# Pi Scholar

[![npm version](https://img.shields.io/npm/v/@luffysolution/pi-scholar.svg)](https://www.npmjs.com/package/@luffysolution/pi-scholar)
[![GitHub release](https://img.shields.io/github/v/release/luffysolution-svg/pi-scholar)](https://github.com/luffysolution-svg/pi-scholar/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/node/v/@luffysolution/pi-scholar.svg)](https://nodejs.org)

[简体中文](./README.md) | English

Pi Scholar adds literature search, Zotero access, PDF parsing, citation tools, materials data, and scientific image generation to Pi. Models call these tools directly; MCP is not required.

Parsed papers are saved as UTF-8 Markdown, JSON, and image files. The output can be a regular directory or an Obsidian vault. See the [configuration reference](docs/CONFIGURATION.en.md).

## Features

- Search Semantic Scholar, OpenAlex, PubMed/PMC, arXiv, Crossref, and Google Scholar
- Fetch paper metadata, authors, citation graphs, snippets, patents, datasets, and journal metrics
- Find open-access copies and license information through Unpaywall
- Read Zotero collections, items, notes, annotations, and attachments without changing the Zotero library
- Extract PDF text, formulas, tables, and figures through MinerU
- Find citation candidates and format references
- Query and export Materials Project records, calculate phase diagrams, and simulate XRD
- Generate, edit, and vectorize scientific images through Ai4Scholar or a configured image provider

## Install

Requires Node.js `>=22.19`, Pi `>=0.84.4`, and Zotero `7+`. Windows, macOS, and Linux are supported.

```sh
pi install npm:@luffysolution/pi-scholar@latest
```

Pin a version or install from GitHub:

```sh
pi install npm:@luffysolution/pi-scholar@1.1.1
pi install git:github.com/luffysolution-svg/pi-scholar@main
```

Restart Pi or run `/reload`. To update or uninstall:

```sh
pi update npm:@luffysolution/pi-scholar@latest
pi remove npm:@luffysolution/pi-scholar
```

## Entry point: `/pi-scholar`

```text
/pi-scholar
/pi-scholar find photothermal hydrogen-production papers and match local Zotero
/pi-scholar parse Zotero item BIRUSQD5 and analyze figure 3
/pi-scholar add verified APA citations to this related-work section
```

With no arguments, the command opens an input box. With an argument, Pi Scholar chooses the search, Zotero, parsing, citation, or image tools needed for the request.

Store credentials in the config file or reference environment variables. The command does not write credentials. Status commands:

```text
/pi-scholar status      Show configuration source, connection mode, and image providers
/pi-scholar credits     Check online-service credits
/pi-scholar docs        Show the configuration documentation URL
```

Credential order is `apiKey`, the variable named by `apiKeyEnv`, then the service's default environment variable. Do not commit a config file containing a plaintext key.

Google Scholar and Google Patents requests through Ai4Scholar default to a 60-second timeout; other Ai4Scholar requests default to 30 seconds. See [Configuration](docs/CONFIGURATION.en.md) for overrides. Generated Ai4Scholar images are saved under `ai4scholar-images/` in the output directory and returned inline so the model can view them.

`ai4scholar_citation_candidates` searches Semantic Scholar for claims marked with `[CITE]` or supplied as statements. It returns candidates for review rather than selecting a citation on the user's behalf.

## Included skills

The package contains one orchestrator and seven focused skills:

| Skill | Purpose |
|---|---|
| `pi-scholar` | Orchestrates multi-stage research requests |
| `scholar-search` | Online literature, patents, authors, citation networks, journals, and datasets |
| `zotero-research` | Local Zotero search, matching, notes, annotations, and attachments |
| `paper-reading` | MinerU parsing and close reading of text, formulas, tables, and figures |
| `academic-citation` | Citation verification, formatting, bibliographies, and insertion |
| `scientific-figure` | Scientific figure generation, editing, critique, and vectorization |
| `materials-project` | Materials screening, structures, properties, calculation provenance, and export |
| `chemical-data` | CAS Common Chemistry names, CAS RN, structures, and basic substance data |

Use `/pi-scholar` for general requests or `/skill:<name>` when you want a specific workflow.

## Output layout

Default layout:

```text
<vault>/
└── Literatures/
    └── Yang-2024-Paper Title/
        ├── Yang-2024-Paper Title.md
        ├── metadata.json
        └── assets/
            ├── figure-01.png
            └── figure-02.png
```

- `output.directory` sets the output root.
- `output.literaturesDirectory` sets the paper directory name, such as `Literatures` or `Papers`. It must be a single path component.
- Reprocessing a Zotero item reuses its directory. Items with the same display name receive ` (2)`, ` (3)`, and so on.
- Images are stored under `assets` with names such as `figure-01.png`.
- Long directory names are shortened to keep Markdown and image paths within 240 characters. The full title remains in frontmatter and `metadata.json`.
- Markdown uses relative image paths, so a paper directory can be moved as a unit.

## Configuration

Copy [`pi-scholar.config.example.json`](./pi-scholar.config.example.json) to `pi-scholar.config.json`, or use a user-level location.

Discovery order:

1. File named by `PI_SCHOLAR_CONFIG`
2. `pi-scholar.config.json` in a trusted project or one of its parent directories
3. `~/.pi/agent/pi-scholar.json`
4. `~/.config/pi-scholar/config.json`
5. `~/.pi-scholar.json`
6. Built-in defaults

Direct credentials win and environment variables are fallbacks. Zotero and output-path environment variables can override JSON. Relative JSON paths resolve from the configuration file's directory.

Image tools support Gemini API, Vertex AI, OpenAI, xAI, fal.ai, Qwen/DashScope, Atlas, and custom OpenAI-compatible services. Editing modes, sizes, and output formats depend on the provider and model.

> See [Image Provider Compatibility](./docs/IMAGE_PROVIDERS.en.md) for models, controls, and platform limits.
>
> See the [full English configuration reference](./docs/CONFIGURATION.en.md) or [中文版](./docs/CONFIGURATION.md) for every field, default, range, and environment variable.

Enable “Allow other applications on this computer to communicate with Zotero” in Zotero. Keep port `23119` on the local machine.

## Diagnostics

No Pi session is required:

```sh
npx @luffysolution/pi-scholar doctor
npx @luffysolution/pi-scholar --version
npx @luffysolution/pi-scholar --help
```

`doctor` checks the Node version, config location, Zotero connection, and whether MinerU and Ai4Scholar credentials are present. It does not print keys or read library content.

<details>
<summary>Data and files</summary>

- Zotero tools send GET requests only to `localhost:23119/api` or `127.0.0.1:23119/api`.
- MinerU parsing uploads the PDF selected by the user.
- Keys, authorization headers, and signed URLs are excluded from Markdown, YAML, and logs.
- MinerU archives are checked for unsafe paths and size before extraction.
- Paper files are written to a temporary directory before replacing the destination; interrupted writes leave the previous directory in place.
- Online search, MinerU, and image generation may use provider quota or credits.

</details>

## Development

```sh
npm install
npm test
npm run check
npm run pack:check
npm audit --omit=dev
```

Tests use mocks and temporary directories; they do not contact real services.

## License

[MIT](./LICENSE) © Pi Scholar contributors

See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for dependency notices.
