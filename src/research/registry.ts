import { ResearchError } from "./errors.js";
import type { LiteratureProvider, ProviderStatus } from "./types.js";

/** In-memory capability registry. It never probes providers or loads credentials. */
export class ResearchProviderRegistry {
  private readonly entries = new Map<string, LiteratureProvider>();
  constructor(providers: Iterable<LiteratureProvider> = []) { for (const provider of providers) this.register(provider); }
  register(provider: LiteratureProvider): void {
    if (this.entries.has(provider.status.id)) throw new ResearchError("CONFLICT", `Provider already registered: ${provider.status.id}`, provider.status.id);
    this.entries.set(provider.status.id, provider);
  }
  get(id: string): LiteratureProvider {
    const value = this.entries.get(id);
    if (!value) throw new ResearchError("SOURCE_UNAVAILABLE", `Unknown research provider: ${id}`, id);
    return value;
  }
  list(): ProviderStatus[] { return [...this.entries.values()].map((provider) => provider.status); }
  values(): LiteratureProvider[] { return [...this.entries.values()]; }
}
