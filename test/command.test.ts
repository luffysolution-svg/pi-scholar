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
  assert.equal(value.command.getArgumentCompletions("config"), null);
  assert.equal(value.command.getArgumentCompletions("unknown"), null);
});

test("credential commands are removed and never prompt or write configuration", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "scholar-config-only-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "config.json");
  await writeFile(file, "{}");
  const value = harness();
  for (const action of ["setup", "setup-sources", "clear-key"]) {
    assert.equal(value.command.getArgumentCompletions(action), null);
    await assert.rejects(value.command.handler(action, { cwd: dir, hasUI: true, ui: new Proxy({}, { get() { throw new Error("Must not prompt"); } }) }), /apiKey\/apiKeyEnv/);
  }
  assert.equal(await readFile(file, "utf8"), "{}");
  assert.deepEqual(await readdir(dir), ["config.json"]);
  assert.deepEqual(value.sent, []);
});
