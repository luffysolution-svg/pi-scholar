# 📚 Pi Scholar

[![npm version](https://img.shields.io/npm/v/@luffysolution/pi-scholar.svg)](https://www.npmjs.com/package/@luffysolution/pi-scholar)
[![GitHub release](https://img.shields.io/github/v/release/luffysolution-svg/pi-scholar)](https://github.com/luffysolution-svg/pi-scholar/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/node/v/@luffysolution/pi-scholar.svg)](https://nodejs.org)

🌐 [简体中文](./README.md) ｜ **English**

Pi Scholar is an all-in-one research extension for Pi. One package provides online scholarly discovery, read-only local Zotero access, MinerU PDF parsing, citation and journal analysis, scientific figures, and on-demand MCP capabilities.

Output is ordinary UTF-8 Markdown, JSON metadata, and image files. No Obsidian plugin or database is required; point the output directory at an Obsidian vault if desired.

## ✨ Features

- Search Semantic Scholar, PubMed, Google Scholar, and Google Patents
- Inspect papers, authors, citation networks, recommendations, snippets, and datasets
- Query JCR/CAS journal metrics and recommend submission venues
- Read Zotero collections, items, notes, annotations, and attachments without mutation
- Parse PDF text, formulas, tables, and figures through MinerU
- Format references and automatically add citations to academic prose
- Generate, edit, critique, and vectorize scientific figures
- Discover and load hosted MCP tools on demand
- Enforce loopback-only Zotero access, secret redaction, safe ZIP extraction, and transactional publishing

## 📦 Install

Requires Node.js `>=22.19`, Pi `>=0.84.4`, and Zotero `7+`. Windows, macOS, and Linux are supported.

```sh
pi install npm:@luffysolution/pi-scholar
```

Pin a version or install from GitHub:

```sh
pi install npm:@luffysolution/pi-scholar@0.3.1
pi install git:https://github.com/luffysolution-svg/pi-scholar.git#main
```

Restart Pi or run `/reload`. Update or uninstall with:

```sh
pi update npm:@luffysolution/pi-scholar
pi remove npm:@luffysolution/pi-scholar
```

## 💬 One entry point: `/pi-scholar`

```text
/pi-scholar
/pi-scholar find photothermal hydrogen-production papers and match local Zotero
/pi-scholar parse Zotero item BIRUSQD5 and analyze figure 3
/pi-scholar add verified APA citations to this related-work section
```

With no arguments it opens an input dialog. With natural-language arguments it invokes the orchestrator skill directly, allowing the model to select only the online, local, parsing, citation, or figure tools needed.

Setup and status are handled by the same command:

```text
/pi-scholar setup       Configure the online-service API key
/pi-scholar status      Show configuration source and connection mode
/pi-scholar credits     Check online-service credits
/pi-scholar docs        Show the configuration documentation URL
/pi-scholar clear-key   Delete the locally stored key
```

The API key lives only in an environment variable or `~/.pi/agent/pi-scholar.credentials.json`; it is never written to project configuration, model messages, or parsed output.

## 🧠 Included skills

The package contains one orchestrator and five focused skills:

| Skill | Purpose |
|---|---|
| `pi-scholar` | Orchestrates multi-stage research requests |
| `scholar-search` | Online literature, patents, authors, citation networks, journals, and datasets |
| `zotero-research` | Local Zotero search, matching, notes, annotations, and attachments |
| `paper-reading` | MinerU parsing and close reading of text, formulas, tables, and figures |
| `academic-citation` | Citation verification, formatting, bibliographies, and automatic citation |
| `scientific-figure` | Scientific figure generation, editing, critique, and vectorization |

For everyday use, remember only `/pi-scholar`. Focused skills can also be invoked explicitly with `/skill:<name>`.

## 📁 Output layout

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

- `output.directory` is the vault or ordinary output root.
- `output.literaturesDirectory` renames `Literatures`, for example to `Papers` or another safe single directory name.
- Each paper is one transactional unit, making it safe to copy, move, archive, or delete with its metadata and figures.
- Reprocessing the same Zotero item reuses its directory; different items with the same readable name receive ` (2)`, ` (3)`, and so on.
- The asset directory is always the short name `assets`, with image names such as `figure-01.png`, so the paper title is not repeated in image paths.
- Paper directory names are shortened against the actual output root as needed, keeping final Markdown and image paths within 240 characters. The complete title remains in frontmatter and `metadata.json`.
- Markdown uses relative image paths, so moving the complete paper directory preserves rendering.

## ⚙️ Configuration

Copy [`pi-scholar.config.example.json`](./pi-scholar.config.example.json) to `pi-scholar.config.json`, or use a user-level location.

Discovery order:

1. File named by `PI_SCHOLAR_CONFIG`
2. Nearest `pi-scholar.config.json` in a trusted project
3. `~/.config/pi-scholar/config.json`
4. `~/.pi-scholar.json`
5. Built-in defaults

Environment variables always override JSON. Relative JSON paths resolve from the configuration file's directory.

> 📖 See the [full English configuration reference](./docs/CONFIGURATION.en.md) or [中文版](./docs/CONFIGURATION.md) for every field, default, range, and environment variable.

Enable “Allow other applications on this computer to communicate with Zotero” in Zotero. Never expose port `23119` externally.

## 🩺 Diagnostics

No Pi session is required:

```sh
npx @luffysolution/pi-scholar doctor
npx @luffysolution/pi-scholar --version
npx @luffysolution/pi-scholar --help
```

`doctor` checks Node, config discovery, Zotero reachability, and whether MinerU/online-service keys exist. It never displays secrets or reads library content.

<details>
<summary>🔒 Security and privacy</summary>

- Zotero requests are hard-restricted to `localhost:23119/api` or `127.0.0.1:23119/api`, GET-only, with redirects disabled.
- MinerU receives the selected PDF over the network; call it only when structured text, formulas, tables, or figures are required.
- API keys, Authorization headers, and signed URLs are never written to Markdown, YAML, metadata, or tool output.
- MinerU ZIPs are checked before writing for entry count, expanded size, encryption, symlinks, absolute paths, traversal, and duplicates.
- Each paper is written to a staging directory and atomically replaces the final directory; failure or cancellation restores prior content.
- Online search, automatic citation, MinerU, and figure operations may consume quota or credits.

</details>

## 🛠️ Development

```sh
npm install
npm test
npm run check
npm run pack:check
npm audit --omit=dev
```

Tests use mocks and temporary directories; they do not contact real services.

## 📄 License

[MIT](./LICENSE) © Pi Scholar contributors

See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for dependency notices.
