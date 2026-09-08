import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";

export interface ConfigMigrationPlan {
  path: string;
  inputHash: string;
  fromVersion: number;
  toVersion: 2;
  changed: boolean;
  proposed: Record<string, unknown>;
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Preview is read-only and preserves every existing section, including media. */
export async function planConfigMigration(file: string): Promise<ConfigMigrationPlan> {
  const target = path.resolve(file);
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024) throw new Error("Migration requires a regular config file under 64 KB");
  loadConfig({ PI_SCHOLAR_CONFIG: target });
  const text = await readFile(target, "utf8");
  const value = JSON.parse(text) as Record<string, unknown>;
  const version = value.schemaVersion ?? 1;
  if (version !== 1 && version !== 2) throw new Error("Unsupported config version");
  return {
    path: target, inputHash: hash(text), fromVersion: version, toVersion: 2,
    changed: version !== 2,
    proposed: { ...value, schemaVersion: 2 },
  };
}

/** Write a separate reviewed v2 file, never replace the active user's configuration. */
export async function applyConfigMigration(plan: ConfigMigrationPlan): Promise<{ changed: boolean; path: string; backupPath?: string }> {
  const current = await planConfigMigration(plan.path);
  if (current.inputHash !== plan.inputHash || JSON.stringify(current.proposed) !== JSON.stringify(plan.proposed)) throw new Error("Configuration changed; generate a new migration preview");
  if (!current.changed) return { changed: false, path: current.path };
  const original = await readFile(current.path, "utf8");
  const backupPath = `${current.path}.v1-${randomUUID()}.bak`;
  const outputPath = `${current.path}.v2.json`;
  await writeFile(backupPath, original, { flag: "wx", mode: 0o600 });
  if (hash(await readFile(backupPath, "utf8")) !== current.inputHash) throw new Error("Migration backup verification failed");
  const proposed = `${JSON.stringify(current.proposed, null, 2)}\n`;
  // Exclusive creation makes retries and concurrent migration safe: no file is overwritten.
  try { await writeFile(outputPath, proposed, { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST" || await readFile(outputPath, "utf8") !== proposed) throw error;
    await unlink(backupPath);
    return { changed: false, path: outputPath };
  }
  return { changed: true, path: outputPath, backupPath };
}
