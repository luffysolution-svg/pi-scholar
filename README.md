# pi-scholar

Pi-native TypeScript research workflow combining the tested `pi-ai4scholar` extension, read-only Zotero Desktop access, and MinerU's official Precision API. It writes ordinary UTF-8 Markdown and a sibling per-document `.assets` directory—no Obsidian, Vault, plugin, or database required.

Published to npm as **`@luffysolution/pi-scholar`** (the unscoped name `pi-scholar` is already taken by an unrelated package). All in-product names — the `/pi-scholar` command, the `pi-scholar` skill, `pi_scholar_parse`, and `pi-scholar.config.json` — are unaffected by the npm scope.

## Install

Requires Node.js **>=22.19**, Pi **>=0.84.4**, Zotero **7+** with the Local API enabled, and Windows/macOS/Linux.

```sh
pi install npm:@luffysolution/pi-scholar
pi install npm:@luffysolution/pi-scholar@0.1.0            # pinned
pi install git:https://github.com/luffysolution-svg/pi-scholar.git#main
pi install ./path/to/pi-scholar                            # local persistent install
pi -e ./path/to/pi-scholar                                 # temporary development load
```

Restart Pi or run `/reload`. Verify `zotero_collections`, `zotero_search`, `zotero_item`, `pi_scholar_parse`, imported `ai4scholar_search`/`ai4scholar_paper`/`ai4scholar_cite`, and `/skill:pi-scholar`. Update/uninstall with `pi update npm:@luffysolution/pi-scholar` and `pi remove npm:@luffysolution/pi-scholar`.

Installing the package already supplies its pinned/tested `pi-ai4scholar` dependency. The upstream extension is imported exactly once; no Ai4Scholar client source is copied or reimplemented.

### `/pi-scholar` command

Once installed, type `/pi-scholar` inside Pi's chat. With no arguments it opens a one-line input dialog ("Pi Scholar：你想研究什么？"); with arguments (e.g. `/pi-scholar 查找光热催化论文，并匹配本地 Zotero`) it skips the dialog. Either way it hands your request to the `pi-scholar` skill (`/skill:pi-scholar ...`) through Pi's normal prompt-template expansion, so the model plans and calls `zotero_*`/`ai4scholar_*`/`pi_scholar_parse` under Pi's usual tool-permission flow — the command itself never calls Zotero or MinerU directly. In print/JSON/non-interactive Pi modes (`ctx.hasUI === false`), you must pass the request inline as an argument; there is no dialog to fall back on.

### Setup diagnostics (`npx`/`npm`, no Pi required)

A small zero-dependency CLI ships alongside the extension for verifying your machine *before* or *after* installing into Pi. It never touches Zotero data beyond a bounded read-only reachability probe, and it cannot install or configure the Pi extension itself — only `pi install ...` does that.

```sh
npx @luffysolution/pi-scholar doctor     # Node version, config discovery, Zotero reachability, MinerU token presence
npx @luffysolution/pi-scholar --version
npx @luffysolution/pi-scholar --help
```

## Configuration

Use one JSON file for Zotero, MinerU behavior, output location, asset naming, and tag formatting; copy `pi-scholar.config.example.json` to `pi-scholar.config.json` (or a user-level location, see below) and edit it. **Never commit `pi-scholar.config.json`** — it is already covered by `.gitignore`.

### Discovery order

1. `PI_SCHOLAR_CONFIG` environment variable — an explicit path (must exist, or Pi refuses to start the tool).
2. The nearest `pi-scholar.config.json`, searched from the current working directory upward. Only used when the project directory is trusted by Pi (`ctx.isProjectTrusted()`), so an untrusted project cannot silently redirect output or the Zotero endpoint.
3. `~/.config/pi-scholar/config.json` (all platforms, including Windows — use `%USERPROFILE%\.config\pi-scholar\config.json`).
4. `~/.pi-scholar.json` as a last resort.
5. Built-in defaults if none of the above exist.

Relative `output.directory` and `zotero.dataDir` values resolve **relative to the config file's own directory**, not the current working directory. Environment variables (below) are read fresh on every tool call and always win over the JSON file, which is convenient for one-off overrides (e.g. CI, a temporary output directory) without editing the file.

### Full reference

```json
{
  "output": {
    "directory": "F:/个人知识库",
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

| Field | Env override | Default | Notes |
|---|---|---|---|
| `output.directory` | `PI_SCHOLAR_OUTPUT_DIR` | `~/pi-scholar` | Where `.md` files and `.assets` folders are published. May be an Obsidian vault folder, but Obsidian is never required. Resolved relative to the config file's directory when given as a relative path in JSON; resolved relative to `cwd` when given via the env var. |
| `output.filenameSeparator` | `PI_SCHOLAR_FILENAME_SEPARATOR` | `+` | 1–3 characters from `[+._ -]`, joins `Author`, `Year`, `Title` in generated filenames. |
| `output.assetsSuffix` | `PI_SCHOLAR_ASSETS_SUFFIX` | `.assets` | Sibling directory suffix, e.g. `Paper.assets/`. Must be a safe filename component (no path separators, max 64 UTF-8 bytes). |
| `output.assetFilePrefix` | `PI_SCHOLAR_ASSET_FILE_PREFIX` | `figure` | Extracted image basename prefix, e.g. `figure-01.png`. |
| `output.metadataFileName` | `PI_SCHOLAR_METADATA_FILE` | `metadata.json` | Sidecar filename inside the assets directory; must end in `.json`. |
| `output.tagSpaceReplacement` | `PI_SCHOLAR_TAG_SPACE_REPLACEMENT` | `-` | `-` or `_`; character substituted for whitespace/unsupported punctuation in Obsidian-facing tags only (the metadata sidecar keeps the original Zotero tag text). |
| `zotero.baseUrl` | `ZOTERO_BASE_URL` | `http://127.0.0.1:23119/api` | Must be exactly `http://localhost:23119/api` or `http://127.0.0.1:23119/api` — no other host, port, path, credentials, query, or fragment is accepted. This is enforced in code, not just documented. |
| `zotero.dataDir` | `ZOTERO_DATA_DIR` | none | Zotero's data directory (contains `storage/`), only needed as a fallback when Zotero's own `file/view/url` endpoint cannot resolve a managed attachment's path. |
| `zotero.timeoutMs` | `ZOTERO_TIMEOUT_MS` | `15000` | Per-request timeout, 1,000–120,000 ms. |
| `zotero.maxItems` | `ZOTERO_MAX_ITEMS` | `5000` | Upper bound on paged results per call, 1–50,000. |
| `mineru.tokenEnv` | — | `MINERU_API_TOKEN` | Names *which* environment variable holds the MinerU secret. The config file never stores the secret itself — only the variable name (must be uppercase, `[A-Z_][A-Z0-9_]*`). |
| — | `MINERU_API_TOKEN` (always checked) or the variable named by `mineru.tokenEnv` | none | The actual MinerU API token. Required only for `pi_scholar_parse`; every other tool works without it. |
| `mineru.timeoutMs` | `MINERU_TIMEOUT_MS` | `600000` | Overall extraction deadline, 10,000–3,600,000 ms. Individual HTTP attempts are separately capped at 60 s. |
| `mineru.pollInitialMs` / `mineru.pollMaxMs` | `MINERU_POLL_INITIAL_MS` / `MINERU_POLL_MAX_MS` | `3000` / `15000` | Polling backoff bounds while MinerU extracts the PDF. |
| `mineru.maxAttempts` | `MINERU_MAX_ATTEMPTS` | `120` | Max poll attempts, 1–1000. |
| `mineru.language` | `MINERU_LANGUAGE` | `en` | MinerU OCR/layout language hint. |
| `mineru.enableFormula` / `mineru.enableTable` | `MINERU_ENABLE_FORMULA` / `MINERU_ENABLE_TABLE` | `true` / `true` | Accepts `1/0`, `true/false`, `yes/no` (case-insensitive) via env. |
| `mineru.isOcr` | `MINERU_IS_OCR` | `false` | Force OCR even for text-layer PDFs. |
| `mineru.modelVersion` | `MINERU_MODEL_VERSION` | `vlm` | MinerU model version identifier. |

Every field is validated at load time (type, range, and — for filenames/URLs — safety checks); an invalid config file or environment variable throws a clear error instead of silently falling back. See `.env.example` for a documentation-only list of the same environment variables — **this package does not read `.env` files itself**; export the variables through your shell, OS, or Pi's own environment configuration.

Ai4Scholar configuration remains owned by the directly reused `pi-ai4scholar` extension: use `/ai4scholar setup`, `AI4SCHOLAR_API_KEY` (or legacy `AI4S_API_KEY`), `AI4SCHOLAR_BASE_URL`, `AI4SCHOLAR_TIMEOUT_MS`, and its proxy settings.

Enable **Allow other applications on this computer to communicate with Zotero** in Zotero settings. Zotero requests are unauthenticated loopback GETs only, with redirects disabled. Never expose port 23119 externally.

## Behavior

`zotero_collections` can list collections, read collection metadata, or list a collection's top-level items. `zotero_item` maps raw records into one typed `Paper`: complete forward-compatible parent metadata, structured creators, original date/year, DOI/ISBN/ISSN, publication fields, tags/collections, child notes/attachments, PDF-child annotations, indexed-text availability, and selected PDF. When a parent is clearly sparse, missing bibliographic fields are filled only if Zotero contains exactly one non-deleted item with the same normalized title and first author; the donor key, fields, and raw metadata are recorded for provenance. When no attachment key is supplied, PDFs are sorted by key and the first is selected and reported. Identifier matching uses normalized DOI first, then normalized title/year; nothing is written back to Zotero.

`pi_scholar_parse` validates `%PDF-`, hashes SHA-256, requests an official MinerU signed upload, uploads raw bytes with PUT, polls with bounded backoff, downloads and safely inspects the ZIP, repairs local image links, and transactionally publishes. Result names are `FirstAuthor+Year+Title.md`; missing components use `UnknownAuthor`, `UnknownYear`, or `Untitled`. Invalid cross-platform characters and component `+` signs become spaces, reserved device names are prefixed, and UTF-8 length is bounded. Collisions use ` (2)`, ` (3)`, etc.—never a Zotero key. Reprocessing is recognized by the YAML `zotero://select/...` deep link (legacy `zotero_key` remains readable).

The YAML frontmatter is intentionally compact for note-property UIs: it contains only non-empty, commonly queried bibliographic fields plus Zotero/attachment identity and parse time. Null fields, raw objects, notes, annotations, attachment arrays, and verbose parser details are omitted. Complete path-safe provenance—including selected raw Zotero metadata, any exact-match enrichment donor, notes, annotations, attachments, and MinerU options—is written to the sibling `.assets/metadata.json`; indexed full text and local filesystem paths are not duplicated. Zotero and the selected PDF are exposed as clickable `zotero://select/...` and `zotero://open-pdf/...` frontmatter links. Images use explicit relative paths such as `![](<./<document>.assets/figure-01.jpg>)`, so spaces and Unicode render correctly in Obsidian when the Markdown and sibling asset directory are copied together. The directory suffix, image prefix, metadata filename, and document separator are configurable. Frontmatter tags preserve their original form in the metadata sidecar while the Obsidian-facing values replace whitespace (default `-`) and unsupported punctuation; for example, `frustrated Lewis pairs` becomes `frustrated-Lewis-pairs` and `Ni/NiOx@C` becomes `Ni/NiOx-C`.

MinerU receives the PDF over the network; consult its privacy policy. MinerU and Ai4Scholar have quotas and may charge credits. Tokens, Authorization headers, and signed URLs are never put in output/YAML. Tool output is bounded to 50KB/2000 lines.

## Security notes

- Zotero access is hard-restricted in code to `http://localhost:23119/api` or `http://127.0.0.1:23119/api`, GET-only, with redirects disabled — an extension-level compromise or misconfiguration cannot be used to reach an arbitrary host or mutate your library.
- MinerU requests must be HTTPS with no embedded credentials; signed upload/download URLs, bearer tokens, and raw error bodies are redacted from every thrown error and from tool output.
- The downloaded MinerU result archive is validated before extraction (central-directory inspection, entry-count/size caps, symlink/encrypted-entry rejection, path-traversal and absolute-path rejection, duplicate-entry rejection) before any file is written to disk.
- Publishing a parsed paper is transactional: work happens in a temporary staging directory, existing files are only replaced after the new content is fully written, and a crash or cancellation restores the prior state instead of leaving a partial `.md`/`.assets` pair.
- No dependency on this project's own registry account is required at runtime: `pi-ai4scholar` is pinned to an exact version and bundled, so a compromised or yanked upstream release cannot silently change behavior after install.

## Development

```sh
npm install
npm test
npm run check
npm run pack:check
npm pack --dry-run
```

Tests use mocks and temporary files; they do not contact Zotero or MinerU.

## Release process

1. Bump `version` in `package.json`, update this README's install snippets if the version is pinned anywhere, and run `npm run prepublishOnly` locally (also runs automatically before `npm publish`).
2. Tag and push: `git tag vX.Y.Z && git push origin main --tags`, then create a GitHub Release from the tag (`gh release create vX.Y.Z --generate-notes`).
3. Publish to npm: `npm publish` (the package is scoped and marked `"publishConfig": {"access": "public"}`, so no extra `--access` flag is required).
4. Verify with `pi install npm:@luffysolution/pi-scholar@X.Y.Z` in a scratch Pi session before announcing.
