import { ResearchError } from "../errors.js";
import { appendQuery, requestBytes, requestJson, requestText } from "../network.js";
import type { ProviderConfig, ResearchConfig } from "../config.js";
import type { LiteratureProvider, LiteratureRecord, ProviderCapability, ProviderStatus, ResearchSearchRequest, ResearchSearchResult } from "../types.js";
import { SaxesParser } from "saxes";
import { resolveApiKey } from "../../credentials.js";

const DOCS = {
  "semantic-scholar": "https://api.semanticscholar.org/api-docs/graph",
  crossref: "https://www.crossref.org/documentation/retrieve-metadata/rest-api/",
  pubmed: "https://www.ncbi.nlm.nih.gov/sites/books/NBK25497/",
  arxiv: "https://info.arxiv.org/help/api/user-manual.html",
  openalex: "https://help.openalex.org/api/",
  unpaywall: "https://unpaywall.org/api",
  easyscholar: "https://www.easyscholar.cc/open/getPublicationRank",
} as const;

function cap(id: ProviderCapability["id"], docs: string, status: ProviderCapability["implementationStatus"] = "implemented", notes?: string): ProviderCapability { return { id, docs, implementationStatus: status, notes }; }
function source(provider: string, config: ProviderConfig, capabilities: ProviderCapability[], paid: boolean, limitations: string[] = []): ProviderStatus {
  const env = config.apiKeyEnv;
  const configured = Boolean(resolveApiKey(config, process.env, provider === "semantic-scholar" ? ["SEMANTIC_SCHOLAR_API_KEY"] : provider === "openalex" ? ["OPENALEX_API_KEY"] : provider === "pubmed" ? ["NCBI_API_KEY"] : provider === "easyscholar" ? ["EASYSCHOLAR_SECRET_KEY"] : []));
  const blocked = capabilities.some((item) => item.implementationStatus === "contract_blocked");
  const credentialRequired = provider === "easyscholar";
  const contactMissing = provider === "unpaywall" && !config.contact?.trim();
  return { id: provider, name: provider, enabled: config.enabled === true, paid, implementationStatus: blocked ? "contract_blocked" : capabilities.some((item) => item.implementationStatus === "implemented") ? "implemented" : "not_implemented", credentialStatus: configured ? "configured" : credentialRequired ? "missing" : "not_required", accessStatus: blocked ? "permission_required" : credentialRequired && !configured ? "restricted" : contactMissing ? "unknown" : "public", validationStatus: blocked ? "live_untested" : "mock_passed", capabilities, apiKeyEnv: env, docs: [DOCS[provider as keyof typeof DOCS]], limitations };
}
function providerKey(config: ProviderConfig, provider: string): string | undefined {
  return resolveApiKey(config, process.env, provider === "semantic-scholar" ? ["SEMANTIC_SCHOLAR_API_KEY"] : provider === "openalex" ? ["OPENALEX_API_KEY"] : provider === "pubmed" ? ["NCBI_API_KEY"] : provider === "easyscholar" ? ["EASYSCHOLAR_SECRET_KEY"] : []);
}
function auth(config: ProviderConfig, provider: string, kind: "x-api-key" | "bearer" = "bearer"): Record<string, string> {
  const value = providerKey(config, provider);
  if (!value) throw new ResearchError("AUTH_REQUIRED", `${provider} requires ${config.apiKeyEnv ?? "a credential"}`, provider);
  const header = kind === "x-api-key" ? "x-api-key" : "Authorization";
  return { [header]: kind === "bearer" ? `Bearer ${value}` : value };
}
function optionalAuth(config: ProviderConfig, kind: "x-api-key" | "bearer" = "x-api-key"): Record<string, string> {
  const value = providerKey(config, "semantic-scholar");
  if (!value) return {};
  return { [kind === "x-api-key" ? "x-api-key" : "Authorization"]: kind === "bearer" ? `Bearer ${value}` : value };
}
function result(provider: string, items: LiteratureRecord[], total?: number, next?: string, requests = 1, warnings: string[] = [], costUsd?: number): ResearchSearchResult { return { provider, items, total, next, warnings, usage: { requests, ...(typeof costUsd === "number" && Number.isFinite(costUsd) ? { estimatedCost: costUsd, costKnown: true } : { costKnown: false }) } }; }
function schema(value: unknown, provider: string, required: string[]): any {
  if (!value || typeof value !== "object" || Array.isArray(value) || required.some((key) => !(key in (value as object)))) throw new ResearchError("SCHEMA_MISMATCH", `${provider} response is missing expected fields: ${required.join(", ")}`, provider);
  return value;
}
function parseArxiv(xml: string, provider: string): LiteratureRecord[] {
  const entries: any[] = [];
  let current: any;
  let field = "";
  let author: any;
  const parser = new SaxesParser({ xmlns: false });
  parser.on("doctype", () => { throw new ResearchError("SCHEMA_MISMATCH", "arXiv XML must not contain a DOCTYPE", provider); });
  parser.on("processinginstruction", () => { throw new ResearchError("SCHEMA_MISMATCH", "arXiv XML processing instructions are not accepted", provider); });
  parser.on("opentag", (tag: any) => {
    const name = String(tag.name).toLowerCase();
    if (name === "entry") { current = { authors: [] }; entries.push(current); }
    if (!current) return;
    if (name === "author") { author = {}; current.authors.push(author); }
    field = name;
  });
  parser.on("text", (value: string) => {
    if (!current) return;
    const valueText = value.replace(/\s+/g, " ").trim();
    if (!valueText) return;
    if (author && field === "name") author.name = `${author.name ?? ""}${valueText}`.trim();
    else if (["id", "title", "summary", "published"].includes(field)) current[field] = `${current[field] ?? ""}${valueText}`.trim();
  });
  parser.on("closetag", (tag: any) => { if (String(tag.name).toLowerCase() === "author") author = undefined; field = ""; });
  try { parser.write(xml).close(); } catch (error) { if (error instanceof ResearchError) throw error; throw new ResearchError("SCHEMA_MISMATCH", "Invalid arXiv Atom response", provider, undefined, String(error)); }
  return entries.filter((entry) => entry.id).map((entry) => record(provider, {}, { id: entry.id, title: entry.title, abstract: entry.summary, year: Number(entry.published?.slice(0, 4)) || undefined, url: entry.id, identifiers: { arXiv: entry.id.split("/abs/")[1] ?? entry.id }, authors: entry.authors.filter((a: any) => a.name).map((a: any) => ({ name: a.name })) }));
}
function text(value: any): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function authors(raw: any): Array<{ name: string; id?: string }> { const values = Array.isArray(raw) ? raw : []; return values.map((a: any) => ({ name: (text(a?.name) ?? [a?.given, a?.family].filter(Boolean).join(" ")) || "Unknown", id: text(a?.authorId ?? a?.id) })); }
function record(provider: string, raw: any, fields: Partial<LiteratureRecord> = {}): LiteratureRecord {
  const id = text(fields.id ?? raw?.paperId ?? raw?.id ?? raw?.DOI ?? raw?.doi ?? raw?.pmid ?? raw?.uid) ?? "unknown";
  return { id, title: text(fields.title ?? raw?.title ?? raw?.articleTitle) ?? "Untitled", authors: fields.authors ?? authors(raw?.authors ?? raw?.author), identifiers: fields.identifiers ?? {}, source: { provider, sourceId: id, retrievedAt: new Date().toISOString(), url: text(fields.url ?? raw?.url ?? raw?.URL) }, raw, ...fields };
}

abstract class BaseProvider implements LiteratureProvider {
  abstract readonly status: ProviderStatus;
  constructor(protected readonly config: ProviderConfig, protected readonly provider: string) {}
  protected ensureEnabled() { if (!this.status.enabled) throw new ResearchError("SOURCE_UNAVAILABLE", `${this.provider} is disabled`, this.provider); }
  protected unsupported(capability: string): never { throw new ResearchError("UNSUPPORTED_CAPABILITY", `${this.provider} does not support ${capability}`, this.provider); }
  abstract search(request: ResearchSearchRequest): Promise<ResearchSearchResult>;
}

export class SemanticScholarProvider extends BaseProvider {
  readonly status = source("semantic-scholar", this.config, [cap("literature.search", DOCS["semantic-scholar"]), cap("literature.lookup", DOCS["semantic-scholar"]), cap("literature.references", DOCS["semantic-scholar"]), cap("literature.citations", DOCS["semantic-scholar"]), cap("literature.recommendations", "https://api.semanticscholar.org/api-docs/recommendations")], false);
  async search(r: ResearchSearchRequest) { this.ensureEnabled(); const q: any = { query: r.query, limit: Math.min(r.limit ?? 20, 100), offset: r.offset, fields: (r.fields ?? ["title", "abstract", "authors", "year", "venue", "citationCount", "externalIds", "openAccessPdf"]).join(",") }; if (r.yearFrom || r.yearTo) q.year = `${r.yearFrom ?? ""}-${r.yearTo ?? ""}`; if (r.openAccessOnly) q.openAccessPdf = ""; const x = await requestJson<any>({ provider: this.provider, url: appendQuery("https://api.semanticscholar.org/graph/v1/paper/search", q), headers: optionalAuth(this.config), signal: r.signal, timeoutMs: this.config.timeoutMs }); const data = schema(x.data, this.provider, ["data"]); const items = (data.data ?? []).map((p: any) => record(this.provider, p, { id: p.paperId, identifiers: p.externalIds ?? {}, openAccessUrl: p.openAccessPdf?.url, citationCount: p.citationCount, authors: authors(p.authors) })); return result(this.provider, items, data.total, data.next); }
  async get(id: string, signal?: AbortSignal) { this.ensureEnabled(); const x = await requestJson<any>({ provider: this.provider, url: appendQuery(`https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(id)}`, { fields: "title,abstract,authors,year,venue,citationCount,externalIds,openAccessPdf,url" }), headers: optionalAuth(this.config), signal, timeoutMs: this.config.timeoutMs }); return record(this.provider, x.data, { id: x.data?.paperId, identifiers: x.data?.externalIds ?? {}, openAccessUrl: x.data?.openAccessPdf?.url, citationCount: x.data?.citationCount, authors: authors(x.data?.authors) }); }
  async graph(id: string, kind: "references" | "citations" | "recommendations", o: any = {}) {
    this.ensureEnabled();
    const url = kind === "recommendations"
      ? "https://api.semanticscholar.org/recommendations/v1/papers/forpaper/" + encodeURIComponent(id)
      : `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(id)}/${kind}`;
    const x = await requestJson<any>({ provider: this.provider, url: appendQuery(url, { limit: Math.min(o.limit ?? 20, 1000), offset: kind === "recommendations" ? undefined : o.offset, fields: "title,abstract,authors,year,venue,externalIds" }), headers: optionalAuth(this.config), signal: o.signal, timeoutMs: this.config.timeoutMs });
    const values = x.data?.data ?? x.data?.recommendedPapers ?? [];
    return result(this.provider, values.map((v: any) => record(this.provider, v.citedPaper ?? v.citingPaper ?? v, { id: (v.citedPaper ?? v.citingPaper ?? v)?.paperId })), x.data?.total, x.data?.next);
  }
}

export class CrossrefProvider extends BaseProvider {
  readonly status = source("crossref", this.config, [cap("literature.search", DOCS.crossref), cap("literature.lookup", DOCS.crossref), cap("literature.references", DOCS.crossref, "implemented", "Reference and update/retraction relation fields are preserved for independent review.")], false);
  private doi(id: string): string { const normalized = id.trim().replace(/^https?:\/\/doi\.org\//i, ""); if (!/^10\.\d{4,9}\/\S+$/i.test(normalized)) throw new ResearchError("SCHEMA_MISMATCH", "Crossref lookup requires a DOI", this.provider); return normalized; }
  private mapped(w: any, fallback?: string): LiteratureRecord { const doi = text(w?.DOI ?? fallback); return record(this.provider, w, { id: doi ?? fallback, doi, title: w?.title?.[0], authors: authors(w?.author), year: w?.published?.["date-parts"]?.[0]?.[0], venue: w?.["container-title"]?.[0], url: w?.URL, identifiers: doi ? { DOI: doi } : {}, source: { provider: this.provider, sourceId: doi ?? fallback, retrievedAt: new Date().toISOString(), url: w?.URL, fields: { updateTo: JSON.stringify(w?.["update-to"] ?? []), relation: JSON.stringify(w?.relation ?? {}) } } }); }
  async search(r: ResearchSearchRequest) { this.ensureEnabled(); const x = await requestJson<any>({ provider: this.provider, url: appendQuery("https://api.crossref.org/works", { "query.bibliographic": r.query, rows: Math.min(r.limit ?? 20, 1000), offset: r.offset, select: "DOI,title,author,published,container-title,URL,link,reference,relation,update-to" }), headers: { "User-Agent": `pi-scholar (mailto:${this.config.contact ?? "noreply@example.invalid"})` }, signal: r.signal, timeoutMs: this.config.timeoutMs }); const m = schema(x.data?.message, this.provider, ["items"]); return result(this.provider, (m.items ?? []).map((w: any) => this.mapped(w)), m["total-results"]); }
  async get(id: string, signal?: AbortSignal) { this.ensureEnabled(); const doi = this.doi(id); const x = await requestJson<any>({ provider: this.provider, url: `https://api.crossref.org/works/${encodeURIComponent(doi)}`, signal, timeoutMs: this.config.timeoutMs }); const w = x.data?.message; return this.mapped(w, doi); }
  async graph(id: string, kind: "references") { this.ensureEnabled(); const paper = await this.get(id); const refs = Array.isArray((paper.raw as any)?.reference) ? (paper.raw as any).reference : []; return result(this.provider, refs.map((ref: any) => record(this.provider, ref, { id: ref.DOI ?? ref.doi ?? ref.key ?? ref.unstructured ?? "reference", doi: ref.DOI ?? ref.doi, title: ref.articleTitle ?? ref.unstructured, identifiers: ref.DOI ? { DOI: ref.DOI } : {} }))); }
}

export class PubmedProvider extends BaseProvider {
  readonly status = source("pubmed", this.config, [cap("literature.search", DOCS.pubmed), cap("literature.lookup", DOCS.pubmed), cap("literature.references", DOCS.pubmed), cap("fulltext.resolve", DOCS.pubmed, "implemented", "Only PMC records with an explicit OA license are eligible."), cap("fulltext.fetch", DOCS.pubmed, "implemented", "Fetches licensed PMC XML through NCBI E-utilities; it does not bypass publisher access controls.")], false, ["PubMed metadata access does not imply PMC full-text permission; PMC OA license is checked before fetch."]);
  private base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
  private params(r: any) { const key = providerKey(this.config, this.provider); return { db: "pubmed", retmode: "json", ...(key ? { api_key: key } : {}), ...r }; }
  private identifiers(value: any, pmid: string): Record<string, string> { const identifiers: Record<string, string> = { PMID: pmid }; for (const item of Array.isArray(value?.articleids) ? value.articleids : []) { const id = text(item?.id ?? item?.value); const type = text(item?.idtype)?.toLowerCase(); if (!id || !type || type === "pubmed") continue; if (type === "pmc" || type === "pmcid") identifiers.PMCID = id.toUpperCase().startsWith("PMC") ? id.toUpperCase() : `PMC${id}`; else if (type === "doi") identifiers.DOI = id; else identifiers[type.toUpperCase()] = id; } return identifiers; }
  async search(r: ResearchSearchRequest) { this.ensureEnabled(); const s = await requestJson<any>({ provider: this.provider, url: appendQuery(`${this.base}esearch.fcgi`, this.params({ term: r.query, retmax: Math.min(r.limit ?? 20, 100), retstart: r.offset ?? 0 })), signal: r.signal, timeoutMs: this.config.timeoutMs }); const search = schema(s.data?.esearchresult, this.provider, ["idlist"]); const ids = search.idlist ?? []; if (!ids.length) return result(this.provider, [], 0, undefined, 1); const d = await requestJson<any>({ provider: this.provider, url: appendQuery(`${this.base}esummary.fcgi`, this.params({ id: ids.join(",") })), signal: r.signal, timeoutMs: this.config.timeoutMs }); const summary = schema(d.data?.result, this.provider, ids); const items = ids.map((id: string) => record(this.provider, summary[id], { id, identifiers: this.identifiers(summary[id], id), title: summary[id]?.title, authors: authors(summary[id]?.authors), year: Number((summary[id]?.pubdate ?? "").slice(0, 4)) || undefined })); return result(this.provider, items, Number(search.count ?? items.length), undefined, 2); }
  async get(id: string, signal?: AbortSignal) { this.ensureEnabled(); const d = await requestJson<any>({ provider: this.provider, url: appendQuery(`${this.base}esummary.fcgi`, this.params({ id })), signal, timeoutMs: this.config.timeoutMs }); const p = d.data?.result?.[id]; if (!p) throw new ResearchError("NOT_FOUND", `PubMed record ${id} was not found`, this.provider); return record(this.provider, p, { id, identifiers: this.identifiers(p, id), title: p.title, authors: authors(p.authors), year: Number((p.pubdate ?? "").slice(0, 4)) || undefined }); }
  async graph(id: string, kind: "references" | "citations", o: any = {}) { this.ensureEnabled(); const linkname = kind === "references" ? "pubmed_pubmed_refs" : "pubmed_pubmed_citedin"; const x = await requestJson<any>({ provider: this.provider, url: appendQuery(`${this.base}elink.fcgi`, this.params({ dbfrom: "pubmed", db: "pubmed", id, linkname, retmode: "json" })), signal: o.signal, timeoutMs: this.config.timeoutMs }); const sets = Array.isArray(x.data?.linksets) ? x.data.linksets : Object.values(x.data?.linksets ?? {}); const links = (sets as any[]).flatMap((set: any) => (set.linksetdb ?? []).flatMap((v: any) => v.link ?? [])); return result(this.provider, links.slice(o.offset ?? 0, (o.offset ?? 0) + Math.min(o.limit ?? 20, 1000)).map((v: any) => record(this.provider, {}, { id: String(v.id), identifiers: { PMID: String(v.id) } }))); }
  private pmcId(id: string): string {
    const normalized = id.trim().toUpperCase();
    if (!/^PMC\d+$/.test(normalized)) throw new ResearchError("SCHEMA_MISMATCH", "PMC full text requires an identifier such as PMC123456", this.provider);
    return normalized;
  }
  async fulltext(id: string, action: "resolve" | "fetch", signal?: AbortSignal) {
    this.ensureEnabled();
    const pmcId = this.pmcId(id);
    const oa = await requestText({ provider: this.provider, url: appendQuery("https://www.ncbi.nlm.nih.gov/pmc/utils/oa/oa.fcgi", { id: pmcId }), signal, timeoutMs: this.config.timeoutMs });
    const error = oa.text.match(/<error[^>]*>([^<]*)<\/error>/i)?.[1]?.trim();
    if (error) throw new ResearchError("ENTITLEMENT_REQUIRED", `PMC record ${pmcId} is not available through the OA service: ${error}`, this.provider);
    const license = oa.text.match(/<record\b[^>]*\blicense="([^"]+)"/i)?.[1];
    const packageUrl = oa.text.match(/<link\b[^>]*\bhref="([^"]+)"/i)?.[1];
    const fetchUrl = appendQuery(`${this.base}efetch.fcgi`, { db: "pmc", id: pmcId, rettype: "full", retmode: "xml" });
    if (action === "resolve") return { provider: this.provider, id: pmcId, available: Boolean(license), license, packageUrl, fetchUrl, source: "NCBI PMC OA service" };
    if (!license) throw new ResearchError("ENTITLEMENT_REQUIRED", `PMC record ${pmcId} has no explicit OA license`, this.provider);
    const fulltext = await requestText({ provider: this.provider, url: fetchUrl, headers: { Accept: "application/xml" }, signal, timeoutMs: this.config.timeoutMs });
    return { provider: this.provider, id: pmcId, license, url: fulltext.url, contentType: fulltext.response.headers.get("content-type"), content: fulltext.text };
  }
}

export class ArxivProvider extends BaseProvider {
  readonly status = source("arxiv", this.config, [cap("literature.search", DOCS.arxiv), cap("literature.lookup", DOCS.arxiv), cap("fulltext.resolve", DOCS.arxiv, "implemented", "Resolves the versioned arXiv abstract and PDF URLs."), cap("fulltext.fetch", DOCS.arxiv, "implemented", "Fetches the original arXiv PDF only." )], false, ["arXiv API is Atom/XML and has an official request pacing recommendation."]);
  async search(r: ResearchSearchRequest) { this.ensureEnabled(); const x = await requestText({ provider: this.provider, url: appendQuery("https://export.arxiv.org/api/query", { search_query: `all:${r.query}`, start: r.offset ?? 0, max_results: Math.min(r.limit ?? 20, 100) }), signal: r.signal, timeoutMs: this.config.timeoutMs }); return result(this.provider, parseArxiv(x.text, this.provider)); }
  async get(id: string, signal?: AbortSignal) { this.ensureEnabled(); const arxivId = this.arxivId(id); const x = await requestText({ provider: this.provider, url: appendQuery("https://export.arxiv.org/api/query", { search_query: `id:${arxivId}`, start: 0, max_results: 1 }), signal, timeoutMs: this.config.timeoutMs }); const item = parseArxiv(x.text, this.provider)[0]; if (!item) throw new ResearchError("NOT_FOUND", `arXiv record ${id} was not found`, this.provider); return item; }
  private arxivId(id: string): string { const normalized = id.trim().replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//i, "").replace(/\.pdf$/i, ""); if (!/^[A-Za-z0-9][A-Za-z0-9.\-\/]+(?:v\d+)?$/.test(normalized)) throw new ResearchError("SCHEMA_MISMATCH", "arXiv full text requires a versioned arXiv identifier", this.provider); return normalized; }
  async fulltext(id: string, action: "resolve" | "fetch", signal?: AbortSignal) { this.ensureEnabled(); const arxivId = this.arxivId(id); const encodedId = arxivId.split("/").map(encodeURIComponent).join("/"); const abstractUrl = `https://arxiv.org/abs/${encodedId}`; const pdfUrl = `https://arxiv.org/pdf/${encodedId}`; if (action === "resolve") return { provider: this.provider, id: arxivId, version: /v\d+$/i.test(arxivId) ? arxivId.match(/v\d+$/i)?.[0] : "latest", abstractUrl, pdfUrl, original: true }; const x = await requestBytes({ provider: this.provider, url: pdfUrl, headers: { Accept: "application/pdf" }, signal, timeoutMs: this.config.timeoutMs }); const contentType=x.response.headers.get("content-type");if(!/^application\/pdf(?:;|$)/i.test(contentType??"")&&!Buffer.from(x.bytes.subarray(0,5)).equals(Buffer.from("%PDF-")))throw new ResearchError("SCHEMA_MISMATCH","arXiv full-text response is not a PDF",this.provider);return { provider: this.provider, id: arxivId, version: /v\d+$/i.test(arxivId) ? arxivId.match(/v\d+$/i)?.[0] : "latest", url: x.url, contentType, content: x.bytes };
  }
}

export class OpenAlexProvider extends BaseProvider {
  readonly status = source("openalex", this.config, [cap("literature.search", DOCS.openalex), cap("literature.lookup", DOCS.openalex), cap("literature.references", DOCS.openalex), cap("literature.citations", DOCS.openalex)], false);
  private headers() { return {}; }
  private url(path: string, q: any) { const key = providerKey(this.config, this.provider); if (key) q.api_key = key; return appendQuery(`https://api.openalex.org/${path}`, q); }
  private mapped(w: any, fallback?: string): LiteratureRecord { return record(this.provider, w, { id: w?.id ?? fallback, title: w?.title, authors: (w?.authorships ?? []).map((a: any) => ({ name: a.author?.display_name ?? "Unknown", id: a.author?.id, institutions: (a.institutions ?? []).map((i: any) => ({ name: i.display_name ?? "Unknown", id: i.id })) })), year: w?.publication_year, venue: w?.primary_location?.source?.display_name, doi: w?.doi?.replace(/^https?:\/\/doi.org\//, ""), url: w?.id, openAccessUrl: w?.open_access?.oa_url, citationCount: w?.cited_by_count, identifiers: { OpenAlex: w?.id ?? fallback } }); }
  async search(r: ResearchSearchRequest) { this.ensureEnabled(); const x = await requestJson<any>({ provider: this.provider, url: this.url("works", { search: r.query, per_page: Math.min(r.limit ?? 20, 100), page: Math.floor((r.offset ?? 0) / Math.max(1, r.limit ?? 20)) + 1, filter: [r.yearFrom && `from_publication_date:${r.yearFrom}-01-01`, r.yearTo && `to_publication_date:${r.yearTo}-12-31`, r.openAccessOnly && "is_oa:true"].filter(Boolean).join(",") }), headers: this.headers(), signal: r.signal, timeoutMs: this.config.timeoutMs }); const data = schema(x.data, this.provider, ["results"]); return result(this.provider, (data.results ?? []).map((w: any) => this.mapped(w)), data.meta?.count, undefined, 1, [], data.meta?.cost_usd); }
  async get(id: string, signal?: AbortSignal) { this.ensureEnabled(); const x = await requestJson<any>({ provider: this.provider, url: this.url(`works/${encodeURIComponent(id.replace(/^https?:\/\/openalex.org\//, ""))}`, {}), headers: this.headers(), signal, timeoutMs: this.config.timeoutMs }); return this.mapped(x.data, id); }
  async graph(id: string, kind: "references" | "citations", o: any = {}): Promise<ResearchSearchResult> {
    this.ensureEnabled();
    const normalized = id.replace(/^https?:\/\/openalex.org\//, "");
    if (kind === "references") {
      const paper = await this.get(normalized, o.signal);
      const ids = Array.isArray((paper.raw as any)?.referenced_works) ? (paper.raw as any).referenced_works : [];
      return result(this.provider, ids.slice(o.offset ?? 0, (o.offset ?? 0) + Math.min(o.limit ?? 20, 200)).map((ref: string) => record(this.provider, {}, { id: ref, identifiers: { OpenAlex: ref }, url: ref })));
    }
    const x = await requestJson<any>({ provider: this.provider, url: this.url("works", { filter: `cites:${normalized}`, per_page: Math.min(o.limit ?? 20, 100), page: Math.floor((o.offset ?? 0) / Math.max(1, o.limit ?? 20)) + 1 }), headers: this.headers(), signal: o.signal, timeoutMs: this.config.timeoutMs });
    return result(this.provider, (x.data?.results ?? []).map((w: any) => record(this.provider, w, { id: w.id, title: w.title, year: w.publication_year, identifiers: { OpenAlex: w.id } })), x.data?.meta?.count, undefined, 1, [], x.data?.meta?.cost_usd);
  }
}

export class EasyScholarProvider extends BaseProvider {
  readonly status: ProviderStatus;
  constructor(c: ProviderConfig) { super(c, "easyscholar"); this.status = source("easyscholar", c, [cap("journal.metrics", DOCS.easyscholar, "implemented", "The open getPublicationRank endpoint returns customRank and officialRank data.")], false, ["The endpoint requires a provider-issued SecretKey; only the journal metrics endpoint is supported."]); }
  async search(_request: ResearchSearchRequest): Promise<ResearchSearchResult> { return this.unsupported("literature.search"); }
  async metrics(query: string, signal?: AbortSignal): Promise<unknown> {
    this.ensureEnabled();
    if (!query.trim() || query.length > 500) throw new ResearchError("SCHEMA_MISMATCH", "easyScholar publicationName must contain 1 to 500 characters", this.provider);
    const secretKey = providerKey(this.config, this.provider);
    if (!secretKey) throw new ResearchError("AUTH_REQUIRED", `easyscholar requires ${this.config.apiKeyEnv ?? "a credential"}`, this.provider);
    const x = await requestJson<any>({ provider: this.provider, url: appendQuery("https://www.easyscholar.cc/open/getPublicationRank", { secretKey, publicationName: query }), signal, timeoutMs: this.config.timeoutMs });
    const payload = schema(x.data, this.provider, ["code", "msg", "data"]);
    if (payload.code !== 200) {
      const code = payload.code === 40002 ? "AUTH_INVALID" : "SOURCE_UNAVAILABLE";
      throw new ResearchError(code, `easyScholar returned application code ${String(payload.code)}`, this.provider, 200, { message: payload.msg });
    }
    if (!payload.data || typeof payload.data !== "object" || Array.isArray(payload.data)) throw new ResearchError("SCHEMA_MISMATCH", "easyScholar success response data must be an object", this.provider);
    return { provider: this.provider, publicationName: query, data: payload.data, source: { url: x.url, retrievedAt: new Date().toISOString() } };
  }
}

export class UnpaywallProvider extends BaseProvider {
  readonly status = source("unpaywall", this.config, [cap("literature.lookup", DOCS.unpaywall), cap("fulltext.resolve", DOCS.unpaywall, "implemented", "Returns OA locations and license/version metadata; it does not download content.")], false, ["Unpaywall requires a contact email query parameter and only resolves locations; repository/publisher license remains authoritative."]);
  private email(): string { const value = this.config.contact?.trim(); if (!value) throw new ResearchError("AUTH_REQUIRED", "unpaywall requires research.contact or providers.unpaywall.contact", this.provider); return value; }
  private url(path: string, query: Record<string, unknown>) { return appendQuery(`https://api.unpaywall.org/${path}`, { ...query, email: this.email() }); }
  private map(raw: any): LiteratureRecord { const doi = text(raw?.doi); const best = raw?.best_oa_location ?? raw?.oa_locations?.[0]; return record(this.provider, raw, { id: doi ?? raw?.id, doi, title: raw?.title, year: raw?.year, venue: raw?.journal_name, url: raw?.doi_url, openAccessUrl: best?.url_for_pdf ?? best?.url_for_landing_page ?? best?.url, identifiers: doi ? { DOI: doi } : {}, source: { provider: this.provider, sourceId: doi, retrievedAt: new Date().toISOString(), url: raw?.doi_url, license: best?.license } }); }
  async search(_request: ResearchSearchRequest): Promise<ResearchSearchResult> { return this.unsupported("literature.search"); }
  async get(id: string, signal?: AbortSignal) { this.ensureEnabled(); const doi = id.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ""); if (!/^10\.\S+/.test(doi)) throw new ResearchError("SCHEMA_MISMATCH", "Unpaywall lookup requires a DOI", this.provider); const x = await requestJson<any>({ provider: this.provider, url: this.url(`v2/${encodeURIComponent(doi)}`, {}), signal, timeoutMs: this.config.timeoutMs }); return this.map(x.data); }
  async graph(): Promise<never> { return this.unsupported("graph"); }
  async fulltext(id: string, action: "resolve" | "fetch", signal?: AbortSignal) { if (action === "fetch") return this.unsupported("fulltext.fetch"); const item = await this.get(id, signal); const raw = item.raw as any; const locations = Array.isArray(raw?.oa_locations) ? raw.oa_locations : []; return { provider: this.provider, id: item.doi ?? id, isOa: raw?.is_oa === true, oaStatus: raw?.oa_status, locations: locations.map((location: any) => ({ url: location.url, urlForPdf: location.url_for_pdf, urlForLandingPage: location.url_for_landing_page, version: location.version, license: location.license, hostType: location.host_type })) }; }
}

export function createResearchProviders(config: ResearchConfig): LiteratureProvider[] {
  const p = config.providers;
  return [new SemanticScholarProvider(p["semantic-scholar"]!, "semantic-scholar"), new OpenAlexProvider(p.openalex!, "openalex"), new PubmedProvider(p.pubmed!, "pubmed"), new ArxivProvider(p.arxiv!, "arxiv"), new CrossrefProvider({ ...p.crossref!, contact: p.crossref?.contact ?? config.contact }, "crossref"), new UnpaywallProvider({ ...p.unpaywall!, contact: p.unpaywall?.contact ?? config.contact }, "unpaywall"), new EasyScholarProvider(p.easyscholar!)];
}

export { DOCS };
