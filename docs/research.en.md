# Literature Data Sources and Search

Pi Scholar includes a multi-source scholarly literature layer that aggregates major open academic APIs and search engines. Retrieved records are normalized into a unified format while retaining original identifiers, citation relationships, licenses, and raw provider payloads.

## Supported Data Sources

| Source | Core Capabilities | Notes and Tips |
|---|---|---|
| **Semantic Scholar** | Paper search, paper details, reference/citation graphs, recommendations | Free to use; adding an API key unlocks higher concurrency and daily request limits |
| **OpenAlex** | Institution/author lookup, multi-field structured filtering, global citation graph | Open access and community-driven; no API key needed for full functionality |
| **PubMed / PMC** | Biomedical literature search, open-access PMC full text discovery and retrieval | Free search; an optional NCBI API key improves rate limits; retrieves OA full text |
| **arXiv** | Computer science, physics, and math preprints; direct PDF retrieval | Free to use; resolves and downloads the exact versioned preprint PDF |
| **Crossref** | Authoritative DOI metadata lookup, publication updates, errata, and retractions | Ideal for completing publication year, volume, issue, and page numbers via DOI |
| **Unpaywall** | Resolves legal, free open-access full-text URLs and licenses by DOI | Requires a valid contact email in configuration (`contact`) |
| **easyScholar** | Quick lookup for journal ratings and JCR / CAS divisions | Requires your easyScholar `SecretKey` in configuration |

### Independent Add-on Services

- **Ai4Scholar**: Provides Google Scholar discovery, patent search, scholarly dataset lookup, and advanced workflows. These tools use the `ai4scholar_*` prefix and are called only when explicitly requested, preventing unexpected quota consumption.
- **CAS Common Chemistry**: Provides substance name, CAS Registry Number, and structure lookups in a dedicated chemistry module. See [CAS Common Chemistry](./chemistry.en.md) for details.

## Tool Set and Actions

The research module registers the following tools with Pi:

- `research_sources`: Inspect provider configuration, credentials, and capabilities offline without making network requests.
- `literature_search`: Search across enabled providers with support for year ranges, keywords, and open-access filtering.
- `literature_get`: Fetch detailed paper metadata using a provider-specific identifier (such as DOI, arXiv ID, or PMID).
- `literature_graph`: Fetch citation networks for a paper: `references`, `citations`, or `recommendations`.
- `journal_metrics`: Query journal metrics and ranking tiers (powered by easyScholar).
- `literature_fulltext`: Handle full-text paper resources with two explicit actions:
  - `action: "resolve"`: Look up open-access download URLs and license terms.
  - `action: "fetch"`: Download and locally cache paper full-text files (such as arXiv PDFs).

## Configuration Example

```json
{
  "schemaVersion": 3,
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

- Providers that accept keys support either environment variables (`apiKeyEnv`) or direct keys (`apiKey`).
- API keys for Semantic Scholar, OpenAlex, and PubMed are optional; the easyScholar `SecretKey` is required when enabled.
- Unpaywall requires a valid contact email, which can be configured via `research.contact` or `unpaywall.contact`.

## Network and Safety Notes

- All network requests connect directly to official provider HTTPS endpoints; redirects to unverified third-party hosts are rejected.
- API keys, authorization tokens, and credentials are automatically redacted from logs, outputs, and generated documents.
- Built-in request timeouts, page limits, and `Retry-After` pacing protect your access against upstream rate limiting.

## Official API Documentation

- [Semantic Scholar Graph API](https://api.semanticscholar.org/api-docs/graph)
- [OpenAlex API](https://docs.openalex.org/)
- [NCBI E-utilities and PMC OA](https://www.ncbi.nlm.nih.gov/books/NBK25497/)
- [arXiv API Manual](https://info.arxiv.org/help/api/user-manual.html)
- [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)
- [Unpaywall REST API](https://unpaywall.org/api)
- [easyScholar Journal Rank API](https://www.easyscholar.cc/open/getPublicationRank)
