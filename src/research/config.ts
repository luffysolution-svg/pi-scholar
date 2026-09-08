import os from "node:os";
import path from "node:path";

export interface ProviderConfig {
  enabled?: boolean;
  credentialEnv?: string;
  contact?: string;
  timeoutMs?: number;
  maxRequests?: number;
  budget?: number;
  cacheTtlMs?: number;
  priority?: number;
}

export interface ResearchPolicy {
  allowPaidFallback: boolean;
  allowExternalFulltextUpload: boolean;
}

export interface ResearchConfig {
  policy: ResearchPolicy;
  providers: Record<string, ProviderConfig>;
  timeoutMs: number;
  maxResults: number;
  maxPages: number;
  contact?: string;
  cacheDir: string;
}

const DEFAULT_PROVIDERS: Record<string, ProviderConfig> = {
  "semantic-scholar": { enabled: true, credentialEnv: "SEMANTIC_SCHOLAR_API_KEY", priority: 100 },
  openalex: { enabled: true, credentialEnv: "OPENALEX_API_KEY", priority: 80 },
  pubmed: { enabled: true, credentialEnv: "NCBI_API_KEY", priority: 60 },
  arxiv: { enabled: true, priority: 50 },
  crossref: { enabled: true, priority: 40 },
  unpaywall: { enabled: false, priority: 10 },
  easyscholar: { enabled: false, credentialEnv: "EASYSCHOLAR_SECRET_KEY", priority: -100 },
};

function int(value: unknown, fallback: number, min: number, max: number, label: string): number {
  if (value !== undefined && typeof value !== "number") throw new Error(`${label} must be a number`);
  const n = value === undefined ? fallback : value;
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} must be an integer from ${min} to ${max}`);
  return n;
}

function envName(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[A-Z_][A-Z0-9_]*$/.test(value)) throw new Error(`${label} must be an uppercase environment variable name`);
  return value;
}

/** Validate and normalize the research section accepted by the root config loader. */
export function validateResearchConfig(value: unknown, env: NodeJS.ProcessEnv = process.env): ResearchConfig {
  const raw = (value ?? {}) as Record<string, unknown>;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("research must be an object");
  if (value !== undefined) for (const key of Object.keys(raw)) if (!["policy", "providers", "timeoutMs", "maxResults", "maxPages", "contact", "cacheDir"].includes(key)) throw new Error(`Invalid research field: ${key}`);
  const policyRaw = (raw.policy ?? {}) as Record<string, unknown>;
  if (typeof policyRaw !== "object" || Array.isArray(policyRaw)) throw new Error("research.policy must be an object");
  for (const key of Object.keys(policyRaw)) if (!["allowPaidFallback", "allowExternalFulltextUpload"].includes(key)) throw new Error(`Invalid research.policy field: ${key}`);
  for (const key of ["allowPaidFallback", "allowExternalFulltextUpload"]) if (policyRaw[key] !== undefined && typeof policyRaw[key] !== "boolean") throw new Error(`research.policy.${key} must be boolean`);
  const policy: ResearchPolicy = {
    allowPaidFallback: Boolean(policyRaw.allowPaidFallback ?? false),
    allowExternalFulltextUpload: Boolean(policyRaw.allowExternalFulltextUpload ?? false),
  };
  const providersRaw = (raw.providers ?? {}) as Record<string, unknown>;
  if (typeof providersRaw !== "object" || Array.isArray(providersRaw)) throw new Error("research.providers must be an object");
  const providers: Record<string, ProviderConfig> = {};
  for (const [id, defaults] of Object.entries(DEFAULT_PROVIDERS)) {
    const candidate = providersRaw[id];
    if (candidate !== undefined && (!candidate || typeof candidate !== "object" || Array.isArray(candidate))) throw new Error(`research.providers.${id} must be an object`);
    const input = (candidate ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(input)) if (!["enabled", "credentialEnv", "contact", "timeoutMs", "maxRequests", "budget", "cacheTtlMs", "priority"].includes(key)) throw new Error(`Invalid research.providers.${id} field: ${key}`);
    if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw new Error(`research.providers.${id}.enabled must be boolean`);
    const merged = { ...defaults, ...input } as ProviderConfig;
    merged.credentialEnv = envName(merged.credentialEnv, `research.providers.${id}.credentialEnv`);
    if (merged.contact !== undefined && (typeof merged.contact !== "string" || !merged.contact.trim())) throw new Error(`research.providers.${id}.contact must be a non-empty string`);
    merged.timeoutMs = int(merged.timeoutMs, 30_000, 1_000, 300_000, `${id}.timeoutMs`);
    merged.maxRequests = int(merged.maxRequests, 100, 1, 100_000, `${id}.maxRequests`);
    merged.budget = int(merged.budget, 100, 1, 1_000_000, `${id}.budget`);
    merged.cacheTtlMs = int(merged.cacheTtlMs, 86_400_000, 0, 31_536_000_000, `${id}.cacheTtlMs`);
    merged.priority = int(merged.priority, 0, -1000, 1000, `${id}.priority`);
    providers[id] = merged;
  }
  for (const id of Object.keys(providersRaw)) if (!Object.hasOwn(DEFAULT_PROVIDERS, id)) throw new Error(`Unknown research provider: ${id}`);
  const cacheDirRaw = typeof raw.cacheDir === "string" && raw.cacheDir.trim() ? raw.cacheDir : path.join(env.HOME ?? env.USERPROFILE ?? os.homedir(), ".cache", "pi-scholar", "research");
  const config: ResearchConfig = {
    policy,
    providers,
    timeoutMs: int(raw.timeoutMs, 30_000, 1_000, 300_000, "research.timeoutMs"),
    maxResults: int(raw.maxResults, 100, 1, 1000, "research.maxResults"),
    maxPages: int(raw.maxPages, 10, 1, 100, "research.maxPages"),
    contact: raw.contact === undefined ? undefined : (typeof raw.contact === "string" && raw.contact.trim() ? raw.contact.trim() : (() => { throw new Error("research.contact must be a non-empty string"); })()),
    cacheDir: raw.cacheDir === undefined ? path.resolve(cacheDirRaw) : (typeof raw.cacheDir === "string" && raw.cacheDir.trim() ? path.resolve(raw.cacheDir) : (() => { throw new Error("research.cacheDir must be a non-empty string"); })()),
  };
  return config;
}

export function loadResearchConfig(value?: unknown, env: NodeJS.ProcessEnv = process.env): ResearchConfig {
  return validateResearchConfig(value, env);
}

/** Legacy configurations must not start contacting newly added providers. */
export function disabledResearchConfig(env: NodeJS.ProcessEnv = process.env): ResearchConfig {
  return validateResearchConfig({ providers: Object.fromEntries(Object.keys(DEFAULT_PROVIDERS).map((id) => [id, { enabled: false }])) }, env);
}

export { DEFAULT_PROVIDERS };
