import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateLocalPhaseDiagram,
  calculatePythonPhaseDiagram,
  fetchMaterialsPythonObject,
  MaterialsDerivedError,
  runMaterialsPythonBridge,
  simulateMaterialXrd,
} from "../src/materials-project/derived.js";
import type { MaterialRecord } from "../src/materials-project/types.js";

function record(materialId: string, formula: string, energy: number): MaterialRecord {
  return {
    materialId,
    formula: { state: "provided", value: formula },
    fields: { formation_energy_per_atom: { state: "provided", value: energy, unit: "eV/atom" } },
    raw: { material_id: materialId, formula_pretty: formula, formation_energy_per_atom: energy },
    provenance: { source: "materials-project", endpoint: "/materials/thermo", retrievedAt: "2026-09-08T00:00:00.000Z", query: {}, url: "https://api.materialsproject.org/materials/thermo/" },
    warnings: [],
  };
}

test("local binary phase diagram identifies the lower convex hull and records derivation provenance", () => {
  const result = calculateLocalPhaseDiagram([
    record("mp-a", "Li", 0), record("mp-b", "F", 0), record("mp-ab", "LiF", -1), record("mp-high", "LiF", -0.5),
  ]);
  assert.deepEqual(result.stableMaterialIds, ["mp-a", "mp-ab", "mp-b"]);
  assert.equal(result.entries.find((entry) => entry.materialId === "mp-high")?.aboveHull, 0.5);
  assert.equal(result.provenance.capabilityId, "MP17");
  assert.match(result.provenance.inputFingerprint, /^[a-f0-9]{64}$/);
});

test("pymatgen-backed derived functions use fixed bridge operations without putting keys in provenance", async () => {
  const bridge = async (operation: string, payload: unknown) => {
    assert.equal(operation, "phase_diagram");
    assert.doesNotMatch(JSON.stringify(payload), /apiKey/);
    return { backendVersion: { pymatgen: "test" }, entries: [{ materialId: "mp-a", energyUnit: "eV/atom", stable: true }], stableMaterialIds: ["mp-a"] };
  };
  const result = await calculatePythonPhaseDiagram([record("mp-a", "Li", 0), record("mp-b", "F", 0)], {}, bridge);
  assert.equal(result.provenance.backend, "pymatgen");
  assert.doesNotMatch(JSON.stringify(result.provenance), /apiKey/);
});

test("simulated XRD and full-object retrieval validate inputs before the fixed bridge", async () => {
  const value = record("mp-149", "Si", 0);
  value.raw.structure = { lattice: { matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }, sites: [{ species: [{ element: "Si", occu: 1 }], abc: [0, 0, 0] }] };
  const xrd = await simulateMaterialXrd(value, {}, async (operation) => {
    assert.equal(operation, "simulated_xrd");
    return { backendVersion: { pymatgen: "test" }, pattern: { peaks: [{ twoTheta: 28.4, intensity: 100 }] } };
  });
  assert.equal((xrd.pattern as { peaks: unknown[] }).peaks.length, 1);
  const full = await fetchMaterialsPythonObject("dos", { apiKey: "test-key", materialId: "mp-149" }, async (operation, payload) => {
    assert.equal(operation, "dos");
    assert.equal((payload as Record<string, unknown>).materialId, "mp-149");
    return { materialId: "mp-149", data: { efermi: 0 } };
  });
  assert.equal(full.materialId, "mp-149");
  await assert.rejects(() => runMaterialsPythonBridge("arbitrary", {}), (error: unknown) => error instanceof MaterialsDerivedError && error.code === "INVALID_INPUT");
});
