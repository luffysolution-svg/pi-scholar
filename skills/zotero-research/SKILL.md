---
name: zotero-research
description: Search and inspect the user's local Zotero library with Pi Scholar. Use for collections, bibliographic metadata, local-paper matching, notes, annotations, attachments, indexed-text availability, or selecting a PDF without modifying Zotero.
---

# Local Zotero research

Treat Zotero as read-only. Never create, edit, move, tag, or delete library items.

## Workflow

1. Use `zotero_collections` to list collections, read one collection, or inspect its top-level items.
2. Use `zotero_search` with DOI first when available, then distinctive title terms. Optionally constrain by collection or item type. To browse all or recently modified top-level items, omit `query`; a literal `*` is treated as the same browse mode rather than a wildcard search.
3. Match normalized DOI first. Otherwise compare normalized title, year, and first author. Report ambiguous candidates instead of guessing.
4. Use `zotero_item` with `mode=aggregate` for the selected parent item. Inspect complete metadata, notes, PDF annotations, attachment paths, indexed-text status, and selected PDF.
5. If several PDFs exist, require or explain the selected attachment key. Do not assume similarly named attachments are identical.
6. Treat indexed-text unavailability as unknown content, not as an empty paper.
7. Inspect `pi_scholar_sync` status/plan before using `pi_scholar_parse`. Parsing is only for necessary structured full text, formulas, tables, or figures with authorized upload; bibliographic refreshes use local paths. A missing or excluded publication does not authorize re-import.

If Zotero is unavailable, ask the user to start Zotero and enable local application communication. Never suggest exposing port 23119 externally.
