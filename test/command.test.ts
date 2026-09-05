import assert from "node:assert/strict";
import test from "node:test";
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

test("/pi-scholar exposes unified management actions", () => {
  const value = harness();
  assert.deepEqual(value.command.getArgumentCompletions("st"), [{ value: "status", label: "status" }]);
  assert.equal(value.command.getArgumentCompletions("unknown"), null);
});
