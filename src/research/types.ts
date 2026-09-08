/** Shared contracts for the first-party research provider layer. */
export type ResearchCapability =
  | "literature.search"
  | "literature.lookup"
  | "literature.references"
  | "literature.citations"
  | "literature.recommendations"
  | "journal.metrics"
  | "fulltext.resolve"
  | "fulltext.fetch";

export type ImplementationStatus = "implemented" | "contract_blocked" | "not_implemented";
export type CredentialStatus = "not_required" | "configured" | "missing";
export type AccessStatus = "unknown" | "public" | "restricted" | "denied" | "permission_required";
export type ValidationStatus = "mock_passed" | "live_passed" | "live_untested";

export interface ProviderCapability {
  id: ResearchCapability;
  implementationStatus: ImplementationStatus;
  docs: string;
  notes?: string;
}

export interface ProviderStatus {
  id: string;
  name: string;
  enabled: boolean;
  paid: boolean;
  implementationStatus: ImplementationStatus;
  credentialStatus: CredentialStatus;
  accessStatus: AccessStatus;
  validationStatus: ValidationStatus;
  capabilities: ProviderCapability[];
  credentialEnv?: string;
  docs: string[];
  limitations: string[];
}

export interface ResearchSourceRef {
  provider: string;
  sourceId?: string;
  url?: string;
  retrievedAt: string;
  providerUpdatedAt?: string;
  fields?: Record<string, string>;
  license?: string;
}

export interface LiteratureRecord {
  id: string;
  title: string;
  abstract?: string;
  authors: Array<{ name: string; id?: string; institutions?: Array<{ name: string; id?: string }> }>;
  year?: number;
  venue?: string;
  doi?: string;
  identifiers: Record<string, string>;
  url?: string;
  openAccessUrl?: string;
  citationCount?: number;
  source: ResearchSourceRef;
  raw?: unknown;
}

export interface ResearchSearchRequest {
  query: string;
  provider?: string;
  providers?: string[];
  limit?: number;
  offset?: number;
  yearFrom?: number;
  yearTo?: number;
  openAccessOnly?: boolean;
  fields?: string[];
  /** Explicit opt-in for providers whose API or entitlement may incur cost. */
  allowPaid?: boolean;
  signal?: AbortSignal;
}

export interface ResearchSearchResult {
  provider: string;
  items: LiteratureRecord[];
  total?: number;
  next?: string;
  warnings: string[];
  usage: { requests: number; estimatedCost?: number; costKnown: boolean };
}

export interface LiteratureProvider {
  readonly status: ProviderStatus;
  search(request: ResearchSearchRequest): Promise<ResearchSearchResult>;
  get?(id: string, signal?: AbortSignal): Promise<LiteratureRecord>;
  graph?(id: string, kind: "references" | "citations" | "recommendations", options?: { limit?: number; offset?: number; signal?: AbortSignal }): Promise<ResearchSearchResult>;
  metrics?(query: string, signal?: AbortSignal): Promise<unknown>;
  fulltext?(id: string, action: "resolve" | "fetch", signal?: AbortSignal): Promise<unknown>;
}

export interface ResearchRouter {
  listSources(): ProviderStatus[];
  search(request: ResearchSearchRequest): Promise<ResearchSearchResult | ResearchSearchResult[]>;
  get(provider: string, id: string, signal?: AbortSignal): Promise<LiteratureRecord>;
  graph(provider: string, id: string, kind: "references" | "citations" | "recommendations", options?: { limit?: number; offset?: number; signal?: AbortSignal }): Promise<ResearchSearchResult>;
}
