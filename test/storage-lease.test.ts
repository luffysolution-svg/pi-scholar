import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { withLease, inspectLease } from "../src/storage/lease.js";

test("active leases exclude concurrent writers and release after failure", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "scholar-lease-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const lock = path.join(dir, "lock");
  await withLease(lock, async () => {
    assert.equal((await inspectLease(lock))?.pid, process.pid);
    await assert.rejects(withLease(lock, async () => 1), /CONFLICT/);
  });
  assert.equal(await inspectLease(lock), null);
  await assert.rejects(withLease(lock, async () => { throw new Error("task failed"); }), /task failed/);
  assert.equal(await withLease(lock, async () => 2), 2);
});

test("expired foreign and indeterminate lease owners are never stolen", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "scholar-lease-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const lock = path.join(dir, "lock");
  await mkdir(lock);
  await writeFile(path.join(lock, "owner.json"), JSON.stringify({ version: 1, token: "foreign", host: "another-device", pid: 1, createdAt: 1, expiresAt: 2 }));
  await assert.rejects(withLease(lock, async () => 1), /cannot be proven dead/);
  assert.equal((await inspectLease(lock))?.token, "foreign");
  await writeFile(path.join(lock, "owner.json"), "broken");
  await assert.rejects(withLease(lock, async () => 1));
});
