import {
  MP_BASE_URL,
  MP_API_DOCS,
  type MaterialField,
  type MaterialProperty,
  type MaterialRecord,
  type MaterialsFetch,
  type MaterialsGetOptions,
  type MaterialsGetResult,
  type MaterialsHttpResponse,
  type MaterialsProjectConfig,
  type MaterialsSearchFilters,
  type MaterialsSearchResult,
  type MaterialsRouteSearchOptions,
  type MaterialsRouteSearchResult,
  type Provenance,
  type RangeFilter,
} from "./types.js";
import { readResponseBytes } from "../io.js";
import { createHash } from "node:crypto";
import { resolveApiKey } from "../credentials.js";

export type MaterialsErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "RATE_LIMITED"
  | "BUDGET_EXCEEDED"
  | "NOT_FOUND"
  | "ENTITLEMENT_REQUIRED"
  | "CONFLICT"
  | "CONTRACT_UNVERIFIED"
  | "SCHEMA_MISMATCH"
  | "SOURCE_UNAVAILABLE"
  | "UNSUPPORTED_CAPABILITY";

export class MaterialsProjectError extends Error {
  constructor(
    public readonly code: MaterialsErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(`${code}: ${message}`);
    this.name = "MaterialsProjectError";
  }
}

const DEFAULT_FIELDS = ["material_id", "formula_pretty", "elements", "band_gap", "energy_above_hull", "density", "volume"];
const UNITS: Record<string, string> = {
  band_gap: "eV",
  energy_above_hull: "eV/atom",
  formation_energy_per_atom: "eV/atom",
  energy_per_atom: "eV/atom",
  density: "g/cm^3",
  volume: "Å^3",
  total_magnetization: "μB",
  total_magnetization_normalized_vol: "μB/Å^3",
  weighted_surface_energy: "J/m^2",
  weighted_work_function: "eV",
  k_vrh: "GPa",
  g_vrh: "GPa",
  elasticity: "GPa",
  piezoelectric_modulus: "C/m^2",
};

const PROPERTY_SUFFIX: Record<MaterialProperty, string> = {
  summary: "materials/summary",
  doi: "doi",
  structure: "materials/summary",
  thermo: "materials/thermo",
  bandstructure: "materials/electronic_structure/bandstructure",
  dos: "materials/electronic_structure/dos",
  magnetism: "materials/magnetism",
  elasticity: "materials/elasticity",
  dielectric: "materials/dielectric",
  piezoelectric: "materials/piezoelectric",
  phonon: "materials/phonon",
  absorption: "materials/absorption",
  xas: "materials/xas",
  insertion_electrodes: "materials/insertion_electrodes",
  provenance: "materials/provenance",
  tasks: "materials/tasks",
  bonds: "materials/bonds",
  chemenv: "materials/chemenv",
  oxidation_states: "materials/oxidation_states",
  robocrys: "materials/robocrys",
  eos: "materials/eos",
  surface_properties: "materials/surface_properties",
  grain_boundaries: "materials/grain_boundaries",
  substrates: "materials/substrates",
  alloys: "materials/alloys",
  similarity: "materials/similarity",
  synthesis: "materials/synthesis",
};

/** The bandstructure and DOS collections are condition-search routes. The
 * documented material-ID retrieval used by this adapter is their metadata in
 * the electronic_structure collection; complete curve objects require the
 * optional mp-api/pymatgen bridge. */
const PROPERTY_GET_SUFFIX: Record<MaterialProperty, string> = {
  ...PROPERTY_SUFFIX,
  bandstructure: "materials/electronic_structure",
  dos: "materials/electronic_structure",
};

const SUPPORTED_PROPERTIES = new Set<MaterialProperty>(Object.keys(PROPERTY_SUFFIX) as MaterialProperty[]);
// These endpoints are official but their REST search contracts do not accept
// material_ids. They remain visible in the matrix as partial, while this
// bounded material-ID operation reports the limitation explicitly.
const MATERIAL_ID_UNSUPPORTED_PROPERTIES = new Set<MaterialProperty>(["substrates", "synthesis"]);
const TASK_ID_PROPERTIES = new Set<MaterialProperty>(["tasks", "eos", "xas"]);
const IDENTIFIER_PROPERTIES = new Set<MaterialProperty>(["phonon"]);
const MATERIAL_ID_UNSUPPORTED_DIRECT_PROPERTIES = new Set<MaterialProperty>(["insertion_electrodes"]);
/** Bounded top-level projections for each route. Nested objects remain raw and
 * are never interpreted as another endpoint's schema. */
export const PROPERTY_FIELDS: Record<MaterialProperty, readonly string[]> = {
  summary: ["material_id", "formula_pretty", "formula", "elements", "chemsys", "band_gap", "energy_above_hull", "formation_energy_per_atom", "density", "volume", "is_stable", "is_metal", "structure", "origins", "warnings"],
  structure: ["material_id", "formula_pretty", "elements", "structure", "symmetry", "origins", "warnings"],
  thermo: ["material_id", "entries", "formation_energy_per_atom", "energy_above_hull", "energy_per_atom", "uncorrected_energy_per_atom", "origins", "warnings"],
  bandstructure: ["material_id", "bandstructure", "band_gap", "cbm", "vbm", "efermi", "is_gap_direct", "origins", "warnings"],
  dos: ["material_id", "dos", "band_gap", "efermi", "origins", "warnings"],
  magnetism: ["material_id", "ordering", "is_magnetic", "total_magnetization", "total_magnetization_normalized_formula_units", "total_magnetization_normalized_vol", "num_magnetic_sites", "num_unique_magnetic_sites", "types_of_magnetic_species", "origins", "warnings"],
  elasticity: ["material_id", "elastic_tensor", "compliance_tensor", "bulk_modulus", "shear_modulus", "universal_anisotropy", "homogeneous_poisson", "warnings"],
  dielectric: ["material_id", "total", "ionic", "electronic", "e_electronic", "e_ionic", "e_total", "n", "structure", "origins", "warnings"],
  piezoelectric: ["material_id", "total", "ionic", "electronic", "e_ij_max", "max_direction", "strain_for_max", "structure", "origins", "warnings"],
  phonon: ["identifier", "phonon_method", "phonon_bandstructure", "phonon_dos", "structure", "total_dft_energy", "volume_per_formula_unit", "formula_units", "force_constants", "last_updated"],
  absorption: ["material_id", "energies", "energy_max", "absorption_coefficient", "average_imaginary_dielectric", "average_real_dielectric", "bandgap", "nkpoints", "structure", "origins", "warnings"],
  xas: ["task_id", "spectrum", "spectrum_name", "absorbing_element", "spectrum_type", "edge", "last_updated", "warnings"],
  insertion_electrodes: ["material_ids", "battery_type", "battery_formula", "working_ion", "average_voltage", "capacity_grav", "capacity_vol", "energy_grav", "energy_vol", "framework", "framework_formula", "thermo_type", "warnings"],
  provenance: ["material_id", "origins", "remarks", "tags", "warnings"],
  tasks: ["task_id", "material_id", "task_type", "run_type", "input", "output", "calcs_reversed", "warnings"],
  bonds: ["material_id", "structure_graph", "method", "bond_types", "bond_length_stats", "coordination_envs", "coordination_envs_anonymous", "origins", "warnings"],
  chemenv: ["material_id", "structure", "valences", "species", "chemenv_symbol", "chemenv_iupac", "chemenv_iucr", "chemenv_name", "chemenv_name_with_alternatives", "csm", "method", "wyckoff_positions", "origins", "warnings"],
  oxidation_states: ["material_id", "structure", "possible_species", "possible_valences", "average_oxidation_states", "method", "origins", "warnings"],
  robocrys: ["material_id", "description", "condensed_structure", "robocrys_version", "structure", "origins", "warnings"],
  doi: ["material_id", "doi", "citation", "warnings"],
  eos: ["task_id", "eos", "energies", "volumes"],
  surface_properties: ["material_id", "surfaces", "weighted_surface_energy_EV_PER_ANG2", "weighted_surface_energy", "surface_anisotropy", "pretty_formula", "shape_factor", "weighted_work_function", "has_reconstructed", "structure"],
  grain_boundaries: ["material_id", "sigma", "type", "rotation_axis", "gb_plane", "rotation_angle", "gb_energy", "initial_structure", "final_structure", "pretty_formula", "w_sep", "structure", "chemsys", "last_updated"],
  substrates: ["sub_form", "sub_id", "film_orient", "area", "energy", "film_id", "_norients", "orient"],
  alloys: ["alloy_pair", "pair_id", "alloy_system", "alloy_id"],
  similarity: ["material_id", "sim", "feature_vector", "method", "origins", "warnings"],
  synthesis: ["doi", "paragraph_string", "synthesis_type", "reaction_string", "reaction", "target", "targets_formula", "precursors_formula", "targets_formula_s", "precursors_formula_s", "precursors", "operations", "search_score", "highlights"],
};

function validatePropertyFields(property: MaterialProperty, fields: string[]): void {
  const invalid = fields.filter((fieldName) => !PROPERTY_FIELDS[property].includes(fieldName));
  if (invalid.length) throw new MaterialsProjectError("SCHEMA_MISMATCH", `${property} fields are not in the verified REST projection: ${invalid.join(", ")}`);
}
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_MAX_RESULTS = 100;
const DEFAULT_TIMEOUT = 20_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

function asStringArray(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

function validateId(id: string): string {
  if (!/^mp-[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) throw new MaterialsProjectError("SCHEMA_MISMATCH", `invalid material id: ${id}`);
  return id;
}

function validateTaskId(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) throw new MaterialsProjectError("SCHEMA_MISMATCH", `invalid task id: ${id}`);
  return id;
}

function validateElement(element: string): string {
  if (!/^[A-Z][a-z]?$/.test(element)) throw new MaterialsProjectError("SCHEMA_MISMATCH", `invalid element symbol: ${element}`);
  return element;
}

function validateRange(name: string, range: RangeFilter | undefined): void {
  if (!range) return;
  if (range.min !== undefined && (!Number.isFinite(range.min))) throw new MaterialsProjectError("SCHEMA_MISMATCH", `${name}.min must be finite`);
  if (range.max !== undefined && (!Number.isFinite(range.max))) throw new MaterialsProjectError("SCHEMA_MISMATCH", `${name}.max must be finite`);
  if (range.min !== undefined && range.max !== undefined && range.min > range.max) throw new MaterialsProjectError("SCHEMA_MISMATCH", `${name}.min cannot exceed max`);
}

function addList(params: URLSearchParams, key: string, values: string[] | undefined): void {
  if (!values?.length) return;
  // MP's OpenAPI contract describes list-valued filters as comma-separated
  // strings (material_ids, elements, chemsys, and fields).
  params.set(key, values.join(","));
}

function addRange(params: URLSearchParams, sdkName: string, restName: string, value: RangeFilter | undefined): void {
  if (!value) return;
  validateRange(sdkName, value);
  if (value.min !== undefined) params.set(`${restName}_min`, String(value.min));
  if (value.max !== undefined) params.set(`${restName}_max`, String(value.max));
}

/** Maps public SDK-like filter names to the distinct REST query contract. */
export function buildSummaryQuery(filters: MaterialsSearchFilters): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  const ids = filters.materialIds?.map(validateId);
  const elements = filters.elements?.map(validateElement);
  const formula = asStringArray(filters.formula);
  const chemsys = asStringArray(filters.chemsys);
  if (formula?.some((v) => !/^[A-Za-z0-9*()+._-]{1,120}$/.test(v))) throw new MaterialsProjectError("SCHEMA_MISMATCH", "formula contains unsupported characters");
  if (chemsys?.some((v) => !/^[A-Za-z0-9*.-]{1,120}$/.test(v))) throw new MaterialsProjectError("SCHEMA_MISMATCH", "chemsys contains unsupported characters");
  if (filters.elementsMode && !elements) throw new MaterialsProjectError("SCHEMA_MISMATCH", "elementsMode requires elements");
  if (ids) query.material_ids = ids;
  if (elements) query.elements = elements;
  if (formula) query.formula = formula;
  if (chemsys) query.chemsys = chemsys;
  if (filters.isStable !== undefined) query.is_stable = String(filters.isStable);
  if (filters.isMetal !== undefined) query.is_metal = String(filters.isMetal);
  if (filters.hasProps) {
    if (filters.hasProps.length > 20 || filters.hasProps.some((v) => !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(v))) throw new MaterialsProjectError("SCHEMA_MISMATCH", "invalid hasProps");
    query.has_props = filters.hasProps;
  }
  addRangeToObject(query, "bandGap", "band_gap", filters.bandGap);
  addRangeToObject(query, "energyAboveHull", "energy_above_hull", filters.energyAboveHull);
  addRangeToObject(query, "density", "density", filters.density);
  addRangeToObject(query, "volume", "volume", filters.volume);
  addRangeToObject(query, "numSites", "num_sites", filters.numSites);
  const fields = filters.fields ?? DEFAULT_FIELDS;
  if (fields.length > 100 || fields.some((f) => !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(f))) throw new MaterialsProjectError("SCHEMA_MISMATCH", "invalid fields");
  const invalidFields = fields.filter((fieldName) => !PROPERTY_FIELDS.summary.includes(fieldName));
  if (invalidFields.length) throw new MaterialsProjectError("SCHEMA_MISMATCH", `summary fields are not in the verified REST projection: ${invalidFields.join(", ")}`);
  query._fields = fields.join(",");
  return query;
}

function addRangeToObject(query: Record<string, string | string[]>, sdkName: string, restName: string, value: RangeFilter | undefined): void {
  if (!value) return;
  validateRange(sdkName, value);
  if (value.min !== undefined) query[`${restName}_min`] = String(value.min);
  if (value.max !== undefined) query[`${restName}_max`] = String(value.max);
}

function toUrlQuery(query: Record<string, string | string[]>, page: number, limit: number): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) addList(params, key, value);
    else params.set(key, value);
  }
  params.set("_skip", String(page * limit));
  params.set("_limit", String(limit));
  return params;
}

function responseRows(payload: unknown): { rows: Record<string, unknown>[]; total?: number; nextPage?: number } {
  let data: unknown = payload;
  let total: number | undefined;
  let nextPage: number | undefined;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const object = payload as Record<string, unknown>;
    data = object.data ?? object.docs ?? object.results ?? object.items ?? [];
    if (typeof object.total === "number") total = object.total;
    const meta = object.meta;
    if (meta && typeof meta === "object" && typeof (meta as Record<string, unknown>).total === "number") total = (meta as Record<string, number>).total;
    if (meta && typeof meta === "object" && typeof (meta as Record<string, unknown>).total_doc === "number") total = (meta as Record<string, number>).total_doc;
    if (typeof object.next_page === "number") nextPage = object.next_page;
  }
  if (!Array.isArray(data) || data.some((row) => !row || typeof row !== "object" || Array.isArray(row))) throw new MaterialsProjectError("SCHEMA_MISMATCH", "Materials Project response did not contain object rows");
  return { rows: data as Record<string, unknown>[], total, nextPage };
}

function unitsFor(name: string): string | undefined {
  return UNITS[name] ?? (name.endsWith("_tensor") ? "source-defined" : undefined);
}

function field(value: unknown, sourceField: string): MaterialField {
  if (value === undefined || value === null) return { state: "missing", sourceField, reason: "not provided by the response" };
  return { state: "provided", value, sourceField, ...(unitsFor(sourceField) ? { unit: unitsFor(sourceField) } : {}) };
}

function normalizeRow(row: Record<string, unknown>, provenance: Provenance, requestedFields: string[], allowDerivedId = false, derivedIdPreferred = false): MaterialRecord {
  const pair = row.pair_id && typeof row.pair_id === "object" && !Array.isArray(row.pair_id) ? row.pair_id as Record<string, unknown> : undefined;
  const pairId = pair && typeof pair.id_a === "string" && typeof pair.id_b === "string" ? `${pair.id_a}_${pair.id_b}` : row.pair_id;
  const materialListId = Array.isArray(row.material_ids) && row.material_ids.every((value) => typeof value === "string") ? `${row.material_ids.join(",")}:${String(row.working_ion ?? "")}` : undefined;
  const identity = derivedIdPreferred ? undefined : [
    ["material_id", row.material_id ?? row.materialId],
    ["task_id", row.task_id ?? row.taskId],
    ["identifier", row.identifier],
    ["film_id", row.film_id],
    ["pair_id", pairId],
    ["battery_id", row.battery_id],
    ["spectrum_id", row.spectrum_id],
    ["sub_id", row.sub_id],
    ["material_ids", materialListId],
  ].find(([, value]) => typeof value === "string") as [string, string] | undefined;
  if (!identity && !allowDerivedId) throw new MaterialsProjectError("SCHEMA_MISMATCH", "response row has no verified source identifier");
  const [recordIdField, id] = identity ?? ["derived_sha256", `sha256:${createHash("sha256").update(JSON.stringify(sanitizePayload(row))).digest("hex")}`];
  const fields: Record<string, MaterialField> = {};
  for (const name of requestedFields) fields[name] = row[name] === undefined ? { state: "not_requested", sourceField: name, reason: "field was not returned" } : field(row[name], name);
  const formulaValue = row.formula_pretty ?? row.formula;
  const elementValue = row.elements;
  return {
    ...(recordIdField === "material_id" ? { materialId: id } : {}),
    recordId: id,
    recordIdField,
    formula: field(formulaValue, formulaValue === row.formula ? "formula" : "formula_pretty") as MaterialField<string>,
    elements: field(elementValue, "elements") as MaterialField<string[]>,
    fields,
    raw: sanitizePayload(row) as Record<string, unknown>,
    provenance,
    warnings: recordIdField === "material_id" ? [] : [`source document is identified by ${recordIdField}, not material_id`],
  };
}

/** Remove secrets that may appear in response metadata or pagination links. */
export function sanitizePayload(value: unknown, key = ""): unknown {
  if (/(api.?key|token|authorization|cookie|signature|signed|secret|password|next.?page)/i.test(key)) return "[REDACTED]";
  if (typeof value === "string") return value.replace(/([?&](?:api_key|token|key|signature)=)[^&\s]*/gi, "$1[REDACTED]");
  if (Array.isArray(value)) return value.map((item) => sanitizePayload(item));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) output[childKey] = sanitizePayload(childValue, childKey);
  return output;
}

function makeProvenance(endpoint: string, query: Record<string, unknown>, url: string, payload: unknown): Provenance {
  const object = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  return {
    source: "materials-project",
    endpoint,
    retrievedAt: new Date().toISOString(),
    ...(typeof object.api_version === "string" ? { apiVersion: object.api_version } : {}),
    ...(typeof object.database_version === "string" ? { databaseVersion: object.database_version } : {}),
    query: sanitizePayload(query) as Record<string, unknown>,
    url: url.replace(/([?&](?:api_key|token|key)=)[^&]*/gi, "$1[REDACTED]"),
    license: "Materials Project data; verify current terms before redistribution",
  };
}

function errorFromResponse(status: number): MaterialsProjectError {
  if (status === 401) return new MaterialsProjectError("AUTH_INVALID", "Materials Project API key was rejected", status);
  if (status === 403) return new MaterialsProjectError("AUTH_INVALID", "Materials Project API access denied", status);
  if (status === 404) return new MaterialsProjectError("NOT_FOUND", "Materials Project endpoint or material was not found", status);
  if (status === 429) return new MaterialsProjectError("RATE_LIMITED", "Materials Project request rate limit exceeded", status);
  return new MaterialsProjectError("SOURCE_UNAVAILABLE", `Materials Project HTTP ${status}`, status);
}

function endpointUrl(endpoint: string | undefined): URL {
  const value = endpoint ?? MP_BASE_URL;
  let url: URL;
  try { url = new URL(value); } catch { throw new MaterialsProjectError("SCHEMA_MISMATCH", "invalid Materials Project endpoint"); }
  // Keep the production adapter pinned to the official service. Tests can still
  // inject a fetcher while requests retain the real service URL.
  if (url.protocol !== "https:" || url.username || url.password || url.hostname !== "api.materialsproject.org") throw new MaterialsProjectError("SCHEMA_MISMATCH", "Materials Project endpoint must be the official HTTPS service without userinfo");
  if (url.hostname === "api.materialsproject.org" && url.port && url.port !== "443") throw new MaterialsProjectError("SCHEMA_MISMATCH", "Materials Project production endpoint must use HTTPS port 443");
  return new URL(url.toString().replace(/\/$/, "") + "/");
}

async function readJson(response: MaterialsHttpResponse, maxBytes: number, signal: AbortSignal): Promise<unknown> {
  let text: string;
  try {
    if (response.body) {
      const bytes = await readResponseBytes(new Response(response.body, { headers: response.headers }), maxBytes, signal);
      text = new TextDecoder().decode(bytes);
    } else {
      signal.throwIfAborted();
      text = await response.text();
      signal.throwIfAborted();
      if (new TextEncoder().encode(text).byteLength > maxBytes) throw new MaterialsProjectError("SOURCE_UNAVAILABLE", "Materials Project response exceeds configured size limit", response.status);
    }
  } catch (error) {
    if (error instanceof MaterialsProjectError) throw error;
    if (signal.aborted) throw new MaterialsProjectError("SOURCE_UNAVAILABLE", "Materials Project request aborted", response.status);
    if (error instanceof Error && /response body exceeds/i.test(error.message)) throw new MaterialsProjectError("SOURCE_UNAVAILABLE", "Materials Project response exceeds configured size limit", response.status);
    throw new MaterialsProjectError("SOURCE_UNAVAILABLE", "Materials Project response body could not be read", response.status);
  }
  try { return JSON.parse(text.replace(/^\uFEFF/, "")); }
  catch { throw new MaterialsProjectError("SCHEMA_MISMATCH", "Materials Project response was not valid JSON", response.status); }
}

export class MaterialsProjectClient {
  private readonly base: URL;
  private readonly fetcher: MaterialsFetch;
  private readonly timeoutMs: number;
  private readonly apiKey?: string;
  private readonly defaultMaxPages: number;
  private readonly defaultMaxResults: number;
  private readonly maxResponseBytes: number;

  constructor(config: MaterialsProjectConfig = {}, fetcher: MaterialsFetch = fetch as unknown as MaterialsFetch) {
    this.base = endpointUrl(config.endpoint);
    this.fetcher = fetcher;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT;
    this.apiKey = resolveApiKey(config, process.env, ["MP_API_KEY"]);
    this.defaultMaxPages = config.maxPages ?? config.maxRequests ?? DEFAULT_MAX_PAGES;
    this.defaultMaxResults = config.maxResults ?? DEFAULT_MAX_RESULTS;
    const maxResponseBytes = config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1024 || maxResponseBytes > 64 * 1024 * 1024) throw new MaterialsProjectError("BUDGET_EXCEEDED", "maxResponseBytes must be an integer from 1024 to 67108864");
    this.maxResponseBytes = maxResponseBytes;
  }

  private async request(path: string, query: URLSearchParams, signal?: AbortSignal): Promise<{ payload: unknown; url: string }> {
    if (!this.apiKey) throw new MaterialsProjectError("AUTH_REQUIRED", "set MP_API_KEY or configure a Materials Project apiKey/apiKeyEnv");
    // The production API redirects collection routes without a trailing slash
    // to an http:// URL. Build the canonical HTTPS URL directly so credentials
    // are never exposed to or blocked by that redirect.
    const canonicalPath = `${path.replace(/^\//, "").replace(/\/$/, "")}/`;
    const url = new URL(canonicalPath, this.base);
    for (const [key, value] of query.entries()) url.searchParams.append(key, value);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await this.fetcher(url, {
        method: "GET",
        redirect: "manual",
        headers: {
          "X-API-KEY": this.apiKey,
          Accept: "application/json",
          "User-Agent": "pi-scholar/materials-project",
        },
        signal: controller.signal,
      });
      if (!response.status || response.status < 200 || response.status >= 300) throw errorFromResponse(response.status);
      return { payload: await readJson(response, this.maxResponseBytes, controller.signal), url: url.toString().replace(/([?&](?:api_key|token|key)=)[^&]*/gi, "$1[REDACTED]") };
    } catch (error) {
      if (error instanceof MaterialsProjectError) throw error;
      if (signal?.aborted || controller.signal.aborted) throw new MaterialsProjectError("SOURCE_UNAVAILABLE", "Materials Project request aborted");
      throw new MaterialsProjectError("SOURCE_UNAVAILABLE", "Materials Project request failed");
    } finally {
      clearTimeout(timer); signal?.removeEventListener("abort", onAbort);
    }
  }

  async search(filters: MaterialsSearchFilters = {}, signal?: AbortSignal): Promise<MaterialsSearchResult> {
    const query = buildSummaryQuery(filters);
    const maxPages = boundedBudget(filters.maxPages ?? this.defaultMaxPages, "maxPages", 1000);
    const maxResults = boundedBudget(filters.maxResults ?? this.defaultMaxResults, "maxResults", 10_000);
    const pageSize = Math.min(1000, maxResults);
    const records: MaterialRecord[] = [];
    const provenance: Provenance[] = [];
    const warnings: string[] = [];
    let total: number | undefined;
    let nextPage: number | undefined;
    let requestsMade = 0;
    let page = 0;
    while (page < maxPages && records.length < maxResults) {
      const requestQuery = toUrlQuery(query, page, Math.min(pageSize, maxResults - records.length));
      const response = await this.request("materials/summary", requestQuery, signal);
      requestsMade += 1;
      const pageResult = responseRows(response.payload);
      const prov = makeProvenance("/materials/summary", query, response.url, response.payload);
      provenance.push(prov);
      for (const row of pageResult.rows) {
        const requestedFields = typeof query._fields === "string" ? query._fields.split(",") : DEFAULT_FIELDS;
        const record = normalizeRow(row, prov, requestedFields);
        if (filters.elementsMode === "exact" && filters.elements && !isExactElementSet(record, filters.elements)) continue;
        records.push(record);
        if (records.length >= maxResults) break;
      }
      total = pageResult.total ?? total;
      nextPage = pageResult.nextPage;
      const reachedTotal = pageResult.total !== undefined && records.length >= Math.min(maxResults, pageResult.total);
      if (pageResult.rows.length === 0 || reachedTotal || (pageResult.total === undefined && pageResult.rows.length < pageSize)) break;
      page = nextPage ?? page + 1;
    }
    const truncated = records.length >= maxResults || (page >= maxPages && (total === undefined || records.length < total));
    if (filters.elementsMode === "exact") warnings.push("exact element matching is a bounded local filter over the returned page set; server-side coverage may include additional candidates");
    if (truncated) warnings.push(`request budget reached: ${requestsMade} request(s), ${records.length} record(s)`);
    return { records, total, nextPage, pagesFetched: requestsMade, requestsMade, truncated, query: sanitizePayload(query) as Record<string, unknown>, provenance, warnings };
  }

  /** Query a non-summary collection using that collection's documented
   * mp-api parameters. This is the only entry point for route-specific
   * filters such as substrate, synthesis, battery, EOS and XAS searches. */
  async searchRoute(options: MaterialsRouteSearchOptions, signal?: AbortSignal): Promise<MaterialsRouteSearchResult> {
    const property = options.property;
    if (!SUPPORTED_PROPERTIES.has(property)) {
      throw new MaterialsProjectError("SCHEMA_MISMATCH", `property ${property} is not a route-search capability`);
    }
    const maxPages = boundedBudget(options.maxPages ?? this.defaultMaxPages, "maxPages", 1000);
    const maxResults = boundedBudget(options.maxResults ?? this.defaultMaxResults, "maxResults", 10_000);
    const fields = options.fields ?? [...PROPERTY_FIELDS[property]];
    validatePropertyFields(property, fields);

    const filters: Record<string, unknown> = { ...(options.filters ?? {}) };
    const ids = options.materialIds?.map(validateId) ?? [];
    const taskIds = options.taskIds?.map(validateTaskId) ?? [];
    const identifiers = options.identifiers ?? [];
    if (property === "phonon") {
      if (ids.length) throw new MaterialsProjectError("UNSUPPORTED_CAPABILITY", "phonon REST search accepts identifiers, not material_ids; the official helper resolves material_ids via summary phonon_IDs first");
      if (identifiers.length) filters.identifiers = identifiers;
    } else if (MATERIAL_ID_UNSUPPORTED_DIRECT_PROPERTIES.has(property) && ids.length) {
      throw new MaterialsProjectError("UNSUPPORTED_CAPABILITY", `${property} REST search has no material_ids parameter; use the electronic_structure summary or the optional mp-api/pymatgen helper for material-ID object retrieval`);
    } else if (TASK_ID_PROPERTIES.has(property)) {
      if (ids.length) throw new MaterialsProjectError("UNSUPPORTED_CAPABILITY", `${property} REST search uses task_ids, not material_ids`);
      if (taskIds.length) filters.task_ids = taskIds;
    } else if (ids.length && !["substrates", "synthesis"].includes(property)) {
      filters.material_ids = ids;
    } else if (ids.length) {
      throw new MaterialsProjectError("UNSUPPORTED_CAPABILITY", `${property} has no material_ids REST filter; provide its documented route-specific filters`);
    }
    if (options.spectrumIds?.length) {
      if (property !== "xas") throw new MaterialsProjectError("SCHEMA_MISMATCH", "spectrumIds is only valid for xas");
      filters.spectrum_ids = options.spectrumIds;
    }
    if (options.identifiers?.length && property !== "phonon") throw new MaterialsProjectError("SCHEMA_MISMATCH", "identifiers is only valid for phonon");
    const query: Record<string, string | string[]> = { ...routeQuery(property, filters), _fields: fields.join(",") };
    const pageSize = Math.min(1000, maxResults);
    const records: MaterialRecord[] = [];
    const provenance: Provenance[] = [];
    const warnings: string[] = [];
    let total: number | undefined;
    let nextPage: number | undefined;
    let requestsMade = 0;
    let page = 0;
    while (page < maxPages && records.length < maxResults) {
      const pageQuery = toUrlQuery(query, page, Math.min(pageSize, maxResults - records.length));
      const response = await this.request(PROPERTY_SUFFIX[property], pageQuery, signal);
      requestsMade += 1;
      const parsed = responseRows(response.payload);
      const prov = makeProvenance(`/${PROPERTY_SUFFIX[property]}`, query, response.url, response.payload);
      provenance.push(prov);
      for (const row of parsed.rows) {
        records.push(normalizeRow(row, prov, fields, ["synthesis", "insertion_electrodes", "alloys"].includes(property), property === "synthesis"));
        if (records.length >= maxResults) break;
      }
      total = parsed.total ?? total;
      nextPage = parsed.nextPage;
      if (parsed.rows.length === 0 || parsed.rows.length < pageSize || (total !== undefined && records.length >= Math.min(maxResults, total))) break;
      page = nextPage ?? page + 1;
    }
    const truncated = records.length >= maxResults || (page >= maxPages && (total === undefined || records.length < total));
    if (truncated) warnings.push(`request budget reached: ${requestsMade} request(s), ${records.length} record(s)`);
    return { records, property, pagesFetched: requestsMade, requestsMade, truncated, query: sanitizePayload(query) as Record<string, unknown>, provenance, warnings };
  }

  async get(options: MaterialsGetOptions, signal?: AbortSignal): Promise<MaterialsGetResult> {
    const materialIds = (options.materialIds ?? []).map(validateId);
    const taskIds = (options.taskIds ?? []).map(validateTaskId);
    if (!materialIds.length && !taskIds.length) throw new MaterialsProjectError("SCHEMA_MISMATCH", "materialIds or taskIds is required");
    const properties: MaterialProperty[] = options.properties.length ? options.properties : ["summary"];
    for (const property of properties) {
      if (!SUPPORTED_PROPERTIES.has(property)) throw new MaterialsProjectError("SCHEMA_MISMATCH", `unsupported property: ${property}`);
    }
    const maxPages = boundedBudget(options.maxPages ?? this.defaultMaxPages, "maxPages", 1000);
    const maxResults = boundedBudget(options.maxResults ?? Math.min(this.defaultMaxResults, (materialIds.length || taskIds.length)), "maxResults", 10_000);
    const recordsById = new Map<string, MaterialRecord>();
    const warnings: string[] = [];
    let requestsMade = 0;
    let resolvedTaskIds = [...taskIds];
    if (!resolvedTaskIds.length && materialIds.length && properties.some((property) => TASK_ID_PROPERTIES.has(property))) {
      if (maxPages < 2) throw new MaterialsProjectError("BUDGET_EXCEEDED", "resolving task IDs from material IDs requires at least two requests");
      const originQuery: Record<string, string | string[]> = { material_ids: materialIds, _fields: "material_id,origins" };
      const originResponse = await this.request("materials/summary", toUrlQuery(originQuery, 0, Math.min(1000, materialIds.length)), signal);
      requestsMade += 1;
      const originRows = responseRows(originResponse.payload).rows;
      resolvedTaskIds = [...new Set(originRows.flatMap((row) => Array.isArray(row.origins) ? row.origins.map((origin) => {
        if (!origin || typeof origin !== "object") return undefined;
        const value = (origin as Record<string, unknown>).task_id ?? (origin as Record<string, unknown>).taskId;
        return typeof value === "string" ? value : undefined;
      }).filter((value): value is string => Boolean(value)) : []))];
      if (!resolvedTaskIds.length) warnings.push("No task IDs were present in the selected materials' summary origins");
    }
    const pageSize = Math.min(1000, maxResults);
    for (const property of properties) {
      const path = PROPERTY_GET_SUFFIX[property];
      // Each route gets its own bounded projection by default. Callers can pass
      // a shared field list when querying several routes, provided those fields
      // are valid for every selected route.
      const fields = options.fields ?? [...PROPERTY_FIELDS[property]];
      validatePropertyFields(property, fields);
      if (MATERIAL_ID_UNSUPPORTED_DIRECT_PROPERTIES.has(property)) {
        throw new MaterialsProjectError("UNSUPPORTED_CAPABILITY", `${property} has no material_ids REST filter; use materials_route_search or the optional Python bridge`);
      }
      if (property === "phonon" && materialIds.length) {
        throw new MaterialsProjectError("UNSUPPORTED_CAPABILITY", "phonon REST retrieval requires phonon identifiers; the official mp-api helper resolves material_ids through summary phonon_IDs before querying this route");
      }
      if (MATERIAL_ID_UNSUPPORTED_PROPERTIES.has(property)) {
        throw new MaterialsProjectError("UNSUPPORTED_CAPABILITY", `${property} has no material_ids REST filter; use materials_route_search with its documented route-specific filters`);
      }
      const idKey = TASK_ID_PROPERTIES.has(property) ? "task_ids" : IDENTIFIER_PROPERTIES.has(property) ? "identifiers" : "material_ids";
      const ids = TASK_ID_PROPERTIES.has(property) ? resolvedTaskIds : IDENTIFIER_PROPERTIES.has(property) ? [] : materialIds;
      if (TASK_ID_PROPERTIES.has(property) && !ids.length) throw new MaterialsProjectError("SCHEMA_MISMATCH", `${property} property requires taskIds; task IDs are not material IDs`);
      if (IDENTIFIER_PROPERTIES.has(property) && !ids.length) throw new MaterialsProjectError("SCHEMA_MISMATCH", `${property} property requires route identifiers; use materials_route_search with identifiers`);
      if (!ids.length) throw new MaterialsProjectError("SCHEMA_MISMATCH", `${property} property requires materialIds`);
      const query: Record<string, string | string[]> = { [idKey]: ids, _fields: fields.join(",") };
      let page = 0;
      let propertyRecords = 0;
      while (page < maxPages && requestsMade < maxPages && propertyRecords < maxResults) {
        const pageQuery = toUrlQuery(query, page, Math.min(pageSize, maxResults - propertyRecords));
        const response = await this.request(path, pageQuery, signal);
        requestsMade += 1;
        const parsed = responseRows(response.payload);
        const provenance = makeProvenance(`/${path}`, query, response.url, response.payload);
        for (const row of parsed.rows) {
          const next = normalizeRow(row, provenance, fields, property === "alloys");
          const key = `${next.recordIdField ?? "material_id"}:${next.recordId ?? next.materialId ?? ""}`;
          const previous = recordsById.get(key);
          if (!previous) {
            recordsById.set(key, next);
          } else {
            previous.formula = previous.formula?.state === "provided" ? previous.formula : next.formula;
            previous.elements = previous.elements?.state === "provided" ? previous.elements : next.elements;
            previous.fields = { ...previous.fields, ...next.fields };
            previous.raw = { ...previous.raw, ...next.raw };
            previous.recordId = previous.recordId ?? next.recordId;
            previous.recordIdField = previous.recordIdField ?? next.recordIdField;
            previous.provenanceSources = [...(previous.provenanceSources ?? [previous.provenance]), next.provenance];
            previous.warnings.push(...next.warnings);
          }
          propertyRecords += 1;
        }
        if (parsed.rows.length === 0 || parsed.rows.length < pageSize || propertyRecords >= maxResults) break;
        page += 1;
      }
    }
    if (requestsMade >= maxPages) warnings.push("request budget reached");
    const records = [...recordsById.values()].slice(0, maxResults);
    return { records, properties, pagesFetched: requestsMade, requestsMade, truncated: records.length >= maxResults, warnings };
  }
}

function boundedBudget(value: number, name: string, maximum: number): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new MaterialsProjectError("BUDGET_EXCEEDED", `${name} must be an integer from 1 to ${maximum}`);
  return value;
}

function isExactElementSet(record: MaterialRecord, expected: string[]): boolean {
  const value = record.elements?.value;
  if (!Array.isArray(value)) return false;
  const actual = new Set(value.map(String));
  const wanted = new Set(expected);
  return actual.size === wanted.size && [...actual].every((element) => wanted.has(element));
}

/** REST search parameters accepted by the route-specific mp-api wrappers.
 * This allow-list is intentionally conservative: available_fields is not a
 * filter contract and unknown parameters are rejected before a request. */
export const ROUTE_FILTERS: Record<MaterialProperty, readonly string[]> = {
  summary: [], structure: [],
  thermo: ["thermo_ids", "material_ids", "thermo_types", "formula", "chemsys", "is_stable", "nsites_min", "nsites_max", "nelements_min", "nelements_max", "volume_min", "volume_max", "density_min", "density_max", "density_atomic_min", "density_atomic_max", "uncorrected_energy_per_atom_min", "uncorrected_energy_per_atom_max", "energy_per_atom_min", "energy_per_atom_max", "energy_uncertainy_per_atom_min", "energy_uncertainy_per_atom_max", "formation_energy_per_atom_min", "formation_energy_per_atom_max", "energy_above_hull_min", "energy_above_hull_max", "equilibrium_reaction_energy_per_atom_min", "equilibrium_reaction_energy_per_atom_max", "decomposition_enthalpy_min", "decomposition_enthalpy_max"],
  bandstructure: ["band_gap_min", "band_gap_max", "efermi_min", "efermi_max", "is_gap_direct", "is_metal", "magnetic_ordering", "path_type"],
  dos: ["band_gap_min", "band_gap_max", "efermi_min", "efermi_max", "element", "magnetic_ordering", "orbital", "projection_type", "spin"],
  magnetism: ["num_magnetic_sites_min", "num_magnetic_sites_max", "num_unique_magnetic_sites_min", "num_unique_magnetic_sites_max", "ordering", "total_magnetization_min", "total_magnetization_max", "total_magnetization_normalized_vol_min", "total_magnetization_normalized_vol_max", "total_magnetization_normalized_formula_units_min", "total_magnetization_normalized_formula_units_max"],
  elasticity: ["chemsys", "elastic_anisotropy_min", "elastic_anisotropy_max", "g_voigt_min", "g_voigt_max", "g_reuss_min", "g_reuss_max", "g_vrh_min", "g_vrh_max", "k_voigt_min", "k_voigt_max", "k_reuss_min", "k_reuss_max", "k_vrh_min", "k_vrh_max", "poisson_min", "poisson_max"],
  dielectric: ["e_total_min", "e_total_max", "e_ionic_min", "e_ionic_max", "e_electronic_min", "e_electronic_max", "n_min", "n_max"],
  piezoelectric: ["piezo_modulus_min", "piezo_modulus_max"],
  phonon: ["identifiers", "formula", "chemsys", "elements", "exclude_elements", "crystal_system", "spacegroup_number", "spacegroup_symbol", "phonon_method", "nsites_min", "nsites_max", "nelements_min", "nelements_max", "volume_min", "volume_max", "density_min", "density_max", "density_atomic_min", "density_atomic_max", "total_dft_energy_min", "total_dft_energy_max", "volume_per_formula_unit_min", "volume_per_formula_unit_max", "formula_units_min", "formula_units_max"],
  absorption: ["nsites_min", "nsites_max", "nelements_min", "nelements_max", "volume_min", "volume_max", "density_min", "density_max", "density_atomic_min", "density_atomic_max", "bandgap_min", "bandgap_max"],
  xas: ["edge", "absorbing_element", "formula", "chemsys", "elements", "task_ids", "spectrum_type", "spectrum_ids"],
  insertion_electrodes: ["battery_ids", "average_voltage_min", "average_voltage_max", "capacity_grav_min", "capacity_grav_max", "capacity_vol_min", "capacity_vol_max", "elements", "energy_grav_min", "energy_grav_max", "energy_vol_min", "energy_vol_max", "exclude_elements", "formula", "fracA_charge_min", "fracA_charge_max", "fracA_discharge_min", "fracA_discharge_max", "max_delta_volume_min", "max_delta_volume_max", "max_voltage_step_min", "max_voltage_step_max", "nelements_min", "nelements_max", "num_steps_min", "num_steps_max", "stability_charge_min", "stability_charge_max", "stability_discharge_min", "stability_discharge_max", "working_ion"],
  provenance: [], tasks: ["task_ids", "elements", "exclude_elements", "formula", "last_updated_min", "last_updated_max"],
  bonds: ["coordination_envs", "coordination_envs_anonymous", "max_bond_length_min", "max_bond_length_max", "mean_bond_length_min", "mean_bond_length_max", "min_bond_length_min", "min_bond_length_max"],
  chemenv: ["species", "elements", "exclude_elements", "csm_min", "csm_max", "density_min", "density_max", "nelements_min", "nelements_max", "nsites_min", "nsites_max", "volume_min", "volume_max"],
  oxidation_states: ["chemsys", "formula", "possible_species"],
  robocrys: [], doi: [],
  eos: ["task_ids"],
  surface_properties: ["has_reconstructed", "shape_factor_min", "shape_factor_max", "surface_anisotropy_min", "surface_anisotropy_max", "weighted_surface_energy_EV_PER_ANG2_min", "weighted_surface_energy_EV_PER_ANG2_max", "weighted_surface_energy_min", "weighted_surface_energy_max", "weighted_work_function_min", "weighted_work_function_max"],
  grain_boundaries: ["chemsys", "gb_plane", "gb_energy_min", "gb_energy_max", "pretty_formula", "rotation_axis", "rotation_angle_min", "rotation_angle_max", "w_sep_min", "w_sep_max", "sigma", "type"],
  substrates: ["area_min", "area_max", "energy_min", "energy_max", "film_id", "film_orientation", "sub_id", "sub_form", "substrate_orientation", "norients_min", "norients_max"],
  alloys: ["material_ids", "formulae"], similarity: [],
  synthesis: ["keywords", "synthesis_type", "target_formula", "precursor_formula", "operations", "condition_heating_temperature_min", "condition_heating_temperature_max", "condition_heating_time_min", "condition_heating_time_max", "condition_heating_atmosphere", "condition_mixing_device", "condition_mixing_media"],
};
const MATERIAL_ID_ROUTE_PROPERTIES = new Set<MaterialProperty>(["thermo", "magnetism", "elasticity", "dielectric", "piezoelectric", "absorption", "provenance", "bonds", "chemenv", "oxidation_states", "robocrys", "surface_properties", "grain_boundaries", "alloys", "similarity", "doi"]);

function snakeCase(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function routeQuery(property: MaterialProperty, filters: Record<string, unknown> | undefined): Record<string, string | string[]> {
  const output: Record<string, string | string[]> = {};
  for (const [originalName, raw] of Object.entries(filters ?? {})) {
    if (raw === undefined || raw === null) continue;
    const name = snakeCase(originalName);
    if (!ROUTE_FILTERS[property].includes(name) && !(name === "material_ids" && MATERIAL_ID_ROUTE_PROPERTIES.has(property))) throw new MaterialsProjectError("SCHEMA_MISMATCH", `${property} does not accept route filter ${originalName}`);
    if (typeof raw === "object" && !Array.isArray(raw) && raw !== null && ("min" in raw || "max" in raw)) {
      const range = raw as { min?: unknown; max?: unknown };
      if (range.min !== undefined) output[`${name}_min`] = String(range.min);
      if (range.max !== undefined) output[`${name}_max`] = String(range.max);
    } else if (Array.isArray(raw)) output[name] = raw.map(String);
    else if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") output[name] = String(raw);
    else throw new MaterialsProjectError("SCHEMA_MISMATCH", `${property}.${originalName} must be a scalar, list, or range`);
  }
  return output;
}

export { MP_API_DOCS, PROPERTY_SUFFIX, UNITS };
