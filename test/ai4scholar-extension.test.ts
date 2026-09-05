import assert from "node:assert/strict";
import test from "node:test";
import ai4ScholarExtension from "../src/ai4scholar/index.js";

function createHarness() {
  let command: any;
  let activeTools = ["read"];
  const tools: any[] = [];
  const hooks = new Map<string, any[]>();
  const sent: Array<{ content: unknown; options: unknown }> = [];
  const notifications: string[] = [];
  let editorText: string | undefined;

  const pi = {
    registerTool(tool: any) {
      tools.push(tool);
    },
    on(event: string, handler: any) {
      hooks.set(event, [...(hooks.get(event) ?? []), handler]);
    },
    registerCommand(name: string, definition: any) {
      if (name === "ai4scholar") command = definition;
    },
    getAllTools() {
      return tools;
    },
    getActiveTools() {
      return activeTools;
    },
    setActiveTools(names: string[]) {
      activeTools = names;
    },
    sendUserMessage(content: unknown, options?: unknown) {
      sent.push({ content, options });
    },
  };

  ai4ScholarExtension(pi as any);
  return {
    get command() { return command; },
    get activeTools() { return activeTools; },
    hooks,
    sent,
    notifications,
    get editorText() { return editorText; },
    context(idle = true) {
      return {
        isIdle: () => idle,
        ui: {
          notify(message: string) {
            notifications.push(message);
          },
          setEditorText(message: string) {
            editorText = message;
          },
          confirm: async () => false,
          input: async () => undefined,
        },
      };
    },
  };
}

test("natural language after /ai4scholar starts a turn with Ai4Scholar tools and no visible prefix", async () => {
  const harness = createHarness();
  const query = "帮我查一下钙钛矿太阳能电池文献";

  assert.ok(harness.command);
  await harness.command.handler(query, harness.context());

  assert.deepEqual(harness.sent, [{ content: query, options: undefined }]);
  assert.equal(harness.editorText, undefined);
  assert.deepEqual(harness.notifications, []);
  assert.ok(harness.activeTools.includes("read"));
  assert.ok(harness.activeTools.includes("ai4scholar_search"));
  assert.ok(harness.activeTools.includes("ai4scholar_figure"));

  const beforeAgentStart = harness.hooks.get("before_agent_start")?.[0];
  assert.ok(beforeAgentStart);
  const routed = beforeAgentStart({ prompt: query, systemPrompt: "base prompt" });
  assert.match(routed.systemPrompt, /must call at least one relevant active ai4scholar_\* tool/);
  assert.doesNotMatch(harness.sent[0].content as string, /ai4scholar_\*/);
  assert.equal(beforeAgentStart({ prompt: query, systemPrompt: "base prompt" }), undefined);
});

test("natural language is queued as a follow-up when the agent is busy", async () => {
  const harness = createHarness();
  await harness.command.handler("检索最新论文", harness.context(false));
  assert.deepEqual(harness.sent, [{ content: "检索最新论文", options: { deliverAs: "followUp" } }]);
});
