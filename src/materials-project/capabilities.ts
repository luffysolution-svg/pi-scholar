import { MP_API_DOCS } from "./types.js";
import type { MaterialsProjectConfig } from "./types.js";
import { PROPERTY_FIELDS } from "./client.js";

export type CapabilityImplementationStatus = "implemented" | "partial" | "planned" | "blocked";

export interface MaterialsCapability {
  capabilityId: `MP${string}`;
  title: string;
  endpoint: string;
  fields: string[];
  officialDocumentation: string[];
  inputSchema: string;
  outputSchema: string;
  unitRules: string;
  availabilityCheck: string;
  dependencies: string[];
  implementationStatus: CapabilityImplementationStatus;
  tests: string[];
  realValidation: "mock_passed_live_untested" | "live_passed" | "not_tested";
  limitations: string[];
}

const docs = (path: string) => [`${MP_API_DOCS}/querying-data`, `${MP_API_DOCS}/advanced-usage`, `https://materialsproject.github.io/api/_autosummary/mp_api.client.routes.materials.html#${path}`];
const fieldsFor = (...properties: (keyof typeof PROPERTY_FIELDS)[]): string[] => [...new Set(properties.flatMap((property) => PROPERTY_FIELDS[property]))];
const base = (capabilityId: `MP${string}`, title: string, endpoint: string, status: CapabilityImplementationStatus, limitations: string[] = [], fields: string[] = []): MaterialsCapability => ({
  capabilityId, title, endpoint, fields: [...fields], officialDocumentation: docs(endpoint.replaceAll("/", "-")), inputSchema: "validated TypeScript MaterialsProject input", outputSchema: "MaterialRecord with raw fields, per-field state, and Provenance", unitRules: "Preserve source units; known summary units are annotated; unknown units remain unspecified", availabilityCheck: "Missing/null response fields become explicit missing or not_requested states", dependencies: ["Materials Project API key", "HTTPS fetch"], implementationStatus: status, tests: ["materials-project.test.ts"], realValidation: status === "blocked" || status === "planned" ? "not_tested" : "mock_passed_live_untested", limitations,
});

/** Single source of truth used by the runtime and generated documentation. */
export const MATERIALS_CAPABILITIES: MaterialsCapability[] = [
  base("MP01", "Summary material search", "/materials/summary", "implemented", ["exact element-set matching is a bounded local filter"], fieldsFor("summary")),
  base("MP02", "Structure retrieval", "/materials/summary (structure field)", "implemented", ["CIF export supports the common lattice/sites JSON shape"], fieldsFor("structure")),
  base("MP03", "Thermodynamics", "/materials/thermo", "implemented", ["formation and hull energies remain source-method dependent"], fieldsFor("thermo")),
  base("MP04", "Common summary properties", "/materials/summary", "implemented", [], fieldsFor("summary")),
  base("MP05", "Band structure", "/materials/electronic_structure/bandstructure", "partial", ["generic endpoint retrieval; no local band-curve interpretation"], fieldsFor("bandstructure")),
  base("MP06", "Density of states", "/materials/electronic_structure/dos", "partial", ["generic endpoint retrieval; large objects should be field-limited"], fieldsFor("dos")),
  base("MP07", "Magnetism", "/materials/magnetism", "partial", ["generic retrieval; normalization semantics remain source-defined"], fieldsFor("magnetism")),
  base("MP08", "Elasticity", "/materials/elasticity", "partial", ["generic retrieval; tensor conventions remain source-defined"], fieldsFor("elasticity")),
  base("MP09", "Dielectric and piezoelectric", "/materials/dielectric, /materials/piezoelectric", "partial", ["generic retrieval; response component semantics remain source-defined"], fieldsFor("dielectric", "piezoelectric")),
  base("MP10", "Phonon", "/materials/phonon", "partial", ["generic retrieval; no fabricated curves for missing data"], fieldsFor("phonon")),
  base("MP11", "Optical and XAS", "/materials/absorption, /materials/xas", "partial", ["generic retrieval; results are computational spectra unless source says otherwise"], fieldsFor("absorption", "xas")),
  base("MP12", "Insertion electrodes", "/materials/insertion_electrodes", "partial", ["generic retrieval; electrode records are not treated as structures"], fieldsFor("insertion_electrodes")),
  base("MP13", "Provenance and tasks", "/materials/provenance, /materials/tasks, /doi", "implemented", ["database version is only reported when returned by the service"], fieldsFor("provenance", "tasks", "doi")),
  base("MP14", "Local structure descriptions", "/materials/bonds, /materials/chemenv, /materials/oxidation_states, /materials/robocrys", "partial", ["algorithm-derived fields are retained as source output"], fieldsFor("bonds", "chemenv", "oxidation_states", "robocrys")),
  base("MP15", "Other material routes", "/materials/eos, /materials/surface_properties, /materials/grain_boundaries, /materials/substrates, /materials/alloys, /materials/similarity, /materials/synthesis", "partial", ["Only bounded top-level projections are exposed; route-specific search filters and scientific interpretation remain unavailable", "substrates and synthesis are not addressable by materials_get material IDs"], fieldsFor("eos", "surface_properties", "grain_boundaries", "substrates", "alloys", "similarity", "synthesis")),
  base("MP16", "Safe reproducible exports", "local export", "implemented", ["CIF requires lattice and site data"], ["records", "raw", "fields", "provenance"]),
  base("MP17", "Local derived calculations", "local", "planned", ["No phase-diagram or simulated-XRD calculations are performed"]),
];

export function getMaterialsCapabilities(): MaterialsCapability[] {
  return MATERIALS_CAPABILITIES.map((item) => ({ ...item, fields: [...item.fields], officialDocumentation: [...item.officialDocumentation], tests: [...item.tests], dependencies: [...item.dependencies], limitations: [...item.limitations] }));
}

/** Render the human-readable matrix from the same facts exported at runtime. */
export function renderMaterialsCapabilitiesMarkdown(): string {
  const lines = [
    "# Materials Project capabilities",
    "",
    "Generated from `src/materials-project/capabilities.ts`; the JSON matrix beside it is the machine-readable form. Statuses describe this repository's implementation, not account entitlement.",
    "",
    "| ID | Capability | Status | REST route | Fields | Validation | Limitations |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const item of MATERIALS_CAPABILITIES) {
    const title = item.title.replaceAll("|", "\\|");
    const route = item.endpoint.replaceAll("|", "\\|");
    const fields = item.fields.join(", ").replaceAll("|", "\\|");
    const limitations = item.limitations.join("; ").replaceAll("|", "\\|");
    lines.push(`| ${item.capabilityId} | ${title} | ${item.implementationStatus} | \`${route}\` | ${fields} | ${item.realValidation.replaceAll("_", " ")} | ${limitations} |`);
  }
  lines.push(
    "",
    "## Contract notes",
    "",
    "The adapter sends `X-API-KEY` over HTTPS to the approved production host `api.materialsproject.org`. Credentials are read from an environment variable at request time and never placed in provenance, exports, logs, or query URLs. Production redirects are not followed. Response bodies are streamed and bounded by `maxResponseBytes` (1 KiB to 64 MiB). The client uses the REST contract's comma-separated `material_ids`, `elements`, `chemsys`, and `_fields`; SDK range names such as `bandGap` and `volume` are mapped to REST `band_gap_min/max` and `volume_min/max`. Pagination is bounded by `maxPages`/`maxRequests` and `maxResults`.",
    "",
    "The official docs note that `available_fields` does not mean a field is a valid search filter, and that not all data is available from summary. Callers should use `hasProps` before requesting large property objects. Missing, not requested, unsupported, and failed values are distinct states. Computational stability is not represented as experimental synthesizability.",
    "",
    "Official references: [Getting started](https://docs.materialsproject.org/downloading-data/using-the-api/getting-started), [Querying data](https://docs.materialsproject.org/downloading-data/using-the-api/querying-data), [Advanced usage](https://docs.materialsproject.org/downloading-data/using-the-api/advanced-usage), [Examples](https://docs.materialsproject.org/downloading-data/using-the-api/examples), and [Large-download guidance](https://docs.materialsproject.org/downloading-data/using-the-api/tips-for-large-downloads).",
    "",
    "No paid or private fixture was used. No real API key was available for live verification, so live status is intentionally `live_untested`.",
  );
  return lines.join("\n") + "\n";
}

export interface MaterialsSourceStatus {
  providerId: "materials-project";
  implementationStatus: "implemented";
  credentialStatus: "configured" | "missing";
  accessStatus: "unknown_until_requested";
  validationStatus: "mock_passed_live_untested";
  capabilities: MaterialsCapability[];
  limitations: string[];
}

/** Status is descriptive and performs no network request. */
export function getMaterialsSourceStatus(config: MaterialsProjectConfig = {}): MaterialsSourceStatus {
  const envName = config.credentialEnv ?? "MP_API_KEY";
  return {
    providerId: "materials-project",
    implementationStatus: "implemented",
    credentialStatus: config.apiKey || process.env[envName] ? "configured" : "missing",
    accessStatus: "unknown_until_requested",
    validationStatus: "mock_passed_live_untested",
    capabilities: getMaterialsCapabilities(),
    limitations: ["A configured key does not prove entitlement to every property or dataset", "Live API validation requires an explicit user-requested call and their own key"],
  };
}
