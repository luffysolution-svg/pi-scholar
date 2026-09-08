/** A Common Chemistry substance record. This type is deliberately separate from LiteratureRecord. */
export interface ChemicalRecord {
  casRn: string;
  name: string;
  synonyms: string[];
  molecularFormula?: string;
  molecularMass?: number;
  smiles?: string;
  canonicalSmiles?: string;
  inchi?: string;
  inchiKey?: string;
  source: {
    provider: "cas-common-chemistry";
    retrievedAt: string;
    url?: string;
    license?: "CC BY-NC 4.0" | string;
  };
  raw?: unknown;
}

export interface ChemicalSearchRequest {
  query: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface ChemicalSearchResult {
  provider: "cas-common-chemistry";
  records: ChemicalRecord[];
  total?: number;
  warnings: string[];
}

export type ChemistryImplementationStatus = "contract_blocked" | "implemented";
export type ChemistryAccessStatus = "permission_required" | "unknown" | "public";

export interface ChemistrySourceStatus {
  id: "cas-common-chemistry";
  enabled: boolean;
  implementationStatus: ChemistryImplementationStatus;
  accessStatus: ChemistryAccessStatus;
  credentialEnv: string;
  credentialConfigured: boolean;
  docs: string;
  limitations: string[];
}
