import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import type { PublishedPaper } from "../model.js";

export type FileSnapshot = Record<string, string>;
export type PublicationPhase = "prepared" | "original_staged" | "new_installed" | "manifest_committed" | "cleanup_pending" | "done" | "rolled_back" | "recovery_required";
interface Journal {
  version: 1; id: string; publicationId: string; state: PublicationPhase;
  original: string | null; destination: string; backup: string; stage: string;
  before: FileSnapshot | null; after: FileSnapshot; published: PublishedPaper;
  requiresCommit: boolean; retainUntil: number;
}
export interface PublicationHooks {
  commit?: (published: PublishedPaper) => Promise<void>;
  /** Dependency injection for filesystem failure tests, not exposed as a tool argument. */
  rename?: typeof rename;
  remove?: typeof rm;
  phase?: (phase: PublicationPhase) => Promise<void>;
}
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const same = (a: FileSnapshot | null, b: FileSnapshot | null) => JSON.stringify(a) === JSON.stringify(b);
export async function pathExists(file: string): Promise<boolean> {
  try { await lstat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
export async function confinedPath(root: string, value: string): Promise<string> {
  const base = path.resolve(root), target = path.resolve(base, value), relative = path.relative(base, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("CONFLICT: publication path escapes output root");
  let current = base;
  for (const part of ["", ...relative.split(path.sep)]) {
    if (part) current = path.join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error("CONFLICT: symbolic links are not supported in publication paths"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return target;
}
export async function snapshotTree(directory: string): Promise<FileSnapshot> {
  const output: FileSnapshot = {};
  async function walk(current: string, relative: string): Promise<void> {
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error("CONFLICT: publication contains a symbolic link");
    if (info.isDirectory()) {
      if (relative) output[`${relative}/`] = "directory";
      for (const name of (await readdir(current)).sort()) await walk(path.join(current, name), relative ? `${relative}/${name}` : name);
    } else if (info.isFile()) output[relative] = digest(await readFile(current));
    else throw new Error("CONFLICT: publication contains an unsupported filesystem entry");
  }
  await walk(directory, "");
  return output;
}
async function journalWrite(file: string, journal: Journal): Promise<void> {
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(journal, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  await rename(temp, file);
}
function relative(root: string, target: string): string { return path.relative(root, target).replaceAll(path.sep, "/"); }

/** Install and manifest commit share a recovery journal; backups outlive failed commits. */
export async function installPublication(input: {
  root: string; stage: string; destination: string; original: string | null;
  before: FileSnapshot | null; published: PublishedPaper; retentionDays?: number;
  signal?: AbortSignal; hooks?: PublicationHooks;
}): Promise<PublishedPaper> {
  const root = path.resolve(input.root), hooks = input.hooks ?? {};
  const move = hooks.rename ?? rename;
  const destination = await confinedPath(root, input.destination);
  const stage = await confinedPath(root, input.stage);
  const original = input.original ? await confinedPath(root, input.original) : null;
  const id = randomUUID();
  const backup = await confinedPath(root, path.join(path.dirname(destination), `.pi-scholar-backup-${id}`));
  const journals = await confinedPath(root, ".pi-scholar/transactions");
  await mkdir(journals, { recursive: true });
  const file = path.join(journals, `${id}.json`);
  const journal: Journal = {
    version: 1, id, publicationId: input.published.publicationId!, state: "prepared",
    original: original ? relative(root, original) : null, destination: relative(root, destination),
    stage: relative(root, stage), backup: relative(root, backup), before: input.before,
    after: await snapshotTree(stage), published: input.published, requiresCommit: Boolean(hooks.commit),
    retainUntil: Date.now() + (input.retentionDays ?? 30) * 86_400_000,
  };
  const phase = async (state: PublicationPhase) => { journal.state = state; await journalWrite(file, journal); await hooks.phase?.(state); };
  await phase("prepared");
  let staged = false, installed = false, commitStarted = false;
  try {
    input.signal?.throwIfAborted();
    if (original) {
      if (!same(await snapshotTree(original), input.before)) throw new Error("CONFLICT: publication changed during preparation");
      await move(original, backup); staged = true;
      if (!same(await snapshotTree(backup), input.before)) throw new Error("CONFLICT: publication changed while staging backup");
      await phase("original_staged");
    }
    if (await pathExists(destination)) throw new Error("CONFLICT: publication destination appeared during transaction");
    input.signal?.throwIfAborted();
    await move(stage, destination); installed = true;
    await phase("new_installed");
    if (!same(await snapshotTree(destination), journal.after)) throw new Error("CONFLICT: installed publication was changed externally");
    input.signal?.throwIfAborted();
    commitStarted = true;
    await hooks.commit?.(input.published);
    await phase("manifest_committed");
  } catch (error) {
    // Once manifest commit was attempted, its outcome may be uncertain. Preserve both versions.
    if (commitStarted) {
      journal.state = "recovery_required";
      await journalWrite(file, journal).catch(() => undefined);
      throw new Error("RECOVERY_REQUIRED: manifest commit did not finish; installed output and backup were preserved", { cause: error });
    }
    try {
      if (installed) {
        if (!same(await snapshotTree(destination), journal.after)) throw new Error("External changes prevent automatic rollback");
        // Retain the generated candidate as the stage instead of deleting a possibly useful version.
        if (await pathExists(stage)) throw new Error("Stage path occupied during rollback");
        await move(destination, stage);
      }
      if (staged && original) {
        if (await pathExists(original)) throw new Error("Original path occupied during rollback");
        await move(backup, original);
      }
      await phase("rolled_back");
    } catch (rollbackError) {
      journal.state = "recovery_required";
      await journalWrite(file, journal).catch(() => undefined);
      throw new AggregateError([error, rollbackError], "RECOVERY_REQUIRED: publication rollback could not finish; retained versions require recovery");
    }
    throw error;
  }
  // Cleanup failure never enters rollback. Default retention keeps the verified original.
  if (staged && journal.retainUntil <= Date.now()) {
    try {
      await phase("cleanup_pending");
      await (hooks.remove ?? rm)(backup, { recursive: true, force: true });
    } catch { journal.state = "cleanup_pending"; await journalWrite(file, journal).catch(() => undefined); return { ...input.published, cleanupPending: true }; }
  }
  try { await phase("done"); } catch { return { ...input.published, cleanupPending: true }; }
  return input.published;
}

/** Caller holds the publication lease. Recovery never guesses ownership from names alone. */
export async function recoverPublications(rootInput: string, commit?: (published: PublishedPaper) => Promise<void>): Promise<Array<{ id: string; state: string; reason?: string }>> {
  const root = path.resolve(rootInput), directory = await confinedPath(root, ".pi-scholar/transactions");
  if (!await pathExists(directory)) return [];
  const results: Array<{ id: string; state: string; reason?: string }> = [];
  for (const name of (await readdir(directory)).filter(name => name.endsWith(".json"))) {
    const file = await confinedPath(root, path.join(directory, name));
    let journal: Journal;
    try {
      journal = JSON.parse(await readFile(file, "utf8"));
      if (journal.version !== 1 || !journal.id || !journal.after || !journal.published) throw new Error("Unknown journal schema");
      if (["done", "rolled_back"].includes(journal.state)) { results.push({ id: journal.id, state: journal.state }); continue; }
      const destination = await confinedPath(root, journal.destination), backup = await confinedPath(root, journal.backup);
      const original = journal.original ? await confinedPath(root, journal.original) : null;
      if (await pathExists(destination) && same(await snapshotTree(destination), journal.after)) {
        if (journal.requiresCommit && !["manifest_committed", "cleanup_pending"].includes(journal.state)) {
          if (!commit) throw new Error("An idempotent manifest commit is required to finalize this publication");
          const published = { ...journal.published, markdownPath: await confinedPath(root, journal.published.markdownPath), metadataPath: await confinedPath(root, journal.published.metadataPath), assetsDirectory: await confinedPath(root, journal.published.assetsDirectory) };
          await commit(published);
        }
        journal.state = "done"; // Keep backups during recovery, even when retention elapsed.
      } else if (original && await pathExists(backup) && !await pathExists(original) && !await pathExists(destination)) {
        if (!same(await snapshotTree(backup), journal.before)) throw new Error("Backup differs from recorded original");
        await rename(backup, original); journal.state = "rolled_back";
      } else if (original && await pathExists(original) && !await pathExists(backup) && same(await snapshotTree(original), journal.before)) {
        journal.state = "rolled_back";
      } else if (!original && !await pathExists(destination) && !await pathExists(backup) && journal.state === "prepared") {
        journal.state = "rolled_back";
      } else throw new Error("Current files do not match a recoverable transaction phase; preserve all versions for review");
      await journalWrite(file, journal);
      results.push({ id: journal.id, state: journal.state });
    } catch (error) { results.push({ id: name, state: "recovery_required", reason: error instanceof Error ? error.message : "Invalid transaction journal" }); }
  }
  return results;
}

/** Prune expired, verified backups only while the committed replacement is still intact. */
export async function cleanupPublicationBackups(rootInput: string): Promise<Array<{ id:string; removed:boolean }>> {
  const root=path.resolve(rootInput), directory=await confinedPath(root,".pi-scholar/transactions");
  if(!await pathExists(directory))return [];
  const results:Array<{id:string;removed:boolean}>=[];
  for(const name of (await readdir(directory)).filter(name=>name.endsWith(".json"))){
    const file=await confinedPath(root,path.join(directory,name));
    const journal=JSON.parse(await readFile(file,"utf8")) as Journal;
    if(journal.version!==1||!["done","cleanup_pending"].includes(journal.state)||!Number.isFinite(journal.retainUntil)||journal.retainUntil>Date.now())continue;
    const backup=await confinedPath(root,journal.backup),destination=await confinedPath(root,journal.destination);
    if(!await pathExists(backup))continue;
    if(!await pathExists(destination)||!same(await snapshotTree(destination),journal.after)||!same(await snapshotTree(backup),journal.before)){results.push({id:journal.id,removed:false});continue;}
    await rm(backup,{recursive:true,force:true});
    journal.state="done";await journalWrite(file,journal);
    results.push({id:journal.id,removed:true});
  }
  return results;
}
