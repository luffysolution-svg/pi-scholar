/** Types for the Materials Project REST adapter.
 *
 * These are intentionally REST-facing types. They are not aliases of mp-api's
 * Python SDK arguments: the adapter validates the public tool input and maps
 * it to the query parameters accepted by the REST service.
 */

export const MP_BASE_URL = "https://api.materialsproject.org" as const;
export const MP_API_DOCS = "https://docs.materialsproject.org/downloading-data/using-the-api" as const;

export type MaterialFieldState =
  | "requested"
  | "provided"
  | "missing"
  | "not_requested"
  | "unsupported"
  | "error";

export interface MaterialField<T = unknown> {
  value?: T;
  state: MaterialFieldState;
  unit?: string;
  sourceField?: string;
  reason?: string;
}

export interface Provenance {
  source: "materials-project";
  endpoint: string;
  retrievedAt: string;
  apiVersion?: string;
  databaseVersion?: string;
  query: Record<string, unknown>;
  url: string;
  license?: string;
}

export interface MaterialRecord {
  /** Material ID when the source document has one. Non-material collections
   * (tasks, EOS, substrates, alloys and synthesis) use recordId instead. */
  materialId?: string;
  /** Stable source identifier for every collection document. */
  recordId?: string;
  recordIdField?: string;
  formula?: MaterialField<string>;
  elements?: MaterialField<string[]>;
  fields: Record<string, MaterialField>;
  raw: Record<string, unknown>;
  provenance: Provenance;
  /** Additional endpoint provenance when a get operation combines properties. */
  provenanceSources?: Provenance[];
  warnings: string[];
}

export interface RangeFilter {
  min?: number;
  max?: number;
}

/** Public, validated filters accepted by materials_search. */
export interface MaterialsSearchFilters {
  materialIds?: string[];
  formula?: string | string[];
  elements?: string[];
  /** `contains` follows MP's elements filter; `exact` is a bounded local check. */
  elementsMode?: "contains" | "exact";
  chemsys?: string | string[];
  bandGap?: RangeFilter;
  energyAboveHull?: RangeFilter;
  density?: RangeFilter;
  volume?: RangeFilter;
  numSites?: RangeFilter;
  isStable?: boolean;
  isMetal?: boolean;
  hasProps?: string[];
  fields?: string[];
  /** Maximum records returned across all pages. */
  maxResults?: number;
  /** Maximum HTTP requests/pages for this operation. */
  maxPages?: number;
}

export interface MaterialsSearchResult {
  records: MaterialRecord[];
  total?: number;
  nextPage?: number;
  pagesFetched: number;
  requestsMade: number;
  truncated: boolean;
  query: Record<string, unknown>;
  provenance: Provenance[];
  warnings: string[];
}

export type MaterialProperty =
  | "summary"
  | "doi"
  | "structure"
  | "thermo"
  | "bandstructure"
  | "dos"
  | "magnetism"
  | "elasticity"
  | "dielectric"
  | "piezoelectric"
  | "phonon"
  | "absorption"
  | "xas"
  | "insertion_electrodes"
  | "provenance"
  | "tasks"
  | "bonds"
  | "chemenv"
  | "oxidation_states"
  | "robocrys"
  | "eos"
  | "surface_properties"
  | "grain_boundaries"
  | "substrates"
  | "alloys"
  | "similarity"
  | "synthesis";

export interface MaterialsGetOptions {
  materialIds?: string[];
  /** Calculation task identifiers, used only with the tasks route. */
  taskIds?: string[];
  properties: MaterialProperty[];
  fields?: string[];
  maxResults?: number;
  maxPages?: number;
}

/**
 * Route-specific search input. The property-specific SDK wrappers do not all
 * share the summary endpoint's material_ids contract, so this is deliberately
 * separate from MaterialsGetOptions.
 */
export interface MaterialsRouteSearchOptions {
  property: Exclude<MaterialProperty, "summary" | "structure">;
  materialIds?: string[];
  taskIds?: string[];
  identifiers?: string[];
  spectrumIds?: string[];
  fields?: string[];
  /** REST names are accepted only from the verified allow-list in the client. */
  filters?: Record<string, string | number | boolean | Array<string | number>>;
  maxResults?: number;
  maxPages?: number;
}

export interface MaterialsRouteSearchResult {
  records: MaterialRecord[];
  property: MaterialProperty;
  pagesFetched: number;
  requestsMade: number;
  truncated: boolean;
  query: Record<string, unknown>;
  provenance: Provenance[];
  warnings: string[];
}

export interface MaterialsGetResult {
  records: MaterialRecord[];
  properties: MaterialProperty[];
  pagesFetched: number;
  requestsMade: number;
  truncated: boolean;
  warnings: string[];
}

export interface MaterialsProjectConfig {
  enabled?: boolean;
  apiKey?: string;
  apiKeyEnv?: string;
  endpoint?: string;
  timeoutMs?: number;
  maxPages?: number;
  /** Alias accepted by the root data config; it bounds total requests. */
  maxRequests?: number;
  maxResults?: number;
  userAgent?: string;
  maxResponseBytes?: number;
}

export interface MaterialsHttpResponse {
  status: number;
  headers: Headers;
  /** Native fetch responses expose a stream; test doubles may omit it. */
  body?: ReadableStream<Uint8Array> | null;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type MaterialsFetch = (input: string | URL, init?: RequestInit) => Promise<MaterialsHttpResponse>;
