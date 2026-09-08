# Changelog

All notable changes to Pi Scholar are documented in this file.

## 1.0.1 - 2026-09-08

- Keep release and configuration-transition notes in this changelog instead of separate upgrade and implementation-report files.
- Remove test-machine and transport-failure wording from the research documentation.
- Keep README and configuration references focused on current behavior.

## 1.0.0 - 2026-09-08

- Replace the v2 credential-reference schema with `schemaVersion: 3`. Keyed services accept direct `apiKey`, `apiKeyEnv`, and standard environment-variable fallback in that order.
- Rename provider `credentialEnv` fields to `apiKeyEnv` and `mineru.tokenEnv` to `mineru.apiKeyEnv`.
- Move Ai4Scholar and MinerU credentials into the unified config while preserving Ai4Scholar tools and explicit routing.
- Remove the old config migration command and module. Version 1.0.0 starts from a new configuration file.
- Complete the MP01-MP17 Materials Project surface: route-specific REST search, task resolution, fixed optional `mp-api`/`pymatgen` helpers, phase diagrams, simulated XRD, and reproducible exports.
- Add `materials_search`, `materials_get`, `materials_route_search`, `materials_advanced`, and `materials_export`; Python-backed operations require Python 3.11 or newer with `mp-api` and `pymatgen`.
- Generate the human and machine Materials capability matrices from one runtime source.
- Rewrite the Chinese and English setup documentation around current behavior and concrete commands.

## 0.5.0 - 2026-09-08

- Add versioned research, materials, and sync configuration, source setup candidates, and non-overwriting configuration migration previews/backups.
- Route local parsing through synchronization checks and protect publication identity and user content.
- Add the bounded first-party literature set (Semantic Scholar, OpenAlex, PubMed/PMC, arXiv, Crossref, Unpaywall, and SecretKey-gated easyScholar journal ranks), Materials Project workflows, and an independent contract-gated CAS Common Chemistry model.
- Preserve Ai4Scholar as an explicitly selected compatible service; it is not a required first-party routing dependency or automatic paid fallback.
- Stop automatic retransmission after uncertain MinerU task creation/upload; enforce an overall operation deadline.
- Update research/reading skills and add Materials Project and chemical-data workflows.
- Fix canonical Materials Project collection URLs and capability routing for DOI-only Unpaywall lookup.

## 0.4.3 - 2026-09-06

### Changed

- Installation and update commands now use the npm `latest` channel so new releases are installed without changing the documented command.

## 0.4.2 - 2026-09-06

### Changed

- Direct API keys can be entered with `media.providerOptions.<id>.apiKey` in the unified configuration and are used by all built-in image providers.
- Atlas GPT Image 2 uses explicit pixel dimensions with a `1024x1024` default; provider documentation and validation now use the same format.

## 0.4.1 - 2026-09-06

### Fixed

- Atlas GPT Image 2 requests now include the upstream billing-required `size`, defaulting to `1024x1024`; explicit pixel dimensions are accepted while `1K`/`2K`/`4K` aliases remain rejected.

## 0.4.0 - 2026-09-06

### Added

- Native scientific image generation and editing for Gemini API, Vertex AI, OpenAI, xAI, fal.ai, Qwen/DashScope, Atlas, and custom OpenAI-compatible services.
- Unified text-to-image, image-to-image, multi-reference, mask, aspect-ratio, resolution, count, quality, transparency, format, and compression controls with provider-specific validation.
- Read-only model discovery, non-generating connection checks, configured default models, and automatic selection of the newest compatible candidate.
- Vertex service-account JSON, Application Default Credentials, project, and regional endpoint support.
- Safe reference input handling, asynchronous job polling, origin-bound downloads, bounded response bodies, atomic artifact publishing, and secret redaction.
- Scientific figure workflow guidance covering provider selection, prompt structure, cost control, validation, and research-integrity requirements.

### Changed

- Consolidated image provider settings into the existing `pi-scholar.config.json` discovery and validation flow.
- Extended `/pi-scholar status` to report configured image providers without exposing credentials.
- Updated Chinese and English configuration documentation with provider compatibility and current official references.

### Notes

- Balance lookup remains disabled where no stable official API is verified. Use the corresponding provider billing console.
- Connection checks use read-only catalogs and do not prove image inference entitlement or remaining quota.
