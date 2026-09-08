import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { disabledResearchConfig, validateResearchConfig } from "../src/research/config.js";
import { redactSecrets, ResearchError } from "../src/research/errors.js";
import { requestJson } from "../src/research/network.js";
import { DefaultResearchRouter } from "../src/research/router.js";
import { ArxivProvider, CrossrefProvider, EasyScholarProvider, OpenAlexProvider, PubmedProvider, SemanticScholarProvider, UnpaywallProvider, createResearchProviders } from "../src/research/providers/index.js";
import type { LiteratureProvider } from "../src/research/types.js";
import { registerResearchTools } from "../src/research/tools.js";

test("research config validates credential references and legacy defaults are disabled", () => {
  assert.equal(disabledResearchConfig().providers.crossref?.enabled, false);
  assert.throws(() => validateResearchConfig({ providers: { crossref: { enabled: "true" } } }), /enabled must be boolean/);
  assert.throws(() => validateResearchConfig({ providers: { crossref: { apiKey: "secret" } } }), /Invalid research.providers.crossref field/);
});

test("redaction recursively removes credentials and signed query values", () => {
  const value = redactSecrets({ Authorization: "Bearer abc", nextPage: "https://api.example.test/x?api_key=abc&cursor=ok", nested: [{ token: "secret" }] });
  assert.equal((value as any).Authorization, "[REDACTED]");
  assert.match((value as any).nextPage, /api_key=%5BREDACTED%5D/);
  assert.equal((value as any).nested[0].token, "[REDACTED]");
});

test("network accepts only official HTTPS hosts and redacts URL query keys", async () => {
  const fetchImpl = (async (url: URL) => new Response(JSON.stringify({ apiKey: "hidden", ok: true }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  const response = await requestJson({ provider: "openalex", url: "https://api.openalex.org/works?api_key=secret", fetchImpl });
  assert.equal((response.data as any).apiKey, "[REDACTED]");
  assert.match(response.url, /api_key=%5BREDACTED%5D/);
  await assert.rejects(() => requestJson({ provider: "openalex", url: "http://api.openalex.org/works", fetchImpl }), (error: unknown) => error instanceof ResearchError && error.code === "SOURCE_UNAVAILABLE");
});

test("router never implicitly chooses paid providers", async () => {
  const paid: LiteratureProvider = {
    status: { id: "paid", name: "paid", enabled: true, paid: true, implementationStatus: "implemented", credentialStatus: "configured", accessStatus: "public", validationStatus: "mock_passed", capabilities: [{ id: "literature.search", implementationStatus: "implemented", docs: "https://example.test" }], docs: [], limitations: [] },
    async search() { return { provider: "paid", items: [], warnings: [], usage: { requests: 1, costKnown: false } }; },
  };
  const config = validateResearchConfig({ providers: Object.fromEntries(Object.keys(disabledResearchConfig().providers).map((id) => [id, { enabled: false }])) });
  const router = new DefaultResearchRouter({ ...config, providers: { ...config.providers, paid: { enabled: true } } }, [paid]);
  await assert.rejects(() => router.search({ query: "test" }), /No enabled|paid providers/);
  const result = await router.search({ query: "test", provider: "paid" });
  assert.equal((result as any).provider, "paid");
});

test("implicit discovery uses only the highest-priority enabled source", async () => {
  const called: string[] = [];
  const provider = (id: string): LiteratureProvider => ({
    status: { id, name: id, enabled: true, paid: false, implementationStatus: "implemented", credentialStatus: "not_required", accessStatus: "public", validationStatus: "mock_passed", capabilities: [{ id: "literature.search", implementationStatus: "implemented", docs: "https://example.test" }], docs: [], limitations: [] },
    async search() { called.push(id); return { provider: id, items: [], warnings: [], usage: { requests: 1, costKnown: false } }; },
  });
  const base = validateResearchConfig({ providers: Object.fromEntries(Object.keys(disabledResearchConfig().providers).map(id => [id, { enabled: false }])) });
  const config = { ...base, providers: { ...base.providers, primary: { enabled: true, priority: 100, maxRequests: 10 }, secondary: { enabled: true, priority: 10, maxRequests: 10 } } };
  const router = new DefaultResearchRouter(config, [provider("secondary"), provider("primary")]);
  assert.equal((await router.search({ query: "test" }) as any).provider, "primary");
  assert.deepEqual(called, ["primary"]);
});

test("Crossref adapter maps a documented list response and preserves pagination totals", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ message: { "total-results": 1, items: [{ DOI: "10.5555/example", title: ["Example"], author: [{ given: "Ada", family: "Lovelace" }], published: { "date-parts": [[2024]] }, "container-title": ["Journal"] }] } }), { status: 200 })) as typeof fetch;
  try {
    const provider = new CrossrefProvider({ enabled: true, timeoutMs: 30000, maxRequests: 10, budget: 10 }, "crossref");
    const found = await provider.search({ query: "example", limit: 1 });
    assert.equal(found.items[0]?.doi, "10.5555/example");
    assert.equal(found.total, 1);
  } finally { globalThis.fetch = previous; }
});

test("Semantic Scholar adapter accepts an empty result page without inventing records", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ total: 0, offset: 0, data: [] }), { status: 200 })) as typeof fetch;
  try {
    const provider = new SemanticScholarProvider({ enabled: true, timeoutMs: 30000, maxRequests: 10, budget: 10 }, "semantic-scholar");
    const found = await provider.search({ query: "nonsense", limit: 1 });
    assert.deepEqual(found.items, []);
  } finally { globalThis.fetch = previous; }
});

test("provider responses with drift fail closed and credential headers use the documented name", async () => {
  const previous = globalThis.fetch;
  let seenHeader = "";
  globalThis.fetch = (async (_url: URL, init?: RequestInit) => { seenHeader = new Headers(init?.headers).get("x-api-key") ?? ""; return new Response(JSON.stringify({ unexpected: true }), { status: 200 }); }) as typeof fetch;
  const oldKey = process.env.RESEARCH_TEST_S2_KEY;
  process.env.RESEARCH_TEST_S2_KEY = "test-key";
  try {
    const provider = new SemanticScholarProvider({ enabled: true, credentialEnv: "RESEARCH_TEST_S2_KEY", timeoutMs: 30000, maxRequests: 10, budget: 10 }, "semantic-scholar");
    await assert.rejects(() => provider.search({ query: "drift", limit: 1 }), (error: unknown) => error instanceof ResearchError && error.code === "SCHEMA_MISMATCH");
    assert.equal(seenHeader, "test-key");
  } finally { globalThis.fetch = previous; if (oldKey === undefined) delete process.env.RESEARCH_TEST_S2_KEY; else process.env.RESEARCH_TEST_S2_KEY = oldKey; }
});

test("research registry contains only the approved literature sources", () => {
  const config = validateResearchConfig({ contact: "researcher@example.org" });
  const providers = createResearchProviders(config);
  assert.deepEqual(providers.map((provider) => provider.status.id), ["semantic-scholar", "openalex", "pubmed", "arxiv", "crossref", "unpaywall", "easyscholar"]);
  for (const removed of ["elsevier", "scopus", "springer", "web-of-science", "wiley", "ai4scholar", "cas"]) {
    assert.throws(() => validateResearchConfig({ providers: { [removed]: { enabled: true } } }), /Unknown research provider/);
  }
  assert.equal(providers.find((provider) => provider.status.id === "unpaywall")?.status.validationStatus, "mock_passed");
  const easy = new EasyScholarProvider({ enabled: true });
  assert.equal(easy.status.implementationStatus, "implemented");
  assert.equal(easy.status.capabilities[0]?.implementationStatus, "implemented");
});

test("Unpaywall uses contact metadata and redacts the email from request URLs", async () => {
  const previous = globalThis.fetch;
  let seen = "";
  globalThis.fetch = (async (url: URL) => { seen = url.toString(); return new Response(JSON.stringify({ doi: "10.5555/example", title: "Example", is_oa: true, oa_status: "green", oa_locations: [{ url_for_pdf: "https://repository.example/paper.pdf", version: "acceptedVersion", license: "cc-by" }] }), { status: 200 }); }) as typeof fetch;
  try {
    const provider = new UnpaywallProvider({ enabled: true, contact: "researcher@example.org", timeoutMs: 30000, maxRequests: 10, budget: 10 }, "unpaywall");
    const found = await provider.get("10.5555/example");
    assert.equal(found.openAccessUrl, "https://repository.example/paper.pdf");
    assert.match(redactSecrets(seen), /email=%5BREDACTED%5D/);
    assert.match(seen, /researcher%40example/);
  } finally { globalThis.fetch = previous; }
});

test("non-search sources expose only verified capabilities and credential state", async () => {
  const unpaywall = new UnpaywallProvider({ enabled: true, contact: "researcher@example.org", timeoutMs: 30000, maxRequests: 10, budget: 10 }, "unpaywall");
  assert.equal(unpaywall.status.capabilities.some((item) => item.id === "literature.search"), false);
  await assert.rejects(() => unpaywall.search({ query: "not a DOI search" }), /does not support literature\.search/);
  const easy = new EasyScholarProvider({ enabled: true, credentialEnv: "RESEARCH_TEST_MISSING_EASY_KEY", timeoutMs: 30000, maxRequests: 10, budget: 10 });
  assert.equal(easy.status.credentialStatus, "missing");
  assert.equal(easy.status.accessStatus, "restricted");
});

test("arXiv full-text fetch stores bounded binary PDF bytes in the research cache", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-scholar-arxiv-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = validateResearchConfig({ cacheDir: root, providers: { arxiv: { enabled: true } } });
  const tools: any[] = [];
  registerResearchTools({ registerTool: (tool: any) => tools.push(tool) } as any, config);
  const previous = globalThis.fetch;
  globalThis.fetch = (async () => new Response(Buffer.from("%PDF-1.7\nmock"), { status: 200, headers: { "content-type": "application/pdf" } })) as typeof fetch;
  try {
    const tool = tools.find(tool => tool.name === "literature_fulltext");
    const result = await tool.execute("call", { provider: "arxiv", id: "2401.00001v2", action: "fetch" }, undefined, undefined, { cwd: root, isProjectTrusted: () => false });
    const value = JSON.parse(result.content[0].text);
    assert.equal(value.bytes, 13);
    assert.equal(await readFile(value.localPath, "utf8"), "%PDF-1.7\nmock");
    assert.match(value.localPath, /fulltext[\\/]arxiv[\\/].+\.pdf$/);
    assert.equal(Object.hasOwn(value, "content"), false);
  } finally { globalThis.fetch = previous; }
});

test("OpenAlex preserves author institutions and reported request cost", async () => {
  const previous = globalThis.fetch;
  let requested: URL | undefined;
  globalThis.fetch = (async (url: URL) => { requested = url; return new Response(JSON.stringify({ meta: { count: 1, cost_usd: 0.002 }, results: [{ id: "https://openalex.org/W1", title: "Example", authorships: [{ author: { id: "https://openalex.org/A1", display_name: "Ada" }, institutions: [{ id: "https://openalex.org/I1", display_name: "Example University" }] }] }] }), { status: 200 }); }) as typeof fetch;
  try {
    const found = await new OpenAlexProvider({ enabled: true, timeoutMs: 30000, maxRequests: 10, budget: 10 }, "openalex").search({ query: "example", limit: 200 });
    assert.equal(requested?.searchParams.get("per-page") ?? requested?.searchParams.get("per_page"), "100");
    assert.equal(found.items[0]?.authors[0]?.institutions?.[0]?.name, "Example University");
    assert.equal(found.usage.costKnown, true);
    assert.equal(found.usage.estimatedCost, 0.002);
  } finally { globalThis.fetch = previous; }
});

test("PubMed maps article identifiers and sends the correct ELink relation", async () => {
  const previous = globalThis.fetch;
  const urls: URL[] = [];
  globalThis.fetch = (async (url: URL) => { urls.push(url); if (url.pathname.endsWith("esearch.fcgi")) return new Response(JSON.stringify({ esearchresult: { idlist: ["1"], count: "1" } }), { status: 200 }); if (url.pathname.endsWith("esummary.fcgi")) return new Response(JSON.stringify({ result: { "1": { uid: "1", title: "Example", articleids: [{ idtype: "pmc", value: "PMC2" }, { idtype: "doi", value: "10.5555/example" }] } } }), { status: 200 }); return new Response(JSON.stringify({ linksets: [{ linksetdb: [{ link: [{ id: "2" }] }] }] }), { status: 200 }); }) as typeof fetch;
  try {
    const provider = new PubmedProvider({ enabled: true, timeoutMs: 30000, maxRequests: 10, budget: 10 }, "pubmed");
    const found = await provider.search({ query: "example", limit: 1 });
    assert.deepEqual(found.items[0]?.identifiers, { PMID: "1", PMCID: "PMC2", DOI: "10.5555/example" });
    await provider.graph("1", "citations");
    assert.equal(urls.at(-1)?.searchParams.get("linkname"), "pubmed_pubmed_citedin");
  } finally { globalThis.fetch = previous; }
});

test("arXiv lookup uses a direct id query and binary PDF fetch stays bytes", async () => {
  const previous = globalThis.fetch;
  const urls: URL[] = [];
  globalThis.fetch = (async (url: URL) => { urls.push(url); if (url.pathname.includes("/api/query")) return new Response("<?xml version=\"1.0\"?><feed><entry><id>https://arxiv.org/abs/2401.00001v2</id><title>Example</title><summary>Abstract</summary><published>2024-01-01T00:00:00Z</published><author><name>Ada</name></author></entry></feed>", { status: 200 }); return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { "content-type": "application/pdf" } }); }) as typeof fetch;
  try {
    const provider = new ArxivProvider({ enabled: true, timeoutMs: 30000, maxRequests: 10, budget: 10 }, "arxiv");
    const found = await provider.get("2401.00001v2");
    assert.equal(found.identifiers.arXiv, "2401.00001v2");
    assert.doesNotMatch(urls[0]?.searchParams.get("search_query") ?? "", /all:id/);
    const pdf = await provider.fulltext("2401.00001v2", "fetch");
    assert.deepEqual(Array.from((pdf as any).content), [37, 80, 68, 70]);
  } finally { globalThis.fetch = previous; }
});

test("easyScholar journal rank uses only the configured SecretKey and URL-encodes journal names", async () => {
  const previous = globalThis.fetch;
  const previousKey = process.env.RESEARCH_EASY_KEY;
  let requested: URL | undefined;
  process.env.RESEARCH_EASY_KEY = "test-only-secret";
  globalThis.fetch = (async (url: URL) => { requested = url; return new Response(JSON.stringify({ code: 200, msg: "SUCCESS", data: { officialRank: { select: { sci: "Q1" } }, customRank: { rankInfo: [], rank: [] } } }), { status: 200 }); }) as typeof fetch;
  try {
    const provider = new EasyScholarProvider({ enabled: true, credentialEnv: "RESEARCH_EASY_KEY", timeoutMs: 30000, maxRequests: 10, budget: 10 });
    const result = await provider.metrics("Journal & Test");
    assert.equal((result as any).data.officialRank.select.sci, "Q1");
    assert.equal(requested?.protocol, "https:");
    assert.equal(requested?.hostname, "www.easyscholar.cc");
    assert.equal(requested?.searchParams.get("publicationName"), "Journal & Test");
    assert.equal(requested?.searchParams.get("secretKey"), "test-only-secret");
    assert.doesNotMatch(JSON.stringify(result), /test-only-secret/);
  } finally { globalThis.fetch = previous; if (previousKey === undefined) delete process.env.RESEARCH_EASY_KEY; else process.env.RESEARCH_EASY_KEY = previousKey; }
});
