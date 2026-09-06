# Changelog

All notable changes to Pi Scholar are documented in this file.

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
