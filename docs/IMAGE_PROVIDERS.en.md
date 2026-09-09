# Scientific image providers

[中文版](./IMAGE_PROVIDERS.md)

The table below lists the models and controls available through Pi Scholar. Account permissions, region, and plan may change what a provider accepts.

## Provider documentation

| Provider | Documentation |
|---|---|
| Gemini API | https://ai.google.dev/gemini-api/docs/image-generation |
| Vertex AI | https://cloud.google.com/vertex-ai/generative-ai/docs/image/generate-images |
| OpenAI | https://developers.openai.com/api/docs/guides/image-generation |
| xAI | https://docs.x.ai/developers/model-capabilities/images/generation |
| fal.ai | https://fal.ai/models/fal-ai/nano-banana-2/api |
| Qwen / Model Studio | https://www.alibabacloud.com/help/en/model-studio/qwen-image-api |
| Atlas / Aixoras | https://doc.aixoras.com/jieruwendang/1-jiekouwendang.html |

> Atlas refers to the Aixoras API proxy configured with `ATLAS_API_KEY`.

## Capability matrix

| Provider | Default model | Text to image | Editing and references | Resolution | Output count | Transparency | Quality |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Gemini API | `gemini-3.1-flash-image` | Yes | Up to 14 references on Gemini 3 | 1K / 2K / 4K | Sequential requests | No | No |
| Vertex AI | `gemini-3.1-flash-image` | Yes | Depends on model | Gemini: 1K / 2K / 4K; Imagen 4: 1K / 2K | Imagen: 1 to 4 | No | No |
| OpenAI | `gpt-image-2` | Yes | Up to 16 references | Pixel dimensions | 1 to 10 | PNG / WebP | `auto`, `low`, `medium`, `high` |
| xAI | `grok-imagine-image-2.0` | Yes | Up to 5 source images | 1K / 2K | 1 to 10 | No | `auto`, `low`, `medium` |
| fal.ai | `fal-ai/nano-banana-2` | Yes | Dedicated `/edit` model; 1 to 14 images | 0.5K / 1K / 2K / 4K | Depends on model | Depends on model | Depends on model |
| Qwen | `qwen-image-3.0-pro` | Yes | Qwen 3 accepts 1 to 3 references | 1K / 2K or bounded pixels | 1 to 6 | No | No |
| Atlas | `gpt-image-2-1k` | Yes | 1 reference | Pixel dimensions; default `1024x1024` | Depends on service | Depends on model | Depends on model |
| Custom OpenAI-compatible service | Configuration order | Declared by config | Declared by config | Depends on endpoint | Depends on endpoint | Depends on endpoint | Depends on endpoint |

## Provider parameters

### Gemini API and Vertex AI

- Gemini uses `generateContent` for text generation, single-image edits, and reference-guided generation.
- Gemini 3 accepts 1K, 2K, and 4K. Gemini 2.5 defaults to 1K.
- Multiple outputs are submitted in sequence. Reference limits depend on the selected Flash or Pro model.
- Imagen 4 candidates include `imagen-4.0-generate-001`, `imagen-4.0-fast-generate-001`, and `imagen-4.0-ultra-generate-001`. They typically return 1 to 4 images at 1K or 2K.
- Vertex AI reads Application Default Credentials or a configured service-account JSON file.

### OpenAI

- Candidate models are `gpt-image-2`, `gpt-image-1.5`, `gpt-image-1`, and `gpt-image-1-mini`. DALL-E is used only when named explicitly.
- A request can return 1 to 10 images and accept up to 16 reference images.
- Quality values are `auto`, `low`, `medium`, and `high`.
- Transparent output requires PNG or WebP. JPEG and WebP accept compression values from 0 to 100.
- `gpt-image-2` dimensions must be multiples of 16. The longest edge is 3840 pixels and the aspect ratio range is 1:3 to 3:1.

### xAI

- `grok-imagine-image-2.0` handles generation, single-image editing, and multiple references.
- It accepts up to 5 references and returns up to 10 images. Reference order is preserved.
- Resolution is 1K or 2K. Quality is `auto`, `low`, or `medium`.

### fal.ai

- The default generation model is `fal-ai/nano-banana-2`; the edit model is `fal-ai/nano-banana-2/edit`.
- Available controls include 0.5K, 1K, 2K, and 4K sizes, aspect ratio, count, seed, and PNG/JPEG/WebP output.
- Local reference images are uploaded to temporary storage before submission.

### Qwen / DashScope / QwenCloud

- Candidates include `qwen-image-3.0-pro`, `qwen-image-3.0`, `qwen-image-2.0-pro`, and `qwen-image-2.0`.
- Qwen 3 accepts 1 to 3 references and returns 1 to 6 PNG images.
- Pixel area ranges from 512² to 2048², with aspect ratios from 1:8 to 8:1.
- Set `workspace` when the account is tied to a Model Studio workspace.

### Atlas / Aixoras

- Common model IDs are `gpt-image-2-1k` for generation and `gpt-image-2-2k` for editing.
- The default size is `1024x1024`; the request may use other upstream-supported dimensions such as `2048x2048`.
- Supported aspect ratios include 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, and 21:9.

## Status and billing

`/pi-scholar status` lists image providers recognized in the local configuration. It does not connect to providers or verify generation access. `pi_scholar_image_models` reads model catalogs from providers that support catalog requests. Check balances and invoices in the provider console.

## Files

Reference images and generated files default to a 50 MiB limit, configurable through `maxArtifactBytes`. Downloads use a `.part` file and rename it after completion.

A submitted generation request may be billed. Network failures do not trigger an automatic retry; check provider task history before submitting again.
