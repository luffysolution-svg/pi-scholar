# Scientific Image Provider Compatibility

[中文版](./IMAGE_PROVIDERS.md)

This document summarizes the official models, core parameters, and platform capabilities supported across image generation providers. Available models depend on your provider account permissions and plan tier.

## Official Documentation References

| Provider | Official Documentation |
|---|---|
| Gemini API | https://ai.google.dev/gemini-api/docs/image-generation |
| Vertex AI | https://cloud.google.com/vertex-ai/generative-ai/docs/image/generate-images |
| OpenAI | https://developers.openai.com/api/docs/guides/image-generation |
| xAI | https://docs.x.ai/developers/model-capabilities/images/generation |
| fal.ai | https://fal.ai/models/fal-ai/nano-banana-2/api |
| Qwen / Model Studio | https://www.alibabacloud.com/help/en/model-studio/qwen-image-api |
| Atlas / Aixoras | https://doc.aixoras.com/jieruwendang/1-jiekouwendang.html |

> Note: Atlas in this extension refers to the Aixoras API proxy service (configured via `ATLAS_API_KEY`), used for quick access to GPT image generation.

## Capability Matrix

| Provider | Default Recommended Model | Text-to-Image | Image-to-Image / Multi-Reference | Resolutions | Batch Count | Transparency | Quality Controls |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Gemini API** | `gemini-3.1-flash-image` | Supported | Supported; up to 14 references on Gemini 3 | 1K / 2K / 4K | Sequential | N/A | N/A |
| **Vertex AI** | `gemini-3.1-flash-image` | Supported | Model-dependent | Gemini: 1K / 2K / 4K; Imagen 4: 1K / 2K | Imagen: 1–4 | N/A | N/A |
| **OpenAI** | `gpt-image-2` | Supported | Supported; up to 16 references | Explicit pixel dimensions | 1–10 | PNG / WebP | `auto`, `low`, `medium`, `high` |
| **xAI** | `grok-imagine-image-2.0` | Supported | Supported; up to 5 reference images | 1K / 2K | 1–10 | N/A | `auto`, `low`, `medium` |
| **fal.ai** | `fal-ai/nano-banana-2` | Supported | Dedicated `/edit` model; 1–14 images | 0.5K / 1K / 2K / 4K | Service-governed | Model-specific | Model-specific |
| **Qwen** | `qwen-image-3.0-pro` | Supported | Qwen 3 supports 1–3 reference images | 1K / 2K or bounded pixels | 1–6 | N/A | N/A |
| **Atlas** | `gpt-image-2-1k` | Supported | 1 reference image | Explicit pixel dimensions, default `1024x1024` | Service-governed | Model-dependent | Model-dependent |
| **Custom OpenAI-Compatible** | Configured order | By declaration | By declaration | Endpoint-dependent | Endpoint-dependent | Endpoint-dependent | Endpoint-dependent |

## Provider Details

### Gemini API & Vertex AI

- Gemini image generation uses `generateContent`, supporting pure text generation, single-image editing, and multi-reference guidance.
- Gemini 3 supports 1K, 2K, and 4K; Gemini 2.5 defaults to 1K output.
- Batch requests submit sequentially. When using multiple reference images or iterating across multiple rounds, Flash and Pro models are recommended.
- Imagen 4 candidates include `imagen-4.0-generate-001`, `imagen-4.0-fast-generate-001`, and `imagen-4.0-ultra-generate-001`, typically generating 1–4 images at 1K/2K.
- Vertex AI uses Application Default Credentials (ADC) or a service-account JSON specified via configuration.

### OpenAI

- GPT Image candidates include `gpt-image-2`, `gpt-image-1.5`, `gpt-image-1`, and `gpt-image-1-mini`; DALL-E is used only when explicitly selected.
- Supports 1–10 outputs per generation and up to 16 input reference images.
- Quality tiers: `auto`, `low`, `medium`, `high`.
- Transparent backgrounds require PNG or WebP output; JPEG or WebP is recommended when using compression settings (0–100).
- `gpt-image-2` dimensions must be multiples of 16, with max edge length <= 3840 pixels, aspect ratio between 1:3 and 3:1.

### xAI

- `grok-imagine-image-2.0` supports text-to-image, single-image editing, and multi-reference guidance.
- Accepts up to 5 reference images and generates up to 10 outputs while preserving reference order.
- Resolutions: 1K or 2K; quality options: `auto`, `low`, `medium`.

### fal.ai

- Recommended models: `fal-ai/nano-banana-2` for text-to-image, and `fal-ai/nano-banana-2/edit` for image editing and references.
- Supports 0.5K, 1K, 2K, 4K, custom aspect ratios, batch counts, seeds, and format options (PNG/JPEG/WebP).
- Local reference images are temporarily uploaded to secure fal storage before task submission.

### Qwen / DashScope / QwenCloud

- Recommended candidates: `qwen-image-3.0-pro`, `qwen-image-3.0`, `qwen-image-2.0-pro`, and `qwen-image-2.0`.
- Qwen 3 supports 1–3 reference images and 1–6 output PNG images.
- Pixel area should fall between 512² and 2048² pixels, with aspect ratios between 1:8 and 8:1.
- If your account uses a specific Model Studio Workspace, configure your `workspace` ID accordingly.

### Atlas / Aixoras

- Typical models include `gpt-image-2-1k` for generation and `gpt-image-2-2k` for edits.
- Defaults to `1024x1024`, supporting explicit pixel dimensions like `2048x2048`.
- Supports standard academic aspect ratios: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 21:9.

## Connectivity Checks and Quotas

- **Connection Testing**: Run `/pi-scholar status` to test connectivity with configured providers. Checks perform read-only catalog handshakes without creating billable generation requests.
- **Balance Lookup**: Because upstream providers lack unified balance endpoints, check usage and remaining credits in your provider's web console.

## File Safety and Output Handling

- **File Size Limits**: Individual reference images are capped at 50 MiB, and generated artifacts default to a 50 MiB limit (adjustable with `maxArtifactBytes`) to prevent excessive memory and disk consumption.
- **Cost Protection**: Failed generation requests are not retried automatically, preventing accidental double billing. Inspect the issue and retry manually when ready.
- **Atomic Writes**: Generated figures stream into temporary files before an atomic rename to destination directories, ensuring corrupted or partial files are never left behind.
