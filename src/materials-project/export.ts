import type { MaterialRecord } from "./types.js";
import { sanitizePayload } from "./client.js";
import path from "node:path";
import { mkdir, open } from "node:fs/promises";

export interface MaterialsExportBundle {
  records: MaterialRecord[];
  query?: Record<string, unknown>;
  source?: string;
  retrievedAt?: string;
  databaseVersion?: string;
  warnings?: string[];
}

/** Write an explicitly requested artifact beneath a caller-owned Materials directory.
 * Existing files are never overwritten; output paths cannot escape the base. */
export async function writeMaterialsExport(baseDir: string, relativeName: string, contents: string): Promise<string> {
  if (!relativeName || path.isAbsolute(relativeName) || relativeName.includes("\0")) throw new Error("export filename must be a relative path");
  const root = path.resolve(baseDir);
  const target = path.resolve(root, relativeName);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) throw new Error("export filename escapes Materials directory");
  if (Buffer.byteLength(contents, "utf8") > 50 * 1024 * 1024) throw new Error("export exceeds 50 MiB");
  await mkdir(path.dirname(target), { recursive: true });
  const handle = await open(target, "wx");
  try { await handle.writeFile(contents, "utf8"); }
  finally { await handle.close(); }
  return relative;
}

function bundle(value: MaterialRecord[] | MaterialsExportBundle): MaterialsExportBundle {
  return Array.isArray(value) ? { records: value } : value;
}

/** JSON export is deterministic and recursively redacts credential-like fields. */
export function exportMaterialsJson(value: MaterialRecord[] | MaterialsExportBundle): string {
  return JSON.stringify(sanitizePayload(bundle(value)), null, 2) + "\n";
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Tabular CSV keeps nested structures as JSON so no scientific data is silently dropped. */
export function exportMaterialsCsv(value: MaterialRecord[] | MaterialsExportBundle): string {
  const records = bundle(value).records;
  const keys = [...new Set(records.flatMap((record) => Object.keys(record.raw)))].sort();
  const columns = ["material_id", "formula", "formula_state", "formula_unit", "elements", "elements_state", "provenance_endpoint", "provenance_sources", "provenance_retrieved_at", "provenance_query", "field_states", ...keys.filter((key) => key !== "material_id")];
  const lines = [columns.map(csvCell).join(",")];
  for (const record of records) {
    const safeRaw = sanitizePayload(record.raw) as Record<string, unknown>;
    const values: Record<string, unknown> = {
      material_id: record.materialId,
      formula: record.formula?.value,
      formula_state: record.formula?.state,
      formula_unit: record.formula?.unit,
      elements: record.elements?.value,
      elements_state: record.elements?.state,
      provenance_endpoint: record.provenance.endpoint,
      provenance_sources: sanitizePayload(record.provenanceSources ?? [record.provenance]),
      provenance_retrieved_at: record.provenance.retrievedAt,
      provenance_query: sanitizePayload(record.provenance.query),
      field_states: Object.fromEntries(Object.entries(record.fields).map(([name, item]) => [name, { state: item.state, unit: item.unit, reason: item.reason }])),
    };
    for (const key of keys) values[key] = safeRaw[key];
    lines.push(columns.map((key) => csvCell(values[key])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

function cifValue(value: unknown): string {
  if (value === undefined || value === null) return "?";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  const text = String(value).replace(/[\r\n]+/g, " ").replace(/'/g, "''");
  return /^[A-Za-z0-9_.+\-]+$/.test(text) ? text : `'${text}'`;
}

function firstFinite(...values: unknown[]): number | undefined {
  for (const value of values) if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

/**
 * Export a single MP structure as CIF. This deliberately accepts only the
 * common lattice/sites JSON shape; absent structure data is represented with
 * an explicit error rather than a fabricated CIF.
 */
export function exportMaterialCif(record: MaterialRecord): string {
  const raw = sanitizePayload(record.raw) as Record<string, unknown>;
  const structure = (raw.structure && typeof raw.structure === "object" ? raw.structure : raw) as Record<string, unknown>;
  const lattice = (structure.lattice && typeof structure.lattice === "object" ? structure.lattice : {}) as Record<string, unknown>;
  const matrix = Array.isArray(lattice.matrix) ? lattice.matrix as unknown[] : [];
  const a = Array.isArray(matrix[0]) ? matrix[0] as unknown[] : [];
  const b = Array.isArray(matrix[1]) ? matrix[1] as unknown[] : [];
  const c = Array.isArray(matrix[2]) ? matrix[2] as unknown[] : [];
  const sites = Array.isArray(structure.sites) ? structure.sites : [];
  if (sites.length === 0 || matrix.length !== 3 || [a, b, c].some((v) => v.length !== 3 || v.some((n) => typeof n !== "number" || !Number.isFinite(n)))) throw new Error(`Incomplete structure data for ${record.materialId}; CIF export requires a finite 3x3 lattice matrix and sites`);
  const vectors = [a, b, c] as number[][];
  const dot = (x: number[], y: number[]) => x.reduce((sum, n, index) => sum + n * y[index], 0);
  const norm = (x: number[]) => Math.sqrt(dot(x, x));
  const lengths = vectors.map(norm);
  if (lengths.some((length) => length <= 0)) throw new Error(`Invalid zero-length lattice vector for ${record.materialId}`);
  const angle = (x: number[], y: number[]) => Math.acos(Math.min(1, Math.max(-1, dot(x, y) / (norm(x) * norm(y))))) * 180 / Math.PI;
  const angles = [angle(vectors[1], vectors[2]), angle(vectors[0], vectors[2]), angle(vectors[0], vectors[1])];
  const formula = record.formula?.value ?? raw.formula_pretty ?? raw.formula ?? record.materialId;
  const lines = [
    `data_${record.materialId.replace(/[^A-Za-z0-9_]/g, "_")}`,
    `_audit_creation_method 'pi-scholar Materials Project REST export'`,
    `_audit_update_record ${cifValue(record.provenance.retrievedAt)}`,
    `_chemical_formula_sum ${cifValue(formula)}`,
    `_cell_length_a ${cifValue(firstFinite(lattice.a, lengths[0]))}`,
    `_cell_length_b ${cifValue(firstFinite(lattice.b, lengths[1]))}`,
    `_cell_length_c ${cifValue(firstFinite(lattice.c, lengths[2]))}`,
    `_cell_angle_alpha ${cifValue(firstFinite(lattice.alpha, angles[0]))}`,
    `_cell_angle_beta ${cifValue(firstFinite(lattice.beta, angles[1]))}`,
    `_cell_angle_gamma ${cifValue(firstFinite(lattice.gamma, angles[2]))}`,
  ];
  if (sites.length) {
    lines.push("loop_", "_atom_site_label", "_atom_site_type_symbol", "_atom_site_fract_x", "_atom_site_fract_y", "_atom_site_fract_z", "_atom_site_occupancy");
    sites.forEach((site, index) => {
      const row = (site && typeof site === "object" ? site : {}) as Record<string, unknown>;
      const speciesList = Array.isArray(row.species) ? row.species : [row.species];
      // MSON uses `abc` for fractional coordinates; retain frac_coords as a
      // compatibility fallback for REST representations.
      const frac = Array.isArray(row.abc) ? row.abc : row.frac_coords;
      if (!Array.isArray(frac) || frac.length !== 3 || frac.some((n) => typeof n !== "number" || !Number.isFinite(n))) throw new Error(`Invalid fractional coordinates for ${record.materialId} site ${index}`);
      if (!speciesList.length) throw new Error(`Missing species for ${record.materialId} site ${index}`);
      speciesList.forEach((species, speciesIndex) => {
        const speciesObject = species && typeof species === "object" ? species as Record<string, unknown> : {};
        const symbol = speciesObject.element ?? speciesObject.label ?? (typeof species === "string" ? species : row.label) ?? "X";
        const occupancy = speciesObject.occu ?? speciesObject.occupancy ?? 1;
        lines.push([`a${index + 1}${speciesIndex ? `_${speciesIndex + 1}` : ""}`, symbol, frac[0], frac[1], frac[2], occupancy].map(cifValue).join(" "));
      });
    });
  }
  return lines.join("\n") + "\n";
}

export function exportMaterialsMarkdown(value: MaterialRecord[] | MaterialsExportBundle): string {
  const input = bundle(value);
  const rows = input.records;
  const lines = ["# Materials Project export", "", `Source: Materials Project REST API`, `Retrieved: ${input.retrievedAt ?? rows[0]?.provenance.retrievedAt ?? "unknown"}`, ""];
  if (input.query) lines.push("## Query", "", "```json", JSON.stringify(sanitizePayload(input.query), null, 2), "```", "");
  lines.push("## Records", "", "| Material ID | Formula | Elements | Fields | Provenance |", "| --- | --- | --- | --- | --- |", ...rows.map((record) => {
    const formula = record.formula?.state === "provided" ? String(record.formula.value) : `_${record.formula?.state ?? "missing"}_`;
    const elements = record.elements?.state === "provided" ? (record.elements.value ?? []).join(", ") : `_${record.elements?.state ?? "missing"}_`;
    const fields = Object.entries(record.fields).map(([name, item]) => `${name}=${item.state === "provided" ? JSON.stringify(sanitizePayload(item.value)) : item.state}${item.unit ? ` ${item.unit}` : ""}`).join("; ");
    const provenance = (record.provenanceSources ?? [record.provenance]).map((source) => `${source.endpoint} @ ${source.retrievedAt}`).join("; ");
    return `| ${record.materialId.replace(/\|/g, "\\|")} | ${formula.replace(/\|/g, "\\|")} | ${elements.replace(/\|/g, "\\|")} | ${fields.replace(/\|/g, "\\|")} | ${provenance.replace(/\|/g, "\\|")} |`;
  }));
  if (input.warnings?.length) lines.push("", "## Warnings", "", ...input.warnings.map((warning) => `- ${warning}`));
  return lines.join("\n") + "\n";
}
