import { ResearchError } from "./errors.js";
import type { ResearchConfig } from "./config.js";
import { createResearchProviders } from "./providers/index.js";
import type { LiteratureProvider, ResearchRouter, ResearchSearchRequest, ResearchSearchResult } from "./types.js";
import { ResearchProviderRegistry } from "./registry.js";

export class DefaultResearchRouter implements ResearchRouter {
  private readonly registry: ResearchProviderRegistry;
  private readonly requestCounts = new Map<string, number>();
  constructor(private readonly config: ResearchConfig, providers = createResearchProviders(config)) {
    this.registry = new ResearchProviderRegistry(providers);
  }
  listSources() { return this.registry.list(); }
  private select(id: string, capability?: string): LiteratureProvider {
    const provider = this.registry.get(id);
    if (!provider.status.enabled) throw new ResearchError("SOURCE_UNAVAILABLE", `${id} is disabled in research configuration`, id);
    if (capability && !provider.status.capabilities.some((c) => c.id === capability && c.implementationStatus === "implemented")) throw new ResearchError("UNSUPPORTED_CAPABILITY", `${id} does not implement ${capability}`, id);
    if (provider.status.paid && !this.config.policy.allowPaidFallback) {
      // Explicit source selection is still allowed, but fallback is never implicit.
      // Callers set allowPaid on a request when they explicitly approve a paid source.
    }
    return provider;
  }
  private reserve(provider: LiteratureProvider, amount = 1) {
    const max = this.config.providers[provider.status.id]?.maxRequests ?? 100;
    const used = this.requestCounts.get(provider.status.id) ?? 0;
    if (used + amount > max) throw new ResearchError("BUDGET_EXCEEDED", `${provider.status.id} local request budget exceeded`, provider.status.id);
    this.requestCounts.set(provider.status.id, used + amount);
  }
  private adjust(provider: LiteratureProvider, reserved: number, actual: number) {
    if (actual > reserved) this.reserve(provider, actual - reserved);
    else if (actual < reserved) this.requestCounts.set(provider.status.id, Math.max(0, (this.requestCounts.get(provider.status.id) ?? 0) - (reserved - actual)));
  }
  async search(request: ResearchSearchRequest): Promise<ResearchSearchResult | ResearchSearchResult[]> {
    const ids = request.providers ?? (request.provider ? [request.provider] : []);
    const automatic = this.registry.values()
      .filter((p) => p.status.enabled && p.status.capabilities.some((c) => c.id === "literature.search" && c.implementationStatus === "implemented") && (!p.status.paid || this.config.policy.allowPaidFallback))
      .sort((a, b) => (this.config.providers[b.status.id]?.priority ?? 0) - (this.config.providers[a.status.id]?.priority ?? 0));
    const selected = ids.length ? ids : automatic.slice(0, 1);
    if (!selected.length) throw new ResearchError("SOURCE_UNAVAILABLE", "No enabled research provider is available");
    const results: ResearchSearchResult[] = [];
    for (const providerLike of selected) {
      const provider = typeof providerLike === "string" ? this.select(providerLike, "literature.search") : providerLike;
      if (provider.status.paid && !request.allowPaid && !request.provider && !request.providers) continue;
      // Reserve one request before the call, then reconcile with the provider's
      // reported count (PubMed uses one request for an empty page and two otherwise).
      const reserved = provider.status.id === "pubmed" ? 2 : 1;
      this.reserve(provider, reserved);
      const found = await provider.search({ ...request, provider: provider.status.id, limit: Math.min(request.limit ?? this.config.maxResults, this.config.maxResults) });
      this.adjust(provider, reserved, found.usage.requests);
      results.push(found);
    }
    if (!results.length) throw new ResearchError("ENTITLEMENT_REQUIRED", "Only paid providers are enabled; set allowPaid or explicitly select one");
    return results.length === 1 ? results[0]! : results;
  }
  async get(providerId: string, id: string, signal?: AbortSignal) { const provider = this.select(providerId, "literature.lookup"); if (!provider.get) throw new ResearchError("UNSUPPORTED_CAPABILITY", `${providerId} does not support literature.lookup`, providerId); this.reserve(provider); return provider.get(id, signal); }
  async graph(providerId: string, id: string, kind: "references" | "citations" | "recommendations", options: any = {}) { const provider = this.select(providerId, `literature.${kind}`); if (!provider.graph) throw new ResearchError("UNSUPPORTED_CAPABILITY", `${providerId} does not support ${kind}`, providerId); this.reserve(provider); return provider.graph(id, kind, options); }
  async metrics(providerId: string, query: string, signal?: AbortSignal) { const provider = this.select(providerId, "journal.metrics"); if (!provider.metrics) throw new ResearchError("UNSUPPORTED_CAPABILITY", `${providerId} does not support journal.metrics`, providerId); this.reserve(provider); return provider.metrics(query, signal); }
  async fulltext(providerId: string, id: string, action: "resolve" | "fetch", signal?: AbortSignal) { const provider = this.select(providerId, `fulltext.${action}`); if (!provider.fulltext) throw new ResearchError("UNSUPPORTED_CAPABILITY", `${providerId} does not support fulltext.${action}`, providerId); this.reserve(provider, provider.status.id === "pubmed" && action === "fetch" ? 2 : 1); return provider.fulltext(id, action, signal); }
}

export function createResearchRouter(config: ResearchConfig): DefaultResearchRouter { return new DefaultResearchRouter(config); }
