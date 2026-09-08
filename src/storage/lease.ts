import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { lstat, mkdir, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export interface LeaseOwner {
  version: 1;
  token: string;
  host: string;
  pid: number;
  createdAt: number;
  expiresAt: number;
}
export interface LeaseOptions { signal?: AbortSignal; leaseMs?: number }

export async function inspectLease(directory: string): Promise<LeaseOwner | null> {
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("CONFLICT: lease path is not a regular directory");
    const file = path.join(directory, "owner.json");
    const ownerInfo = await lstat(file);
    if (!ownerInfo.isFile() || ownerInfo.isSymbolicLink() || ownerInfo.size > 4096) throw new Error("CONFLICT: invalid lease owner file");
    const raw = JSON.parse(await readFile(file, "utf8")) as LeaseOwner;
    if (raw.version !== 1 || typeof raw.token !== "string" || !raw.token || typeof raw.host !== "string" || !Number.isInteger(raw.pid) || raw.pid < 1 || !Number.isFinite(raw.expiresAt) || !Number.isFinite(raw.createdAt)) throw new Error("CONFLICT: invalid lease owner");
    return raw;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try { await lstat(directory); } catch (missing) { if ((missing as NodeJS.ErrnoException).code === "ENOENT") return null; throw missing; }
    throw new Error("CONFLICT: lease initialization is incomplete; owner cannot be established");
  }
}

function demonstrablyDead(owner: LeaseOwner): boolean {
  // A crashed same-host process can leave a lease whose expiry is still in the
  // future. The PID probe is stronger evidence than age; active or foreign
  // owners remain non-reclaimable.
  if (owner.host !== hostname()) return false;
  try { process.kill(owner.pid, 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
}

async function reclaimDeadLease(directory: string): Promise<void> {
  const reclaim = `${directory}.reclaim`;
  try { await mkdir(reclaim); } catch { throw new Error("CONFLICT: lease reclamation is already in progress or inaccessible"); }
  try {
    const owner = await inspectLease(directory);
    if (!owner) return;
    if (!demonstrablyDead(owner)) throw new Error("CONFLICT: lease is active or its owner cannot be proven dead");
    // A second reclaimer cannot remove a replacement lease while this guard exists.
    // Use nonrecursive removal: unexpected contents remain available for inspection.
    await unlink(path.join(directory, "owner.json"));
    await rmdir(directory);
  } finally { await rmdir(reclaim); }
}

/** Single-host lease. An unknown/foreign owner is never evicted based on age alone. */
export async function withLease<T>(directory: string, task: (signal: AbortSignal) => Promise<T>, options: LeaseOptions = {}): Promise<T> {
  options.signal?.throwIfAborted();
  const duration = options.leaseMs ?? 30_000;
  if (!Number.isInteger(duration) || duration < 100 || duration > 3_600_000) throw new Error("Invalid lease duration");
  const target = path.resolve(directory);
  const parent = await lstat(path.dirname(target));
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error("CONFLICT: lease parent must be a regular directory");
  try { await mkdir(target); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    await reclaimDeadLease(target);
    try { await mkdir(target); } catch { throw new Error("CONFLICT: lease was acquired concurrently; retry after the owner completes"); }
  }
  const owner: LeaseOwner = { version: 1, token: randomUUID(), host: hostname(), pid: process.pid, createdAt: Date.now(), expiresAt: Date.now() + duration };
  const ownerPath = path.join(target, "owner.json");
  try { await writeFile(ownerPath, JSON.stringify(owner), { flag: "wx", mode: 0o600 }); }
  catch (error) { await rmdir(target).catch(() => undefined); throw error; }
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  let heartbeat: Promise<void> = Promise.resolve();
  const timer = setInterval(() => {
    heartbeat = heartbeat.then(async () => {
      if ((await inspectLease(target))?.token !== owner.token) throw new Error("CONFLICT: lease ownership changed");
      owner.expiresAt = Date.now() + duration;
      const temp = path.join(target, `${owner.token}.tmp`);
      await writeFile(temp, JSON.stringify(owner), { mode: 0o600 });
      await rename(temp, ownerPath);
    }).catch(error => { controller.abort(error); });
  }, Math.max(50, Math.floor(duration / 3)));
  timer.unref();
  try {
    const result = await task(signal);
    signal.throwIfAborted();
    if ((await inspectLease(target))?.token !== owner.token) throw new Error("CONFLICT: lease ownership changed before completion");
    return result;
  } finally {
    clearInterval(timer);
    await heartbeat;
    // Never remove a replacement lock or unfamiliar files.
    if ((await inspectLease(target))?.token === owner.token) {
      await unlink(ownerPath);
      await rmdir(target);
    }
  }
}
