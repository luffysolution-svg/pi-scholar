---
name: paper-reading
description: Parse and analyze a local Zotero PDF with Pi Scholar and MinerU. Use when the task requires structured full text, formulas, tables, figures, captions, or close reading beyond metadata and Zotero notes.
license: MIT
compatibility: Requires Pi 0.84.4 or newer, the @luffysolution/pi-scholar package, Zotero 7, network access, and MinerU credentials.
---

# PDF parsing and close reading

MinerU receives the selected PDF over the network and may consume quota. Do not parse for metadata-only questions.

## Workflow

1. Resolve the parent item and intended PDF with `zotero_item` in aggregate mode. If multiple PDFs are plausible, require an explicit attachment key.
2. Use `pi_scholar_sync` status/plan to let the runtime check publication identity, hashes, generated baselines, and cache validity. Reuse valid local content; metadata-only changes do not require parsing.
3. Apply the appropriate plan or call the compatible `pi_scholar_parse` entrypoint. External upload needs user authorization and applicable content permission. Do not set force flags to bypass a conflict. Respect cancellation, quota, and ambiguous submissions; never automatically resubmit an uncertain remote task.
4. The default output is `<vault>/Literatures/<paper>/<paper>.md`, `metadata.json`, and `assets/`. The `Literatures` component is configurable, while paper names are shortened when needed to keep final paths portable.
5. Read the generated Markdown progressively: headings first, then only sections needed for the question.
6. Inspect referenced figures in original order and distinguish visual observation from caption/author claims.
7. Use `metadata.json` for provenance, attachment identity, parser options, and hashes; do not expect verbose data in YAML frontmatter.
8. Cite exact sections, figures, tables, or equations when making paper-specific claims. State clearly when extraction quality limits confidence.

Read [sync.md](references/sync.md) when files are missing, changed, excluded, or require recovery.
