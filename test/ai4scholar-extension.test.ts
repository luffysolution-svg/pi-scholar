import assert from "node:assert/strict";
import test from "node:test";
import registerOnlineResearchTools from "../src/ai4scholar/index.js";

test("integrated online research layer registers tools without a separate command", () => {
  const tools: string[] = [];
  const commands: string[] = [];
  registerOnlineResearchTools({
    registerTool(tool: { name: string }) { tools.push(tool.name); },
    registerCommand(name: string) { commands.push(name); },
    on() {},
  } as any);
  assert.equal(tools.length, 12);
  assert.ok(tools.includes("ai4scholar_search"));
  assert.ok(tools.includes("ai4scholar_citation_candidates"));
  assert.ok(tools.includes("ai4scholar_figure"));
  assert.ok(!tools.some(name => name.includes("mcp")));
  assert.deepEqual(commands, []);
});
