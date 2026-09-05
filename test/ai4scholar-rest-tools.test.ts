import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerRestTools } from "../src/ai4scholar/rest-tools.js";

interface CapturedTool {
  execute: (...args: any[]) => Promise<any>;
}

function captureTools(): Map<string, CapturedTool> {
  const tools = new Map<string, CapturedTool>();
  registerRestTools({
    registerTool(tool: { name: string }) {
      tools.set(tool.name, tool as unknown as CapturedTool);
    },
  } as unknown as ExtensionAPI);
  return tools;
}

function configureTestEnvironment(t: test.TestContext): void {
  const originalKey = process.env.AI4SCHOLAR_API_KEY;
  const originalBase = process.env.AI4SCHOLAR_BASE_URL;
  const originalProxy = process.env.AI4SCHOLAR_PROXY;
  process.env.AI4SCHOLAR_API_KEY = "test-key";
  process.env.AI4SCHOLAR_BASE_URL = "https://example.test";
  process.env.AI4SCHOLAR_PROXY = "direct";
  t.after(() => {
    if (originalKey === undefined) delete process.env.AI4SCHOLAR_API_KEY;
    else process.env.AI4SCHOLAR_API_KEY = originalKey;
    if (originalBase === undefined) delete process.env.AI4SCHOLAR_BASE_URL;
    else process.env.AI4SCHOLAR_BASE_URL = originalBase;
    if (originalProxy === undefined) delete process.env.AI4SCHOLAR_PROXY;
    else process.env.AI4SCHOLAR_PROXY = originalProxy;
  });
}

test("Semantic Scholar relevance search does not send unsupported sort", async (t) => {
  configureTestEnvironment(t);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response('{"data":[]}', { status: 200 });
  };

  const tool = captureTools().get("ai4scholar_search");
  assert.ok(tool);
  await tool.execute(
    "call",
    { source: "semantic_scholar", query: "LLM", sort: "citationCount:desc" },
    undefined,
    undefined,
    {},
  );

  const url = new URL(requestedUrl);
  assert.equal(url.pathname, "/graph/v1/paper/search");
  assert.equal(url.searchParams.has("sort"), false);
});

test("Semantic Scholar paper authors use author fields by default", async (t) => {
  configureTestEnvironment(t);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response('{"data":[]}', { status: 200 });
  };

  const tool = captureTools().get("ai4scholar_paper");
  assert.ok(tool);
  await tool.execute(
    "call",
    { source: "semantic_scholar", action: "authors", id: "DOI:10.1000/example" },
    undefined,
    undefined,
    {},
  );

  const url = new URL(requestedUrl);
  assert.equal(url.pathname, "/graph/v1/paper/DOI:10.1000%2Fexample/authors");
  assert.match(url.searchParams.get("fields") ?? "", /authorId/);
  assert.doesNotMatch(url.searchParams.get("fields") ?? "", /paperId/);
});
