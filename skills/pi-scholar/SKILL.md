---
name: pi-scholar
description: End-to-end scholarly search, local Zotero matching, complete paper inspection, optional MinerU PDF parsing, full-text/figure analysis, and evidence-backed citation.
---

# Pi Scholar workflow

Users may reach this skill either directly (`/skill:pi-scholar <request>`) or through the friendlier `/pi-scholar` command, which opens a one-line input dialog when called with no arguments and otherwise forwards the typed request here verbatim via prompt-template expansion. Treat both entry points identically.

Use progressive disclosure: inspect summaries and paths first, then read only the generated sections/assets needed for the question. Never mutate Zotero. Output is plain Markdown with relative assets; an Obsidian vault may be selected as the configured directory, but no Obsidian API or plugin is required.

## Preconditions

- Zotero Desktop is running, its Local API communication option is enabled, and the desired PDF is locally readable.
- Ai4Scholar is configured (`/ai4scholar setup` or environment) and may consume credits.
- MinerU parsing requires `MINERU_API_TOKEN`, network access/quota, and a writable configured output directory; uploading sends the PDF to MinerU.
- Configuration is discovered from `PI_SCHOLAR_CONFIG`, a nearby `pi-scholar.config.json`, or the user-level config; environment variables override it. Reload Pi after changes.

## Tools and I/O

- `ai4scholar_search`: requires source/query; returns online candidates. Network/credits apply.
- `ai4scholar_paper` and `ai4scholar_cite`: require the upstream identifier/citation inputs; return detail/citation evidence. Network/credits apply.
- `zotero_collections`: `action=list` (optional limit), `action=read` plus an 8-character key for metadata, or `action=items` plus key/optional limit for top-level collection items.
- `zotero_search`: requires query; optional collectionKey, itemType, limit; returns read-only local candidates.
- `zotero_item`: requires key and mode (`item` or `aggregate`); aggregate accepts optional attachmentKey and returns normalized metadata, notes, annotations, attachments, indexed-text availability, paths, and selected PDF.
- `pi_scholar_parse`: requires bibliographic key and optional attachmentKey; uploads to MinerU and returns Markdown/assets paths, SHA-256, batch ID, state, and timestamp. Generated content is saved, not returned.

## End-to-end sequence

1. Formulate the literature query and call `ai4scholar_search`; use `ai4scholar_paper` for likely online records.
2. Call `zotero_search` with DOI where available, then title terms. Match DOI first. Otherwise compare normalized title and year. Report multiple/weak matches; do not guess.
3. Call `zotero_item` in `aggregate` mode for the selected local parent. Inspect complete metadata, notes, PDF-child annotations, attachment paths, indexed-text status, and any exact local duplicate used to enrich a sparse record.
4. If several PDFs exist, ask/select the intended attachment key; absent an explicit choice, the adapter reports its deterministic lowest-key selection.
5. Skip parsing for metadata-only work. Reuse generated output only when its compact YAML `zotero` deep link and metadata sidecar `pdf.sha256`, terminal `mineru.state`, and options match the current PDF/configuration. Parse when layout, formulas, tables, or figures are required and no current result exists. Reparse after hash/config changes.
6. Read only relevant sections of the saved Markdown and referenced relative assets. Use the configured asset suffix and metadata filename (defaults: `scholar-assets/metadata.json`) for verbose provenance rather than expecting it in frontmatter. Analyze headings, formulas, tables, images, and captions in their original order.
7. Support online claims with `ai4scholar_cite`/detail tools. Never fabricate unavailable references.

## Failures and retries

- No local match: continue with online evidence or refine search; do not create a Zotero item.
- Ambiguous match/multiple PDFs: report candidates and require a deliberate key.
- Zotero unavailable/API disabled/no PDF/indexed text unavailable/unresolved storage: start Zotero, enable communication, download the attachment, select a PDF, or configure `ZOTERO_DATA_DIR`; indexed text absence is not empty text.
- Upload/network/5xx/429: the client makes bounded backoff retries (honoring Retry-After when present). Retry later after quota/rate limits; never loop indefinitely.
- Authentication/input/terminal parse failure/malformed or unsafe archive: fix credentials/input or inspect the service error; do not blindly retry.
- Poll timeout: check MinerU later and retry once if appropriate. Cancellation/failure publishes no partial final result and preserves an existing parse.
- Stale hash: reparse before relying on full text or figures.
