# ⚙️ Configuration Reference

[中文版](./CONFIGURATION.md)

`pi-scholar` uses **one JSON file** to configure the Zotero connection, MinerU parsing behavior, output location, asset naming, and tag formatting. Every field is validated at load time (type, range, and safety checks); an invalid config throws a clear error instead of silently falling back.

## 📁 Where the config file lives

Copy the repo-root [`pi-scholar.config.example.json`](../pi-scholar.config.example.json) to `pi-scholar.config.json` (or one of the user-level locations below) and edit it as needed.

> ⚠️ **Never commit `pi-scholar.config.json`** — it's already covered by `.gitignore` since it typically contains your personal output path and other local details.

### 🔍 Discovery order

Checked in order, first match wins:

1. **`PI_SCHOLAR_CONFIG` env var** — an explicit path; it must exist, or the tool refuses to start.
2. **The nearest `pi-scholar.config.json`**, searched from the current working directory upward. Only used when the project directory is trusted by Pi (`ctx.isProjectTrusted()`), so an untrusted project can't silently redirect output or the Zotero endpoint.
3. **`~/.config/pi-scholar/config.json`** — all platforms, including Windows (`%USERPROFILE%\.config\pi-scholar\config.json`).
4. **`~/.pi-scholar.json`** — last resort.
5. Built-in defaults if none of the above exist.

### 📌 Path resolution

- Relative `output.directory` / `zotero.dataDir` values in the **JSON file** resolve relative to the **config file's own directory**.
- The same values set via **environment variables** resolve relative to the **runtime `cwd`**.
- Environment variables are read fresh on every tool call and **always win over the JSON file** — convenient for one-off overrides (CI, a temporary output dir) without editing the file.

## 📝 Full example

```json
{
  "output": {
    "directory": "F:/my-vault",
    "filenameSeparator": "+",
    "assetsSuffix": ".assets",
    "assetFilePrefix": "figure",
    "metadataFileName": "metadata.json",
    "tagSpaceReplacement": "-"
  },
  "zotero": {
    "baseUrl": "http://127.0.0.1:23119/api",
    "timeoutMs": 15000,
    "maxItems": 5000
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

---

## 📤 `output` — location & naming

| Field | Env override | Default |
|---|---|---|
| `directory` | `PI_SCHOLAR_OUTPUT_DIR` | `~/pi-scholar` |
| `filenameSeparator` | `PI_SCHOLAR_FILENAME_SEPARATOR` | `+` |
| `assetsSuffix` | `PI_SCHOLAR_ASSETS_SUFFIX` | `.assets` |
| `assetFilePrefix` | `PI_SCHOLAR_ASSET_FILE_PREFIX` | `figure` |
| `metadataFileName` | `PI_SCHOLAR_METADATA_FILE` | `metadata.json` |
| `tagSpaceReplacement` | `PI_SCHOLAR_TAG_SPACE_REPLACEMENT` | `-` |

<details>
<summary>Field details</summary>

- **`directory`**: Where generated `.md` files and `.assets` folders are published. May be an Obsidian vault folder, but Obsidian is never required. Relative paths in JSON resolve relative to the config file's directory; relative paths via env var resolve relative to `cwd`.
- **`filenameSeparator`**: 1–3 characters from `[+._ -]` used to join `Author`, `Year`, `Title` in generated filenames.
- **`assetsSuffix`**: Sibling directory suffix, e.g. `Paper.assets/`. Must be a safe filename component (no path separators, max 64 UTF-8 bytes).
- **`assetFilePrefix`**: Extracted image basename prefix, e.g. `figure-01.png`.
- **`metadataFileName`**: Sidecar filename inside the assets directory; must end in `.json`.
- **`tagSpaceReplacement`**: `-` or `_`; character substituted for whitespace/unsupported punctuation in Obsidian-facing tags only (the metadata sidecar keeps the original Zotero tag text).

</details>

## 🗂️ `zotero` — local Zotero connection

| Field | Env override | Default |
|---|---|---|
| `baseUrl` | `ZOTERO_BASE_URL` | `http://127.0.0.1:23119/api` |
| `dataDir` | `ZOTERO_DATA_DIR` | none |
| `timeoutMs` | `ZOTERO_TIMEOUT_MS` | `15000` |
| `maxItems` | `ZOTERO_MAX_ITEMS` | `5000` |

<details>
<summary>Field details</summary>

- **`baseUrl`**: Must be exactly `http://localhost:23119/api` or `http://127.0.0.1:23119/api` — no other host, port, path, credentials, query, or fragment is accepted. Enforced in code, not just documented.
- **`dataDir`**: Zotero's data directory (contains `storage/`), only needed as a fallback when Zotero's own `file/view/url` endpoint cannot resolve a managed attachment's path.
- **`timeoutMs`**: Per-request timeout, 1,000–120,000 ms.
- **`maxItems`**: Upper bound on paged results per call, 1–50,000.

</details>

> Enable **Allow other applications on this computer to communicate with Zotero** in Zotero's settings. Zotero requests are unauthenticated loopback GETs only, with redirects disabled. Never expose port 23119 externally.

## 🧬 `mineru` — PDF parsing behavior

| Field | Env override | Default |
|---|---|---|
| `tokenEnv` | — | `MINERU_API_TOKEN` |
| (actual token) | `MINERU_API_TOKEN` or the var named by `tokenEnv` | none |
| `timeoutMs` | `MINERU_TIMEOUT_MS` | `600000` |
| `pollInitialMs` / `pollMaxMs` | `MINERU_POLL_INITIAL_MS` / `MINERU_POLL_MAX_MS` | `3000` / `15000` |
| `maxAttempts` | `MINERU_MAX_ATTEMPTS` | `120` |
| `language` | `MINERU_LANGUAGE` | `en` |
| `enableFormula` / `enableTable` | `MINERU_ENABLE_FORMULA` / `MINERU_ENABLE_TABLE` | `true` / `true` |
| `isOcr` | `MINERU_IS_OCR` | `false` |
| `modelVersion` | `MINERU_MODEL_VERSION` | `vlm` |

<details>
<summary>Field details</summary>

- **`tokenEnv`**: Names *which* environment variable holds the MinerU secret. The config file never stores the secret itself — only the variable name (must be uppercase, `[A-Z_][A-Z0-9_]*`).
- **The actual MinerU API token**: Required only for `pi_scholar_parse`; every other tool works without it.
- **`timeoutMs`**: Overall extraction deadline. Individual HTTP attempts are separately capped at 60 s.
- **`pollInitialMs` / `pollMaxMs`**: Polling backoff bounds while MinerU extracts the PDF.
- **`maxAttempts`**: Max poll attempts, 1–1000.
- **`language`**: MinerU OCR/layout language hint.
- **`enableFormula` / `enableTable`**: Accepts `1/0`, `true/false`, `yes/no` (case-insensitive) via env.
- **`isOcr`**: Force OCR even for text-layer PDFs.
- **`modelVersion`**: MinerU model version identifier.

</details>

---

## 🌱 Environment variable quick reference

See [`.env.example`](../.env.example) at the repo root for a documentation-only list of all variables above. **This package does not read `.env` files itself** — export the variables through your shell, OS, or Pi's own environment configuration.

## 🔗 Ai4Scholar configuration

Ai4Scholar configuration remains owned by the directly reused `pi-ai4scholar` extension, independent of this file:

- `/ai4scholar setup`
- `AI4SCHOLAR_API_KEY` (legacy `AI4S_API_KEY`)
- `AI4SCHOLAR_BASE_URL`
- `AI4SCHOLAR_TIMEOUT_MS`
- and its proxy settings
