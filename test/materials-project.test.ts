import test from "node:test";
import assert from "node:assert/strict";
import { buildSummaryQuery, MaterialsProjectClient, MaterialsProjectError, sanitizePayload } from "../src/materials-project/client.js";
import { exportMaterialCif, exportMaterialsCsv, exportMaterialsJson, exportMaterialsMarkdown, writeMaterialsExport } from "../src/materials-project/export.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getMaterialsCapabilities, getMaterialsSourceStatus } from "../src/materials-project/capabilities.js";
import { createMaterialsLiveTestPlan } from "../src/materials-project/live.js";
import { validateMaterialsConfig } from "../src/materials-project/config.js";
import { registerMaterialsTools } from "../src/materials-project/index.js";
import type { MaterialRecord, MaterialsHttpResponse } from "../src/materials-project/types.js";

function response(body: unknown, status = 200): MaterialsHttpResponse {
  return { status, headers: new Headers({ "content-type": "application/json" }), json: async () => body, text: async () => JSON.stringify(body) };
}

function streamResponse(body: string, status = 200, headers = new Headers({ "content-type": "application/json" })): MaterialsHttpResponse {
  const bytes = new TextEncoder().encode(body);
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });
  return { status, headers, body: stream, json: async () => JSON.parse(body), text: async () => body };
}

test("maps SDK-style filters to the documented REST contract", () => {
  const query = buildSummaryQuery({ materialIds: ["mp-149", "mp-13"], elements: ["Si", "O"], formula: ["AB2"], bandGap: { min: 0.5, max: 1 }, volume: { min: 10 }, fields: ["material_id", "band_gap"] });
  assert.deepEqual(query, { material_ids: ["mp-149", "mp-13"], elements: ["Si", "O"], formula: ["AB2"], band_gap_min: "0.5", band_gap_max: "1", volume_min: "10", _fields: "material_id,band_gap" });
  assert.throws(() => buildSummaryQuery({ elements: ["si"] }), MaterialsProjectError);
  assert.throws(() => buildSummaryQuery({ bandGap: { min: 2, max: 1 } }), MaterialsProjectError);
});

test("uses fixed HTTPS requests, comma lists, and a bounded pagination budget", async () => {
  const calls: URL[] = [];
  const client = new MaterialsProjectClient({ apiKey: "test-only", maxPages: 2, maxResults: 3 }, async (input) => {
    const url = new URL(String(input)); calls.push(url);
    const page = Number(url.searchParams.get("_skip"));
    return response(page === 0 ? { data: [{ material_id: "mp-1", formula_pretty: "Si", elements: ["Si"], density: 0 }, { material_id: "mp-2", formula_pretty: "SiO2", elements: ["Si", "O"] }], meta: { total_doc: 3 } } : { data: [{ material_id: "mp-3", formula_pretty: "Al", elements: ["Al"] }], meta: { total_doc: 3 } });
  });
  const result = await client.search({ elements: ["Si", "O"], maxResults: 3 });
  assert.equal(result.records.length, 3);
  assert.equal(result.requestsMade, 2);
  assert.equal(calls[0].protocol, "https:");
  assert.equal(calls[0].hostname, "api.materialsproject.org");
  assert.equal(calls[0].pathname, "/materials/summary/");
  assert.equal(calls[0].searchParams.get("material_ids"), null);
  assert.equal(calls[0].searchParams.get("elements"), "Si,O");
  assert.equal(calls[0].searchParams.get("_fields"), "material_id,formula_pretty,elements,band_gap,energy_above_hull,density,volume");
  assert.equal(result.records[0].fields.density.value, 0, "zero is a provided value, not missing");
});

test("exact element mode is local and missing fields retain states", async () => {
  const client = new MaterialsProjectClient({ apiKey: "test-only", maxPages: 1 }, async () => response({ data: [
    { material_id: "mp-1", formula_pretty: "SiO2", elements: ["Si", "O"], density: null },
    { material_id: "mp-2", formula_pretty: "SiOF", elements: ["Si", "O", "F"], density: 1 },
  ] }));
  const result = await client.search({ elements: ["Si", "O"], elementsMode: "exact", maxResults: 10 });
  assert.deepEqual(result.records.map((record) => record.materialId), ["mp-1"]);
  assert.equal(result.records[0].fields.density.state, "missing");
  assert.match(result.warnings.join(" "), /bounded local/);
});

test("property route uses task_ids separately from material_ids", async () => {
  let seen: URL | undefined;
  const client = new MaterialsProjectClient({ apiKey: "test-only" }, async (input) => { seen = new URL(String(input)); return response({ data: [{ material_id: "mp-1", task_id: "task-1" }] }); });
  await client.get({ materialIds: ["mp-1"], taskIds: ["task-1"], properties: ["tasks"] });
  assert.equal(seen?.searchParams.get("task_ids"), "task-1");
  assert.equal(seen?.searchParams.get("material_ids"), null);
});

test("property projections are route-specific and schema drift is rejected", async () => {
  let calls = 0;
  const client = new MaterialsProjectClient({ apiKey: "test-only" }, async () => { calls += 1; return response({ data: [{ task_id: "task-1", eos: { energies: [1] } }] }); });
  const result = await client.get({ taskIds: ["task-1"], properties: ["eos"], fields: ["task_id", "eos"] });
  assert.equal(result.records.length, 1);
  assert.equal(calls, 1);
  await assert.rejects(() => client.get({ taskIds: ["task-1"], properties: ["eos"], fields: ["not_a_verified_field"] }), /SCHEMA_MISMATCH/);
  const drift = new MaterialsProjectClient({ apiKey: "test-only" }, async () => response({ data: [{ formula_pretty: "Si" }] }));
  await assert.rejects(() => drift.search({ maxPages: 1 }), /SCHEMA_MISMATCH/);
});

test("multiple property groups share one material record and use every route", async () => {
  const seen: string[] = [];
  const client = new MaterialsProjectClient({ apiKey: "test-only", maxPages: 10 }, async (input) => {
    const url = new URL(String(input));
    seen.push(url.pathname);
    return url.pathname.endsWith("/summary/")
      ? response({ data: [{ material_id: "mp-1", formula_pretty: "Si", structure: { sites: [] } }] })
      : response({ data: [{ material_id: "mp-1", formation_energy_per_atom: -1, entries: [] }] });
  });
  const result = await client.get({ materialIds: ["mp-1"], properties: ["structure", "thermo"] });
  assert.equal(result.records.length, 1);
  assert.deepEqual(seen, ["/materials/summary/", "/materials/thermo/"]);
  assert.deepEqual(result.records[0].fields.structure.value, { sites: [] });
  assert.equal(result.records[0].fields.formation_energy_per_atom.value, -1);
  assert.equal(result.records[0].provenanceSources?.length, 2);
});

test("client rejects non-official endpoint overrides", () => {
  assert.throws(() => new MaterialsProjectClient({ apiKey: "test-only", endpoint: "https://localhost:1234" }), /official HTTPS service/);
  assert.throws(() => new MaterialsProjectClient({ apiKey: "test-only", endpoint: "https://example.org" }), /official HTTPS service/);
});

test("empty pages stop pagination and HTTP auth/rate errors map safely", async () => {
  let calls = 0;
  const empty = new MaterialsProjectClient({ apiKey: "test-only", maxPages: 10 }, async () => { calls += 1; return response({ data: [], meta: { total_doc: 99 } }); });
  const result = await empty.search({ maxPages: 10 });
  assert.equal(result.requestsMade, 1);
  assert.equal(calls, 1);
  const unauthorized = new MaterialsProjectClient({ apiKey: "test-only" }, async () => response({}, 401));
  await assert.rejects(() => unauthorized.search({ maxPages: 1 }), (error: unknown) => error instanceof MaterialsProjectError && error.code === "AUTH_INVALID");
  const limited = new MaterialsProjectClient({ apiKey: "test-only" }, async () => response({}, 429));
  await assert.rejects(() => limited.search({ maxPages: 1 }), (error: unknown) => error instanceof MaterialsProjectError && error.code === "RATE_LIMITED");
});

test("response byte limits cover chunked bodies without Content-Length", async () => {
  const client = new MaterialsProjectClient({ apiKey: "test-only", maxResponseBytes: 1024 }, async () => streamResponse(JSON.stringify({ data: [{ material_id: "mp-1", formula_pretty: "Si", oversized: "x".repeat(2_000) }] })));
  await assert.rejects(() => client.search({ maxPages: 1 }), (error: unknown) => error instanceof MaterialsProjectError && error.code === "SOURCE_UNAVAILABLE");
});

test("body timeout aborts a stalled stream without exposing request details", async () => {
  const client = new MaterialsProjectClient({ apiKey: "test-only", timeoutMs: 20 }, async () => {
    const stream = new ReadableStream<Uint8Array>({ pull() { return new Promise<void>(() => undefined); } });
    return { status: 200, headers: new Headers({ "content-type": "application/json" }), body: stream, json: async () => ({}), text: async () => "" };
  });
  await assert.rejects(() => client.search({ maxPages: 1 }), (error: unknown) => error instanceof MaterialsProjectError && error.code === "SOURCE_UNAVAILABLE" && !/api[_-]?key|https?:\/\//i.test(error.message));
});

test("all declared extension routes use bounded projections", async () => {
  const seen: string[] = [];
  const client = new MaterialsProjectClient({ apiKey: "test-only", maxPages: 1 }, async (input) => {
    const path = new URL(String(input)).pathname;
    seen.push(path);
    if (path.includes("/eos/") || path.includes("/xas/") || path.includes("/tasks/")) return response({ data: [{ task_id: "task-1" }] });
    if (path.includes("/phonon/")) return response({ data: [{ identifier: "mp-1-pbe" }] });
    if (path.includes("/substrates/")) return response({ data: [{ film_id: "mp-1", sub_id: "mp-2" }] });
    if (path.includes("/alloys/")) return response({ data: [{ pair_id: "mp-1_mp-2", alloy_pair: [] }] });
    if (path.includes("/synthesis/")) return response({ data: [{ doi: "10.1/example", paragraph_string: "procedure" }] });
    return response({ data: [{ material_id: "mp-1" }] });
  });
  for (const property of ["bandstructure", "dos", "magnetism", "elasticity", "dielectric", "piezoelectric", "absorption", "provenance", "bonds", "chemenv", "oxidation_states", "robocrys", "doi", "surface_properties", "grain_boundaries", "alloys", "similarity"] as const) {
    await client.get({ materialIds: ["mp-1"], properties: [property] });
  }
  await client.searchRoute({ property: "phonon", identifiers: ["mp-1-pbe"], maxPages: 1 });
  await client.searchRoute({ property: "xas", taskIds: ["task-1"], maxPages: 1 });
  await client.searchRoute({ property: "eos", taskIds: ["task-1"], maxPages: 1 });
  await client.searchRoute({ property: "insertion_electrodes", filters: { working_ion: "Li" }, maxPages: 1 });
  await client.searchRoute({ property: "substrates", filters: { film_id: "mp-1" }, maxPages: 1 });
  await client.searchRoute({ property: "synthesis", filters: { target_formula: "LiFePO4" }, maxPages: 1 });
  assert.ok(seen.includes("/materials/electronic_structure/"));
  assert.ok(seen.includes("/materials/synthesis/"));
});

function record(): MaterialRecord {
  return {
    materialId: "mp-149",
    formula: { state: "provided", value: "Si", sourceField: "formula_pretty" },
    elements: { state: "provided", value: ["Si"], sourceField: "elements" },
    fields: { density: { state: "provided", value: 0, unit: "g/cm^3" }, band_gap: { state: "missing", unit: "eV", reason: "not provided" } },
    raw: { material_id: "mp-149", formula_pretty: "Si", density: 0, apiKey: "must-not-export" },
    provenance: { source: "materials-project", endpoint: "/materials/summary", retrievedAt: "2026-09-07T00:00:00.000Z", query: { _fields: "material_id" }, url: "https://api.materialsproject.org/materials/summary" },
    warnings: [],
  };
}

test("exports preserve provenance, units, missing states, and redact secrets", () => {
  const value = record();
  assert.doesNotMatch(exportMaterialsJson([value]), /must-not-export/);
  assert.match(exportMaterialsCsv([value]), /provenance_endpoint/);
  assert.match(exportMaterialsCsv([value]), /density/);
  assert.match(exportMaterialsMarkdown([value]), /materials\/summary/);
});

test("CIF derives non-orthogonal angles, MSON abc, and mixed occupancy", () => {
  const value = record();
  value.raw = { structure: { lattice: { matrix: [[2, 0, 0], [1, 2, 0], [0, 0, 3]] }, sites: [{ species: [{ element: "Si", occu: 0.5 }, { element: "Ge", occu: 0.5 }], abc: [0, 0, 0] }] } };
  const cif = exportMaterialCif(value);
  assert.match(cif, /_cell_angle_gamma 63\.4349/);
  assert.match(cif, /Si 0 0 0 0\.5/);
  assert.match(cif, /Ge 0 0 0 0\.5/);
  assert.throws(() => exportMaterialCif({ ...value, raw: {} }));
});

test("config validation accepts direct keys and environment fallback with direct precedence", () => {
  const result = validateMaterialsConfig({ enabled: true, apiKeyEnv: "MP_API_KEY", maxRequests: 1000, maxResults: 10000, maxResponseBytes: 64 * 1024 * 1024 }, {});
  assert.equal(result.config.apiKey, undefined);
  assert.equal(result.config.maxResponseBytes, 64 * 1024 * 1024);
  assert.match(result.warnings.join(" "), /credential missing/);
  assert.equal(validateMaterialsConfig({ apiKey: "direct", apiKeyEnv: "CUSTOM_MP_KEY" }, { CUSTOM_MP_KEY: "environment", MP_API_KEY: "standard" }).config.apiKey, "direct");
  assert.equal(validateMaterialsConfig({ apiKeyEnv: "CUSTOM_MP_KEY" }, { CUSTOM_MP_KEY: "environment", MP_API_KEY: "standard" }).config.apiKey, "environment");
  assert.equal(validateMaterialsConfig({}, { MP_API_KEY: "standard" }).config.apiKey, "standard");
  assert.throws(() => validateMaterialsConfig({ apiKeyEnv: "not-safe" }, {}));
  assert.throws(() => validateMaterialsConfig({ maxResponseBytes: 64 * 1024 * 1024 + 1 }, {}));
});

test("materials tool output is bounded by bytes and lines", async () => {
  const tools: any[] = [];
  registerMaterialsTools({ registerTool: (tool: unknown) => tools.push(tool) } as any);
  const tool = tools.find((item) => item.name === "materials_export");
  const huge = record();
  huge.raw = { material_id: huge.materialId, payload: "x".repeat(100_000) };
  const result = await tool.execute("call", { records: [huge], format: "json" });
  const text = result.content[0].text as string;
  assert.ok(new TextEncoder().encode(text).byteLength <= 50 * 1024);
  assert.ok(text.split(/\r?\n/).length <= 2_000);
});

test("capability and source status matrix is truthful and side-effect free", () => {
  const capabilities = getMaterialsCapabilities();
  assert.equal(capabilities.length, 17);
  assert.equal(capabilities.find((item) => item.capabilityId === "MP17")?.implementationStatus, "implemented");
  assert.equal(getMaterialsSourceStatus({}).accessStatus, "unknown_until_requested");
  assert.deepEqual(sanitizePayload({ apiKey: "secret", nextPage: "https://example.test/?key=secret" }), { apiKey: "[REDACTED]", nextPage: "[REDACTED]" });
});

test("live smoke test is an explicit, no-network preview", () => {
  const plan = createMaterialsLiveTestPlan({ maxRequests: 1 });
  assert.equal(plan.explicitOptInRequired, true);
  assert.equal(plan.endpoint, "https://api.materialsproject.org");
  assert.throws(() => createMaterialsLiveTestPlan({ maxRequests: 0 }));
});

test("artifact writer is confined to Materials directory and exclusive", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-scholar-materials-"));
  try {
    assert.equal(await writeMaterialsExport(root, "nested/result.json", "{}"), path.join("nested", "result.json"));
    assert.equal(await readFile(path.join(root, "nested", "result.json"), "utf8"), "{}");
    await assert.rejects(() => writeMaterialsExport(root, "nested/result.json", "changed"));
    await assert.rejects(() => writeMaterialsExport(root, "../outside.json", "bad"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
