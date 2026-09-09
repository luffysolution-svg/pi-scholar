# Materials Project capabilities

[中文版](./materials-capabilities.md)

This page summarizes the Materials Project features available in Pi Scholar. Run `materials_capabilities` for the current fields, filters, endpoints, and limits; that tool does not make a network request.

All 17 capabilities below are implemented. Validation describes this project's checks, not the data available to every account or material.

## Capability overview

| ID | Capability | Tool | Validation |
|---|---|---|---|
| MP01 | Summary material search | `materials_search` | Live request passed |
| MP02 | Structure retrieval | `materials_get`<br>`materials_advanced`<br>`materials_export` | Live request passed |
| MP03 | Thermodynamics | `materials_get`<br>`materials_route_search` | Live request passed |
| MP04 | Common summary properties | `materials_search` | Live request passed |
| MP05 | Band structure | `materials_get`<br>`materials_route_search`<br>`materials_advanced` | REST passed; helper object unavailable in sample |
| MP06 | Density of states | `materials_get`<br>`materials_route_search`<br>`materials_advanced` | REST passed; helper object unavailable in sample |
| MP07 | Magnetism | `materials_get`<br>`materials_route_search` | Live request passed |
| MP08 | Elasticity | `materials_get`<br>`materials_route_search` | Live request passed |
| MP09 | Dielectric and piezoelectric | `materials_get`<br>`materials_route_search` | Live request passed |
| MP10 | Phonon | `materials_route_search`<br>`materials_advanced` | REST passed; helper object unavailable in sample |
| MP11 | Optical and XAS | `materials_get`<br>`materials_route_search` | Live request passed |
| MP12 | Insertion electrodes | `materials_route_search` | Live request passed |
| MP13 | Provenance and tasks | `materials_get`<br>`materials_route_search` | Live request passed |
| MP14 | Local structure descriptions | `materials_get`<br>`materials_route_search` | Live request passed |
| MP15 | Other material routes | `materials_get`<br>`materials_route_search` | Live request passed |
| MP16 | Safe reproducible exports | `materials_export` | Local tests passed |
| MP17 | Local derived calculations | `materials_advanced` | Local tests passed |

## Choosing a tool

| Tool | Use |
|---|---|
| `materials_capabilities` | Inspect capabilities, fields, filters, and credential status offline |
| `materials_search` | Screen summary records by formula, elements, band gap, stability, and related fields |
| `materials_get` | Fetch structures or selected properties by material ID |
| `materials_route_search` | Query collections that use task IDs, spectrum IDs, electrode conditions, or other route-specific filters |
| `materials_advanced` | Fetch complete band-structure, DOS, or phonon objects and run phase-diagram or simulated-XRD calculations |
| `materials_export` | Export retrieved records as JSON, CSV, CIF, or Markdown without a network request |

## Availability notes

- REST metadata for MP05, MP06, and MP10 passed live checks, but the sampled official Python helper did not return complete objects. The tools retain the REST result and report the helper error.
- `materials_route_search` validates filters per collection. Materials Project `available_fields` are not automatically valid search filters.
- Phase diagrams are labelled as local 0 K and 0 atm derivations. Simulated XRD is not experimental data.
- CIF export requires finite lattice and site data. Computational stability does not establish experimental synthesizability.

## Credentials and data

Materials Project credentials are resolved from `apiKey`, the variable named by `apiKeyEnv`, then `MP_API_KEY`. `X-API-KEY` is sent only to `https://api.materialsproject.org` and is omitted from URLs, exports, and status output.

Results distinguish unrequested, missing, unsupported, and failed values. Keep units, methods, task IDs, database versions, and warnings when comparing records.

## Official documentation

- [Getting started](https://docs.materialsproject.org/downloading-data/using-the-api/getting-started)
- [Querying data](https://docs.materialsproject.org/downloading-data/using-the-api/querying-data)
- [Advanced usage](https://docs.materialsproject.org/downloading-data/using-the-api/advanced-usage)
- [Examples](https://docs.materialsproject.org/downloading-data/using-the-api/examples)
- [Large-download guidance](https://docs.materialsproject.org/downloading-data/using-the-api/tips-for-large-downloads)
