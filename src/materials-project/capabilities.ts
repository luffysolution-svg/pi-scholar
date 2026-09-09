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

export type MaterialsCapabilitiesLocale = "en" | "zh";

const CAPABILITY_TITLES_ZH: Record<string, string> = {
  MP01: "材料概览检索",
  MP02: "晶体结构获取",
  MP03: "热力学数据",
  MP04: "常用概览性质",
  MP05: "能带结构",
  MP06: "态密度",
  MP07: "磁性",
  MP08: "弹性",
  MP09: "介电与压电性质",
  MP10: "声子",
  MP11: "光学与 XAS",
  MP12: "嵌入电极",
  MP13: "来源与计算任务",
  MP14: "局部结构描述",
  MP15: "其他材料数据集合",
  MP16: "本地导出",
  MP17: "本地派生计算",
};

const VALIDATION_LABELS: Record<MaterialsCapability["realValidation"], { en: string; zh: string }> = {
  live_passed: { en: "Live request passed", zh: "已通过在线实测" },
  rest_live_helper_unavailable: { en: "REST passed; helper object unavailable in sample", zh: "REST 已实测；样本未返回 Python 对象" },
  local_passed: { en: "Local tests passed", zh: "已通过本地测试" },
  mock_passed_live_untested: { en: "Mock tested; live request not run", zh: "已通过模拟测试；未在线实测" },
  not_tested: { en: "Not tested", zh: "未测试" },
};

/** Render a compact user guide from the capability facts exported at runtime. */
export function renderMaterialsCapabilitiesMarkdown(locale: MaterialsCapabilitiesLocale = "en"): string {
  const zh = locale === "zh";
  const lines = [
    zh ? "# Materials Project 能力说明" : "# Materials Project capabilities",
    "",
    zh ? "[English](./materials-capabilities.en.md)" : "[中文版](./materials-capabilities.md)",
    "",
    zh
      ? "本页概述 Pi Scholar 已接入的 Materials Project 功能。字段、筛选器、端点和限制的实时清单可通过 `materials_capabilities` 查看；该工具不发送网络请求。"
      : "This page summarizes the Materials Project features available in Pi Scholar. Run `materials_capabilities` for the current fields, filters, endpoints, and limits; that tool does not make a network request.",
    "",
    zh ? "下列 17 项能力均已实现。实测状态描述本项目的验证结果，不代表账号一定有权访问每种数据。" : "All 17 capabilities below are implemented. Validation describes this project's checks, not the data available to every account or material.",
    "",
    zh ? "## 能力概览" : "## Capability overview",
    "",
    zh ? "| ID | 功能 | 入口工具 | 验证状态 |" : "| ID | Capability | Tool | Validation |",
    "|---|---|---|---|",
  ];

  for (const item of MATERIALS_CAPABILITIES) {
    const title = (zh ? CAPABILITY_TITLES_ZH[item.capabilityId] ?? item.title : item.title).replaceAll("|", "\\|");
    const tools = item.inputSchema.tools.map((tool) => `\`${tool}\``).join("<br>");
    const validation = VALIDATION_LABELS[item.realValidation][locale].replaceAll("|", "\\|");
    lines.push(`| ${item.capabilityId} | ${title} | ${tools} | ${validation} |`);
  }

  lines.push(
    "",
    zh ? "## 如何选择工具" : "## Choosing a tool",
    "",
    zh ? "| 工具 | 用途 |" : "| Tool | Use |",
    "|---|---|",
    zh ? "| `materials_capabilities` | 离线查看能力、字段、筛选器和凭据状态 |" : "| `materials_capabilities` | Inspect capabilities, fields, filters, and credential status offline |",
    zh ? "| `materials_search` | 按化学式、元素、带隙、稳定性等条件筛选概览记录 |" : "| `materials_search` | Screen summary records by formula, elements, band gap, stability, and related fields |",
    zh ? "| `materials_get` | 按材料 ID 获取结构或指定性质 |" : "| `materials_get` | Fetch structures or selected properties by material ID |",
    zh ? "| `materials_route_search` | 查询使用任务 ID、光谱 ID、电极条件等专用筛选器的数据集合 |" : "| `materials_route_search` | Query collections that use task IDs, spectrum IDs, electrode conditions, or other route-specific filters |",
    zh ? "| `materials_advanced` | 获取完整能带、态密度或声子对象，并执行相图和模拟 XRD 计算 |" : "| `materials_advanced` | Fetch complete band-structure, DOS, or phonon objects and run phase-diagram or simulated-XRD calculations |",
    zh ? "| `materials_export` | 将已获取记录导出为 JSON、CSV、CIF 或 Markdown；不联网 |" : "| `materials_export` | Export retrieved records as JSON, CSV, CIF, or Markdown without a network request |",
    "",
    zh ? "## 使用限制" : "## Availability notes",
    "",
    zh ? "- MP05、MP06 和 MP10 的 REST 元数据已通过实测，但抽样时官方 Python helper 未返回完整对象。工具会保留 REST 结果并报告 helper 错误。" : "- REST metadata for MP05, MP06, and MP10 passed live checks, but the sampled official Python helper did not return complete objects. The tools retain the REST result and report the helper error.",
    zh ? "- `materials_route_search` 按数据集合验证筛选器。Materials Project 的 `available_fields` 不能直接视为可搜索字段。" : "- `materials_route_search` validates filters per collection. Materials Project `available_fields` are not automatically valid search filters.",
    zh ? "- 相图标记为 0 K、0 atm 的本地推导结果；模拟 XRD 不属于实验数据。" : "- Phase diagrams are labelled as local 0 K and 0 atm derivations. Simulated XRD is not experimental data.",
    zh ? "- CIF 导出需要有限晶格和位点数据。计算稳定性也不等同于实验可合成性。" : "- CIF export requires finite lattice and site data. Computational stability does not establish experimental synthesizability.",
    "",
    zh ? "## 凭据与数据" : "## Credentials and data",
    "",
    zh ? "Materials Project 凭据按 `apiKey`、`apiKeyEnv` 指向的变量、`MP_API_KEY` 的顺序读取。`X-API-KEY` 只发送到 `https://api.materialsproject.org`，不会写入 URL、导出文件或状态输出。" : "Materials Project credentials are resolved from `apiKey`, the variable named by `apiKeyEnv`, then `MP_API_KEY`. `X-API-KEY` is sent only to `https://api.materialsproject.org` and is omitted from URLs, exports, and status output.",
    "",
    zh ? "返回值会区分未请求、服务端缺失、不支持和请求失败。比较材料时还应保留单位、计算方法、任务 ID、数据库版本和警告。" : "Results distinguish unrequested, missing, unsupported, and failed values. Keep units, methods, task IDs, database versions, and warnings when comparing records.",
    "",
    zh ? "## 官方文档" : "## Official documentation",
    "",
    zh ? "- [开始使用](https://docs.materialsproject.org/downloading-data/using-the-api/getting-started)" : "- [Getting started](https://docs.materialsproject.org/downloading-data/using-the-api/getting-started)",
    zh ? "- [查询数据](https://docs.materialsproject.org/downloading-data/using-the-api/querying-data)" : "- [Querying data](https://docs.materialsproject.org/downloading-data/using-the-api/querying-data)",
    zh ? "- [进阶用法](https://docs.materialsproject.org/downloading-data/using-the-api/advanced-usage)" : "- [Advanced usage](https://docs.materialsproject.org/downloading-data/using-the-api/advanced-usage)",
    zh ? "- [示例](https://docs.materialsproject.org/downloading-data/using-the-api/examples)" : "- [Examples](https://docs.materialsproject.org/downloading-data/using-the-api/examples)",
    zh ? "- [大批量下载说明](https://docs.materialsproject.org/downloading-data/using-the-api/tips-for-large-downloads)" : "- [Large-download guidance](https://docs.materialsproject.org/downloading-data/using-the-api/tips-for-large-downloads)",
  );
  return `${lines.join("\n")}\n`;
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
