# CAS Common Chemistry data source

[中文版](./chemistry.md)

Pi Scholar registers three CAS Common Chemistry tools:

- `chemical_sources`: show configuration and current availability without a network request.
- `chemical_search`: search by name, CAS Registry Number, or structure.
- `chemical_get`: fetch a substance by CAS Registry Number.

Results use the `ChemicalRecord` schema, with names, CAS RN, synonyms, formula, molecular mass, SMILES, InChI, InChIKey, source, and license fields.

## Current status

CAS provides API details after an access application. This release does not implement the query endpoint. `chemical_search` and `chemical_get` return `contract_blocked` or `permission_required` without sending a request; `chemical_sources` reports that status.

The configuration accepts `apiKey`, `apiKeyEnv`, and `CAS_API_KEY`, but this release does not use the credential for a query.

## Data coverage

CAS Common Chemistry provides names, identifiers, and basic properties for common substances. It does not include SciFinder literature, reaction mechanisms, patent analysis, synthesis recipes, or supplier search.

## Official resources

- [CAS Common Chemistry API access](https://www.cas.org/services/common-chemistry-api)
- Web substance data uses the CC BY-NC 4.0 license. API terms are set by the user's CAS agreement.
