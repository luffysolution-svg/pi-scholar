# Failure and scientific boundaries

- Missing credentials: point to `data.providers.materials-project.apiKey`, `apiKeyEnv`, or `MP_API_KEY`. Never request that a secret be pasted into a research note or tool argument.
- Permission errors: report the source's limitation. Do not switch to a paid service implicitly.
- Missing property: preserve whether it was unrequested, unavailable, not applicable, or failed. A successful metadata response does not establish that a complete DOS or band structure was retrieved.
- Offline service or rate limit: use only a valid permitted cache or report the failure; keep request budgets bounded.
- Unsupported filters: ask for a supported formulation or report the limitation. Do not silently drop the constraint or label a locally filtered subset as a complete database search.
- Corrupt cache: report invalidity; do not invent values or silently expand remote work.
- Export conflict: preserve the existing user file and choose an explicitly requested new destination or review the conflict.
- Python-dependent functionality: missing optional dependencies affect only advanced objects and derived calculations. The bridge accepts fixed JSON operations and never runs model-supplied Python, shell, or pickle.
- Official helper unavailable: full band structure, DOS, or phonon retrieval may fail even when REST metadata exists. Report the helper error as an upstream availability problem and retain the successful metadata separately.

Preserve energy correction and functional distinctions. Report spin, normalization, frequency/energy units, and coordinate conventions when relevant. Do not claim an archived database version is necessarily still replayable online.
