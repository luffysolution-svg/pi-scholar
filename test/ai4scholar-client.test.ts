import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  Ai4ScholarError,
  buildUrl,
  clearStoredApiKey,
  getConfigPath,
  loadConfig,
  requestAi4Scholar,
  saveStoredApiKey,
} from "../src/ai4scholar/client.js";

test("loadConfig reads supported environment variables", () => {
  assert.deepEqual(
    loadConfig(
      { AI4SCHOLAR_API_KEY: " key ", AI4SCHOLAR_BASE_URL: "https://example.test/", AI4SCHOLAR_TIMEOUT_MS: "1234" },
      { configPath: null },
    ),
    { apiKey: "key", baseUrl: "https://example.test", timeoutMs: 1234, proxyUrl: undefined },
  );
});

test("stored configuration works without restarting Pi", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-ai4scholar-config-"));
  const env = { PI_CODING_AGENT_DIR: directory };
  const path = await saveStoredApiKey("sk-user-test_12345678", env);
  assert.equal(path, getConfigPath(env));
  assert.equal(loadConfig(env).apiKey, "sk-user-test_12345678");
  assert.equal(await clearStoredApiKey(env), true);
  assert.equal(loadConfig(env).apiKey, "");
});

test("buildUrl encodes query values and skips empty values", () => {
  const url = buildUrl("https://example.test", "/graph/v1/paper/search", {
    query: "graph neural network",
    limit: 5,
    ignored: undefined,
    fields: ["title", "year"],
  });
  assert.equal(url.origin, "https://example.test");
  assert.equal(url.pathname, "/graph/v1/paper/search");
  assert.equal(url.searchParams.get("query"), "graph neural network");
  assert.deepEqual(url.searchParams.getAll("fields"), ["title", "year"]);
});

test("requestAi4Scholar sends Bearer auth and exposes credit headers", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://example.test/pubmed/v1/paper/search");
    assert.equal(init?.method, "POST");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer secret");
    assert.equal(init?.body, '{"query":"CRISPR"}');
    return new Response('{"data":[{"pmid":"1"}]}', {
      status: 200,
      headers: { "content-type": "application/json", "x-credits-charged": "1", "x-credits-remaining": "9" },
    });
  };

  const response = await requestAi4Scholar(
    { apiKey: "secret", baseUrl: "https://example.test", timeoutMs: 1000, proxyUrl: "direct" },
    { method: "POST", path: "/pubmed/v1/paper/search", body: { query: "CRISPR" } },
  );
  assert.deepEqual(response.data, { data: [{ pmid: "1" }] });
  assert.equal(response.creditsCharged, 1);
  assert.equal(response.creditsRemaining, 9);
});

test("requestAi4Scholar rejects missing keys before network access", async () => {
  await assert.rejects(
    () => requestAi4Scholar({ apiKey: "", baseUrl: "https://example.test", timeoutMs: 1000, proxyUrl: "direct" }, { path: "/api/credits" }),
    (error: unknown) => error instanceof Ai4ScholarError && error.message.includes("AI4SCHOLAR_API_KEY"),
  );
});
