import type { ResearchConfig } from "./config.js";
import { createResearchRouter } from "./router.js";
import type { LiteratureRecord, ResearchSearchResult } from "./types.js";

export interface ResearchRequestPreview {
  provider: string;
  enabled: boolean;
  credentialEnv?: string;
  credentialConfigured: boolean;
  estimatedRequests: number;
  estimatedCost: "unknown";
  paid: boolean;
}

/** Return the exact local preflight for a single explicitly selected source. */
export function previewResearchRequest(config: ResearchConfig, provider: string): ResearchRequestPreview {
  const status = createResearchRouter(config).listSources().find((item) => item.id === provider);
  if (!status) throw new Error(`Unknown research provider: ${provider}`);
  return { provider, enabled: status.enabled, credentialEnv: status.credentialEnv, credentialConfigured: status.credentialStatus === "configured" || status.accessStatus === "public", estimatedRequests: 1, estimatedCost: "unknown", paid: status.paid };
}

/** Explicit live smoke check. It performs one bounded search only after the caller selected a provider. */
export async function liveResearchCheck(config: ResearchConfig, provider: string, query = "pi scholar", signal?: AbortSignal): Promise<ResearchSearchResult> {
  const preview = previewResearchRequest(config, provider);
  if (!preview.enabled) throw new Error(`${provider} is disabled; enable it before a live check`);
  const router = createResearchRouter(config);
  return await router.search({ provider, query, limit: 1, allowPaid: true, signal }) as ResearchSearchResult;
}

/** Explicit DOI lookup smoke check for resolvers that do not offer search. */
export async function liveDoiLookupCheck(config: ResearchConfig, provider: string, doi: string, signal?: AbortSignal): Promise<LiteratureRecord> {
  const preview = previewResearchRequest(config, provider);
  if (!preview.enabled) throw new Error(`${provider} is disabled; enable it before a live check`);
  return createResearchRouter(config).get(provider, doi, signal);
}

/** Explicit live smoke check for providers whose verified capability is not search (currently easyScholar metrics). */
export async function liveJournalMetricsCheck(config: ResearchConfig, provider: string, query: string, signal?: AbortSignal): Promise<unknown> {
  const preview = previewResearchRequest(config, provider);
  if (!preview.enabled) throw new Error(`${provider} is disabled; enable it before a live check`);
  return createResearchRouter(config).metrics(provider, query, signal);
}
