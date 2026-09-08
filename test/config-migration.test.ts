import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyConfigMigration, planConfigMigration } from "../src/config-migration.js";
import { loadConfig } from "../src/config.js";

test("v2 configuration rejects unsafe data destinations and policy values", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "scholar-v2-config-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "config.json");
  for (const value of [
    { schemaVersion: 99 },
    { data: { providers: { "materials-project": { endpoint: "https://example.org" } } } },
    { data: { providers: { "materials-project": { apiKey: "not-permitted" } } } },
    { data: { providers: { "cas-common-chemistry": { apiKey: "not-permitted" } } } },
    { data: { providers: { "materials-project": { enabled: "true" } } } },
    { data: { providers: { "materials-project": { maxRequests: "10" } } } },
    { sync: { missingPolicy: "recreate" } },
    { sync: { namespace: "../other" } },
  ]) {
    await writeFile(file, JSON.stringify(value));
    assert.throws(() => loadConfig({ PI_SCHOLAR_CONFIG: file }));
  }
  await writeFile(file, JSON.stringify({ schemaVersion: 2, data: { providers: { "materials-project": { enabled: true, credentialEnv: "MISSING_MP_KEY" }, "cas-common-chemistry": { enabled: false } } }, sync: { cacheDir: "./cache", namespace: "profile-1" } }));
  const config = loadConfig({ PI_SCHOLAR_CONFIG: file });
  assert.equal(config.sync?.cacheDir, path.join(dir, "cache"));
  assert.equal(config.data?.providers?.["materials-project"]?.enabled, true);
  assert.equal(config.data?.providers?.["cas-common-chemistry"]?.enabled, false);
  assert.equal(config.research, undefined);
});

test("migration previews, preserves active config, verifies backup and is idempotent", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "scholar-migration-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "config.json");
  const original = '{"output":{"directory":"./vault"},"mineru":{"tokenEnv":"MY_MINERU_TOKEN"}}\n';
  await writeFile(file, original);
  const plan = await planConfigMigration(file);
  assert.equal(plan.fromVersion, 1);
  assert.equal(await readFile(file, "utf8"), original);
  const result = await applyConfigMigration(plan);
  assert.equal(await readFile(file, "utf8"), original);
  assert.equal(await readFile(result.backupPath!, "utf8"), original);
  assert.equal(loadConfig({ PI_SCHOLAR_CONFIG: result.path }).outputDir, path.join(dir, "vault"));
  assert.equal((await applyConfigMigration(plan)).changed, false);
  assert.equal((await planConfigMigration(result.path)).changed, false);
});

test("migration rejects stale previews and never overwrites an existing candidate", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "scholar-migration-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "config.json");
  await writeFile(file, "{}");
  const plan = await planConfigMigration(file);
  await writeFile(file, '{"mineru":{"language":"ch"}}');
  await assert.rejects(applyConfigMigration(plan), /changed/);
  const updated = await planConfigMigration(file);
  await writeFile(`${file}.v2.json`, "user content");
  await assert.rejects(applyConfigMigration(updated));
  assert.equal(await readFile(`${file}.v2.json`, "utf8"), "user content");
});
