import { ResearchError } from "../research/errors.js";
import type { ChemicalRecord, ChemicalSearchRequest, ChemicalSearchResult, ChemistrySourceStatus } from "./types.js";

const DOCS = "https://www.cas.org/services/commonchemistry-api";

export interface CASCommonChemistryConfig {
  enabled?: boolean;
  /** Name of the environment variable holding the provider-issued credential. */
  credentialEnv?: string;
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
  private readonly credentialEnv: string;

  constructor(config: CASCommonChemistryConfig = {}) {
    this.credentialEnv = config.credentialEnv ?? "CAS_API_KEY";
    if (!/^[A-Z_][A-Z0-9_]*$/.test(this.credentialEnv)) throw new Error("credentialEnv must be an uppercase environment variable name");
    this.status = {
      id: "cas-common-chemistry",
      enabled: config.enabled === true,
      implementationStatus: "contract_blocked",
      accessStatus: "permission_required",
      credentialEnv: this.credentialEnv,
      credentialConfigured: Boolean(process.env[this.credentialEnv]?.trim()),
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
