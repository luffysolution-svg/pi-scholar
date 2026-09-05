---
name: paper-reading
description: Parse and analyze a real local Zotero PDF with Pi Scholar and MinerU. Use when the task requires structured full text, formulas, tables, figures, captions, or close reading beyond metadata and Zotero notes.
---

# PDF parsing and close reading

MinerU receives the selected PDF over the network and may consume quota. Do not parse for metadata-only questions.

## Workflow

1. Resolve the parent item and intended PDF with `zotero_item` in aggregate mode. If multiple PDFs are plausible, require an explicit attachment key.
2. Reuse an existing parse only when the Zotero identity, `metadata.json` PDF SHA-256, terminal MinerU state, and relevant parser options match.
3. Otherwise call `pi_scholar_parse` once. Respect cancellation, timeout, authentication, quota, and unsafe-archive failures; never loop indefinitely.
4. The default output is `<vault>/Literatures/<paper>/<paper>.md`, `metadata.json`, and `assets/`. The `Literatures` component is configurable, while paper names are shortened when needed to keep final paths portable.
5. Read the generated Markdown progressively: headings first, then only sections needed for the question.
6. Inspect referenced figures in original order and distinguish visual observation from caption/author claims.
7. Use `metadata.json` for provenance, attachment identity, parser options, and hashes; do not expect verbose data in YAML frontmatter.
8. Cite exact sections, figures, tables, or equations when making paper-specific claims. State clearly when extraction quality limits confidence.
