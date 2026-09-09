# Literature sources and search

[中文版](./research.md)

Pi Scholar converts records from different providers into one paper schema while retaining provider identifiers, citation links, license data, and raw responses.

## Sources

| Source | Available operations | Configuration |
|---|---|---|
| Semantic Scholar | Search, paper metadata, citation graph, recommendations | API key optional; authenticated limits are set by the provider |
| OpenAlex | Papers, authors, institutions, structured filters | API key optional |
| PubMed / PMC | Biomedical search and PMC open full text | NCBI key optional; a key raises the request rate |
| arXiv | Preprint search and versioned PDFs | No key |
| Crossref | DOI metadata, updates, corrections, and retractions | No key; contact email supported |
| Unpaywall | Open-access locations and licenses for a DOI | Requires a `contact` email |
| easyScholar | Journal tiers, JCR, and CAS rankings | Requires a `SecretKey` |

### Other data services

Tools prefixed with `ai4scholar_*` cover Google Scholar, Google Patents, Semantic Scholar, PubMed, journals, and datasets through Ai4Scholar. Calls may use Ai4Scholar credits. Credentials are configured via top-level `ai4scholar.apiKey`, `ai4scholar.apiKeyEnv`, or the `AI4SCHOLAR_API_KEY` environment variable.

CAS Common Chemistry uses a separate substance record. See [Chemical data source](./chemistry.en.md).

## Tools

- `research_sources`: show configured sources and their available operations without a network request.
- `literature_search`: search selected sources with year and open-access filters.
- `literature_get`: fetch metadata by DOI, arXiv ID, PMID, or provider ID.
- `literature_graph`: fetch references, citations, or recommendations.
- `journal_metrics`: fetch journal metrics and ranking data.
- `literature_fulltext`: use `resolve` to return a full-text location and license, or `fetch` to download and cache the file.
- `ai4scholar_*`: Ai4Scholar tool suite, including `ai4scholar_search`, `ai4scholar_paper`, `ai4scholar_author`, `ai4scholar_batch`, `ai4scholar_recommend`, `ai4scholar_cite`, `ai4scholar_snippets`, `ai4scholar_citation_candidates`, `ai4scholar_dataset`, `ai4scholar_journal`, `ai4scholar_figure`, and `ai4scholar_credits`.

## Configuration

```json
{
  "schemaVersion": 3,
  "ai4scholar": {
    "apiKeyEnv": "AI4SCHOLAR_API_KEY"
  },
  "research": {
    "policy": {
      "allowPaidFallback": false,
      "allowExternalFulltextUpload": false
    },
    "contact": "your-email@example.org",
    "providers": {
      "semantic-scholar": { "enabled": true, "apiKeyEnv": "SEMANTIC_SCHOLAR_API_KEY" },
      "openalex": { "enabled": true, "apiKeyEnv": "OPENALEX_API_KEY" },
      "pubmed": { "enabled": true, "apiKeyEnv": "NCBI_API_KEY" },
      "arxiv": { "enabled": true },
      "crossref": { "enabled": true },
      "unpaywall": { "enabled": true },
      "easyscholar": { "enabled": false, "apiKeyEnv": "EASYSCHOLAR_SECRET_KEY" }
    }
  }
}
```

`apiKey` stores a key directly. `apiKeyEnv` names an environment variable. Keys are optional for Semantic Scholar, OpenAlex, and PubMed. easyScholar requires a `SecretKey`. Ai4Scholar is configured under the top-level `ai4scholar` block. Set the Unpaywall email in `research.contact` or `unpaywall.contact`.

## Request behavior

The literature module connects to provider HTTPS endpoints and rejects cross-origin redirects. Logs and generated files redact keys and authorization headers. Requests have time, page, and result limits. When a provider returns `Retry-After`, the client waits for that interval.

## API documentation

- [Semantic Scholar Graph API](https://api.semanticscholar.org/api-docs/graph)
- [OpenAlex API](https://docs.openalex.org/)
- [NCBI E-utilities and PMC OA](https://www.ncbi.nlm.nih.gov/books/NBK25497/)
- [arXiv API manual](https://info.arxiv.org/help/api/user-manual.html)
- [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)
- [Unpaywall REST API](https://unpaywall.org/api)
- [easyScholar journal rank API](https://www.easyscholar.cc/open/getPublicationRank)
- [Ai4Scholar API Documentation](https://ai4scholar.net/api-docs)
