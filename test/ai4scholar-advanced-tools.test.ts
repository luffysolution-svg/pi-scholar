import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAdvancedTools } from "../src/ai4scholar/advanced-tools.js";
import { registerRestTools } from "../src/ai4scholar/rest-tools.js";

interface CapturedTool {
  execute: (...args: any[]) => Promise<any>;
}

function capture(register: (pi: ExtensionAPI) => void): Map<string, CapturedTool> {
  const tools = new Map<string, CapturedTool>();
  register({
    registerTool(tool: { name: string }) {
      tools.set(tool.name, tool as unknown as CapturedTool);
    },
  } as unknown as ExtensionAPI);
  return tools;
}

function configure(t: test.TestContext): void {
  const original = {
    key: process.env.AI4SCHOLAR_API_KEY,
    base: process.env.AI4SCHOLAR_BASE_URL,
    proxy: process.env.AI4SCHOLAR_PROXY,
    timeout: process.env.AI4SCHOLAR_TIMEOUT_MS,
  };
  process.env.AI4SCHOLAR_API_KEY = "test-key";
  process.env.AI4SCHOLAR_BASE_URL = "https://example.test";
  process.env.AI4SCHOLAR_PROXY = "direct";
  t.after(() => {
    if (original.key === undefined) delete process.env.AI4SCHOLAR_API_KEY;
    else process.env.AI4SCHOLAR_API_KEY = original.key;
    if (original.base === undefined) delete process.env.AI4SCHOLAR_BASE_URL;
    else process.env.AI4SCHOLAR_BASE_URL = original.base;
    if (original.proxy === undefined) delete process.env.AI4SCHOLAR_PROXY;
    else process.env.AI4SCHOLAR_PROXY = original.proxy;
    if (original.timeout === undefined) delete process.env.AI4SCHOLAR_TIMEOUT_MS;
    else process.env.AI4SCHOLAR_TIMEOUT_MS = original.timeout;
  });
}

function mockFetch(t: test.TestContext, handler: typeof fetch): void {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  t.after(() => { globalThis.fetch = original; });
}

test("Semantic Scholar bulk, match, and autocomplete modes use documented endpoints", async (t) => {
  configure(t);
  const requests: string[] = [];
  mockFetch(t, async (input) => {
    requests.push(String(input));
    return new Response('{"data":[]}');
  });
  const tool = capture(registerRestTools).get("ai4scholar_search")!;

  await tool.execute("1", { source: "semantic_scholar", semanticMode: "bulk", query: "graph|network", sort: "citationCount:desc", token: "next" }, undefined, undefined, {});
  await tool.execute("2", { source: "semantic_scholar", semanticMode: "match", query: "Attention Is All You Need" }, undefined, undefined, {});
  await tool.execute("3", { source: "semantic_scholar", semanticMode: "autocomplete", query: "attent" }, undefined, undefined, {});

  const bulk = new URL(requests[0]);
  assert.equal(bulk.pathname, "/graph/v1/paper/search/bulk");
  assert.equal(bulk.searchParams.get("sort"), "citationCount:desc");
  assert.equal(bulk.searchParams.get("token"), "next");
  assert.equal(new URL(requests[1]).pathname, "/graph/v1/paper/search/match");
  assert.equal(new URL(requests[2]).pathname, "/graph/v1/paper/autocomplete");
});

test("Google Scholar search forwards cites and cluster", async (t) => {
  configure(t);
  let body = "";
  mockFetch(t, async (_input, init) => {
    body = String(init?.body);
    return new Response('{"results":[]}');
  });
  const tool = capture(registerRestTools).get("ai4scholar_search")!;
  await tool.execute("1", { source: "google_scholar", query: "LLM", cites: "c1", cluster: "v1" }, undefined, undefined, {});
  assert.deepEqual(JSON.parse(body), { query: "LLM", page: 1, cites: "c1", cluster: "v1" });
});

test("PubMed dates and patent result count use documented parameter names", async (t) => {
  configure(t);
  const bodies: any[] = [];
  mockFetch(t, async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response("{}");
  });
  const tool = capture(registerRestTools).get("ai4scholar_search")!;
  await tool.execute("1", {
    source: "pubmed", query: "CRISPR", minDate: "2024/01/01", maxDate: "2025/12/31", sort: "date",
  }, undefined, undefined, {});
  await tool.execute("2", {
    source: "google_patents", query: "transformer", limit: 1,
  }, undefined, undefined, {});
  assert.deepEqual(bodies[0], {
    query: "CRISPR", limit: 10, sort: "date", minDate: "2024/01/01", maxDate: "2025/12/31",
  });
  assert.equal(bodies[1].num, 1);
  assert.equal("limit" in bodies[1], false);
});

test("dataset tool covers release, download, and diff paths", async (t) => {
  configure(t);
  const paths: string[] = [];
  mockFetch(t, async (input) => {
    paths.push(new URL(String(input)).pathname);
    return new Response("{}");
  });
  const tool = capture(registerAdvancedTools).get("ai4scholar_dataset")!;
  await tool.execute("1", { action: "list_releases" }, undefined, undefined, {});
  await tool.execute("2", { action: "release_detail", releaseId: "2025-01-01" }, undefined, undefined, {});
  await tool.execute("3", { action: "dataset_download", releaseId: "r1", datasetName: "papers" }, undefined, undefined, {});
  await tool.execute("4", { action: "diffs", startReleaseId: "r1", endReleaseId: "r2", datasetName: "papers" }, undefined, undefined, {});
  assert.deepEqual(paths, [
    "/datasets/v1/release/",
    "/datasets/v1/release/2025-01-01",
    "/datasets/v1/release/r1/dataset/papers",
    "/datasets/v1/diffs/r1/to/r2/papers",
  ]);
});

test("journal tool maps search filters and recommendation body", async (t) => {
  configure(t);
  const requests: Array<{ url: string; body?: string }> = [];
  mockFetch(t, async (input, init) => {
    requests.push({ url: String(input), body: init?.body?.toString() });
    return new Response('{"data":[]}');
  });
  const tool = capture(registerAdvancedTools).get("ai4scholar_journal")!;
  await tool.execute("1", { action: "search", query: "Nature", jcrQuartile: "Q1", minImpactFactor: 5 }, undefined, undefined, {});
  await tool.execute("2", { action: "recommend", title: "Deep Learning for Medical Imaging", topN: 5, categories: ["Radiology"] }, undefined, undefined, {});

  const search = new URL(requests[0].url);
  assert.equal(search.pathname, "/jcr/v1/journals");
  assert.equal(search.searchParams.get("jcr_quartile"), "Q1");
  assert.equal(search.searchParams.get("min_if"), "5");
  assert.equal(new URL(requests[1].url).pathname, "/jrec/v1/recommend");
  assert.deepEqual(JSON.parse(requests[1].body!), {
    title: "Deep Learning for Medical Imaging",
    top_n: 5,
    filters: { categories: ["Radiology"] },
  });
});

test("auto-cite parses progress and result SSE events", async (t) => {
  configure(t);
  const updates: string[] = [];
  process.env.AI4SCHOLAR_TIMEOUT_MS = "1";
  mockFetch(t, async (_input, init) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(init?.signal?.aborted, false, "Auto-Cite should override the short generic timeout");
    return new Response(
      'event: progress\ndata: {"message":"Searching","percent":50}\n\n' +
      'event: result\ndata: {"annotatedText":"Text [1]","references":[{"title":"Paper"}]}\n\n',
      { headers: { "content-type": "text/event-stream", "x-credits-charged": "2" } },
    );
  });
  const tool = capture(registerAdvancedTools).get("ai4scholar_auto_cite")!;
  const result = await tool.execute(
    "1",
    { text: "A".repeat(100), mode: "auto", minCitations: 2, citationStyle: "nature" },
    undefined,
    (update: any) => updates.push(update.content[0].text),
    {},
  );
  assert.match(updates[0], /Searching/);
  assert.equal(result.details.creditsCharged, 2);
  assert.equal(result.details.data.annotatedText, "Text [1]");
});

test("figure tool supports GPT Image 2 and all-action endpoint", async (t) => {
  configure(t);
  let request: { url: string; body: string } | undefined;
  mockFetch(t, async (input, init) => {
    request = { url: String(input), body: String(init?.body) };
    return new Response('{"success":true,"imageUrl":"https://example.test/image.png"}');
  });
  const tool = capture(registerAdvancedTools).get("ai4scholar_figure")!;
  await tool.execute("1", { action: "smart", prompt: "cell pathway", model: "gptimage", imageSize: "2K", lang: "zh" }, undefined, undefined, {});
  assert.equal(new URL(request!.url).pathname, "/api/proxy/nano/generate");
  assert.deepEqual(JSON.parse(request!.body), {
    action: "smart",
    prompt: "cell pathway",
    model: "gptimage",
    imageSize: "2K",
    aspectRatio: "1:1",
    lang: "zh",
    vectorizeMode: "fast",
  });
  await assert.rejects(
    () => tool.execute("2", { action: "vectorize" }, undefined, undefined, {}),
    /images URL/,
  );
});
