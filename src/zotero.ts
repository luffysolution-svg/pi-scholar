import path from "node:path";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import type { CollectionRef, Creator, IndexedText, Paper, PaperAnnotation, PaperAttachment, PaperNote } from "./model.js";
import { readResponseBytes } from "./io.js";
import { safeName, validateZoteroBaseUrl } from "./config.js";

export const ZOTERO_KEY_RE = /^[A-Z0-9]{8}$/;
export interface ZoteroRaw { key: string; version: number; data: Record<string, unknown>; meta?: Record<string, unknown> }
export interface ListResult<T> { items: T[]; total: number; truncated: boolean; lastModifiedVersion: number | null }
export interface ZoteroOptions { baseUrl?: string; dataDir?: string; fetch?: typeof globalThis.fetch; timeoutMs?: number; maxItems?: number }
const string = (v: unknown): string | null => typeof v === "string" && v.length ? v : null;
const tags = (v: unknown): string[] => Array.isArray(v) ? v.map(x => typeof x === "string" ? x : string((x as Record<string, unknown>)?.tag)).filter((x): x is string => !!x) : [];
const ENRICHABLE_FIELDS = ["date","DOI","ISBN","ISSN","publicationTitle","proceedingsTitle","volume","issue","pages","url","abstractNote"] as const;
function normalizedTitle(value:unknown):string{return (string(value)??"").replace(/<[^>]*>/g,"").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu,"").trim();}
function firstAuthor(value:unknown):string{if(!Array.isArray(value))return "";const creator=value.find(row=>string((row as Record<string,unknown>)?.creatorType)==="author") as Record<string,unknown>|undefined;return `${string(creator?.lastName)??""}${string(creator?.name)??""}`.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu,"");}
function metadataScore(data:Record<string,unknown>):number{return ENRICHABLE_FIELDS.reduce((score,key)=>score+(string(data[key])?1:0),0);}
export function validateKey(key: string, what = "Zotero key"): void { if (!ZOTERO_KEY_RE.test(key)) throw new Error(`${what} must be 8 uppercase letters or digits`); }

export class ZoteroClient {
  readonly baseUrl: string; private readonly fetcher: typeof fetch; private readonly timeoutMs: number; private readonly maxItems: number;
  constructor(private readonly options: ZoteroOptions = {}) { this.baseUrl = validateZoteroBaseUrl(options.baseUrl ?? "http://127.0.0.1:23119/api"); this.fetcher = options.fetch ?? fetch; this.timeoutMs = options.timeoutMs ?? 15_000; this.maxItems = options.maxItems ?? 5000; }
  private async request(pathname: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
    if (init.method && init.method !== "GET") throw new Error("Zotero adapter is read-only; only GET is allowed");
    const url = new URL(`${this.baseUrl}/users/0${pathname}`);
    const timeout = AbortSignal.timeout(this.timeoutMs); const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try { response = await this.fetcher(url, { ...init, method: "GET", redirect: "manual", signal: combined, headers: { "User-Agent": "pi-scholar/0.1", "Zotero-API-Version": "3", "Zotero-Allowed-Request": "1", ...init.headers } }); }
    catch (e) { if (signal?.aborted) throw signal.reason ?? new Error("Zotero request cancelled"); throw new Error(`Zotero Desktop unavailable: ${e instanceof Error ? e.message : String(e)}`); }
    if (response.status === 403) throw new Error("Zotero Local API is disabled; enable local application communication in Zotero settings");
    if (!response.ok) throw new Error(`Zotero read failed (${response.status}) at ${pathname}`);
    return response;
  }
  async list<T = ZoteroRaw>(pathname: string, query: Record<string, string | undefined> = {}, limit = this.maxItems, signal?: AbortSignal): Promise<ListResult<T>> {
    const requested = Math.min(Math.max(limit, 1), this.maxItems); const items: T[] = []; const seenPages = new Set<string>(); let start = 0; let sourceTotal: number | null = null; let lastVersion: number | null = null; let exhausted = false;
    while (items.length < requested) {
      const pageSize = Math.min(100, requested - items.length); const qs = new URLSearchParams({ start: String(start), limit: String(pageSize) }); for (const [k,v] of Object.entries(query)) if (v !== undefined) qs.set(k,v);
      const response = await this.request(`${pathname}?${qs}`, {}, signal); const value: unknown = JSON.parse(Buffer.from(await readResponseBytes(response, 16 * 1024 * 1024, signal)).toString("utf8")); if (!Array.isArray(value)) throw new Error("Zotero returned a malformed list");
      const totalHeader=response.headers.get("total-results"); if(sourceTotal===null&&totalHeader!==null){const n=Number(totalHeader);if(Number.isFinite(n)&&n>=0)sourceTotal=n;}
      const versionHeader=response.headers.get("last-modified-version");if(versionHeader!==null){const lv=Number(versionHeader);if(Number.isFinite(lv)&&lv>=0)lastVersion=lv;}
      if(value.length===0){exhausted=true;break;}const signature=JSON.stringify(value.map((row:unknown)=>typeof row==="object"&&row!==null&&"key" in row?(row as {key:unknown}).key:row));if(seenPages.has(signature))throw new Error("Zotero pagination repeated a page; refusing an incomplete result");seenPages.add(signature);
      items.push(...(value as T[]).slice(0, requested - items.length)); if (value.length < pageSize) { exhausted = true; break; } start += value.length;
    }
    return { items, total: sourceTotal ?? items.length, truncated: sourceTotal !== null ? items.length < sourceTotal : !exhausted && items.length === requested, lastModifiedVersion: lastVersion };
  }
  async listCollections(limit = 5000, signal?: AbortSignal): Promise<ListResult<ZoteroRaw>> { return this.list("/collections", {}, limit, signal); }
  async getCollection(key: string, signal?: AbortSignal): Promise<ZoteroRaw> { validateKey(key, "Collection key"); return this.get(`/collections/${key}`, signal); }
  async listCollectionItems(key: string, limit = 5000, signal?: AbortSignal): Promise<ListResult<ZoteroRaw>> { validateKey(key, "Collection key"); const requested=Math.min(Math.max(limit,1),this.maxItems);const result = await this.list<ZoteroRaw>(`/collections/${key}/items`, {}, this.maxItems, signal); const matched = result.items.filter(x => !x.data.deleted && !x.data.parentItem && Array.isArray(x.data.collections) && x.data.collections.includes(key));const items=matched.slice(0,requested); return { ...result, items, total: matched.length, truncated:result.truncated||matched.length>items.length }; }
  async searchItems(q: string, opts: { collectionKey?: string; itemType?: string; limit?: number } = {}, signal?: AbortSignal): Promise<ListResult<ZoteroRaw>> { if (!q.trim()) throw new Error("Search query must not be empty"); if (opts.collectionKey) { validateKey(opts.collectionKey,"Collection key"); const requested=Math.min(Math.max(opts.limit ?? 50,1),this.maxItems);const all = await this.list<ZoteroRaw>(`/collections/${opts.collectionKey}/items`, { q, qmode: "everything", itemType: opts.itemType }, this.maxItems, signal); const matched = all.items.filter(x => !x.data.deleted && !x.data.parentItem && Array.isArray(x.data.collections) && x.data.collections.includes(opts.collectionKey!));const items=matched.slice(0,requested); return { ...all, items, total: matched.length, truncated:all.truncated||matched.length>items.length }; } return this.list("/items/top", { q, qmode: "everything", itemType: opts.itemType }, opts.limit ?? 50, signal); }
  async get<T = ZoteroRaw>(pathname: string, signal?: AbortSignal): Promise<T> { const response = await this.request(pathname, {}, signal); return JSON.parse(Buffer.from(await readResponseBytes(response, 16 * 1024 * 1024, signal)).toString("utf8")) as T; }
  async getItem(key: string, signal?: AbortSignal): Promise<ZoteroRaw> { validateKey(key); return this.get(`/items/${key}`, signal); }
  async getChildren(key: string, signal?: AbortSignal): Promise<ZoteroRaw[]> { validateKey(key); return (await this.list<ZoteroRaw>(`/items/${key}/children`, {}, this.maxItems, signal)).items; }
  async indexedText(key: string, signal?: AbortSignal): Promise<IndexedText> { validateKey(key); try { const v = await this.get<Record<string, unknown>>(`/items/${key}/fulltext`, signal); return { status:"available", content: string(v.content) ?? "", ...(typeof v.indexedPages === "number" ? { indexedPages:v.indexedPages } : {}), ...(typeof v.totalPages === "number" ? { totalPages:v.totalPages } : {}) }; } catch (e) { if (String(e).includes("(404)")) return { status:"unavailable" }; throw e; } }
  async locateAttachment(key: string, rawPath: string | null, signal?: AbortSignal): Promise<string | null> {
    validateKey(key, "Attachment key");
    try { const response = await this.request(`/items/${key}/file/view/url`, {}, signal); const text = Buffer.from(await readResponseBytes(response, 16 * 1024, signal)).toString("utf8").trim(); if (text.startsWith("file:")) { const fileUrl = new URL(text); if (fileUrl.hostname && fileUrl.hostname !== "localhost") throw new Error("Remote file URL is not allowed"); const found = fileURLToPath(fileUrl); await access(found, constants.R_OK); return found; } } catch (e) { signal?.throwIfAborted(); if (!rawPath?.startsWith("storage:") || !this.options.dataDir) return null; }
    if (rawPath?.startsWith("storage:") && this.options.dataDir) { const name = rawPath.slice(8); try { safeName(name, "Zotero storage attachment", 255); } catch { throw new Error("Unsafe Zotero storage attachment path"); } const candidate = path.join(this.options.dataDir,"storage",key,name); try{await access(candidate, constants.R_OK);}catch{throw new Error("Zotero managed PDF cannot be read under ZOTERO_DATA_DIR; verify the configured data directory and attachment availability");} return candidate; }
    return null;
  }

  private async enrichBibliography(raw:ZoteroRaw,signal?:AbortSignal):Promise<{data:Record<string,unknown>;enrichment?:Paper["bibliographicEnrichment"]}>{
    const source=raw.data;
    // Only attempt conservative enrichment for clearly sparse records. Never call the
    // network: candidates come from the same read-only Zotero Desktop library.
    if(string(source.date)||string(source.DOI)||string(source.publicationTitle)||string(source.proceedingsTitle))return{data:source};
    const title=string(source.title),author=firstAuthor(source.creators);
    if(!title||!author)return{data:source};
    const result=await this.searchItems(title,{limit:50},signal);
    const targetTitle=normalizedTitle(title);
    const candidates=result.items.filter(candidate=>candidate.key!==raw.key&&!candidate.data.deleted&&!candidate.data.parentItem&&!(["attachment","note","annotation"].includes(string(candidate.data.itemType)??""))&&normalizedTitle(candidate.data.title)===targetTitle&&firstAuthor(candidate.data.creators)===author&&metadataScore(candidate.data)>metadataScore(source));
    if(candidates.length!==1)return{data:source};
    const donor=candidates[0]!,data={...source};const filledFields:string[]=[];
    for(const field of ENRICHABLE_FIELDS){if(!string(data[field])&&string(donor.data[field])){data[field]=donor.data[field];filledFields.push(field);}}
    return{data,enrichment:{zoteroKey:donor.key,zoteroVersion:donor.version,match:"normalized-title-first-author",filledFields,metadata:{...donor.data}}};
  }

  async getPaper(key: string, selectedAttachmentKey?: string, signal?: AbortSignal): Promise<Paper> {
    const raw = await this.getItem(key, signal); const d = raw.data; const type = string(d.itemType) ?? "unknown"; if(d.deleted)throw new Error("Requested Zotero item is deleted");if (["attachment","note","annotation"].includes(type)) throw new Error("Requested Zotero item is not a bibliographic parent item");
    const enriched=await this.enrichBibliography(raw,signal);const bibliographic=enriched.data;
    const children = await this.getChildren(key, signal); const noteRows = children.filter(x => x.data.itemType === "note"); const attachmentRows = children.filter(x => x.data.itemType === "attachment");
    const collectionsResult = await this.listCollections(this.maxItems, signal); const nameMap = new Map(collectionsResult.items.map(c => [c.key, string(c.data.name)]));
    const notes: PaperNote[] = noteRows.map(n => ({ key:n.key, version:n.version, parentItem:string(n.data.parentItem) ?? key, note:string(n.data.note) ?? "" }));
    const attachments: PaperAttachment[] = [];
    for (const a of attachmentRows) {
      const contentType = string(a.data.contentType); const filename = string(a.data.filename); const isPdf = contentType === "application/pdf" || filename?.toLowerCase().endsWith(".pdf") === true; const annotationRows = isPdf ? (await this.getChildren(a.key, signal)).filter(x => x.data.itemType === "annotation") : [];
      const annotations = annotationRows.map(toAnnotation); const localPath = isPdf ? await this.locateAttachment(a.key,string(a.data.path),signal) : null; const indexed = isPdf ? await this.indexedText(a.key,signal) : { status:"unavailable" as const };
      attachments.push({ key:a.key, version:a.version, parentItem:string(a.data.parentItem) ?? key, title:string(a.data.title) ?? "", filename, contentType, linkMode:string(a.data.linkMode), path:string(a.data.path), md5:string(a.data.md5), mtime:typeof a.data.mtime === "number" ? a.data.mtime : null, selected:false, localPath, indexedText:indexed, annotations });
    }
    const pdfs = attachments.filter(a => a.contentType === "application/pdf" || a.filename?.toLowerCase().endsWith(".pdf")); if (selectedAttachmentKey) { validateKey(selectedAttachmentKey,"Attachment key"); if (!pdfs.some(x=>x.key===selectedAttachmentKey)) throw new Error("Selected attachment is not a child PDF"); }
    const selected = selectedAttachmentKey ? pdfs.find(x=>x.key===selectedAttachmentKey)! : [...pdfs].sort((a,b)=>a.key.localeCompare(b.key))[0] ?? null; if (selected) selected.selected = true;
    const creators: Creator[] = Array.isArray(d.creators) ? d.creators.map(v => { const c=v as Record<string,unknown>; return { creatorType:string(c.creatorType) ?? "author", firstName:string(c.firstName), lastName:string(c.lastName), name:string(c.name) }; }) : [];
    const date=string(bibliographic.date); const year=(date?.match(/(?:^|\D)((?:1[5-9]|20|21)\d{2})(?:\D|$)/)?.[1]) ?? null; const collectionKeys=Array.isArray(d.collections) ? d.collections.filter((v):v is string=>typeof v==="string") : [];
    return { zoteroKey:raw.key,zoteroVersion:raw.version,itemType:type,title:string(d.title) ?? "Untitled",creators,metadata:{...d},...(enriched.enrichment?{bibliographicEnrichment:enriched.enrichment}:{}),date,year,doi:string(bibliographic.DOI),isbn:string(bibliographic.ISBN),issn:string(bibliographic.ISSN),publicationTitle:string(bibliographic.publicationTitle) ?? string(bibliographic.proceedingsTitle),volume:string(bibliographic.volume),issue:string(bibliographic.issue),pages:string(bibliographic.pages),url:string(bibliographic.url),abstract:string(bibliographic.abstractNote),tags:tags(d.tags),collections:collectionKeys.map((k):CollectionRef=>({key:k,name:nameMap.get(k) ?? null})),notes,annotations:attachments.flatMap(a=>a.annotations),attachments,selectedPdf:selected };
  }
}
function toAnnotation(a: ZoteroRaw): PaperAnnotation { return { key:a.key,version:a.version,parentAttachment:string(a.data.parentItem) ?? "",text:string(a.data.annotationText),comment:string(a.data.annotationComment),color:string(a.data.annotationColor),pageLabel:string(a.data.annotationPageLabel),sortIndex:string(a.data.annotationSortIndex),position:a.data.annotationPosition ?? null,tags:tags(a.data.tags) }; }
