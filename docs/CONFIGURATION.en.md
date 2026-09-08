# Pi Scholar configuration

[中文版](./CONFIGURATION.md)

Pi Scholar 1.0 uses `schemaVersion: 3`. Every keyed service accepts either:

- `apiKey`, which stores the key directly in JSON.
- `apiKeyEnv`, which names an environment variable read at runtime.

Resolution order is the direct `apiKey`, the variable named by `apiKeyEnv`, then the service's standard environment variable. A direct key is plaintext local data. Keep the file private and never commit it. The repository ignores `pi-scholar.config.json`, but user-level files still need normal filesystem protection.

## Minimal configuration

```json
{
  "schemaVersion": 3,
  "ai4scholar": { "apiKey": "YOUR_AI4SCHOLAR_API_KEY" },
  "research": {
    "policy": { "allowPaidFallback": false, "allowExternalFulltextUpload": false },
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
  "mineru": { "apiKey": "YOUR_MINERU_API_KEY" }
}
```

The complete template is [`pi-scholar.config.example.json`](../pi-scholar.config.example.json). Replace or remove every placeholder before using a copied file.

## Environment variables

Use `apiKeyEnv` when a custom variable name is preferred:

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

PowerShell, current session:

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

Bash or zsh:

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

Image providers also recognize `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`, `FAL_KEY`, `FAL_API_KEY`, `DASHSCOPE_API_KEY`, `QWENCLOUD_API_KEY`, and `ATLAS_API_KEY`. Vertex uses ADC or `GOOGLE_APPLICATION_CREDENTIALS`.

## Configuration discovery

The first available location wins:

1. The file named by `PI_SCHOLAR_CONFIG`.
2. The nearest `pi-scholar.config.json` above the working directory in a trusted project.
3. `~/.config/pi-scholar/config.json` (`%USERPROFILE%\.config\pi-scholar\config.json` on Windows).
4. `~/.pi-scholar.json`.
5. Built-in defaults.

Relative JSON paths resolve from the configuration file. Relative path environment variables resolve from the runtime working directory.

## Credential map

| Service | Configuration | Standard environment variable | Notes |
|---|---|---|---|
| Semantic Scholar | `research.providers.semantic-scholar` | `SEMANTIC_SCHOLAR_API_KEY` | Optional key for account quota |
| OpenAlex | `research.providers.openalex` | `OPENALEX_API_KEY` | Optional key |
| PubMed / PMC | `research.providers.pubmed` | `NCBI_API_KEY` | Optional key; PMC license checks still apply |
| arXiv | `research.providers.arxiv` | none | Rejects meaningless key fields |
| Crossref | `research.providers.crossref` | none | Optional contact metadata belongs in `research.contact` |
| Unpaywall | `research.providers.unpaywall` | none | Uses a `contact` email, not an API key |
| easyScholar | `research.providers.easyscholar` | `EASYSCHOLAR_SECRET_KEY` | Verified journal-rank endpoint only |
| Materials Project | `data.providers.materials-project` | `MP_API_KEY` | Shared by REST and the optional Python bridge |
| CAS Common Chemistry | `data.providers.cas-common-chemistry` | `CAS_API_KEY` | A stored key does not remove the public-contract block |
| Ai4Scholar | `ai4scholar` | `AI4SCHOLAR_API_KEY` | Preserved explicit tools; never an automatic paid fallback |
| MinerU | `mineru` | `MINERU_API_TOKEN` | Sends the selected PDF to MinerU |

`enabled` permits routing. It does not prove entitlement, quota, or property availability. `/pi-scholar status`, `research_sources`, and `materials_capabilities` are offline status checks and never reveal keys.

## Materials Project

`data.providers.materials-project` accepts:

| Field | Default | Use or range |
|---|---|---|
| `enabled` | `false` | Allows Materials tools to make requests |
| `apiKey` | none | Direct key |
| `apiKeyEnv` | `MP_API_KEY` | Custom environment-variable name |
| `timeoutMs` | `20000` | 1,000 to 120,000 ms |
| `maxRequests` / `maxPages` | `10` | Per-operation request bound |
| `maxResults` | `100` | Up to 10,000 records |
| `maxResponseBytes` | `5242880` | 1 KiB to 64 MiB |

Use `materials_search` for summary screening, `materials_get` for material-addressable properties, `materials_route_search` for task IDs, phonon identifiers, electrodes, substrates, synthesis, and other independent collections, and `materials_advanced` for fixed Python helpers or local derived calculations. See [`materials-capabilities.md`](./materials-capabilities.md) for MP01-MP17.

Complete band structures, DOS, phonon objects, structure helpers, and multicomponent phase diagrams require Python 3.11 or newer with the official packages:

```powershell
python -m pip install mp-api pymatgen
$env:PI_SCHOLAR_PYTHON = "C:\Path\To\python.exe"
```

```bash
python -m pip install mp-api pymatgen
export PI_SCHOLAR_PYTHON="/path/to/python"
```

The bridge accepts only fixed operations and JSON. It never executes caller-supplied Python, shell, or pickle. Phase diagrams retain thermo type and 0 K/0 atm provenance. Simulated XRD is labelled as local derived data, not an experiment.

## Ai4Scholar, MinerU, sync, and local files

Ai4Scholar also accepts `baseUrl`, `timeoutMs`, and `proxyUrl`; `proxyUrl` may be an HTTP(S) proxy or `direct`. Environment equivalents are `AI4SCHOLAR_BASE_URL`, `AI4SCHOLAR_TIMEOUT_MS`, `AI4SCHOLAR_PROXY`, and `AI4SCHOLAR_MCP_URL`. `/pi-scholar setup` writes a new key to the unified config. `clear-key` removes only `ai4scholar.apiKey`.

MinerU accepts `timeoutMs`, `pollInitialMs`, `pollMaxMs`, `maxAttempts`, `language`, `enableFormula`, `enableTable`, `isOcr`, and `modelVersion`. `MINERU_*` variables override these non-credential fields. Upload requires both `research.policy.allowExternalFulltextUpload` and authorization on the call.

The sync policies are fixed to `skip-and-report`, `preserve-local`, `three-way-merge`, and `when-required-and-authorized`. `sync.namespace` isolates libraries and `sync.cacheDir` selects the parse cache. Missing output is reported; restore, exclusion, and repair are separate actions. Metadata refresh does not retransmit the PDF.

`output.directory` defaults to `~/pi-scholar`. `literaturesDirectory`, `assetFilePrefix`, `filenameSeparator`, and `tagSpaceReplacement` control names. The corresponding `PI_SCHOLAR_*` path and naming variables may override JSON.

Zotero `baseUrl` must be exactly `http://localhost:23119/api` or `http://127.0.0.1:23119/api`. `timeoutMs` ranges from 1,000 to 120,000 ms and `maxItems` from 1 to 50,000. Do not expose port 23119 externally.

## Image providers

`media.providerOptions.<id>.apiKey` and `apiKeyEnv` follow the same precedence. Built-in adapters cover Gemini, Vertex, OpenAI, xAI, fal.ai, Qwen/DashScope, and Atlas, plus explicitly declared OpenAI-compatible services. See [`IMAGE_PROVIDERS.en.md`](./IMAGE_PROVIDERS.en.md) for model, size, connection-test, and field constraints.

## Validation

The loader rejects unknown fields, wrong types, unsafe paths, invalid URLs, and out-of-range values. Configuration files use `schemaVersion: 3`, with `apiKey` and `apiKeyEnv` as the credential fields. Verify a configuration with:

```sh
npx @luffysolution/pi-scholar doctor
```
