import type { MaterialsProjectConfig } from "./types.js";
import { resolveApiKey, validateApiKeyEnv } from "../credentials.js";

export interface MaterialsConfigValidation {
  config: MaterialsProjectConfig;
  warnings: string[];
}

/**
 * Validate the `data.providers.materials-project` section and resolve its key.
 * A direct key wins over apiKeyEnv and the standard MP_API_KEY fallback.
 */
export function validateMaterialsConfig(input: unknown, env: NodeJS.ProcessEnv = process.env): MaterialsConfigValidation {
  if (input === undefined || input === null) return { config: {}, warnings: ["Materials Project provider is not configured"] };
  if (typeof input !== "object" || Array.isArray(input)) throw new Error("data.providers.materials-project must be an object");
  const source = input as Record<string, unknown>;
  const allowed = new Set(["enabled", "apiKey", "apiKeyEnv", "timeoutMs", "maxRequests", "maxPages", "maxResults", "maxResponseBytes"]);
  for (const key of Object.keys(source)) if (!allowed.has(key)) throw new Error(`Invalid materials-project field: ${key}`);
  const config: MaterialsProjectConfig = {};
  const warnings: string[] = [];
  if (Object.prototype.hasOwnProperty.call(source, "endpoint")) throw new Error("materials-project.endpoint is not allowed in persisted config");
  if (source.enabled !== undefined && typeof source.enabled !== "boolean") throw new Error("materials-project.enabled must be boolean");
  if (source.enabled !== undefined) config.enabled = source.enabled;
  if (source.apiKey !== undefined && (typeof source.apiKey !== "string" || !source.apiKey.trim())) throw new Error("materials-project.apiKey must be a non-empty string");
  if (source.apiKey !== undefined) config.apiKey = (source.apiKey as string).trim();
  const apiKeyEnv = validateApiKeyEnv(source.apiKeyEnv, "materials-project.apiKeyEnv");
  if (apiKeyEnv !== undefined) config.apiKeyEnv = apiKeyEnv;
  config.apiKey = resolveApiKey(config, env, ["MP_API_KEY"]);
  for (const name of ["timeoutMs", "maxRequests", "maxPages", "maxResults", "maxResponseBytes"] as const) {
    if (source[name] !== undefined) {
      const maximum = name === "timeoutMs" ? 120_000 : name === "maxRequests" ? 1000 : name === "maxResults" ? 10_000 : name === "maxResponseBytes" ? 64 * 1024 * 1024 : 100;
      const minimum = name === "maxResponseBytes" ? 1024 : 1;
      if (typeof source[name] !== "number" || !Number.isInteger(source[name]) || source[name] < minimum || source[name] > maximum) throw new Error(`materials-project.${name} is out of range`);
      config[name] = source[name];
    }
  }
  if (config.enabled === false) return { config, warnings };
  const envName = config.apiKeyEnv ?? "MP_API_KEY";
  if (!config.apiKey) warnings.push(`Materials Project credential missing (${envName}); materials tools will return AUTH_REQUIRED`);
  return { config, warnings };
}
