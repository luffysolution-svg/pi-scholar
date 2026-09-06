# Image provider compatibility

[中文版](./IMAGE_PROVIDERS.md)

Verified against official provider documentation on **2026-09-06**. Provider APIs and model availability may change by account, project, region, and billing tier. A listed model is a supported candidate, not a guarantee that a particular credential can use it.

## Official documentation

| Provider | Documentation |
|---|---|
| Gemini API | https://ai.google.dev/gemini-api/docs/image-generation |
| Vertex AI | https://cloud.google.com/vertex-ai/generative-ai/docs/image/generate-images |
| OpenAI | https://developers.openai.com/api/docs/guides/image-generation |
| xAI | https://docs.x.ai/developers/model-capabilities/images/generation |
| fal.ai | https://fal.ai/models/fal-ai/nano-banana-2/api |
| Qwen / Model Studio | https://www.alibabacloud.com/help/en/model-studio/qwen-image-api |
| Atlas / Aixoras | https://doc.aixoras.com/jieruwendang/1-jiekouwendang.html |

Atlas refers to the Aixoras API configured by `ATLAS_API_KEY`. It is a third-party intermediary, not OpenAI Platform or MongoDB Atlas. Prompts and source images submitted through this provider are processed by that intermediary and its upstream services.

## Capability matrix

| Provider | Default image candidate | Text generation | Image edit / references | Resolution | Count | Transparency | Quality |
|---|---|---:|---:|---|---|---:|---|
| Gemini API | `gemini-3.1-flash-image` | Yes | Yes, up to 14 references on Gemini 3 | 1K / 2K / 4K | Sequential requests | No | No |
| Vertex AI | `gemini-3.1-flash-image` | Yes | Model-dependent | Gemini: 1K / 2K / 4K; Imagen 4: 1K / 2K | Imagen: 1–4 | No | No |
| OpenAI | `gpt-image-2` | Yes | Yes, up to 16 sources | Explicit pixels | 1–10 | PNG/WebP | `auto`, `low`, `medium`, `high` |
| xAI | `grok-imagine-image-2.0` | Yes | Yes, up to 5 sources | 1K / 2K | 1–10 | No | `auto`, `low`, `medium` |
| fal.ai | `fal-ai/nano-banana-2` | Yes | Separate `/edit` model, 1–14 sources | 0.5K / 1K / 2K / 4K | Positive integer; service limit applies | No generic control | No generic control |
| Qwen | `qwen-image-3.0-pro` | Yes | Qwen 3 supports 1–3 sources | 1K / 2K or bounded pixels | 1–6 | No | No |
| Atlas | `gpt-image-2-1k` | Yes | One source image | Explicit pixels, default `1024x1024` | Positive integer; service limit applies | Model-dependent | Model-dependent |
| Custom OpenAI-compatible | Configuration order | Declared capability | Declared capability | Endpoint-dependent | Endpoint-dependent | Endpoint-dependent | Endpoint-dependent |

Normalized controls are submitted in the format accepted by the selected model.

## Provider details

### Gemini API and Vertex AI

- Native Gemini image generation uses `generateContent` with image response modalities and supports text, source images, and multiple references.
- Gemini 3 supports 1K, 2K, and 4K image-size tiers. Gemini 2.5 uses its native 1K output.
- One native Gemini image is requested per call. Multi-image requests are submitted sequentially and stop after the first failure without automatically retrying a billable request.
- Gemini 3 accepts up to 14 input/reference images. Flash or Pro is preferred over Flash Lite for reference-heavy or iterative editing.
- Imagen 4 candidates include `imagen-4.0-generate-001`, `imagen-4.0-fast-generate-001`, and `imagen-4.0-ultra-generate-001`. Standard Imagen generation is text-only and commonly supports 1–4 outputs at 1K or 2K.
- Vertex uses Application Default Credentials or a service-account JSON file. `location` must be `global` or a valid Google Cloud region such as `us-central1`.
- Background transparency, output format, compression, and generic quality controls are not exposed for Google image models.

### OpenAI

- Supported GPT Image candidates are `gpt-image-2`, `gpt-image-1.5`, `gpt-image-1`, and `gpt-image-1-mini`. DALL-E remains available only when explicitly selected.
- GPT Image requests support 1–10 outputs and up to 16 edit/reference images.
- GPT Image quality values are `auto`, `low`, `medium`, and `high`.
- Transparent output requires PNG or WebP. Compression from 0–100 requires explicit JPEG or WebP output.
- GPT Image 2 accepts explicit dimensions whose edges are multiples of 16, maximum edge is 3840 pixels, aspect ratio is between 1:3 and 3:1, and area is 655,360–8,294,400 pixels.
- Earlier GPT Image models use `1024x1024`, `1536x1024`, `1024x1536`, or `auto`. Ambiguous 1K/2K/4K aliases are rejected.

### xAI

- `grok-imagine-image-2.0` supports generation and single/multiple-image editing.
- Up to five source images and ten outputs are accepted. Source order is preserved.
- Resolution is 1K or 2K. Arbitrary pixel dimensions and 4K are not documented.
- Quality is `auto`, `low`, or `medium`.
- Masks, background transparency, output format, and compression are not exposed.

### fal.ai

- `fal-ai/nano-banana-2` is used for text generation and `fal-ai/nano-banana-2/edit` for image editing and references.
- Resolution supports 0.5K, 1K, 2K, and 4K. Aspect ratio, count, seed, PNG, JPEG, and WebP are supported.
- Local source images are uploaded to fal storage before queue submission. Higher resolution and optional model-native features may increase cost.
- fal schemas are endpoint-specific. Only explicitly verified image endpoints are enabled.

### Qwen / DashScope / QwenCloud

- Current candidates are `qwen-image-3.0-pro`, `qwen-image-3.0`, `qwen-image-2.0-pro`, and `qwen-image-2.0`. Legacy candidates remain available for explicit selection.
- Qwen 3 accepts 1–3 source images and 1–6 PNG outputs.
- Dimensions must have an area from 512² through 2048² pixels and an aspect ratio from 1:8 through 8:1. Square 1K and 2K aliases are accepted; 4K is not.
- Mask, background, quality, and compression controls are not exposed.
- Qwen 3 accounts may use workspace-scoped regional origins. Configure the exact account origin in `providerOptions.<id>.baseUrl` and, when required, set `workspace`.

### Atlas / Aixoras

- Documented GPT Image 2 examples include `gpt-image-2-1k` for generation and `gpt-image-2-2k` for editing. Use the exact model available to the account.
- GPT Image 2 requests use explicit pixel dimensions and default to `1024x1024`. Enter larger supported dimensions directly, such as `2048x2048`; the service response remains authoritative for the actual output.
- Supported ratios are 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, and 21:9.
- Editing accepts one source image. Multiple references and masks are not enabled.

## Models, connection tests, and balance

- Read-only model discovery is available for Gemini, Vertex AI Model Garden, OpenAI, xAI, Atlas when its catalog responds, and declared custom OpenAI-compatible models. fal and Qwen use verified built-in candidates because no stable authenticated image catalog is documented.
- Custom catalogs never infer capabilities from arbitrary model names. Only models explicitly declared in `customProviders` are returned as image-capable.
- Non-generating connection checks are available for Gemini, Vertex, OpenAI, xAI, and custom OpenAI-compatible `/models` endpoints. Catalog access confirms authentication to that endpoint only; it does not prove image inference entitlement or quota.
- No stable official balance endpoint is enabled. `balance` returns `unsupported` and directs users to the provider billing console. No paid generation is used as a connection test.

## Data and cost controls

- Reference images and prompts are transmitted to the selected external provider.
- Local and remote reference inputs are limited to 50 MiB each. Provider JSON responses are limited to 128 MiB, and downloaded artifacts default to a 50 MiB limit configurable through `maxArtifactBytes`.
- Generated files are streamed to the configured output directory using temporary files and atomic renames. Partial files are removed after failure.
- Authenticated download headers are origin-bound, redirects are checked, and private/reserved remote addresses are rejected.
- Failed billable submissions are not automatically retried. Check provider history before manually retrying an ambiguous failure.
