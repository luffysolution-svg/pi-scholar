#!/usr/bin/env python3
"""Fixed JSON bridge for optional mp-api and pymatgen operations."""

import argparse
import importlib.metadata
import inspect
import json
import sys


def fail(code, message):
    return {"ok": False, "error": {"code": code, "message": message}}


def versions():
    return {"mpApi": importlib.metadata.version("mp-api"), "pymatgen": importlib.metadata.version("pymatgen")}


def jsonable(value):
    from monty.json import MontyEncoder
    return json.loads(json.dumps(value, cls=MontyEncoder))


def require_text(payload, name):
    value = payload.get(name)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")
    return value.strip()


def with_mpr(payload, callback):
    from mp_api.client import MPRester
    api_key = require_text(payload, "apiKey")
    # The server may deploy schema fields before the latest client models are
    # published. Dict mode keeps the fixed helpers usable while this bridge
    # validates and serializes only their returned objects.
    with MPRester(api_key=api_key, mute_progress_bars=True, use_document_model=False) as rester:
        return callback(rester)


def get_structure(payload):
    material_id = require_text(payload, "materialId")
    value = with_mpr(payload, lambda rester: rester.get_structure_by_material_id(
        material_id,
        final=bool(payload.get("final", True)),
        conventional_unit_cell=bool(payload.get("conventionalUnitCell", False)),
    ))
    return {"backendVersion": versions(), "materialId": material_id, "data": jsonable(value)}


def get_bandstructure(payload):
    from emmet.core.band_theory import BSPathType
    material_id = require_text(payload, "materialId")
    path_type = BSPathType(payload.get("pathType", "setyawan_curtarolo"))

    def fetch(rester):
        method = rester.get_bandstructure_by_material_id
        kwargs = {"path_type": path_type, "line_mode": bool(payload.get("lineMode", True))}
        if "load_projections" in inspect.signature(method).parameters:
            kwargs["load_projections"] = bool(payload.get("loadProjections", False))
        return method(material_id, **kwargs)

    value = with_mpr(payload, fetch)
    return {"backendVersion": versions(), "materialId": material_id, "data": jsonable(value)}


def get_dos(payload):
    material_id = require_text(payload, "materialId")

    def fetch(rester):
        method = rester.get_dos_by_material_id
        kwargs = {}
        if "load_projections" in inspect.signature(method).parameters:
            kwargs["load_projections"] = bool(payload.get("loadProjections", False))
        return method(material_id, **kwargs)

    value = with_mpr(payload, fetch)
    return {"backendVersion": versions(), "materialId": material_id, "data": jsonable(value)}


def get_phonon(payload):
    material_id = require_text(payload, "materialId")
    kind = payload.get("kind", "both")
    if kind not in {"bandstructure", "dos", "both"}:
        raise ValueError("kind must be bandstructure, dos, or both")

    def fetch(rester):
        result = {}
        if kind in {"bandstructure", "both"}:
            result["bandstructure"] = jsonable(rester.get_phonon_bandstructure_by_material_id(material_id))
        if kind in {"dos", "both"}:
            result["dos"] = jsonable(rester.get_phonon_dos_by_material_id(material_id))
        return result

    return {"backendVersion": versions(), "materialId": material_id, "data": with_mpr(payload, fetch)}


def phase_diagram(payload):
    from pymatgen.analysis.phase_diagram import PDEntry, PhaseDiagram
    from pymatgen.core import Composition
    raw_entries = payload.get("entries")
    if not isinstance(raw_entries, list) or not raw_entries:
        raise ValueError("entries must be a non-empty list")
    entries = []
    ids = {}
    for item in raw_entries:
        if not isinstance(item, dict):
            raise ValueError("each phase-diagram entry must be an object")
        material_id = require_text(item, "materialId")
        composition = item.get("composition") or item.get("formula")
        energy_per_atom = item.get("energyPerAtom")
        if not isinstance(composition, (dict, str)) or not isinstance(energy_per_atom, (int, float)):
            raise ValueError("each entry requires composition/formula and energyPerAtom")
        comp = Composition(composition)
        entry = PDEntry(comp, float(energy_per_atom) * comp.num_atoms, name=material_id)
        entries.append(entry)
        ids[id(entry)] = material_id
    diagram = PhaseDiagram(entries)
    stable = {id(entry) for entry in diagram.stable_entries}
    rows = [{
        "materialId": ids[id(entry)],
        "formula": entry.composition.reduced_formula,
        "energyPerAtom": float(entry.energy_per_atom),
        "energyUnit": "eV/atom",
        "aboveHull": float(diagram.get_e_above_hull(entry)),
        "stable": id(entry) in stable,
    } for entry in entries]
    return {
        "backendVersion": versions(), "entries": rows,
        "stableMaterialIds": sorted(item["materialId"] for item in rows if item["stable"]),
        "hull": [], "warnings": ["local-derived phase diagram at 0 K and 0 atm"],
    }


def phase_diagram_from_chemsys(payload):
    from pymatgen.analysis.phase_diagram import PhaseDiagram
    elements = payload.get("elements")
    if not isinstance(elements, list) or not 1 < len(elements) <= 6 or not all(isinstance(x, str) for x in elements):
        raise ValueError("elements must contain 2 to 6 element symbols")
    thermo_type = payload.get("thermoType", "GGA_GGA+U")

    def fetch(rester):
        criteria = [thermo_type]
        compatibility = "Materials Project API corrections"
        if thermo_type == "GGA_GGA+U_R2SCAN":
            from pymatgen.entries.mixing_scheme import MaterialsProjectDFTMixingScheme
            criteria = ["GGA_GGA+U", "R2SCAN"]
            entries = MaterialsProjectDFTMixingScheme().process_entries(
                rester.get_entries_in_chemsys(elements, additional_criteria={"thermo_types": criteria})
            )
            compatibility = "MaterialsProjectDFTMixingScheme"
        else:
            entries = rester.get_entries_in_chemsys(elements, additional_criteria={"thermo_types": criteria})
        diagram = PhaseDiagram(entries)
        stable = {id(entry) for entry in diagram.stable_entries}
        return [{
            "materialId": str(entry.entry_id), "formula": entry.composition.reduced_formula,
            "energyPerAtom": float(entry.energy_per_atom), "energyUnit": "eV/atom",
            "aboveHull": float(diagram.get_e_above_hull(entry)), "stable": id(entry) in stable,
            "compatibility": compatibility,
        } for entry in entries]

    rows = with_mpr(payload, fetch)
    return {
        "backendVersion": versions(), "entries": rows,
        "stableMaterialIds": sorted(item["materialId"] for item in rows if item["stable"]),
        "hull": [], "thermoType": thermo_type,
        "compatibility": "MaterialsProjectDFTMixingScheme" if thermo_type == "GGA_GGA+U_R2SCAN" else "Materials Project API corrections",
        "warnings": ["pymatgen phase diagram derived from Materials Project entries at 0 K and 0 atm"],
    }


def xrd(payload):
    from pymatgen.analysis.diffraction.xrd import XRDCalculator
    from pymatgen.core import Structure
    structure_data = payload.get("structure")
    if not isinstance(structure_data, dict):
        raise ValueError("structure must be a pymatgen MSON dictionary")
    structure = Structure.from_dict(structure_data)
    wavelength = payload.get("wavelength", "CuKa")
    two_theta = payload.get("twoThetaRange", [0, 180])
    pattern = XRDCalculator(wavelength=wavelength).get_pattern(structure, two_theta_range=two_theta)
    peaks = [{
        "twoTheta": float(position), "intensity": float(intensity),
        "dSpacing": float(d_hkl), "hkls": jsonable(hkls),
    } for position, intensity, d_hkl, hkls in zip(pattern.x, pattern.y, pattern.d_hkls, pattern.hkls)]
    return {"backendVersion": versions(), "pattern": {"radiation": wavelength, "twoThetaRange": two_theta, "peaks": peaks}}


OPERATIONS = {
    "get_structure": get_structure,
    "bandstructure": get_bandstructure,
    "dos": get_dos,
    "phonon": get_phonon,
    "phase_diagram": phase_diagram,
    "phase_diagram_from_chemsys": phase_diagram_from_chemsys,
    "simulated_xrd": xrd,
}


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--operation", required=True, choices=sorted(OPERATIONS))
    args = parser.parse_args()
    try:
        request = json.load(sys.stdin)
        if not isinstance(request, dict) or request.get("operation") != args.operation:
            return fail("BRIDGE_SCHEMA_MISMATCH", "operation does not match the fixed command")
        payload = request.get("payload")
        if not isinstance(payload, dict):
            return fail("INVALID_INPUT", "payload must be an object")
        return {"ok": True, "result": OPERATIONS[args.operation](payload)}
    except ImportError:
        return fail("DEPENDENCY_MISSING", "install mp-api and pymatgen for this operation")
    except ValueError as error:
        return fail("INVALID_INPUT", str(error)[:500])
    except Exception as error:
        if type(error).__name__ in {"MPRestError", "ValidationError", "ConnectionError", "Timeout"}:
            return fail("SOURCE_UNAVAILABLE", f"{type(error).__name__}: the official helper returned no compatible object")
        return fail("BRIDGE_FAILED", f"{type(error).__name__}: operation failed")


if __name__ == "__main__":
    print(json.dumps(main(), separators=(",", ":"), ensure_ascii=True))
