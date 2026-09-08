import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MaterialsProjectClient } from "./client.js";
import { exportMaterialCif, exportMaterialsCsv, exportMaterialsJson, exportMaterialsMarkdown } from "./export.js";
import { validateMaterialsConfig } from "./config.js";
import { getMaterialsSourceStatus } from "./capabilities.js";
import { calculateLocalPhaseDiagram, calculatePythonPhaseDiagram, calculatePythonPhaseDiagramFromChemsys, fetchMaterialsPythonObject, simulateMaterialXrd } from "./derived.js";
import type { MaterialProperty, MaterialRecord, MaterialsProjectConfig, MaterialsRouteSearchOptions, MaterialsSearchFilters } from "./types.js";
import { MP_API_DOCS } from "./types.js";

export * from "./types.js";
export * from "./client.js";
export * from "./config.js";
export * from "./export.js";
export * from "./capabilities.js";
export * from "./live.js";
export * from "./derived.js";

export type MaterialsConfigResolver = (ctx: ExtensionContext) => MaterialsProjectConfig | undefined;

const PROPERTY_VALUES = ["summary", "structure", "thermo", "bandstructure", "dos", "magnetism", "elasticity", "dielectric", "piezoelectric", "phonon", "absorption", "xas", "insertion_electrodes", "provenance", "tasks", "bonds", "chemenv", "oxidation_states", "robocrys", "eos", "surface_properties", "grain_boundaries", "substrates", "alloys", "similarity", "synthesis", "doi"] as const;
const ROUTE_PROPERTY_VALUES = PROPERTY_VALUES.filter((value) => value !== "summary" && value !== "structure");
const range = Type.Optional(Type.Object({ min: Type.Optional(Type.Number()), max: Type.Optional(Type.Number()) }));
const sharedSearch = {
  materialIds: Type.Optional(Type.Array(Type.String({ pattern: "^mp-[A-Za-z0-9][A-Za-z0-9._-]{0,63}$" }), { maxItems: 1000 })),
  formula: Type.Optional(Type.Union([Type.String({ maxLength: 120 }), Type.Array(Type.String({ maxLength: 120 }), { maxItems: 100 })])),
  elements: Type.Optional(Type.Array(Type.String({ pattern: "^[A-Z][a-z]?$" }), { maxItems: 20 })),
  elementsMode: Type.Optional(Type.Union([Type.Literal("contains"), Type.Literal("exact")])),
  chemsys: Type.Optional(Type.Union([Type.String({ maxLength: 120 }), Type.Array(Type.String({ maxLength: 120 }), { maxItems: 100 })])),
  bandGap: range,
  energyAboveHull: range,
  density: range,
  volume: range,
  numSites: range,
  isStable: Type.Optional(Type.Boolean()),
  isMetal: Type.Optional(Type.Boolean()),
  hasProps: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), { maxItems: 20 })),
  fields: Type.Optional(Type.Array(Type.String({ maxLength: 128 }), { maxItems: 100 })),
  maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  maxPages: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
};

const OUTPUT_MAX_BYTES = 50 * 1024;
const OUTPUT_MAX_LINES = 2_000;

function boundOutputText(text: string): string {
  let bounded = text;
  let truncated = false;
  const lines = bounded.split(/\r?\n/);
  if (lines.length > OUTPUT_MAX_LINES) {
    bounded = lines.slice(0, OUTPUT_MAX_LINES).join("\n");
    truncated = true;
  }
  const encoder = new TextEncoder();
  if (encoder.encode(bounded).byteLength > OUTPUT_MAX_BYTES) {
    const marker = "\n… [output truncated]";
    const bytes = encoder.encode(bounded);
    bounded = new TextDecoder().decode(bytes.slice(0, Math.max(0, OUTPUT_MAX_BYTES - encoder.encode(marker).byteLength))) + marker;
    truncated = true;
  }
  return truncated ? bounded : text;
}

function boundOutputDetails(details: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(details);
  if (boundOutputText(serialized) === serialized) return details;
  return { outputTruncated: true, details: boundOutputText(serialized) };
}

const output = (value: unknown, details: Record<string, unknown> = {}) => {
  const text = boundOutputText(typeof value === "string" ? value : JSON.stringify(value, null, 2));
  return { content: [{ type: "text" as const, text }], details: boundOutputDetails(details) };
};

function clientFor(ctx: ExtensionContext, resolver?: MaterialsConfigResolver): MaterialsProjectClient {
  return new MaterialsProjectClient(configFor(ctx, resolver));
}

function configFor(ctx: ExtensionContext, resolver?: MaterialsConfigResolver): MaterialsProjectConfig {
  const configured = resolver?.(ctx);
  const validation = configured === undefined ? validateMaterialsConfig(undefined) : validateMaterialsConfig(configured);
  if (validation.config.enabled === false) throw new Error("Materials Project provider is disabled in data.providers.materials-project");
  return validation.config;
}

export function registerMaterialsTools(pi: ExtensionAPI, resolver?: MaterialsConfigResolver): void {
  pi.registerTool({
    name: "materials_capabilities",
    label: "Materials Project Capabilities",
    description: "Show the Materials Project capability matrix and credential/access status without making a network request.",
    promptSnippet: "Inspect Materials Project capabilities and source status",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const configured = resolver?.(ctx);
      const validation = configured === undefined ? validateMaterialsConfig(undefined) : { config: configured, warnings: [] };
      return output({ ...getMaterialsSourceStatus(validation.config), configWarnings: validation.warnings }, { source: "materials-project", network: false });
    },
  });

  pi.registerTool({
    name: "materials_search",
    label: "Materials Project Search",
    description: `Search Materials Project summary records using validated filters and bounded HTTPS pagination. API docs: ${MP_API_DOCS}`,
    promptSnippet: "Search Materials Project materials with bounded filters",
    promptGuidelines: ["Use elementsMode=exact only when exact chemistry is required; it performs a bounded local check over returned records.", "Request only fields needed for screening and use hasProps before fetching large property objects."],
    parameters: Type.Object(sharedSearch),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const result = await clientFor(ctx, resolver).search(params as MaterialsSearchFilters, signal);
      return output(result, { source: "materials-project", liveValidation: "live_untested_without_explicit_key" });
    },
  });

  pi.registerTool({
    name: "materials_route_search",
    label: "Materials Project Route Search",
    description: "Query a selected Materials Project collection with that route's verified REST filters. Use this for EOS, XAS, electrodes, substrates, synthesis, and other routes that do not share summary material-id semantics.",
    promptSnippet: "Search one Materials Project property collection with route-specific filters",
    parameters: Type.Object({
      property: Type.Union(ROUTE_PROPERTY_VALUES.map((value) => Type.Literal(value)) as [ReturnType<typeof Type.Literal>, ReturnType<typeof Type.Literal>, ...ReturnType<typeof Type.Literal>[]]),
      materialIds: Type.Optional(Type.Array(Type.String(), { maxItems: 100 })),
      taskIds: Type.Optional(Type.Array(Type.String(), { maxItems: 100 })),
      identifiers: Type.Optional(Type.Array(Type.String(), { maxItems: 100 })),
      spectrumIds: Type.Optional(Type.Array(Type.String(), { maxItems: 100 })),
      filters: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Array(Type.Union([Type.String(), Type.Number()]), { maxItems: 100 })]))),
      fields: Type.Optional(Type.Array(Type.String(), { maxItems: 100 })),
      maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
      maxPages: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const result = await clientFor(ctx, resolver).searchRoute(params as MaterialsRouteSearchOptions, signal);
      return output(result, { source: "materials-project", property: params.property });
    },
  });

  pi.registerTool({
    name: "materials_get",
    label: "Materials Project Properties",
    description: "Fetch selected Materials Project properties by material ID through fixed HTTPS REST endpoints. Properties with no response value retain an explicit missing state.",
    promptSnippet: "Get selected Materials Project structure or properties by ID",
    parameters: Type.Object({
      materialIds: Type.Optional(Type.Array(Type.String({ pattern: "^mp-[A-Za-z0-9][A-Za-z0-9._-]{0,63}$" }), { minItems: 1, maxItems: 100 })),
      properties: Type.Array(Type.Union(PROPERTY_VALUES.map((value) => Type.Literal(value)) as [ReturnType<typeof Type.Literal>, ReturnType<typeof Type.Literal>, ...ReturnType<typeof Type.Literal>[]]), { minItems: 1, maxItems: 10 }),
      fields: Type.Optional(Type.Array(Type.String({ maxLength: 128 }), { maxItems: 100 })),
      taskIds: Type.Optional(Type.Array(Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }), { maxItems: 100 })),
      maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      maxPages: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const result = await clientFor(ctx, resolver).get(params as { materialIds?: string[]; taskIds?: string[]; properties: MaterialProperty[]; fields?: string[]; maxResults?: number; maxPages?: number }, signal);
      return output(result, { source: "materials-project", liveValidation: "live_untested_without_explicit_key" });
    },
  });

  pi.registerTool({
    name: "materials_advanced",
    label: "Materials Project Advanced",
    description: "Run fixed optional mp-api/pymatgen operations for complete structures, band structures, DOS, phonons, phase diagrams, or simulated powder XRD. No arbitrary Python or shell is accepted.",
    promptSnippet: "Run a fixed Materials Project Python-backed or local derived operation",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("get_structure"), Type.Literal("bandstructure"), Type.Literal("dos"), Type.Literal("phonon"), Type.Literal("phase_diagram"), Type.Literal("phase_diagram_from_chemsys"), Type.Literal("simulated_xrd")]),
      materialId: Type.Optional(Type.String()),
      records: Type.Optional(Type.Array(Type.Any(), { minItems: 1, maxItems: 2000 })),
      elements: Type.Optional(Type.Array(Type.String({ pattern: "^[A-Z][a-z]?$" }), { minItems: 2, maxItems: 6 })),
      backend: Type.Optional(Type.Union([Type.Literal("local"), Type.Literal("pymatgen")])),
      thermoType: Type.Optional(Type.Union([Type.Literal("GGA_GGA+U"), Type.Literal("R2SCAN"), Type.Literal("GGA_GGA+U_R2SCAN")])),
      energyField: Type.Optional(Type.Union([Type.Literal("formation_energy_per_atom"), Type.Literal("energy_per_atom"), Type.Literal("uncorrected_energy_per_atom")])),
      tolerance: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      wavelength: Type.Optional(Type.Union([Type.String(), Type.Number({ exclusiveMinimum: 0 })])),
      twoThetaRange: Type.Optional(Type.Tuple([Type.Number({ minimum: 0 }), Type.Number({ maximum: 360 })])),
      pathType: Type.Optional(Type.String()),
      lineMode: Type.Optional(Type.Boolean()),
      loadProjections: Type.Optional(Type.Boolean()),
      phononKind: Type.Optional(Type.Union([Type.Literal("bandstructure"), Type.Literal("dos"), Type.Literal("both")])),
      final: Type.Optional(Type.Boolean()),
      conventionalUnitCell: Type.Optional(Type.Boolean()),
      timeoutMs: Type.Optional(Type.Integer({ minimum: 50, maximum: 120000 })),
      maxOutputBytes: Type.Optional(Type.Integer({ minimum: 1024, maximum: 67108864 })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const records = params.records as MaterialRecord[] | undefined;
      const bridgeOptions = { timeoutMs: params.timeoutMs, maxOutputBytes: params.maxOutputBytes, signal };
      if (params.action === "phase_diagram") {
        if (!records) throw new Error("phase_diagram requires records");
        const options = { energyField: params.energyField, tolerance: params.tolerance, ...bridgeOptions };
        return output(params.backend === "pymatgen" ? await calculatePythonPhaseDiagram(records, options) : calculateLocalPhaseDiagram(records, options), { source: "materials-project", network: false, derived: true });
      }
      if (params.action === "simulated_xrd") {
        if (!records || records.length !== 1) throw new Error("simulated_xrd requires exactly one record with a structure");
        return output(await simulateMaterialXrd(records[0], { wavelength: params.wavelength, twoThetaRange: params.twoThetaRange, ...bridgeOptions }), { source: "materials-project", network: false, derived: true });
      }
      const config = configFor(ctx, resolver);
      if (!config.apiKey) throw new Error("Materials Project apiKey is required for this advanced operation");
      if (params.action === "phase_diagram_from_chemsys") {
        if (!params.elements) throw new Error("phase_diagram_from_chemsys requires elements");
        return output(await calculatePythonPhaseDiagramFromChemsys({ apiKey: config.apiKey, elements: params.elements, thermoType: params.thermoType, ...bridgeOptions }), { source: "materials-project", network: true, derived: true });
      }
      if (!params.materialId) throw new Error(`${params.action} requires materialId`);
      return output(await fetchMaterialsPythonObject(params.action, { apiKey: config.apiKey, materialId: params.materialId, pathType: params.pathType, lineMode: params.lineMode, loadProjections: params.loadProjections, phononKind: params.phononKind, final: params.final, conventionalUnitCell: params.conventionalUnitCell, ...bridgeOptions }), { source: "materials-project", operation: params.action, network: true });
    },
  });

  pi.registerTool({
    name: "materials_export",
    label: "Materials Project Export",
    description: "Export already retrieved Materials Project records as JSON, CSV, CIF, or Markdown with provenance, units, and missing-state information. This tool performs no network request.",
    promptSnippet: "Export already retrieved Materials Project results safely",
    parameters: Type.Object({
      records: Type.Array(Type.Any(), { minItems: 1, maxItems: 100 }),
      query: Type.Optional(Type.Any()),
      format: Type.Union([Type.Literal("json"), Type.Literal("csv"), Type.Literal("cif"), Type.Literal("markdown")]),
    }),
    async execute(_id, params) {
      const records = params.records as import("./types.js").MaterialRecord[];
      if (params.format === "cif") {
        if (records.length !== 1) throw new Error("CIF export requires exactly one material record");
        return output(exportMaterialCif(records[0]), { format: "cif", materialId: records[0].materialId ?? records[0].recordId, network: false });
      }
      const bundle = { records, query: params.query as Record<string, unknown> | undefined, source: "materials-project" };
      const text = params.format === "json" ? exportMaterialsJson(bundle) : params.format === "csv" ? exportMaterialsCsv(bundle) : exportMaterialsMarkdown(bundle);
      return output(text, { format: params.format, records: records.length, network: false });
    },
  });
}

export default registerMaterialsTools;
