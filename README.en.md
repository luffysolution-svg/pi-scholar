# 📚 pi-scholar

[![npm version](https://img.shields.io/npm/v/@luffysolution/pi-scholar.svg)](https://www.npmjs.com/package/@luffysolution/pi-scholar)
[![GitHub release](https://img.shields.io/github/v/release/luffysolution-svg/pi-scholar)](https://github.com/luffysolution-svg/pi-scholar/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/node/v/@luffysolution/pi-scholar.svg)](https://nodejs.org)

🌐 [简体中文](./README.md) ｜ **English**

Pi-native TypeScript research workflow combining the tested `pi-ai4scholar` extension, read-only Zotero Desktop access, and MinerU's official Precision API. It writes ordinary UTF-8 Markdown and a sibling per-document `.assets` directory — **no Obsidian, Vault, plugin, or database required**.

> 📦 Published to npm as **`@luffysolution/pi-scholar`** (scoped) — the unscoped name `pi-scholar` is already taken by an unrelated package. All in-product names — the `/pi-scholar` command, the `pi-scholar` skill, `pi_scholar_parse`, and `pi-scholar.config.json` — are unaffected by the npm scope.

## ✨ Features

- 🔎 **Online search + local matching**: reuses `pi-ai4scholar` for online literature search/citation evidence, matched against your local Zotero library by DOI/title.
- 🗂️ **Full metadata aggregation**: `zotero_item` returns structured creators, dates, DOI/ISBN/ISSN, tags, notes, annotations, attachments, and the selected PDF in one call.
- 🧬 **Deep PDF parsing**: `pi_scholar_parse` calls the official MinerU API to recognize formulas/tables/layout and extract figures, publishing results safely.
- 📝 **Clean Markdown output**: compact YAML frontmatter plus a full-provenance `metadata.json` sidecar, with image paths that work out of the box (Obsidian-friendly, never Obsidian-dependent).
- 🔒 **Secure by default**: Zotero requests are hard-locked to loopback addresses, MinerU secrets are redacted everywhere, downloaded ZIPs are validated against path traversal/symlinks before extraction, and publishing is transactional.

## 📦 Install

**Requirements**: Node.js `>=22.19`, Pi `>=0.84.4`, Zotero `7+` with the Local API enabled, Windows / macOS / Linux.

```sh
pi install npm:@luffysolution/pi-scholar
pi install npm:@luffysolution/pi-scholar@0.1.2         # pinned version
pi install git:https://github.com/luffysolution-svg/pi-scholar.git#main
pi install ./path/to/pi-scholar                          # local persistent install
pi -e ./path/to/pi-scholar                                # temporary dev load
```

Restart Pi or run `/reload`, then verify these tools/commands are available: `zotero_collections`, `zotero_search`, `zotero_item`, `pi_scholar_parse`, the imported `ai4scholar_search` / `ai4scholar_paper` / `ai4scholar_cite`, and `/skill:pi-scholar`.

Update / uninstall:

```sh
pi update npm:@luffysolution/pi-scholar
pi remove npm:@luffysolution/pi-scholar
```

Installing the package already supplies its pinned/tested `pi-ai4scholar` dependency — imported exactly once, with no Ai4Scholar client source copied or reimplemented.

<details>
<summary>⚠️ Already have <code>pi-ai4scholar</code> installed standalone? Read this first</summary>

Pi loads every installed extension independently. If `pi-ai4scholar` is already installed as its own top-level extension, it and the copy bundled inside `pi-scholar` will both try to register the same `ai4scholar_*` tool names, and **Pi will refuse to load `pi-scholar` at all** ("Tool conflicts" errors).

Remove the standalone install first, then install/update `pi-scholar`:

```sh
pi remove npm:pi-ai4scholar
pi update npm:@luffysolution/pi-scholar
```

</details>

### 💬 `/pi-scholar` chat command

Once installed, type `/pi-scholar` inside Pi's chat.

- **With no arguments**: opens a one-line input dialog ("Pi Scholar: what do you want to research?").
- **With arguments** (e.g. `/pi-scholar find photothermal catalysis papers and match my local Zotero`): skips the dialog and runs immediately.

Either way, the command hands your request to the `pi-scholar` skill (equivalent to `/skill:pi-scholar ...`) through Pi's normal prompt-template expansion, so the model plans and calls `zotero_*` / `ai4scholar_*` / `pi_scholar_parse` under Pi's usual tool-permission flow — **the command itself never calls Zotero or MinerU directly**.

> In print/JSON/non-interactive Pi modes (`ctx.hasUI === false`) there is no dialog to fall back on; you must pass the request inline as an argument.

### 🩺 Setup diagnostics (`npx` / `npm`, no Pi required)

A small zero-dependency CLI ships alongside the extension for verifying your machine *before* or *after* installing into Pi. It only performs a bounded, read-only reachability probe and never touches Zotero data, and it cannot install or configure the Pi extension itself — only `pi install ...` does that.

```sh
npx @luffysolution/pi-scholar doctor     # Node version, config discovery, Zotero reachability, MinerU token presence
npx @luffysolution/pi-scholar --version
npx @luffysolution/pi-scholar --help
```

> 💡 Running `npx` from inside the `pi-scholar` project's own directory can trip up Node's local-resolution precedence; running it from any other directory works normally.

## ⚙️ Configuration

All configuration lives in **one JSON file** covering the Zotero connection, MinerU parsing behavior, output location, asset naming, and tag formatting. Copy [`pi-scholar.config.example.json`](./pi-scholar.config.example.json) to `pi-scholar.config.json` and edit as needed.

**Discovery order**: `PI_SCHOLAR_CONFIG` env var → nearest `pi-scholar.config.json` (trusted projects only) → `~/.config/pi-scholar/config.json` → `~/.pi-scholar.json` → built-in defaults. Environment variables always override the corresponding JSON fields.

> 📖 **For the full field reference — every option's default, valid range, and env var name — see [docs/CONFIGURATION.en.md](./docs/CONFIGURATION.en.md)（[中文](./docs/CONFIGURATION.md)）.**

Ai4Scholar configuration remains owned by that extension, independent of this file: `/ai4scholar setup`, `AI4SCHOLAR_API_KEY`, `AI4SCHOLAR_BASE_URL`, etc.

Don't forget to enable **Allow other applications on this computer to communicate with Zotero** in Zotero's settings. Zotero requests are unauthenticated loopback GETs only, with redirects disabled. Never expose port 23119 externally.

## 🔍 Behavior

<details>
<summary>Expand for detailed behavior notes</summary>

**`zotero_collections`** can list collections, read collection metadata, or list a collection's top-level items.

**`zotero_item`** maps raw records into one typed `Paper`: complete forward-compatible parent metadata, structured creators, original date/year, DOI/ISBN/ISSN, publication fields, tags/collections, child notes/attachments, PDF-child annotations, indexed-text availability, and the selected PDF. When a parent is clearly sparse, missing bibliographic fields are filled only if Zotero contains **exactly one** non-deleted item with the same normalized title and first author; the donor key, fields, and raw metadata are recorded for provenance. When no attachment key is supplied, PDFs are sorted by key and the first is selected and reported. Identifier matching uses normalized DOI first, then normalized title/year; **nothing is written back to Zotero**.

**`pi_scholar_parse`** validates `%PDF-`, hashes SHA-256, requests an official MinerU signed upload, uploads raw bytes with PUT, polls with bounded backoff, downloads and safely inspects the ZIP, repairs local image links, and transactionally publishes. Result names are `FirstAuthor+Year+Title.md`; missing components use `UnknownAuthor`, `UnknownYear`, or `Untitled`. Invalid cross-platform characters and the component separator `+` become spaces, reserved device names are prefixed, and UTF-8 length is bounded. Collisions use ` (2)`, ` (3)`, etc. — **never** a Zotero key. Reprocessing is recognized by the YAML `zotero://select/...` deep link (legacy `zotero_key` remains readable).

The YAML frontmatter is intentionally compact for note-property UIs: it contains only non-empty, commonly queried bibliographic fields plus Zotero/attachment identity and parse time. Null fields, raw objects, notes, annotations, attachment arrays, and verbose parser details are omitted. Complete path-safe provenance — including selected raw Zotero metadata, any exact-match enrichment donor, notes, annotations, attachments, and MinerU options — is written to the sibling `.assets/metadata.json`; indexed full text and local filesystem paths are not duplicated. Zotero and the selected PDF are exposed as clickable `zotero://select/...` and `zotero://open-pdf/...` frontmatter links. Images use explicit relative paths such as `![](<./<document>.assets/figure-01.jpg>)`, so spaces and Unicode render correctly in Obsidian when the Markdown and sibling asset directory are copied together. The directory suffix, image prefix, metadata filename, and document separator are all configurable. Frontmatter tags preserve their original form in the metadata sidecar while the Obsidian-facing values replace whitespace (default `-`) and unsupported punctuation; for example, `frustrated Lewis pairs` becomes `frustrated-Lewis-pairs` and `Ni/NiOx@C` becomes `Ni/NiOx-C`.

MinerU receives the PDF over the network; consult its privacy policy. MinerU and Ai4Scholar have quotas and may charge credits. Tokens, Authorization headers, and signed URLs are never put in output/YAML. Tool output is bounded to 50KB/2000 lines.

</details>

## 🔒 Security notes

- Zotero access is hard-restricted in code to `http://localhost:23119/api` or `http://127.0.0.1:23119/api`, GET-only, with redirects disabled — an extension-level compromise or misconfiguration cannot be used to reach an arbitrary host or mutate your library.
- MinerU requests must be HTTPS with no embedded credentials; signed upload/download URLs, bearer tokens, and raw error bodies are redacted from every thrown error and from tool output.
- The downloaded MinerU result archive is validated before extraction (central-directory inspection, entry-count/size caps, symlink/encrypted-entry rejection, path-traversal and absolute-path rejection, duplicate-entry rejection) before any file is written to disk.
- Publishing a parsed paper is transactional: work happens in a temporary staging directory, existing files are only replaced after the new content is fully written, and a crash or cancellation restores the prior state instead of leaving a partial `.md`/`.assets` pair.
- No dependency on this project's own registry account is required at runtime: `pi-ai4scholar` is pinned to an exact version and bundled, so a compromised or yanked upstream release cannot silently change behavior after install.

## 🛠️ Development

```sh
npm install
npm test
npm run check
npm run pack:check
npm pack --dry-run
```

Tests use mocks and temporary files; they do not contact Zotero or MinerU.

<details>
<summary>🚀 Release process (maintainers)</summary>

1. Bump `version` in `package.json`, update this README's install snippets if the version is pinned anywhere, and run `npm run prepublishOnly` locally (also runs automatically before `npm publish`).
2. Tag and push: `git tag vX.Y.Z && git push origin main --tags`, then create a GitHub Release from the tag (`gh release create vX.Y.Z --generate-notes`).
3. Publish to npm: `npm publish` (the package is scoped and marked `"publishConfig": {"access": "public"}`, so no extra `--access` flag is required).
4. Verify with `pi install npm:@luffysolution/pi-scholar@X.Y.Z` in a scratch Pi session before announcing.

</details>

## 📄 License

[MIT](./LICENSE) © pi-scholar contributors

Third-party dependency notices: [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
