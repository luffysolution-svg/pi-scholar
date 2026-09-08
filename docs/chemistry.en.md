# CAS Common Chemistry integration boundary

[中文版](./chemistry.md)

CAS Common Chemistry is a separate chemical-substance source exposed through `chemical_sources`, `chemical_search`, and `chemical_get`. Its `ChemicalRecord` contains names, CAS RN, synonyms, molecular formula/mass, SMILES, InChI/InChIKey, source, and license only. It is never converted into a literature record or a Materials Project material record.

CAS's public page states that API access material is supplied after an access request. This repository does not possess the account-specific endpoint, authentication flow, or response schema, so the provider currently reports `contract_blocked` / `permission_required`: `chemical_sources` is an offline status call, while query tools fail before networking. This preserves the correct model and unified configuration boundary without inventing a private contract.

Store the key at `data.providers.cas-common-chemistry.apiKey`, or use `apiKeyEnv` or `CAS_API_KEY`. A configured credential does not remove the contract block.

After CAS supplies API documentation, implementation must first verify the fixed official HTTPS host, authentication header, search/detail schemas, rate limits, license, and commercial-use boundary. Only then may a capability become `implemented`, with mocked contract tests; live account checks still require explicit user opt-in. Common Chemistry must never be represented as SciFinder literature, reaction, patent, formulation, or commercial-source search.

Official entry point: [Request API Access for CAS Common Chemistry](https://www.cas.org/services/commonchemistry-api). The Common Chemistry site labels its public substance content CC BY-NC 4.0; provider terms and the user's account agreement remain authoritative.
