# Pi Scholar configuration

[中文版](./CONFIGURATION.md)

The configuration schema version is `3`. Store a service key in `apiKey`, or use `apiKeyEnv` to name an environment variable.

Credentials are resolved in this order: `apiKey`, the variable named by `apiKeyEnv`, then the service's default environment variable. This repository ignores `pi-scholar.config.json`; exclude config files stored elsewhere before committing plaintext keys.

## Example

```json
{
  "schemaVersion": 3,
  "ai4scholar": {
    "apiKey": "YOUR_AI4SCHOLAR_API_KEY"
  },
  "research": {
    "policy": {
      "allowPaidFallback": false,
      "allowExternalFulltextUpload": false
    },
    "providers": {
      "semantic-scholar": { "enabled": true, "apiKey": "YOUR_SEMANTIC_SCHOLAR_API_KEY" },
      "openalex": { "enabled": true, "apiKey": "YOUR_OPENALEX_API_KEY" },
      "pubmed": { "enabled": true, "apiKey": "YOUR_NCBI_API_KEY" },
      "arxiv": { "enabled": true },
      "crossref": { "enabled": true },
      "unpaywall": { "enabled": true, "contact": "researcher@example.org" },
      "easyscholar": { "enabled": true, "apiKey": "YOUR_EASYSCHOLAR_SECRET_KEY" }
    }
  },
  "data": {
    "providers": {
      "materials-project": { "enabled": true, "apiKey": "YOUR_MATERIALS_PROJECT_API_KEY" },
      "cas-common-chemistry": { "enabled": true, "apiKey": "YOUR_CAS_COMMON_CHEMISTRY_API_KEY" }
    }
  },
  "mineru": {
    "apiKey": "YOUR_MINERU_API_KEY"
  }
}
```

All fields are listed in [`pi-scholar.config.example.json`](../pi-scholar.config.example.json).

## Environment variables

Set `apiKeyEnv` to the variable name:

```json
{
  "schemaVersion": 3,
  "data": {
    "providers": {
      "materials-project": { "enabled": true, "apiKeyEnv": "MY_MP_KEY" }
    }
  }
}
```

You can also set the standard variables directly.

PowerShell:
```powershell
$env:SEMANTIC_SCHOLAR_API_KEY = "YOUR_KEY"
$env:OPENALEX_API_KEY = "YOUR_KEY"
$env:NCBI_API_KEY = "YOUR_KEY"
$env:EASYSCHOLAR_SECRET_KEY = "YOUR_KEY"
$env:MP_API_KEY = "YOUR_KEY"
$env:CAS_API_KEY = "YOUR_KEY"
$env:AI4SCHOLAR_API_KEY = "YOUR_KEY"
$env:MINERU_API_TOKEN = "YOUR_KEY"
```

Bash / zsh:
```bash
export SEMANTIC_SCHOLAR_API_KEY="YOUR_KEY"
export OPENALEX_API_KEY="YOUR_KEY"
export NCBI_API_KEY="YOUR_KEY"
export EASYSCHOLAR_SECRET_KEY="YOUR_KEY"
export MP_API_KEY="YOUR_KEY"
export CAS_API_KEY="YOUR_KEY"
export AI4SCHOLAR_API_KEY="YOUR_KEY"
export MINERU_API_TOKEN="YOUR_KEY"
```

Image providers read `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`, `FAL_KEY`, `DASHSCOPE_API_KEY` (or `QWENCLOUD_API_KEY`), and `ATLAS_API_KEY`. Vertex AI supports Google Application Default Credentials (ADC) or a service-account JSON via `GOOGLE_APPLICATION_CREDENTIALS`.

## Config file discovery

Pi Scholar uses the first file found and does not merge files:

1. The file named by `PI_SCHOLAR_CONFIG`.
2. `pi-scholar.config.json` in the trusted project or one of its parent directories.
3. `~/.pi/agent/pi-scholar.json`, or `pi-scholar.json` under `PI_CODING_AGENT_DIR`.
4. `~/.config/pi-scholar/config.json`.
5. `~/.pi-scholar.json`.
6. Built-in defaults.

Relative paths are resolved from the directory containing the config file.

## Service credentials

| Service | Configuration Path | Standard Environment Variable | Notes |
|---|---|---|---|
| **Semantic Scholar** | `research.providers.semantic-scholar` | `SEMANTIC_SCHOLAR_API_KEY` | Key is optional; grants higher concurrency and daily limits |
| **OpenAlex** | `research.providers.openalex` | `OPENALEX_API_KEY` | Key is optional; open academic catalog |
| **PubMed / PMC** | `research.providers.pubmed` | `NCBI_API_KEY` | Key is optional; increases NCBI request rate limit |
| **arXiv** | `research.providers.arxiv` | None | Open preprint discovery without a key |
| **Crossref** | `research.providers.crossref` | None | Configure `research.contact` to use the Crossref polite pool |
| **Unpaywall** | `research.providers.unpaywall` | None | Requires a valid contact email in `contact` |
| **easyScholar** | `research.providers.easyscholar` | `EASYSCHOLAR_SECRET_KEY` | Requires SecretKey for journal tiers and rankings |
| **Materials Project** | `data.providers.materials-project` | `MP_API_KEY` | Shared between REST calls and optional Python bridge |
| **CAS Common Chemistry** | `data.providers.cas-common-chemistry` | `CAS_API_KEY` | Query endpoints are not implemented in this release |
| **Ai4Scholar** | `ai4scholar` | `AI4SCHOLAR_API_KEY` | Independent tool set invoked on demand |
| **MinerU** | `mineru` | `MINERU_API_TOKEN` | Deep parsing and structured extraction from PDFs |

`/pi-scholar status` reads local configuration and lists enabled services. It does not test remote access or balances, and it does not print keys.

## Materials Project

Configure Materials Project options under `data.providers.materials-project`:

| Option | Default | Description |
|---|---|---|
| `enabled` | `false` | Enables Materials Project tools |
| `apiKey` / `apiKeyEnv` | None / `MP_API_KEY` | API key or custom environment variable name |
| `timeoutMs` | `20000` | Request timeout in milliseconds, from 1,000 to 300,000 |
| `maxRequests` / `maxPages` | `10` | Page or sub-request limit per action |
| `maxResults` | `100` | Record limit per action, up to 10,000 |
| `maxResponseBytes` | `5242880` (5 MiB) | Response size limit |

### Optional Python bridge

Summary, structure, thermodynamics, and property queries use the REST API. Local phase-diagram and simulated-XRD operations require Python 3.11+, `mp-api`, and `pymatgen`:

```sh
pip install mp-api pymatgen
```

To specify an explicit Python binary:
```sh
export PI_SCHOLAR_PYTHON="/path/to/python"
# Windows PowerShell: $env:PI_SCHOLAR_PYTHON = "C:\Path\To\python.exe"
```

Phase diagrams and simulated XRD run locally and do not use additional Materials Project request quota. See [Materials capabilities](./materials-capabilities.en.md).

## Ai4Scholar and MinerU

- Ai4Scholar: `baseUrl` sets the service URL, `timeoutMs` sets the regular request timeout, `crawlerTimeoutMs` sets the Google Scholar and Google Patents timeout, and `proxyUrl` sets an HTTP/HTTPS proxy. Use `direct` to bypass proxies. Environment variables: `AI4SCHOLAR_BASE_URL`, `AI4SCHOLAR_TIMEOUT_MS`, `AI4SCHOLAR_CRAWLER_TIMEOUT_MS`, and `AI4SCHOLAR_PROXY`.
- MinerU: `timeoutMs` sets the overall deadline; `pollInitialMs`, `pollMaxMs`, and `maxAttempts` control polling; `language`, `enableFormula`, `enableTable`, `isOcr`, and `modelVersion` control parsing. Environment overrides use the `MINERU_*` prefix.

## Sync, Zotero, and output directories

```json
{
  "sync": {
    "missingPolicy": "skip-and-report",
    "conflictPolicy": "preserve-local",
    "metadataPolicy": "three-way-merge",
    "reparsePolicy": "when-required-and-authorized",
    "backupRetentionDays": 30
  },
  "output": {
    "directory": "~/pi-scholar",
    "literaturesDirectory": "Literatures",
    "assetFilePrefix": "figure-",
    "filenameSeparator": "-",
    "tagSpaceReplacement": "-"
  }
}
```

- Sync conflicts keep local edits. Metadata refreshes do not upload the PDF again.
- `output.directory` can point to an Obsidian vault. Each paper has its own directory; extracted images are stored under `assets`.
- Zotero uses `http://127.0.0.1:23119/api` by default. Enable "Allow other applications to communicate with Zotero" under Zotero Preferences > Advanced.

## Scientific image generation

The `media` section configures Gemini API, Vertex AI, OpenAI, xAI, fal.ai, Qwen/DashScope, Atlas, and custom OpenAI-compatible services. Available resolution, quality, reference-image, and transparency controls depend on the provider. See [Image providers](./IMAGE_PROVIDERS.en.md).

## Diagnostics

The diagnostic command checks config parsing, key presence, and the local Zotero connection:

```sh
npx @luffysolution/pi-scholar doctor
```
