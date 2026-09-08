# Literature and research data sources

`src/research` is limited to Semantic Scholar, OpenAlex, PubMed/PMC, arXiv, Crossref, Unpaywall, and the easyScholar journal-rank endpoint. Literature records use `LiteratureRecord` while preserving provider identifiers, retrieval time, licenses, and raw provenance.

| Source | Capabilities | Boundary |
| --- | --- | --- |
| Semantic Scholar | Search, lookup, references, citations, recommendations | Graph permissions and quotas remain account-specific |
| OpenAlex | Search, structured filters, lookup, authors/institutions, references and citation relations | A key is optional and only increases quota |
| PubMed / PMC | PubMed search/lookup/links; PMC OA license check, resolution, and XML retrieval | Full text is fetched only after an explicit OA license is returned |
| arXiv | Atom search, version-preserving lookup, abstracts, PDF resolution and retrieval | Follow the official pacing guidance; peer-review status is not inferred |
| Crossref | DOI search/lookup, metadata completion, references, and preserved update/retraction relations | Metadata is not full-text authorization |
| Unpaywall | DOI-based OA status, version, license, and location resolution | Resolves locations only; it does not download or grant content rights |
| easyScholar | Journal rank and partition enhancement (`getPublicationRank`) | Requires `SecretKey`; only this endpoint is claimed |

The existing `ai4scholar_*` service and tools remain intact for explicitly selected Google Scholar, patent, dataset, journal, and advanced workflows. Ai4Scholar is outside the first-party registry above and is never called—or charged—as an automatic fallback when another source fails.

CAS Common Chemistry is an independent `src/chemistry` data boundary using `ChemicalRecord`; it is not a literature provider. CAS API access and endpoint terms require provider approval, so its client is currently `contract_blocked` / `permission_required` and does not guess routes. Its eventual scope is substance names, CAS RNs, structures, and basic information only—not literature, reactions, or SciFinder search.

## Tools and safety

`research_sources` is a side-effect-free status query. `literature_search`, `literature_get`, `literature_graph`, `journal_metrics`, and `literature_fulltext` are capability-gated; full-text `resolve` and `fetch` are separate actions.

`chemical_sources`, `chemical_search`, and `chemical_get` are separate chemical-data tools. They read `data.providers["cas-common-chemistry"]` and make no request while the CAS contract is blocked.

Only official HTTPS hosts are allowed. Credentials are environment-variable names, never stored secrets. The Unpaywall contact email comes from `research.contact` or the provider `contact` and is redacted from URLs and diagnostics. GET requests use bounded retries with `Retry-After`; POST is not retried by default. Timeouts, request/page budgets, and response-body limits are enforced, with recursive redaction of headers, URLs, pagination tokens, and response fields.

## Configuration

```json
{
  "research": {
    "policy": { "allowPaidFallback": false, "allowExternalFulltextUpload": false },
    "contact": "you@example.org",
    "providers": {
      "semantic-scholar": { "enabled": true, "credentialEnv": "SEMANTIC_SCHOLAR_API_KEY" },
      "openalex": { "enabled": true, "credentialEnv": "OPENALEX_API_KEY" },
      "pubmed": { "enabled": true, "credentialEnv": "NCBI_API_KEY" },
      "arxiv": { "enabled": true },
      "crossref": { "enabled": true },
      "unpaywall": { "enabled": true },
      "easyscholar": { "enabled": false, "credentialEnv": "EASYSCHOLAR_SECRET_KEY" }
    }
  }
}
```

Key variable names are stored only as environment references. Keys are optional for Semantic Scholar, OpenAlex, and PubMed; the easyScholar SecretKey is required. A missing contact email makes an Unpaywall request fail explicitly before execution.

## Official contracts

- [Semantic Scholar Graph API](https://api.semanticscholar.org/api-docs/graph)
- [OpenAlex API](https://docs.openalex.org/)
- [NCBI E-utilities and PMC OA](https://www.ncbi.nlm.nih.gov/books/NBK25497/)
- [arXiv API manual](https://info.arxiv.org/help/api/user-manual.html)
- [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)
- [Unpaywall REST API](https://unpaywall.org/api)
- [easyScholar journal-rank endpoint](https://www.easyscholar.cc/open/getPublicationRank)
- [CAS Common Chemistry API](https://www.cas.org/services/commonchemistry-api)

## Production acceptance

Bounded live checks on 2026-09-08 passed for Semantic Scholar, OpenAlex, arXiv, Crossref, Unpaywall, easyScholar, and Materials Project. PubMed/PMC failed during TLS/DNS connection setup on the test host before any NCBI HTTP response; its adapter remains covered by mocked contract tests and was not redirected to an unofficial endpoint. CAS remains blocked before networking because its public contract is insufficient. Runtime status does not treat this acceptance run as proof of another user's entitlement or quota.
