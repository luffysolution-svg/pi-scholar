/** Shared credential parsing for the unified pi-scholar configuration.
 *
 * This module deliberately returns only the selected credential to callers and
 * never logs or serializes it.
 */
export interface ApiKeyConfig {
  apiKey?: string;
  apiKeyEnv?: string;
}

export const STANDARD_API_KEY_ENVS: Record<string, readonly string[]> = {
  "semantic-scholar": ["SEMANTIC_SCHOLAR_API_KEY"],
  openalex: ["OPENALEX_API_KEY"],
  pubmed: ["NCBI_API_KEY"],
  easyscholar: ["EASYSCHOLAR_SECRET_KEY"],
  "materials-project": ["MP_API_KEY"],
  "cas-common-chemistry": ["CAS_API_KEY"],
  ai4scholar: ["AI4SCHOLAR_API_KEY"],
  mineru: ["MINERU_API_TOKEN"],
};

export function validateApiKeyEnv(value: unknown, label = "apiKeyEnv"): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[A-Z_][A-Z0-9_]*$/.test(value)) {
    throw new Error(`${label} must be an uppercase environment variable name`);
  }
  return value;
}

export function resolveApiKey(
  config: ApiKeyConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
  standardEnvNames: readonly string[] = [],
): string | undefined {
  const direct = typeof config?.apiKey === "string" ? config.apiKey.trim() : undefined;
  if (direct) return direct;
  const envName = config?.apiKeyEnv;
  const referenced = envName ? env[envName]?.trim() : undefined;
  if (referenced) return referenced;
  for (const name of standardEnvNames) {
    const fallback = env[name]?.trim();
    if (fallback) return fallback;
  }
  return undefined;
}

export function apiKeyConfigured(
  config: ApiKeyConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
  standardEnvNames: readonly string[] = [],
): boolean {
  return Boolean(resolveApiKey(config, env, standardEnvNames));
}
