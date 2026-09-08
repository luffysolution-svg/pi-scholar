# Pi Scholar Configuration Guide

[中文版](./CONFIGURATION.md)

Pi Scholar 1.0 uses a `schemaVersion: 3` configuration file. Keyed services support two credential approaches:

- `apiKey`: Enter the API key directly in the configuration file.
- `apiKeyEnv`: Specify a custom environment variable name to be read at runtime.

**Resolution Precedence**: When multiple credential sources are provided for the same service, Pi Scholar resolves them in this order: `apiKey` → custom environment variable from `apiKeyEnv` → the service's default standard environment variable.

> Tip: If your configuration file contains plain-text API keys, store it securely. The repository root ignores `pi-scholar.config.json` by default to prevent committing keys into version control.

## Quick-Start Example

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

A complete configuration template is available in [`pi-scholar.config.example.json`](../pi-scholar.config.example.json).

## Using Environment Variables

If you prefer keeping credentials in environment variables, set the service's `apiKeyEnv` field to your variable name:

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

You can also export each service's standard environment variable directly:

**PowerShell**:
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

**Bash / zsh**:
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

Image provider environment variables include `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`, `FAL_KEY`, `DASHSCOPE_API_KEY` (or `QWENCLOUD_API_KEY`), and `ATLAS_API_KEY`. Vertex AI supports Google Application Default Credentials (ADC) or a service-account JSON via `GOOGLE_APPLICATION_CREDENTIALS`.

## Configuration Discovery Order

During startup, Pi Scholar searches for the first available configuration file in this order:

1. The path specified by the `PI_SCHOLAR_CONFIG` environment variable.
2. `pi-scholar.config.json` found in the current trusted project or its parent directories.
3. User global directory: `~/.config/pi-scholar/config.json` (on Windows: `%USERPROFILE%\.config\pi-scholar\config.json`).
4. User home root: `~/.pi-scholar.json`.
5. Built-in defaults.

Relative paths in configuration files resolve from the directory containing that configuration file.

## Service Credentials Summary

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
| **CAS Common Chemistry** | `data.providers.cas-common-chemistry` | `CAS_API_KEY` | Key can be stored; ready for use when official API opens |
| **Ai4Scholar** | `ai4scholar` | `AI4SCHOLAR_API_KEY` | Independent tool set invoked on demand |
| **MinerU** | `mineru` | `MINERU_API_TOKEN` | Deep parsing and structured extraction from PDFs |

The `/pi-scholar status` command inspects local setup without sending unprompted requests across the network, keeping credentials private.

## Materials Project Configuration

Configure Materials Project options under `data.providers.materials-project`:

| Option | Default | Description |
|---|---|---|
| `enabled` | `false` | Enables Materials Project tools |
| `apiKey` / `apiKeyEnv` | None / `MP_API_KEY` | API key or custom environment variable name |
| `timeoutMs` | `20000` | Network timeout in milliseconds (1,000–120,000) |
| `maxRequests` / `maxPages` | `10` | Maximum pages or sub-requests allowed per action |
| `maxResults` | `100` | Maximum records returned per operation (up to 10,000) |
| `maxResponseBytes` | `5242880` (5 MiB) | Maximum response size limit to prevent memory bloat |

### Python Bridge (Optional)

Basic Materials Project REST search (such as summary screening, structure fetching, thermodynamics, and properties) works with zero extra dependencies.

If you want to compute **complete band structures, density of states (DOS), phonon dispersions, phase diagrams, or simulated XRD patterns**, install Python 3.11+ along with the official packages:

```sh
pip install mp-api pymatgen
```

To specify an explicit Python binary:
```sh
export PI_SCHOLAR_PYTHON="/path/to/python"
# Windows PowerShell: $env:PI_SCHOLAR_PYTHON = "C:\Path\To\python.exe"
```

Phase diagram derivation and simulated XRD run locally using theoretical parameters and do not consume remote API quota. See [Materials Capabilities](./materials-capabilities.md) for the complete capability matrix.

## Ai4Scholar and MinerU Options

- **Ai4Scholar**: Supports `baseUrl`, `timeoutMs`, and `proxyUrl` (supports HTTP/HTTPS proxy URLs or `direct`). Matching environment variables are `AI4SCHOLAR_BASE_URL`, `AI4SCHOLAR_TIMEOUT_MS`, and `AI4SCHOLAR_PROXY`.
- **MinerU**: Supports `timeoutMs`, polling backoff (`pollInitialMs`, `pollMaxMs`, `maxAttempts`), and parsing switches: `language`, `enableFormula`, `enableTable`, `isOcr`, and `modelVersion` (defaults to `vlm`). `MINERU_*` environment variables can override these options.

## Sync, Zotero, and Output Directories

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

- **Safe Sync**: Synchronization prioritizes local user edits. Conflicts preserve local changes, and metadata refreshes do not re-upload the original PDF, saving network and parsing costs.
- **Output Management**: `output.directory` can point directly at an Obsidian vault. Each paper is stored in its own directory, with extracted figures organized in a subfolder named `assets`.
- **Zotero Setup**: The default local Zotero loopback address is `http://127.0.0.1:23119/api` (enabled in Zotero Preferences → Advanced → "Allow other applications to communicate with Zotero").

## Scientific Image Generation

Configure image generation providers under `media` for Gemini API, Vertex AI, OpenAI, xAI, fal.ai, Qwen/DashScope, Atlas, or custom OpenAI-compatible services. You can customize resolution, quality, aspect ratio, reference images, and transparency. See [Image Providers](./IMAGE_PROVIDERS.en.md) for full compatibility details.

## Self-Check and Diagnostics

After updating your configuration, run the built-in diagnostic tool to verify local setup and connectivity:

```sh
npx @luffysolution/pi-scholar doctor
```
