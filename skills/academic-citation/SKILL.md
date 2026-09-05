---
name: academic-citation
description: Verify, format, and insert scholarly citations with Pi Scholar. Use for APA, IEEE, GB/T 7714 and other reference styles, citation-network evidence, bibliography generation, or automatic citation insertion into academic prose.
---

# Academic citation

Do not invent references, identifiers, pages, or claims. A plausible title is not evidence that a paper exists or supports a statement.

## Workflow

1. Identify the requested citation style and whether the user needs a bibliography, in-text citations, evidence verification, or automatic insertion.
2. Use `ai4scholar_cite` when formatting a known Google Scholar result ID.
3. Use `ai4scholar_paper` citations/references or `ai4scholar_search` to verify identity and claim relevance before formatting uncertain sources.
4. Use `ai4scholar_auto_cite` only for 100–10,000 characters of supplied prose. Explain that it consumes credits and preserve the user's wording unless citation insertion requires minimal punctuation changes.
5. Check author order, title, venue, year, volume/issue/pages, DOI, and style-specific punctuation against returned evidence.
6. Separate verified references from candidates requiring manual confirmation.
7. Preserve the language and register of the user's text. Never strengthen claims beyond the cited evidence.
