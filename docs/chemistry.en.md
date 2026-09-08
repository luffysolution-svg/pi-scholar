# CAS Common Chemistry Data Source

[中文版](./chemistry.md)

Pi Scholar includes built-in support for CAS Common Chemistry substance data through three dedicated tools:

- `chemical_sources`: Inspect the chemical provider configuration and status offline.
- `chemical_search`: Search substance records by chemical name, CAS Registry Number, or structure.
- `chemical_get`: Look up complete substance details by CAS Registry Number (CAS RN).

Results use an independent `ChemicalRecord` data model that stores chemical names, CAS RNs, synonyms, molecular formula and mass, SMILES, InChI/InChIKey, and source license details. Chemical data is stored separately from literature and materials records.

## Current Access Status

CAS requires developers to submit an application before receiving official API documentation and endpoint details:

- Pi Scholar includes complete data models and configuration fields for CAS Common Chemistry. Until official endpoint specifications are validated, query tools remain gated (reporting `contract_blocked` / `permission_required`) to avoid guessing private or unstable endpoints.
- You can store your API key in advance in the unified configuration via `apiKey`, `apiKeyEnv`, or the `CAS_API_KEY` environment variable.
- Once official API access is granted and verified, the tools will be connected directly.

## Data Scope

CAS Common Chemistry focuses on basic physical and chemical identifiers for common substances:

- It **does not** include SciFinder scholarly literature, chemical reactions, patent data, formulation recipes, or commercial supplier searches.

## Official Resources

- Request API Access: [CAS Common Chemistry API](https://www.cas.org/services/commonchemistry-api).
- Content License: Web substance data is provided under CC BY-NC 4.0; specific API usage terms remain governed by your CAS agreement.
