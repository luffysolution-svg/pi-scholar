---
name: pi-scholar
description: Orchestrate end-to-end research with Pi Scholar across online discovery, local Zotero, PDF parsing, close reading, citations, journal selection, and scientific figures. Use for multi-step scholarly requests or whenever the correct specialized workflow is not yet clear.
---

# Pi Scholar orchestrator

This is the workflow behind `/pi-scholar`. Choose the smallest safe workflow that satisfies the request; do not call every available tool.

## Route by intent

- Online papers, patents, authors, related work, recommendations, journal metrics, snippets, or datasets: apply `scholar-search` guidance.
- Local Zotero collections, matching, metadata, notes, annotations, attachments, or PDF selection: apply `zotero-research` guidance.
- Structured PDF content, formulas, tables, figures, captions, or close reading: apply `paper-reading` guidance.
- Reference formatting, evidence verification, bibliography work, or citation insertion: apply `academic-citation` guidance.
- Figure generation, editing, composition, critique, iteration, or vectorization: apply `scientific-figure` guidance.

For multi-stage requests, use this default sequence:

1. Search online only when discovery is requested or local evidence is insufficient.
2. Match local Zotero records by DOI, then normalized title/year; never guess among ambiguous candidates.
3. Inspect the selected local item before parsing.
4. Upload to MinerU only when full text or visual structure is needed and no current hash-matching output exists.
5. Read generated content progressively and retain provenance.
6. Support external claims with verified identifiers/citation evidence.

## Safety and cost

- Never mutate Zotero.
- Zotero is local-only; never expose or redirect its API endpoint.
- Online search, citation, MinerU, MCP, and figure calls may consume quota or credits.
- MinerU sends the selected PDF to an external service. Avoid unnecessary uploads.
- Never place API keys, Authorization headers, signed URLs, or local PDF paths in answers or generated notes.
- Respect tool cancellation and bounded retries. Do not blindly retry authentication, malformed input, unsafe archives, or terminal service failures.

## Output contract

Default publication layout:

```text
<vault>/Literatures/<paper>/
├── <paper>.md
├── metadata.json
└── assets/
```

`output.literaturesDirectory` renames `Literatures`. Paper names are shortened as needed to keep final paths portable. YAML stays compact; complete path-safe provenance belongs in `metadata.json`.
