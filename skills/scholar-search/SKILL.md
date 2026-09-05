---
name: scholar-search
description: Search scholarly literature, patents, authors, citation networks, recommendations, journal metrics, snippets, and datasets with Pi Scholar. Use for online discovery, evidence gathering, related-work exploration, journal selection, or when local Zotero coverage is insufficient.
---

# Scholarly discovery

Use Pi Scholar's online tools deliberately. Calls may consume credits; prefer the least expensive call that answers the request and never repeat a successful query without reason.

## Workflow

1. Clarify the topic, date range, source, and evidence threshold when ambiguity would materially change results.
2. Use `ai4scholar_search` for Semantic Scholar, PubMed, Google Scholar, or Google Patents. Start with a small result limit and refine before broadening.
3. Use `ai4scholar_paper` for details, citations, references, related papers, authors, or single-paper recommendations.
4. Use `ai4scholar_author` for author identity and publication history. Do not merge same-name authors without evidence.
5. Prefer `ai4scholar_batch` over repeated detail calls for multiple known IDs.
6. Use `ai4scholar_recommend` for seed-based discovery and `ai4scholar_snippets` for focused full-text evidence.
7. Use `ai4scholar_journal` for JCR/CAS metrics or submission recommendations. State the metric year/source returned by the service.
8. Use `ai4scholar_dataset` only for dataset-release work. Use `ai4scholar_mcp` only when direct tools do not cover the requested capability.
9. Report source, identifiers, matching uncertainty, and citation evidence. Never fabricate missing metadata.

For local-library matching after discovery, follow the `zotero-research` workflow. For formatted citations or citation insertion, follow `academic-citation`.
