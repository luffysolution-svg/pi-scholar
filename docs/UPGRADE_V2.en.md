# Safe synchronization and multi-source configuration

This guide applies to the schemaVersion 2 configuration introduced in 0.5.0. Existing configuration, Ai4Scholar commands, and image features remain compatible.

## Configuration and migration

Copy `pi-scholar.config.example.json` and explicitly enable the sources you need. The final literature set lives under `research.providers`; `data.providers.materials-project` and `data.providers.cas-common-chemistry` hold materials and chemical-substance data respectively. New source configuration accepts environment references such as `credentialEnv`; it does not accept plaintext keys or arbitrary credential destinations. Existing `media` configuration retains its previous compatibility behavior.

`/pi-scholar setup-sources` selects a provider and credential environment variable interactively, then previews and writes a separate configuration candidate. It neither activates that file nor probes the account. `/pi-scholar status` reports configuration; use `research_sources` for detailed capabilities and limitations. Enabled, credential-present, implemented, entitled, and live-validated are separate states.

Use `/pi-scholar config-migrate` for an existing file. The preview is read-only. Confirmation creates a `.v2.json` candidate and a byte-verified backup while preserving the active file. Review the candidate and select it with `PI_SCHOLAR_CONFIG`. Repeated migration cannot overwrite a different existing candidate. Changes after preview require a new preview. Migration does not automatically enable new sources.

Paid fallback and external full-text upload default to disabled. Selecting a paid source does not make its price known. Local request budgets cannot account for other clients sharing the same key. Ai4Scholar remains an explicitly callable independent service: it is not removed and is never selected automatically when another provider fails. easyScholar uses only the verified `getPublicationRank` journal-rank endpoint and requires a SecretKey. CAS Common Chemistry remains blocked without the account-specific API contract; no endpoint is invented, and Common Chemistry is never expanded into SciFinder literature or reaction search.

## Local synchronization

Inspect `pi_scholar_sync` status or plan for modified/missing files, cache validity, proposed paths, and remote calls. Supply operation arguments according to the registered tool schema. The compatible `pi_scholar_parse` entrypoint uses the safe synchronization workflow.

- Unchanged inputs reuse existing output. Metadata refreshes should not upload the PDF.
- A missing directory is skipped by default. Explicit `restore` prefers cached data; a cache miss requires a separate parsing decision.
- `exclude` persists an exclusion. `unexclude` only removes it and does not authorize a download.
- `repair` handles confirmed missing artifacts. Local prose, YAML, notes, and extra images require preservation or conflict review.
- `recovery_required` means an unfinished transaction must be resolved first. An offline source or unavailable vault is not evidence of deletion.

Use `sync.namespace` to assign a stable namespace to a Zotero profile. Select a different namespace when changing local libraries so identical item keys cannot collide. `sync.cacheDir` defaults to `.cache/pi-scholar/parse` under the user directory; `backupRetentionDays` defaults to 30. Multiple devices writing the same vault concurrently are unsupported. Keep recovery copies until transaction safety is established.

MinerU's requested model is not an immutable server build revision. An absent parser revision remains unknown. An uncertain creation/upload result returns `AMBIGUOUS_SUBMISSION` and must not be automatically resubmitted. See the [MinerU contract](MINERU_CONTRACT.md).

## Literature, materials, and chemical-substance workflows

Choose sources and bound search requests, then retrieve details using reliable identifiers. Citations, references, and recommendations are different relations. Do not add citation counts from different sources. Resolving a full-text link, downloading, retaining content, and external upload have separate permission requirements.

Materials Project requires the user's key. Filter summaries and property availability first, then retrieve selected IDs. Distinguish containing elements from an exact chemical system. Retain units, calculation methods, tasks, and versions. `materials_export` operates on retrieved data and does not download the database. Full band structures/DOS and their metadata are separate capabilities; consult the runtime matrix.

CAS Common Chemistry records use a separate chemical-substance model limited to names, CAS RN, structure representations, and basic properties. API access follows the access material and license CAS supplies to the account. Without a verified contract, runtime status reports the blocking reason instead of guessing endpoints or authentication.

Run `npm test`, `npm run check`, and `npm run pack:check` for acceptance. Default tests use synthetic records and mocked services, never real PDF uploads. `mock_passed` does not establish live account validation. Consult the implementation report and provider contracts for actual completion and remaining limitations.

The live smoke command is preview-only by default and prints the source, credential state, unknown permissions, request bound, and cost state without making a request: `npm run test:live -- <source>`. It performs one bounded live request only when `PI_SCHOLAR_LIVE_TEST=1` is also set and the positional word `execute` is appended, for example `npm run test:live -- crossref "test query" execute`. Use a DOI for Unpaywall, a journal name for easyScholar, and a formula for Materials Project; CAS returns an explicit blocked status while its contract is unavailable. Confirm provider terms and account permissions first.
