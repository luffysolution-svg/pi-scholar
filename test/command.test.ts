import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerScholarCommand } from "../src/command.js";

function harness() {
  let command: any;
  const sent: any[] = [];
  const pi = {
    registerCommand(name: string, value: any) { assert.equal(name, "pi-scholar"); command = value; },
    getCommands() { return [{ name: "skill:pi-scholar", source: "skill" }]; },
    sendUserMessage(content: string, options: unknown) { sent.push({ content, options }); },
  };
  registerScholarCommand(pi as any);
  return { get command() { return command; }, sent };
}

const context = { hasUI: true, ui: { input: async () => undefined, notify() {}, confirm: async () => false } };

test("/pi-scholar routes natural language only through the orchestrator skill", async () => {
  const value = harness();
  await value.command.handler("检索并分析光热催化论文", context);
  assert.deepEqual(value.sent, [{ content: "/skill:pi-scholar 检索并分析光热催化论文", options: { expandPromptTemplates: true, deliverAs: "followUp" } }]);
});

test("/pi-scholar status reports configured image providers without secrets", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "scholar-command-"));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "config.json");
  await writeFile(file, JSON.stringify({ media: { providerOptions: { openai: { apiKeyEnv: "STATUS_OPENAI_KEY" } } } }));
  const previous = { config: process.env.PI_SCHOLAR_CONFIG, openai: process.env.STATUS_OPENAI_KEY, ai4: process.env.AI4SCHOLAR_API_KEY };
  process.env.PI_SCHOLAR_CONFIG = file;
  process.env.STATUS_OPENAI_KEY = "never-show-this-key";
  process.env.AI4SCHOLAR_API_KEY = "ai4scholar-secret";
  t.after(() => {
    for (const [name, value] of [["PI_SCHOLAR_CONFIG", previous.config], ["STATUS_OPENAI_KEY", previous.openai], ["AI4SCHOLAR_API_KEY", previous.ai4]] as const) value === undefined ? delete process.env[name] : process.env[name] = value;
  });
  let notification = "";
  const value = harness();
  await value.command.handler("status", { hasUI: true, cwd: dir, isProjectTrusted: () => false, ui: { notify(message: string) { notification = message; } } });
  assert.match(notification, /绘图供应商 openai/);
  assert.doesNotMatch(notification, /never-show-this-key|ai4scholar-secret/);
});

test("/pi-scholar exposes unified management actions", () => {
  const value = harness();
  assert.deepEqual(value.command.getArgumentCompletions("st"), [{ value: "status", label: "status" }]);
  assert.equal(value.command.getArgumentCompletions("unknown"), null);
});

test("source setup writes a reviewed environment reference without changing active config or fetching", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "scholar-setup-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "config.json");
  await writeFile(file, "{}");
  const previous = process.env.PI_SCHOLAR_CONFIG;
  process.env.PI_SCHOLAR_CONFIG = file;
  t.after(() => { if (previous === undefined) delete process.env.PI_SCHOLAR_CONFIG; else process.env.PI_SCHOLAR_CONFIG = previous; });
  let preview = "";
  await harness().command.handler("setup-sources", {
    hasUI: true, cwd: dir, isProjectTrusted: () => false,
    ui: {
      select: async () => "materials-project", input: async () => "CUSTOM_MP_KEY",
      confirm: async (_title: string, message: string) => { preview = message; return true; }, notify() {},
    },
  });
  assert.match(preview, /CUSTOM_MP_KEY/);
  assert.equal(await readFile(file, "utf8"), "{}");
  const candidate = (await readdir(dir)).find(name => name.startsWith("config.json.sources-"))!;
  const parsed = JSON.parse(await readFile(path.join(dir, candidate), "utf8"));
  assert.deepEqual(parsed.data.providers["materials-project"], { enabled: true, credentialEnv: "CUSTOM_MP_KEY" });

  await harness().command.handler("setup-sources", {
    hasUI: true, cwd: dir, isProjectTrusted: () => false,
    ui: {
      select: async () => "cas-common-chemistry", input: async () => { throw new Error("CAS contract is not known, so setup must not require a guessed credential"); },
      confirm: async () => true, notify() {},
    },
  });
  const candidates = await Promise.all((await readdir(dir)).filter(name => name.startsWith("config.json.sources-")).map(async name => JSON.parse(await readFile(path.join(dir, name), "utf8"))));
  assert.ok(candidates.some(value => value.data?.providers?.["cas-common-chemistry"]?.enabled === true));
  assert.equal(await readFile(file, "utf8"), "{}");
});
