import type { MaterialsProjectConfig } from "./types.js";

export interface MaterialsConfigValidation {
  config: MaterialsProjectConfig;
  warnings: string[];
}

/**
 * Validate the small `data.providers.materials-project` config section. Keys
 * are references only; the secret itself is read from the selected environment
 * variable when a request is made.
 */
export function validateMaterialsConfig(input: unknown, env: NodeJS.ProcessEnv = process.env): MaterialsConfigValidation {
  if (input === undefined || input === null) return { config: {}, warnings: ["Materials Project provider is not configured"] };
  if (typeof input !== "object" || Array.isArray(input)) throw new Error("data.providers.materials-project must be an object");
  const source = input as Record<string, unknown>;
  const config: MaterialsProjectConfig = {};
  const warnings: string[] = [];
  if (Object.prototype.hasOwnProperty.call(source, "apiKey")) throw new Error("materials-project.apiKey is not allowed in persisted config; use credentialEnv");
  if (Object.prototype.hasOwnProperty.call(source, "endpoint")) throw new Error("materials-project.endpoint is not allowed in persisted config");
  if (source.enabled !== undefined && typeof source.enabled !== "boolean") throw new Error("materials-project.enabled must be boolean");
  if (source.enabled !== undefined) config.enabled = source.enabled;
  if (source.credentialEnv !== undefined) {
    if (typeof source.credentialEnv !== "string" || !/^[A-Z_][A-Z0-9_]{0,127}$/.test(source.credentialEnv)) throw new Error("materials-project.credentialEnv must be an environment variable name");
    config.credentialEnv = source.credentialEnv;
  }
  for (const name of ["timeoutMs", "maxRequests", "maxPages", "maxResults", "maxResponseBytes"] as const) {
    if (source[name] !== undefined) {
      const maximum = name === "timeoutMs" ? 120_000 : name === "maxRequests" ? 1000 : name === "maxResults" ? 10_000 : name === "maxResponseBytes" ? 64 * 1024 * 1024 : 100;
      const minimum = name === "maxResponseBytes" ? 1024 : 1;
      if (typeof source[name] !== "number" || !Number.isInteger(source[name]) || source[name] < minimum || source[name] > maximum) throw new Error(`materials-project.${name} is out of range`);
      config[name] = source[name];
    }
  }
  if (config.enabled === false) return { config, warnings };
  const envName = config.credentialEnv ?? "MP_API_KEY";
  if (!env[envName]) warnings.push(`Materials Project credential missing (${envName}); materials tools will return AUTH_REQUIRED`);
  return { config, warnings };
}
