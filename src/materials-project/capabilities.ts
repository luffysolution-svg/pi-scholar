import { MP_API_DOCS } from "./types.js";
import type { MaterialsProjectConfig } from "./types.js";
import { PROPERTY_FIELDS, ROUTE_FILTERS } from "./client.js";
import { apiKeyConfigured } from "../credentials.js";

export type CapabilityImplementationStatus = "implemented" | "partial" | "planned" | "blocked";

export interface MaterialsCapability {
  capabilityId: `MP${string}`;
  title: string;
  endpoint: string;
  fields: string[];
  officialDocumentation: string[];
  inputSchema: { tools: string[]; selectors: string[] };
  outputSchema: { record: string; fieldStates: string[] };
  unitRules: string;
  availabilityCheck: string;
  dependencies: string[];
  implementationStatus: CapabilityImplementationStatus;
  tests: string[];
  realValidation: "mock_passed_live_untested" | "live_passed" | "rest_live_helper_unavailable" | "local_passed" | "not_tested";
  limitations: string[];
}

const docs = (path: string) => [`${MP_API_DOCS}/querying-data`, `${MP_API_DOCS}/advanced-usage`, `https://materialsproject.github.io/api/_autosummary/mp_api.client.routes.materials.html#${path}`];
const fieldsFor = (...properties: (keyof typeof PROPERTY_FIELDS)[]): string[] => [...new Set(properties.flatMap((property) => PROPERTY_FIELDS[property]))];
const selectorsFor = (...properties: (keyof typeof ROUTE_FILTERS)[]): string[] => [...new Set(properties.flatMap((property) => ROUTE_FILTERS[property]))];
const CAPABILITY_INPUTS: Record<string, { tools: string[]; selectors: string[] }> = {
  MP01: { tools: ["materials_search"], selectors: ["materialIds", "formula", "elements", "elementsMode", "chemsys", "bandGap", "energyAboveHull", "density", "volume", "numSites", "isStable", "isMetal", "hasProps", "fields", "maxResults", "maxPages"] },
  MP02: { tools: ["materials_get", "materials_advanced", "materials_export"], selectors: ["materialIds", "final", "conventionalUnitCell", "format=cif|json"] },
  MP03: { tools: ["materials_get", "materials_route_search"], selectors: ["materialIds", ...selectorsFor("thermo")] },
  MP04: { tools: ["materials_search"], selectors: ["bandGap", "energyAboveHull", "density", "volume", "isStable", "isMetal", "hasProps"] },
  MP05: { tools: ["materials_get", "materials_route_search", "materials_advanced"], selectors: ["materialIds", ...selectorsFor("bandstructure"), "pathType", "lineMode", "loadProjections"] },
  MP06: { tools: ["materials_get", "materials_route_search", "materials_advanced"], selectors: ["materialIds", ...selectorsFor("dos"), "loadProjections"] },
  MP07: { tools: ["materials_get", "materials_route_search"], selectors: ["materialIds", ...selectorsFor("magnetism")] },
  MP08: { tools: ["materials_get", "materials_route_search"], selectors: ["materialIds", ...selectorsFor("elasticity")] },
  MP09: { tools: ["materials_get", "materials_route_search"], selectors: ["materialIds", ...selectorsFor("dielectric", "piezoelectric")] },
  MP10: { tools: ["materials_route_search", "materials_advanced"], selectors: ["identifiers", ...selectorsFor("phonon"), "materialId", "phononKind"] },
  MP11: { tools: ["materials_get", "materials_route_search"], selectors: ["materialIds", "taskIds", "spectrumIds", ...selectorsFor("absorption", "xas")] },
  MP12: { tools: ["materials_route_search"], selectors: selectorsFor("insertion_electrodes") },
  MP13: { tools: ["materials_get", "materials_route_search"], selectors: ["materialIds", "taskIds", ...selectorsFor("tasks")] },
  MP14: { tools: ["materials_get", "materials_route_search"], selectors: ["materialIds", ...selectorsFor("bonds", "chemenv", "oxidation_states", "robocrys")] },
  MP15: { tools: ["materials_get", "materials_route_search"], selectors: ["materialIds", "taskIds", ...selectorsFor("eos", "surface_properties", "grain_boundaries", "substrates", "alloys", "similarity", "synthesis")] },
  MP16: { tools: ["materials_export"], selectors: ["records", "query", "format=json|csv|cif|markdown"] },
  MP17: { tools: ["materials_advanced"], selectors: ["action=phase_diagram|phase_diagram_from_chemsys|simulated_xrd", "records", "elements", "thermoType", "energyField", "tolerance", "wavelength", "twoThetaRange"] },
};
const UNIT_RULES: Record<string, string> = {
  MP01: "Keep each source field's unit; common energy, density, and volume fields are annotated.", MP02: "Lattice lengths are Å; CIF uses fractional site coordinates and explicit occupancies.",
  MP03: "Formation, hull, and per-atom energies remain eV/atom; keep thermo type and corrections.", MP04: "Band gap is eV, density is g/cm^3, and volume is Å^3.",
  MP05: "Retain eV energy reference, spin channels, path convention, and k-point labels.", MP06: "Retain eV energy axis, spin, projection, and source normalization.",
  MP07: "Keep total, per-formula-unit, and per-volume magnetization separate.", MP08: "Elastic tensors and moduli retain source GPa conventions and averaging method.",
  MP09: "Dielectric response is dimensionless where returned; piezoelectric tensors retain the source convention and C/m² when applicable.", MP10: "Retain the returned phonon frequency units, method, and imaginary-mode information.",
  MP11: "Retain energy axes, polarization or absorbing atom, edge, and spectrum type.", MP12: "Keep voltage, gravimetric/volumetric capacity, energy, working ion, and reaction range separate.",
  MP13: "Identifiers and versions are unitless provenance; calculation units remain in their task payload.", MP14: "Coordination, bond, oxidation-state, and text descriptions retain their algorithm labels.",
  MP15: "Each route retains its own units, including EOS energy/volume, surface energy, work function, angles, and interface area.", MP16: "Exports preserve every field's unit or state that the source did not specify one.",
  MP17: "Phase-diagram energies are eV/atom at 0 K and 0 atm; XRD positions are 2θ degrees, intensity is relative, and d-spacing is Å.",
};
const base = (capabilityId: `MP${string}`, title: string, endpoint: string, status: CapabilityImplementationStatus, limitations: string[] = [], fields: string[] = [], dependencies = ["Materials Project API key", "HTTPS fetch"], realValidation: MaterialsCapability["realValidation"] = "live_passed"): MaterialsCapability => ({
  capabilityId, title, endpoint, fields: [...fields], officialDocumentation: docs(endpoint.replaceAll("/", "-")), inputSchema: CAPABILITY_INPUTS[capabilityId], outputSchema: { record: capabilityId === "MP17" ? "derived result with provenance" : "MaterialRecord with raw source data and provenance", fieldStates: ["requested", "provided", "missing", "not_requested", "unsupported", "error"] }, unitRules: UNIT_RULES[capabilityId], availabilityCheck: "Missing, unrequested, unsupported, and failed values remain distinct", dependencies, implementationStatus: status, tests: ["materials-project.test.ts", "materials-derived.test.ts"], realValidation, limitations,
});

/** Single source of truth used by the runtime and generated documentation. */
export const MATERIALS_CAPABILITIES: MaterialsCapability[] = [
  base("MP01", "Summary material search", "/materials/summary", "implemented", ["exact element-set matching is a bounded local filter"], fieldsFor("summary")),
  base("MP02", "Structure retrieval", "/materials/summary (structure field)", "implemented", ["CIF export supports the common lattice/sites JSON shape"], fieldsFor("structure")),
  base("MP03", "Thermodynamics", "/materials/thermo", "implemented", ["formation and hull energies remain source-method dependent"], fieldsFor("thermo")),
  base("MP04", "Common summary properties", "/materials/summary", "implemented", [], fieldsFor("summary")),
  base("MP05", "Band structure", "/materials/electronic_structure + optional mp-api bridge", "implemented", ["REST metadata passed live validation; sampled complete objects were unavailable from the official helper"], fieldsFor("bandstructure"), ["Materials Project API key", "HTTPS fetch", "optional Python mp-api/pymatgen"], "rest_live_helper_unavailable"),
  base("MP06", "Density of states", "/materials/electronic_structure + optional mp-api bridge", "implemented", ["REST metadata passed live validation; sampled complete objects were unavailable from the official helper"], fieldsFor("dos"), ["Materials Project API key", "HTTPS fetch", "optional Python mp-api/pymatgen"], "rest_live_helper_unavailable"),
  base("MP07", "Magnetism", "/materials/magnetism", "implemented", ["normalization fields remain separate"], fieldsFor("magnetism")),
  base("MP08", "Elasticity", "/materials/elasticity", "implemented", ["tensor convention, fitting method, state, and warnings remain source data"], fieldsFor("elasticity")),
  base("MP09", "Dielectric and piezoelectric", "/materials/dielectric, /materials/piezoelectric", "implemented", ["electronic, ionic, and total response fields remain separate"], fieldsFor("dielectric", "piezoelectric")),
  base("MP10", "Phonon", "/materials/phonon + optional mp-api bridge", "implemented", ["REST identifier search passed live validation; sampled complete objects were unavailable from the official helper"], fieldsFor("phonon"), ["Materials Project API key", "HTTPS fetch", "optional Python mp-api/pymatgen"], "rest_live_helper_unavailable"),
  base("MP11", "Optical and XAS", "/materials/absorption, /materials/xas", "implemented", ["XAS uses task or spectrum identifiers; results are not labelled experimental unless the source says so"], fieldsFor("absorption", "xas")),
  base("MP12", "Insertion electrodes", "/materials/insertion_electrodes", "implemented", ["electrode documents use battery/chemistry filters and are not treated as single structures"], fieldsFor("insertion_electrodes")),
  base("MP13", "Provenance and tasks", "/materials/provenance, /materials/tasks, /doi", "implemented", ["database version is only reported when returned by the service"], fieldsFor("provenance", "tasks", "doi")),
  base("MP14", "Local structure descriptions", "/materials/bonds, /materials/chemenv, /materials/oxidation_states, /materials/robocrys", "implemented", ["algorithm-derived descriptions remain labelled as derived source output"], fieldsFor("bonds", "chemenv", "oxidation_states", "robocrys")),
  base("MP15", "Other material routes", "/materials/eos, /materials/surface_properties, /materials/grain_boundaries, /materials/substrates, /materials/alloys, /materials/similarity, /materials/synthesis", "implemented", ["each collection has its own allow-listed filters and identity semantics"], fieldsFor("eos", "surface_properties", "grain_boundaries", "substrates", "alloys", "similarity", "synthesis")),
  base("MP16", "Safe reproducible exports", "local export", "implemented", ["CIF requires a finite lattice and site data"], ["records", "raw", "fields", "provenance"], ["local filesystem"], "local_passed"),
  base("MP17", "Local derived calculations", "local + optional pymatgen", "implemented", ["phase diagrams are labelled 0 K/0 atm local derivations; simulated XRD is not experimental data"], ["phase_diagram", "simulated_xrd"], ["optional Python 3.11+, mp-api, and pymatgen"], "local_passed"),
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
    "The adapter sends `X-API-KEY` only to `https://api.materialsproject.org`. Direct `apiKey`, configured `apiKeyEnv`, and `MP_API_KEY` are resolved in that order. Keys are excluded from URLs, provenance, exports, and status output.",
    "",
    "The official docs note that `available_fields` does not mean a field is a valid search filter. `materials_route_search` therefore validates a separate allow-list for each collection. Missing, unrequested, unsupported, and failed values remain distinct. Computational stability is not experimental synthesizability.",
    "",
    "Official references: [Getting started](https://docs.materialsproject.org/downloading-data/using-the-api/getting-started), [Querying data](https://docs.materialsproject.org/downloading-data/using-the-api/querying-data), [Advanced usage](https://docs.materialsproject.org/downloading-data/using-the-api/advanced-usage), [Examples](https://docs.materialsproject.org/downloading-data/using-the-api/examples), and [Large-download guidance](https://docs.materialsproject.org/downloading-data/using-the-api/tips-for-large-downloads).",
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
  return {
    providerId: "materials-project",
    implementationStatus: "implemented",
    credentialStatus: apiKeyConfigured(config, process.env, ["MP_API_KEY"]) ? "configured" : "missing",
    accessStatus: "unknown_until_requested",
    validationStatus: "mock_passed_live_untested",
    capabilities: getMaterialsCapabilities(),
    limitations: ["A configured key does not prove entitlement to every property or dataset", "Live API validation requires an explicit user-requested call and their own key"],
  };
}
