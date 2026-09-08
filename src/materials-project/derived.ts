import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";
import type { MaterialRecord } from "./types.js";

/** Errors raised by local MP17 calculations.  `code` is intentionally stable so
 * callers can offer an actionable fallback (install Python/pymatgen or export
 * the input for another tool). */
export type MaterialsDerivedErrorCode =
  | "INVALID_INPUT"
  | "DEPENDENCY_MISSING"
  | "BRIDGE_FAILED"
  | "BRIDGE_TIMEOUT"
  | "BRIDGE_INPUT_TOO_LARGE"
  | "BRIDGE_OUTPUT_TOO_LARGE"
  | "BRIDGE_SCHEMA_MISMATCH"
  | "SOURCE_UNAVAILABLE";

export class MaterialsDerivedError extends Error {
  constructor(public readonly code: MaterialsDerivedErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "MaterialsDerivedError";
  }
}

export interface DerivedProvenance {
  source: "materials-project";
  capabilityId: "MP17";
  operation: "phase_diagram" | "simulated_xrd";
  backend: "local" | "pymatgen";
  backendVersion: string;
  inputFingerprint: string;
  input: Record<string, unknown>;
  parameters: Record<string, unknown>;
  warnings: string[];
}

export interface PhaseDiagramEntry {
  materialId: string;
  formula?: string;
  composition?: Record<string, number>;
  energyPerAtom?: number;
  energyUnit: "eV/atom";
  hullEnergyPerAtom?: number;
  aboveHull?: number;
  stable?: boolean;
  reason?: string;
}

export interface PhaseDiagramResult {
  operation: "phase_diagram";
  entries: PhaseDiagramEntry[];
  stableMaterialIds: string[];
  hull: Array<{ materialId: string; composition: number; energyPerAtom: number }>;
  provenance: DerivedProvenance;
  warnings: string[];
}

export interface PhaseDiagramOptions {
  /** A deterministic label retained in provenance; no network request is made. */
  energyField?: "formation_energy_per_atom" | "energy_per_atom" | "uncorrected_energy_per_atom";
  tolerance?: number;
}

export interface SimulatedXrdOptions {
  wavelength?: string | number;
  twoThetaRange?: [number, number];
  backend?: "pymatgen";
  pythonExecutable?: string;
  timeoutMs?: number;
  maxInputBytes?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
}

export interface SimulatedXrdResult {
  operation: "simulated_xrd";
  materialId: string;
  pattern: unknown;
  provenance: DerivedProvenance;
  warnings: string[];
}

export interface PythonBridgeOptions {
  executable?: string;
  timeoutMs?: number;
  maxInputBytes?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
}

export type PythonBridgeInvoker = (operation: string, payload: unknown, options?: PythonBridgeOptions) => Promise<unknown>;

const DEFAULT_INPUT_BYTES = 8 * 1024 * 1024;
const DEFAULT_OUTPUT_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const EPSILON = 1e-10;
const PYTHON_OPERATIONS = new Set(["get_structure", "bandstructure", "dos", "phonon", "phase_diagram", "phase_diagram_from_chemsys", "simulated_xrd"]);

function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function rawOf(record: MaterialRecord): Record<string, unknown> {
  return record.raw && typeof record.raw === "object" ? record.raw : {};
}

function materialIdOf(record: MaterialRecord): string {
  const id = record.materialId ?? record.recordId;
  if (!id) throw new MaterialsDerivedError("INVALID_INPUT", "MP17 requires records with a material_id");
  return id;
}

function numeric(record: MaterialRecord, names: string[]): number | undefined {
  const raw = rawOf(record);
  for (const name of names) {
    const field = record.fields[name]?.value;
    const value = field ?? raw[name];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function formula(record: MaterialRecord): string | undefined {
  const raw = rawOf(record);
  const value = record.formula?.value ?? raw.formula_pretty ?? raw.formula;
  return typeof value === "string" ? value : undefined;
}

/** Parse the common reduced-formula syntax. Parenthesized formulas and site
 * occupancies are deliberately rejected rather than silently misinterpreted. */
function compositionFromFormula(value: string): Record<string, number> | undefined {
  if (!value || /[()[\]{}]/.test(value)) return undefined;
  const result: Record<string, number> = {};
  let offset = 0;
  const token = /([A-Z][a-z]?)(\d*(?:\.\d+)?)?/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(value))) {
    if (match.index !== offset) return undefined;
    const amount = match[2] ? Number(match[2]) : 1;
    if (!Number.isFinite(amount) || amount <= 0) return undefined;
    result[match[1]] = (result[match[1]] ?? 0) + amount;
    offset = token.lastIndex;
  }
  if (offset !== value.length || Object.keys(result).length === 0) return undefined;
  return result;
}

function composition(record: MaterialRecord): Record<string, number> | undefined {
  const raw = rawOf(record);
  const candidate = raw.composition ?? raw.composition_reduced ?? raw.composition_unit_cell;
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
    const values = Object.fromEntries(Object.entries(candidate as Record<string, unknown>).filter(([, value]) => typeof value === "number" && Number.isFinite(value) && value > 0)) as Record<string, number>;
    if (Object.keys(values).length === Object.keys(candidate as object).length && Object.keys(values).length) return values;
  }
  const parsed = formula(record);
  return parsed ? compositionFromFormula(parsed) : undefined;
}

function normalizedComposition(value: Record<string, number>): Record<string, number> {
  const total = Object.values(value).reduce((sum, amount) => sum + amount, 0);
  return Object.fromEntries(Object.keys(value).sort().map((element) => [element, value[element] / total]));
}

function validateOptions(options: PhaseDiagramOptions): Required<Pick<PhaseDiagramOptions, "energyField" | "tolerance">> {
  const energyField = options.energyField ?? "formation_energy_per_atom";
  const tolerance = options.tolerance ?? 1e-8;
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1) throw new MaterialsDerivedError("INVALID_INPUT", "tolerance must be a finite number from 0 to 1");
  return { energyField, tolerance };
}

/**
 * A bounded, deterministic binary convex-hull calculation for already fetched
 * records. Multicomponent systems are returned with an explicit warning and no
 * invented hull values; use the pymatgen bridge for those systems.
 */
export function calculateLocalPhaseDiagram(records: MaterialRecord[], options: PhaseDiagramOptions = {}): PhaseDiagramResult {
  if (!Array.isArray(records) || records.length === 0 || records.length > 2_000) throw new MaterialsDerivedError("INVALID_INPUT", "phase diagram requires 1 to 2000 material records");
  const selected = validateOptions(options);
  const warnings: string[] = [];
  const entries: PhaseDiagramEntry[] = records.map((record) => {
    const rawComposition = composition(record);
    const normalized = rawComposition ? normalizedComposition(rawComposition) : undefined;
    const energy = numeric(record, [selected.energyField, "formation_energy_per_atom", "energy_per_atom", "uncorrected_energy_per_atom"]);
    return {
      materialId: materialIdOf(record),
      ...(formula(record) ? { formula: formula(record) } : {}),
      ...(normalized ? { composition: normalized } : {}),
      ...(energy === undefined ? {} : { energyPerAtom: energy }),
      energyUnit: "eV/atom" as const,
    };
  }).sort((left, right) => left.materialId.localeCompare(right.materialId));
  const elements = [...new Set(entries.flatMap((entry) => Object.keys(entry.composition ?? {})))].sort();
  if (elements.length !== 2) {
    warnings.push(elements.length > 2 ? "Local phase diagram supports binary compositions only; use the pymatgen bridge for multicomponent entries" : "Unable to determine a binary composition from the supplied formulas");
    for (const entry of entries) {
      if (entry.energyPerAtom === undefined) entry.reason = "missing formation energy per atom";
    }
  } else {
    const points = entries.filter((entry): entry is PhaseDiagramEntry & { composition: Record<string, number>; energyPerAtom: number } => Boolean(entry.composition && entry.energyPerAtom !== undefined)).map((entry) => ({ entry, x: entry.composition[elements[1]] ?? 0, energy: entry.energyPerAtom }));
    if (points.length < entries.length) warnings.push("Entries without both composition and formation energy were excluded from the local hull");
    const byComposition = new Map<number, typeof points[number]>();
    for (const point of points) {
      const current = byComposition.get(point.x);
      if (!current || point.energy < current.energy - EPSILON || (Math.abs(point.energy - current.energy) <= EPSILON && point.entry.materialId < current.entry.materialId)) byComposition.set(point.x, point);
    }
    const ordered = [...byComposition.values()].sort((a, b) => a.x - b.x || a.energy - b.energy || a.entry.materialId.localeCompare(b.entry.materialId));
    const hull: typeof ordered = [];
    for (const point of ordered) {
      while (hull.length >= 2) {
        const previous = hull[hull.length - 2];
        const last = hull[hull.length - 1];
        const cross = (last.x - previous.x) * (point.energy - last.energy) - (last.energy - previous.energy) * (point.x - last.x);
        if (cross <= EPSILON) hull.pop(); else break;
      }
      hull.push(point);
    }
    const hullById = new Set(hull.map((point) => point.entry.materialId));
    for (const entry of entries) {
      const point = points.find((item) => item.entry.materialId === entry.materialId);
      if (!point) { entry.reason = "missing composition or formation energy"; continue; }
      let left = hull[0];
      let right = hull[hull.length - 1];
      for (let index = 1; index < hull.length; index++) {
        if (hull[index].x >= point.x) { right = hull[index]; left = hull[index - 1]; break; }
      }
      const hullEnergy = Math.abs(right.x - left.x) <= EPSILON ? left.energy : left.energy + ((point.x - left.x) / (right.x - left.x)) * (right.energy - left.energy);
      entry.hullEnergyPerAtom = hullEnergy;
      entry.aboveHull = Math.max(0, point.energy - hullEnergy);
      entry.stable = hullById.has(entry.materialId) || entry.aboveHull <= selected.tolerance;
    }
  }
  const input = { materialIds: entries.map((entry) => entry.materialId), recordCount: records.length };
  const provenance: DerivedProvenance = { source: "materials-project", capabilityId: "MP17", operation: "phase_diagram", backend: "local", backendVersion: "pi-scholar-local-phase-diagram/1", inputFingerprint: fingerprint(records), input, parameters: { energyField: selected.energyField, tolerance: selected.tolerance }, warnings: [...warnings] };
  const hull = elements.length === 2 ? entries.filter((entry) => entry.stable && entry.composition && entry.energyPerAtom !== undefined).map((entry) => {
    const entryComposition = entry.composition as Record<string, number>;
    return { materialId: entry.materialId, composition: entryComposition[elements[1]] ?? 0, energyPerAtom: entry.energyPerAtom as number };
  }).sort((a, b) => a.composition - b.composition || a.materialId.localeCompare(b.materialId)) : [];
  return { operation: "phase_diagram", entries, stableMaterialIds: entries.filter((entry) => entry.stable).map((entry) => entry.materialId), hull, provenance, warnings };
}

function bridgeScriptPath(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "python-bridge.py");
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) throw new MaterialsDerivedError("INVALID_INPUT", `${name} must be an integer from ${min} to ${max}`);
  return resolved;
}

/** Invoke the optional Python bridge with JSON on stdin/stdout only. */
export const runMaterialsPythonBridge: PythonBridgeInvoker = async (operation, payload, options = {}) => {
  if (!PYTHON_OPERATIONS.has(operation)) throw new MaterialsDerivedError("INVALID_INPUT", `unsupported bridge operation: ${operation}`);
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 50, 120_000, "timeoutMs");
  const maxInputBytes = boundedInteger(options.maxInputBytes, DEFAULT_INPUT_BYTES, 1_024, 64 * 1024 * 1024, "maxInputBytes");
  const maxOutputBytes = boundedInteger(options.maxOutputBytes, DEFAULT_OUTPUT_BYTES, 1_024, 64 * 1024 * 1024, "maxOutputBytes");
  const body = stableJson({ operation, payload }) + "\n";
  if (Buffer.byteLength(body, "utf8") > maxInputBytes) throw new MaterialsDerivedError("BRIDGE_INPUT_TOO_LARGE", `bridge input exceeds ${maxInputBytes} bytes`);
  const executable = options.executable ?? process.env.PI_SCHOLAR_PYTHON ?? "python";
  const script = bridgeScriptPath();
  if (!existsSync(script)) throw new MaterialsDerivedError("DEPENDENCY_MISSING", "the packaged Materials Project Python bridge is missing");
  return await new Promise<unknown>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let outputBytes = 0;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const childEnv = Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value !== undefined && !/(?:API_?KEY|TOKEN|SECRET|PASSWORD|COOKIE|AUTHORIZATION)/i.test(name))) as NodeJS.ProcessEnv;
    const child = spawn(executable, [script, "--operation", operation], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: childEnv });
    const finish = (error?: MaterialsDerivedError, value?: unknown) => { if (settled) return; settled = true; clearTimeout(timer); signalCleanup(); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { timedOut = true; child.kill(); finish(new MaterialsDerivedError("BRIDGE_TIMEOUT", `Python bridge timed out after ${timeoutMs} ms`)); }, timeoutMs);
    const signal = options;
    const signalCleanup = () => signal.signal?.removeEventListener("abort", onAbort);
    const onAbort = () => { child.kill(); finish(new MaterialsDerivedError("BRIDGE_TIMEOUT", "Python bridge was aborted")); };
    signal.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => { outputBytes += chunk.byteLength; if (outputBytes > maxOutputBytes) { child.kill(); finish(new MaterialsDerivedError("BRIDGE_OUTPUT_TOO_LARGE", `bridge output exceeds ${maxOutputBytes} bytes`)); } else stdout.push(chunk); });
    child.stderr.on("data", (chunk: Buffer) => { if (Buffer.concat(stderr).byteLength < 16_384) stderr.push(chunk.subarray(0, 16_384)); });
    child.on("error", (error: NodeJS.ErrnoException) => { finish(new MaterialsDerivedError(error.code === "ENOENT" ? "DEPENDENCY_MISSING" : "BRIDGE_FAILED", error.code === "ENOENT" ? `Python executable or bridge script not found (${executable}); install Python 3 and pymatgen, or set PI_SCHOLAR_PYTHON` : "Python bridge process could not start")); });
    child.on("close", (code) => {
      if (settled) return;
      if (timedOut) return;
      if (code !== 0) { finish(new MaterialsDerivedError("BRIDGE_FAILED", `Python bridge exited with status ${code ?? "unknown"}`)); return; }
      let parsed: unknown;
      try { parsed = JSON.parse(Buffer.concat(stdout).toString("utf8")); } catch { finish(new MaterialsDerivedError("BRIDGE_SCHEMA_MISMATCH", "Python bridge did not return valid JSON")); return; }
      if (!parsed || typeof parsed !== "object") { finish(new MaterialsDerivedError("BRIDGE_SCHEMA_MISMATCH", "Python bridge returned a non-object result")); return; }
      const result = parsed as Record<string, unknown>;
      if (result.ok === false) {
        const error = result.error && typeof result.error === "object" ? result.error as Record<string, unknown> : {};
        const code = error.code === "DEPENDENCY_MISSING" ? "DEPENDENCY_MISSING" : error.code === "INVALID_INPUT" ? "INVALID_INPUT" : error.code === "SOURCE_UNAVAILABLE" ? "SOURCE_UNAVAILABLE" : "BRIDGE_FAILED";
        finish(new MaterialsDerivedError(code, typeof error.message === "string" ? error.message : "Python bridge reported an error"));
        return;
      }
      finish(undefined, result.result ?? parsed);
    });
    child.stdin.end(body, "utf8");
  });
};

function structureOf(record: MaterialRecord): Record<string, unknown> | undefined {
  const raw = rawOf(record);
  const candidate = record.fields.structure?.value ?? raw.structure;
  return candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate as Record<string, unknown> : undefined;
}

function backendVersion(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string").map(([name, version]) => `${name}/${version}`);
    if (parts.length) return parts.join(", ");
  }
  return "version unavailable";
}

/** Simulate powder XRD through pymatgen; the bridge is injectable for tests. */
export async function simulateMaterialXrd(record: MaterialRecord, options: SimulatedXrdOptions = {}, bridge: PythonBridgeInvoker = runMaterialsPythonBridge): Promise<SimulatedXrdResult> {
  if (!record || typeof (record.materialId ?? record.recordId) !== "string") throw new MaterialsDerivedError("INVALID_INPUT", "XRD requires one valid MaterialRecord");
  const materialId = materialIdOf(record);
  const structure = structureOf(record);
  if (!structure) throw new MaterialsDerivedError("INVALID_INPUT", `No structure is available for ${materialId}; request the structure field first`);
  const wavelength = options.wavelength ?? "CuKa";
  const range = options.twoThetaRange ?? [0, 180];
  if (typeof wavelength !== "string" && (typeof wavelength !== "number" || !Number.isFinite(wavelength) || wavelength <= 0)) throw new MaterialsDerivedError("INVALID_INPUT", "wavelength must be a positive number or pymatgen wavelength name");
  if (!Array.isArray(range) || range.length !== 2 || range.some((value) => typeof value !== "number" || !Number.isFinite(value)) || range[0] < 0 || range[1] <= range[0] || range[1] > 360) throw new MaterialsDerivedError("INVALID_INPUT", "twoThetaRange must be an increasing range within 0 to 360 degrees");
  if (options.backend && options.backend !== "pymatgen") throw new MaterialsDerivedError("INVALID_INPUT", `unsupported XRD backend: ${options.backend}`);
  const payload = { materialId, structure, wavelength, twoThetaRange: range };
  const result = await bridge("simulated_xrd", payload, { executable: options.pythonExecutable, timeoutMs: options.timeoutMs, maxInputBytes: options.maxInputBytes, maxOutputBytes: options.maxOutputBytes, signal: options.signal });
  const object = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const warnings = Array.isArray(object.warnings) ? object.warnings.filter((value): value is string => typeof value === "string") : [];
  const backendVersionValue = backendVersion(object.backendVersion);
  const provenance: DerivedProvenance = { source: "materials-project", capabilityId: "MP17", operation: "simulated_xrd", backend: "pymatgen", backendVersion: backendVersionValue, inputFingerprint: fingerprint(payload), input: { materialId, structureFingerprint: fingerprint(structure) }, parameters: { wavelength, twoThetaRange: range }, warnings: [...warnings] };
  return { operation: "simulated_xrd", materialId, pattern: object.pattern ?? result, provenance, warnings };
}

export const simulateXrd = simulateMaterialXrd;
export const calculatePhaseDiagram = calculateLocalPhaseDiagram;

/** Run a Python-backed phase diagram when pymatgen's compatibility corrections
 * and multicomponent hull support are needed. The bridge receives only the
 * already fetched entries; it never fetches MP data or receives credentials. */
export async function calculatePythonPhaseDiagram(records: MaterialRecord[], options: PhaseDiagramOptions & PythonBridgeOptions = {}, bridge: PythonBridgeInvoker = runMaterialsPythonBridge): Promise<PhaseDiagramResult> {
  if (!Array.isArray(records) || records.length === 0 || records.length > 2_000) throw new MaterialsDerivedError("INVALID_INPUT", "phase diagram requires 1 to 2000 material records");
  const selected = validateOptions(options);
  const entries = records.map((record) => {
    const id = materialIdOf(record);
    const rawComposition = composition(record);
    const energy = numeric(record, [selected.energyField, "formation_energy_per_atom", "energy_per_atom", "uncorrected_energy_per_atom"]);
    return { materialId: id, formula: formula(record), composition: rawComposition, energyPerAtom: energy };
  });
  const missing = entries.filter((entry) => !entry.composition || entry.energyPerAtom === undefined);
  if (missing.length) throw new MaterialsDerivedError("INVALID_INPUT", `${missing.length} records lack a parseable composition or formation energy per atom`);
  const payload = { entries, energyUnit: "eV/atom", thermoType: "formation_energy_per_atom", compatibility: "caller-provided entries; no corrections applied" };
  const response = await bridge("phase_diagram", payload, options);
  const object = response && typeof response === "object" ? response as Record<string, unknown> : {};
  const warnings = ["local-derived calculation at 0 K and 0 atm; result is not an API field", "pymatgen compatibility corrections were not applied", ...(Array.isArray(object.warnings) ? object.warnings.filter((value): value is string => typeof value === "string") : [])];
  const returnedEntries = Array.isArray(object.entries) ? object.entries : [];
  const stableMaterialIds = Array.isArray(object.stableMaterialIds) ? object.stableMaterialIds.filter((value): value is string => typeof value === "string") : returnedEntries.filter((value) => value && typeof value === "object" && (value as Record<string, unknown>).stable === true).map((value) => (value as Record<string, unknown>).materialId).filter((value): value is string => typeof value === "string");
  const provenance: DerivedProvenance = { source: "materials-project", capabilityId: "MP17", operation: "phase_diagram", backend: "pymatgen", backendVersion: backendVersion(object.backendVersion), inputFingerprint: fingerprint(payload), input: { materialIds: entries.map((entry) => entry.materialId), recordCount: entries.length }, parameters: { energyField: selected.energyField, tolerance: selected.tolerance, thermoType: "formation_energy_per_atom", compatibility: "not_applied", temperatureK: 0, pressureAtm: 0 }, warnings };
  return { operation: "phase_diagram", entries: returnedEntries as PhaseDiagramEntry[], stableMaterialIds: stableMaterialIds.sort(), hull: Array.isArray(object.hull) ? object.hull as PhaseDiagramResult["hull"] : [], provenance, warnings };
}

export interface MaterialsPythonObjectOptions extends PythonBridgeOptions {
  apiKey: string;
  materialId: string;
  pathType?: string;
  lineMode?: boolean;
  loadProjections?: boolean;
  phononKind?: "bandstructure" | "dos" | "both";
  final?: boolean;
  conventionalUnitCell?: boolean;
}

export async function fetchMaterialsPythonObject(
  operation: "get_structure" | "bandstructure" | "dos" | "phonon",
  options: MaterialsPythonObjectOptions,
  bridge: PythonBridgeInvoker = runMaterialsPythonBridge,
): Promise<Record<string, unknown>> {
  if (!options.apiKey.trim() || !/^mp-[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(options.materialId)) throw new MaterialsDerivedError("INVALID_INPUT", "a Materials Project apiKey and valid materialId are required");
  const result = await bridge(operation, {
    apiKey: options.apiKey,
    materialId: options.materialId,
    ...(operation === "get_structure" ? { final: options.final ?? true, conventionalUnitCell: options.conventionalUnitCell ?? false } : {}),
    ...(operation === "bandstructure" ? { pathType: options.pathType ?? "setyawan_curtarolo", lineMode: options.lineMode ?? true, loadProjections: options.loadProjections ?? false } : {}),
    ...(operation === "dos" ? { loadProjections: options.loadProjections ?? false } : {}),
    ...(operation === "phonon" ? { kind: options.phononKind ?? "both" } : {}),
  }, options);
  if (!result || typeof result !== "object") throw new MaterialsDerivedError("BRIDGE_SCHEMA_MISMATCH", "Python bridge returned a non-object result");
  return result as Record<string, unknown>;
}

export interface PhaseDiagramChemsysOptions extends PythonBridgeOptions {
  apiKey: string;
  elements: string[];
  thermoType?: "GGA_GGA+U" | "R2SCAN" | "GGA_GGA+U_R2SCAN";
}

export async function calculatePythonPhaseDiagramFromChemsys(options: PhaseDiagramChemsysOptions, bridge: PythonBridgeInvoker = runMaterialsPythonBridge): Promise<PhaseDiagramResult> {
  if (!options.apiKey.trim() || !Array.isArray(options.elements) || options.elements.length < 2 || options.elements.length > 6 || options.elements.some((element) => !/^[A-Z][a-z]?$/.test(element))) throw new MaterialsDerivedError("INVALID_INPUT", "apiKey and 2 to 6 valid element symbols are required");
  const thermoType = options.thermoType ?? "GGA_GGA+U";
  const response = await bridge("phase_diagram_from_chemsys", { apiKey: options.apiKey, elements: options.elements, thermoType }, options);
  const object = response && typeof response === "object" ? response as Record<string, unknown> : {};
  const entries = Array.isArray(object.entries) ? object.entries as PhaseDiagramEntry[] : [];
  const warnings = Array.isArray(object.warnings) ? object.warnings.filter((value): value is string => typeof value === "string") : [];
  const provenance: DerivedProvenance = {
    source: "materials-project", capabilityId: "MP17", operation: "phase_diagram", backend: "pymatgen",
    backendVersion: backendVersion(object.backendVersion), inputFingerprint: fingerprint({ elements: options.elements, thermoType }),
    input: { elements: [...options.elements] }, parameters: { thermoType, compatibility: thermoType === "GGA_GGA+U_R2SCAN" ? "MaterialsProjectDFTMixingScheme" : "Materials Project API corrections", temperatureK: 0, pressureAtm: 0 }, warnings,
  };
  return {
    operation: "phase_diagram", entries,
    stableMaterialIds: Array.isArray(object.stableMaterialIds) ? object.stableMaterialIds.filter((value): value is string => typeof value === "string").sort() : entries.filter((entry) => entry.stable).map((entry) => entry.materialId).sort(),
    hull: Array.isArray(object.hull) ? object.hull as PhaseDiagramResult["hull"] : [], provenance, warnings,
  };
}
