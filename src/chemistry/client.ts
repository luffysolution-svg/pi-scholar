import { ResearchError } from "../research/errors.js";
import { apiKeyConfigured, validateApiKeyEnv } from "../credentials.js";
import type { ChemicalRecord, ChemicalSearchRequest, ChemicalSearchResult, ChemistrySourceStatus } from "./types.js";

const DOCS = "https://www.cas.org/services/commonchemistry-api";

export interface CASCommonChemistryConfig {
  enabled?: boolean;
  apiKey?: string;
  apiKeyEnv?: string;
}

/**
 * Boundary for CAS Common Chemistry substance data.
 *
 * CAS currently requires API access and provides the endpoint contract separately.
 * Until that contract is supplied, methods fail closed instead of guessing routes
 * or claiming SciFinder/SciFinder-novel/reaction coverage.
 */
export class CASCommonChemistryClient {
  readonly status: ChemistrySourceStatus;

  constructor(config: CASCommonChemistryConfig = {}) {
    const apiKeyEnv = config.apiKeyEnv ?? "CAS_API_KEY";
    validateApiKeyEnv(apiKeyEnv, "apiKeyEnv");
    this.status = {
      id: "cas-common-chemistry",
      enabled: config.enabled === true,
      implementationStatus: "contract_blocked",
      accessStatus: "permission_required",
      apiKeyEnv,
      credentialConfigured: apiKeyConfigured(config, process.env, ["CAS_API_KEY"]),
      docs: DOCS,
      limitations: [
        "Official API access and endpoint contract are required before requests can be enabled.",
        "This boundary covers substance name, CAS RN, structures, and basic information only.",
        "It does not provide SciFinder literature, reaction, patent, or commercial-source search.",
      ],
    };
  }

  async search(_request: ChemicalSearchRequest): Promise<ChemicalSearchResult> {
    this.assertBlocked();
  }

  async get(_casRn: string, _signal?: AbortSignal): Promise<ChemicalRecord> {
    this.assertBlocked();
  }

  private assertBlocked(): never {
    throw new ResearchError("CONTRACT_UNVERIFIED", "CAS Common Chemistry API access/contract is not available; permission is required", "cas-common-chemistry");
  }
}

export type { ChemicalRecord, ChemicalSearchRequest, ChemicalSearchResult } from "./types.js";
