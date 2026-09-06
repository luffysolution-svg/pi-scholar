# ⚙️ Pi Scholar Configuration

[中文版](./CONFIGURATION.md)

Prefer keeping only non-sensitive settings in project configuration. Configure the Ai4Scholar key with `/pi-scholar setup` or an environment variable. Image providers support either `media.providerOptions.apiKey` in the unified config or the safer `apiKeyEnv`; never commit a credential-bearing config.

## Configuration discovery

First match wins:

1. File named by `PI_SCHOLAR_CONFIG`; a missing explicit path is an error.
2. Nearest `pi-scholar.config.json` searched upward from the working directory; trusted Pi projects only.
3. `~/.config/pi-scholar/config.json`; on Windows, `%USERPROFILE%\.config\pi-scholar\config.json`.
4. `~/.pi-scholar.json`.
5. Built-in defaults.

Relative JSON values for `output.directory`, `zotero.dataDir`, `media.outputDir`, and Vertex `credentialsFile` resolve from the configuration file's directory. Relative environment paths resolve from the runtime working directory. Existing Zotero/MinerU environment variables override JSON. Explicit image-provider credentials and endpoints in the unified config take precedence, with environment variables used only as fallback.

> `pi-scholar.config.json` is ignored by Git. Do not commit personal filesystem paths to a public repository.

## Full example

```json
{
  "output": {
    "directory": "F:/my-vault",
    "literaturesDirectory": "Literatures",
    "filenameSeparator": "-",
    "assetFilePrefix": "figure",
    "tagSpaceReplacement": "-"
  },
  "zotero": {
    "baseUrl": "http://127.0.0.1:23119/api",
    "timeoutMs": 15000,
    "maxItems": 5000
  },
  "media": {
    "outputDir": "./pi-scholar-output/images",
    "providerOptions": {
      "gemini": { "apiKeyEnv": "GEMINI_API_KEY" },
      "vertex": { "credentialsFile": "./vertex-service-account.json", "location": "global" },
      "openai": { "apiKeyEnv": "OPENAI_API_KEY" },
      "xai": { "apiKeyEnv": "XAI_API_KEY" },
      "fal": { "apiKeyEnv": "FAL_KEY" },
      "dashscope": { "apiKeyEnv": "DASHSCOPE_API_KEY" },
      "qwencloud": { "apiKeyEnv": "QWENCLOUD_API_KEY" },
      "atlas": { "apiKeyEnv": "ATLAS_API_KEY" }
    }
  },
  "mineru": {
    "tokenEnv": "MINERU_API_TOKEN",
    "timeoutMs": 600000,
    "pollInitialMs": 3000,
    "pollMaxMs": 15000,
    "maxAttempts": 120,
    "language": "en",
    "enableFormula": true,
    "enableTable": true,
    "isOcr": false,
    "modelVersion": "vlm"
  }
}
```

## `output`: layout and naming

| JSON field | Environment variable | Default |
|---|---|---|
| `directory` | `PI_SCHOLAR_OUTPUT_DIR` | `~/pi-scholar` |
| `literaturesDirectory` | `PI_SCHOLAR_LITERATURES_DIR` | `Literatures` |
| `filenameSeparator` | `PI_SCHOLAR_FILENAME_SEPARATOR` | `-` |
| `assetFilePrefix` | `PI_SCHOLAR_ASSET_FILE_PREFIX` | `figure` |
| `tagSpaceReplacement` | `PI_SCHOLAR_TAG_SPACE_REPLACEMENT` | `-` |

Default layout:

```text
<directory>/
└── <literaturesDirectory>/
    └── <Author-Year-Title>/
        ├── <Author-Year-Title>.md
        ├── metadata.json
        └── assets/
            └── <assetFilePrefix>-01.png
```

<details>
<summary>Field constraints</summary>

- `directory`: vault or ordinary output root; created when absent.
- `literaturesDirectory`: one directory component below the root. It cannot contain separators, Windows reserved device names, or trailing dots/spaces; maximum 64 UTF-8 bytes.
- `filenameSeparator`: 1–3 characters from `[+._ -]`, joining author, year, and title.
- `assetFilePrefix`: safe image basename prefix such as `figure-01.png`.

- `tagSpaceReplacement`: `-` or `_`; affects Markdown frontmatter tags only. `metadata.json` preserves original Zotero tags.

Missing name components use `UnknownAuthor`, `UnknownYear`, and `Untitled`. Cross-platform-invalid characters become spaces and reserved device names are prefixed. Names are first capped at 220 UTF-8 bytes, then shortened against the actual `directory` path as needed so final Markdown and image paths stay within 240 characters; the complete title remains in frontmatter and `metadata.json`. Distinct items with the same readable name receive ` (2)`, ` (3)`, and so on. The asset directory is fixed as `assets`; reprocessing transactionally migrates an overlong directory already owned by the same item.

</details>

## `zotero`: local Zotero

| JSON field | Environment variable | Default |
|---|---|---|
| `baseUrl` | `ZOTERO_BASE_URL` | `http://127.0.0.1:23119/api` |
| `dataDir` | `ZOTERO_DATA_DIR` | none |
| `timeoutMs` | `ZOTERO_TIMEOUT_MS` | `15000` |
| `maxItems` | `ZOTERO_MAX_ITEMS` | `5000` |

- `baseUrl` must be exactly `http://localhost:23119/api` or `http://127.0.0.1:23119/api`. Other hosts, ports, credentials, queries, and redirects are rejected.
- `dataDir` is Zotero's directory containing `storage/`, used only when the Local API cannot resolve a managed attachment path.
- `timeoutMs` range: 1,000–120,000 ms.
- `maxItems` range: 1–50,000.

Enable “Allow other applications on this computer to communicate with Zotero” and never expose port 23119 externally.

## `mineru`: PDF parsing

| JSON field | Environment variable | Default |
|---|---|---|
| `tokenEnv` | — | `MINERU_API_TOKEN` |
| Actual key | `MINERU_API_TOKEN` or the name selected by `tokenEnv` | none |
| `timeoutMs` | `MINERU_TIMEOUT_MS` | `600000` |
| `pollInitialMs` | `MINERU_POLL_INITIAL_MS` | `3000` |
| `pollMaxMs` | `MINERU_POLL_MAX_MS` | `15000` |
| `maxAttempts` | `MINERU_MAX_ATTEMPTS` | `120` |
| `language` | `MINERU_LANGUAGE` | `en` |
| `enableFormula` | `MINERU_ENABLE_FORMULA` | `true` |
| `enableTable` | `MINERU_ENABLE_TABLE` | `true` |
| `isOcr` | `MINERU_IS_OCR` | `false` |
| `modelVersion` | `MINERU_MODEL_VERSION` | `vlm` |

- `tokenEnv` stores only an environment-variable name, never a token; it must match `[A-Z_][A-Z0-9_]*`.
- `timeoutMs` is the overall deadline, 10,000–3,600,000 ms. Individual HTTP attempts are separately capped at 60 seconds.
- Poll intervals are limited to 100–60,000 and 100–120,000 ms; `maxAttempts` is 1–1000.
- Boolean environment variables accept `1/0`, `true/false`, and `yes/no`, case-insensitively.
- `isOcr=true` forces OCR even when a PDF has a text layer.

MinerU receives the selected PDF over the network and may consume quota. Parse only when structured text, formulas, tables, or figures are needed.

## `media`: multi-provider scientific images

Built-in provider IDs are `gemini`, `vertex`, `openai`, `xai`, `fal`, `dashscope`, `qwencloud`, and `atlas`. The unified tools accept text-to-image, image generation/editing, multiple references, aspect ratio, size/resolution, count, quality, transparent background, and output format. Each adapter strictly validates actual model support; unsupported controls fail instead of being ignored.

| Field | Purpose |
|---|---|
| `outputDir` | Download directory; defaults to `<output.directory>/images` |
| `maxArtifactBytes` | Per-artifact limit; default 52,428,800 (50 MiB), range 1–1,073,741,824 bytes |
| `artifactTimeoutMs` | Download timeout; default 120,000, range 1,000–3,600,000 ms |
| `providerOptions.<id>.apiKey` | Direct key; explicit config wins over environment fallback; do not commit it |
| `providerOptions.<id>.apiKeyEnv` | Environment-variable name containing the key |
| `providerOptions.vertex.credentialsFile` | Vertex service-account JSON relative to the config; standard ADC also works |
| `providerOptions.vertex.location` / `project` | Vertex region and optional project; region must be `global` or a valid GCP region such as `us-central1`; project may be inferred from JSON/ADC |
| `defaultModels.<id>.<capability>` | Optional model pin; omission selects the newest candidate from an official catalog or curated fallback |
| `customProviders` | Custom OpenAI-compatible models, capabilities, and generation/edit endpoints |

Default fallbacks are `GEMINI_API_KEY` (then `GOOGLE_API_KEY`), `OPENAI_API_KEY`, `XAI_API_KEY`, `FAL_KEY`/`FAL_API_KEY`, `DASHSCOPE_API_KEY`, `QWENCLOUD_API_KEY`, and `ATLAS_API_KEY`. Vertex supports `GOOGLE_APPLICATION_CREDENTIALS`, `VERTEX_CREDENTIALS_FILE`, `GOOGLE_CLOUD_PROJECT`, and `GOOGLE_CLOUD_LOCATION`.

Current Qwen 3 services commonly use workspace-scoped regional origins; set `baseUrl` to the origin assigned to the account. Fields are provider-specific: Vertex uses `credentialsFile/project/location`, Qwen may also use `workspace`, fal accepts credential settings only, and a custom service URL belongs in `customProviders[].baseUrl`. Call-level `providerOptions` is only for advanced model-native fields and cannot override credentials, endpoints, or normalized controls.

Size controls are intentionally provider-specific: OpenAI accepts explicit pixels; Gemini/fal expose 1K/2K/4K tiers; xAI exposes 1K/2K; Qwen accepts 1K/2K or valid explicit dimensions; the Atlas GPT Image 2 proxy guarantees aspect ratio only. Transparency and quality are exposed only where official documentation confirms support. See [`IMAGE_PROVIDERS.en.md`](./IMAGE_PROVIDERS.en.md) for verified limits and official links.

`pi_scholar_image_models` reads supported provider catalogs without submitting generation. `pi_scholar_image_service` can run read-only checks for OpenAI, Gemini, xAI, Vertex, and custom OpenAI-compatible services that expose `/models`. fal, Qwen, and Atlas report `unsupported` when no stable non-generating probe is verified. No stable common balance endpoint was verified, so `balance` explicitly returns `unsupported`; use each provider's billing console.

See [`pi-scholar.config.example.json`](../pi-scholar.config.example.json) for a custom OpenAI-compatible example. Every model must explicitly declare the supported `image.text_to_image`, `image.image_to_image`, `image.edit`, or `image.multi_reference` capability and endpoint.

## Online scholarly service

Online search, citation, journal, figure, and MCP features use:

| Environment variable | Default / purpose |
|---|---|
| `AI4SCHOLAR_API_KEY` | Service API key; alternatively run `/pi-scholar setup` |
| `AI4SCHOLAR_BASE_URL` | `https://ai4scholar.net` |
| `AI4SCHOLAR_TIMEOUT_MS` | `30000` ms |
| `AI4SCHOLAR_PROXY` | HTTP(S) proxy; set `direct` to force a direct connection |
| `AI4SCHOLAR_MCP_URL` | `https://mcp.ai4scholar.net/sse` |
| `HTTPS_PROXY` / `HTTP_PROXY` | Generic fallback when no dedicated proxy is set |

`/pi-scholar setup` saves the key to `~/.pi/agent/pi-scholar.credentials.json`, restricting directory/file permissions to the current user where supported. Environment variables take precedence over that file. When no proxy is explicitly configured, Windows system-proxy detection uses `ProxyServer` only if the registry's `ProxyEnable` value is enabled, ignoring stale addresses left after the proxy is turned off.

Management commands:

```text
/pi-scholar setup
/pi-scholar status
/pi-scholar credits
/pi-scholar clear-key
```

## Validation

Every field is validated for type, range, and path safety. Unknown fields, wrong types, unsafe filenames, out-of-range numbers, and invalid URLs produce explicit errors instead of being ignored or silently replaced with defaults.
