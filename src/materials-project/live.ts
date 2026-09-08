import { MP_BASE_URL } from "./types.js";

export interface MaterialsLiveTestPlan {
  providerId: "materials-project";
  endpoint: string;
  apiKeyEnv: string;
  requestCountUpperBound: number;
  estimatedCost: "unknown (Materials Project API usage is account/rate-limit dependent)";
  explicitOptInRequired: true;
  commandHint: string;
}
/**
 * Produce a reviewable live-test plan without reading a key or making a
 * request. A caller must explicitly opt in before executing its own smoke test.
 */
export function createMaterialsLiveTestPlan(options: { apiKeyEnv?: string; maxRequests?: number } = {}): MaterialsLiveTestPlan {
  const maxRequests = options.maxRequests ?? 1;
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 1000) throw new Error("maxRequests must be an integer from 1 to 1000");
  return {
    providerId: "materials-project",
    endpoint: MP_BASE_URL,
    apiKeyEnv: options.apiKeyEnv ?? "MP_API_KEY",
    requestCountUpperBound: maxRequests,
    estimatedCost: "unknown (Materials Project API usage is account/rate-limit dependent)",
    explicitOptInRequired: true,
    commandHint: "Configure data.providers.materials-project.apiKey, apiKeyEnv, or MP_API_KEY; review this plan; then explicitly run a bounded request",
  };
}
