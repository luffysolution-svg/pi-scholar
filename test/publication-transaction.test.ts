import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { publishPaper, recoverPublications, mergeGeneratedMarkdown } from "../src/output.js";
import { mineruInfo, paper } from "./helpers.js";

const data = { pdfSha256: "a".repeat(64), mineru: mineruInfo, parsedAt: "2026-09-07T00:00:00Z" };

test("three-way YAML updates preserve unknown user fields and body bytes", () => {
  const base = '---\ntitle: Old\ntags:\n  - one\n---\n\nBody\n';
  const local = '---\ntitle: Old\ntags:\n  - one\nmy_field: "keep spacing" # my comment\n---\n\nBody\n';
  const next = '---\ntitle: New\ntags:\n  - two\n---\n\nBody\n';
  const merged = mergeGeneratedMarkdown(base, local, next);
  assert.match(merged, /title: "New"/);
  assert.match(merged, /my_field: "keep spacing" # my comment/);
  assert.ok(merged.endsWith("\n\nBody\n"));
  assert.throws(() => mergeGeneratedMarkdown(base, local.replace("title: Old", "title: Mine"), next), /CONFLICT/);
});
async function fixture(t: any) {
  const root = await mkdtemp(path.join(os.tmpdir(), "scholar-txn-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const published = await publishPaper(root, paper(), { body: "original", assets: [] }, data);
  return { root, published, original: await readFile(published.markdownPath, "utf8") };
}

test("A02 original rename failure leaves the only original untouched", async t => {
  const { root, published, original } = await fixture(t);
  await assert.rejects(publishPaper(root, paper(), { body: "replacement", assets: [] }, data, undefined, {
    transactionHooks: { rename: async () => { throw new Error("injected original rename failure"); } },
  }), /injected original rename failure/);
  assert.equal(await readFile(published.markdownPath, "utf8"), original);
});

test("installation failure restores the verified staged original", async t => {
  const { root, published, original } = await fixture(t);
  let moves = 0;
  await assert.rejects(publishPaper(root, paper(), { body: "replacement", assets: [] }, data, undefined, {
    transactionHooks: { rename: async (from, to) => { if (++moves === 2) throw new Error("injected install failure"); await rename(from, to); } },
  }), /injected install failure/);
  assert.equal(await readFile(published.markdownPath, "utf8"), original);
});

test("A03 partial backup cleanup failure preserves committed new output", async t => {
  const { root, published } = await fixture(t);
  const result = await publishPaper(root, paper(), { body: "replacement", assets: [] }, data, undefined, {
    backupRetentionDays: 0,
    transactionHooks: { remove: async backup => { await rm(path.join(String(backup), "metadata.json")); throw new Error("injected cleanup failure"); } },
  });
  assert.equal(result.cleanupPending, true);
  assert.match(await readFile(published.markdownPath, "utf8"), /replacement/);
  assert.ok((await recoverPublications(root)).every(item => item.state === "done"));
  assert.match(await readFile(published.markdownPath, "utf8"), /replacement/);
});

test("manifest failure retains both versions and recovery commits idempotently", async t => {
  const { root, published } = await fixture(t);
  await assert.rejects(publishPaper(root, paper(), { body: "replacement", assets: [] }, data, undefined, {
    commit: async () => { throw new Error("injected manifest disk full"); },
  }), /RECOVERY_REQUIRED/);
  assert.match(await readFile(published.markdownPath, "utf8"), /replacement/);
  assert.equal((await readdir(path.dirname(path.dirname(published.markdownPath)))).filter(name => name.startsWith(".pi-scholar-backup-")).length, 1);
  let commits = 0;
  const recovered = await recoverPublications(root, async () => { commits++; });
  assert.ok(recovered.every(item => item.state === "done"));
  await recoverPublications(root, async () => { commits++; });
  assert.equal(commits, 1);
});

test("an external edit after installation is preserved instead of rolled back", async t => {
  const { root, published } = await fixture(t);
  await assert.rejects(publishPaper(root, paper(), { body: "replacement", assets: [] }, data, undefined, {
    transactionHooks: { phase: async phase => { if (phase === "new_installed") await writeFile(published.markdownPath, "external edit"); } },
  }), /RECOVERY_REQUIRED/);
  assert.equal(await readFile(published.markdownPath, "utf8"), "external edit");
  assert.ok((await recoverPublications(root)).some(item => item.state === "recovery_required"));
});

test("repair restores missing artifacts and preserves edited body and extra files byte-for-byte", async t => {
  const { root, published } = await fixture(t);
  const sidecar = JSON.parse(await readFile(published.metadataPath, "utf8"));
  await writeFile(published.markdownPath, "my edited paper\n");
  await writeFile(path.join(path.dirname(published.markdownPath), "notes.md"), "my notes\n");
  await rm(published.metadataPath);
  await publishPaper(root, paper(), { body: "original", assets: [] }, data, undefined, {
    repair: true, baseline: sidecar.publication.baseline,
    targetDirectory: path.relative(root, path.dirname(published.markdownPath)),
  });
  assert.equal(await readFile(published.markdownPath, "utf8"), "my edited paper\n");
  assert.equal(await readFile(path.join(path.dirname(published.markdownPath), "notes.md"), "utf8"), "my notes\n");
  assert.equal(JSON.parse(await readFile(published.metadataPath, "utf8")).zotero.selected_key, "PAPER001");
});

test("process exit at each durable publication stage recovers without losing either version", async t => {
  const source = `
    import { publishPaper } from './src/output.ts';
    import { paper, mineruInfo } from './test/helpers.ts';
    const [root, stop] = process.argv.slice(1);
    await publishPaper(root, paper(), {body:'replacement',assets:[]},
      {pdfSha256:'a'.repeat(64),mineru:mineruInfo,parsedAt:'2026-09-07T00:00:00Z'},
      undefined, {transactionHooks:{phase:async state=>{if(state===stop)process.exit(37)}}});
  `;
  for (const phase of ["prepared", "original_staged", "new_installed", "manifest_committed"]) {
    const { root, published, original } = await fixture(t);
    const exit = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source, root, phase], {
        cwd: fileURLToPath(new URL("..", import.meta.url)), windowsHide: true, stdio: "ignore",
      });
      child.on("error", reject); child.on("exit", resolve);
    });
    assert.equal(exit, 37, phase);
    const result = await recoverPublications(root);
    assert.ok(result.every(item => ["done", "rolled_back"].includes(item.state)), JSON.stringify(result));
    const text = await readFile(published.markdownPath, "utf8");
    if (["prepared", "original_staged"].includes(phase)) assert.equal(text, original);
    else assert.match(text, /replacement/);
    assert.ok((await recoverPublications(root)).every(item => ["done", "rolled_back"].includes(item.state)));
  }
});
