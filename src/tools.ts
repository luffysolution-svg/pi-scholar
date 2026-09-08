import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig, type ScholarConfig } from "./config.js";
import { ZoteroClient } from "./zotero.js";
import { MinerUClient } from "./mineru.js";
import { normalizeArchive, publishPaper } from "./output.js";
import { readFile } from "node:fs/promises";
import { createSyncPlan, excludePublication, parseKey, readCachedParse, readSyncManifest, recordPublication, recoverSync, refreshPublicationMetadata, unexcludePublication, withParseLease, withParseTask, writeCachedParse } from "./sync/index.js";
import { recoverPublications } from "./output.js";

const LIMIT_BYTES=50*1024,LIMIT_LINES=2000;
export function truncate(text: string): { text: string; truncated: boolean; bytes: number; lines: number } {
  const bytes = Buffer.byteLength(text), lines = text.split("\n").length;
  if (bytes <= LIMIT_BYTES && lines <= LIMIT_LINES) return { text, truncated: false, bytes, lines };
  // Reserve marker space and count its lines inside the advertised total limit.
  const source = text.split("\n");
  const output: string[] = [];
  let shownBytes = 0;
  for (const line of source.slice(0, LIMIT_LINES)) {
    const size = Buffer.byteLength(line) + (output.length ? 1 : 0);
    if (shownBytes + size > LIMIT_BYTES - 160) break;
    output.push(line); shownBytes += size;
  }
  const shown = output.length;
  return { text: output.join("\n") + `\n\n[Truncated: displayed ${shown}/${lines} lines and ${shownBytes}/${bytes} bytes. Refine the query or read a specific item.]`, truncated: true, bytes, lines };
}
const configFor = (ctx: ExtensionContext): ScholarConfig => loadConfig(process.env, ctx.cwd, ctx.isProjectTrusted?.() === true);
const zoteroFor = (c: ScholarConfig): ZoteroClient => new ZoteroClient({ baseUrl: c.zoteroBaseUrl, dataDir: c.zoteroDataDir, timeoutMs: c.zoteroTimeoutMs, maxItems: c.zoteroMaxItems });
const result=(value:unknown,details:Record<string,unknown>={})=>{const t=truncate(JSON.stringify(value,null,2));return{content:[{type:"text" as const,text:t.text}],details:{...details,truncated:t.truncated,totalBytes:t.bytes,totalLines:t.lines}};};
type ParseArgs={key:string;attachmentKey?:string;allowExternalUpload?:boolean;action?:string;force?:boolean};
async function executeSafeParse(args:ParseArgs,signal:AbortSignal|undefined,onUpdate:((update:unknown)=>void)|undefined,ctx:ExtensionContext){
  const c=configFor(ctx);const z=zoteroFor(c);const paper=await z.getPaper(args.key,args.attachmentKey,signal);
  const sync=c.sync;
  const namespace=sync?.namespace??("vault-"+parseKey(Buffer.from(c.outputDir),{}).slice(0,16));
  const parseOptions={language:c.mineruLanguage,enableFormula:c.mineruEnableFormula,enableTable:c.mineruEnableTable,isOcr:c.mineruIsOcr,modelVersion:c.mineruModelVersion};
  const metadataPlan=await createSyncPlan({outputRoot:c.outputDir,paper,parseOptions,namespace,cacheDir:sync?.cacheDir});
  if(metadataPlan.status==="metadata_changed"&&metadataPlan.changes.includes("metadata_changed")&&!metadataPlan.changes.includes("parse_changed")){
    const refreshed=await refreshPublicationMetadata(c.outputDir,paper,{namespace,filenameSeparator:c.filenameSeparator,literaturesDirectory:c.literaturesDirectory,tagSpaceReplacement:c.tagSpaceReplacement,backupRetentionDays:sync?.backupRetentionDays});
    return result({status:"metadata-refreshed",publicationId:refreshed.publicationId,revision:refreshed.revision});
  }
  if(!paper.selectedPdf)throw new Error("Zotero item has no PDF attachment");
  if(!paper.selectedPdf.localPath)throw new Error("Selected Zotero PDF file location cannot be resolved; check Zotero file availability or ZOTERO_DATA_DIR");
  const pdfBytes=await readFile(paper.selectedPdf.localPath);
  const plan=await createSyncPlan({outputRoot:c.outputDir,paper,pdfBytes,parseOptions,namespace,cacheDir:sync?.cacheDir});
  const explicitAction=["reparse","restore","repair","apply"].includes(args.action??"");
  if(plan.status==="excluded")return result({status:"excluded",plan});
  if(plan.status==="recovery_required")throw new Error("RECOVERY_REQUIRED: "+plan.reason);
  if(plan.status==="conflict"&&!(plan.changes.includes("metadata_changed")&&!plan.changes.includes("parse_changed")))throw new Error("CONFLICT: "+plan.reason);
  if(plan.status==="missing"&&!explicitAction)return result({status:"skipped",plan});
  if(plan.status==="up_to_date"&&!explicitAction)return result({status:"done",zoteroKey:paper.zoteroKey,selectedAttachmentKey:paper.selectedPdf.key,plan});
  const key=plan.parseKey??parseKey(pdfBytes,parseOptions);
  const forceRemote=args.action==="reparse";
  const cachedBefore=forceRemote?null:await readCachedParse(c.outputDir,namespace,key,sync?.cacheDir);
  if((plan.status==="metadata_changed"||plan.status==="render_changed"||plan.status==="incomplete"||plan.status==="missing"||plan.status==="up_to_date")&&!cachedBefore) {
    if(plan.status!=="missing"&&plan.status!=="incomplete")return result({status:"planned",plan});
    if(!args.allowExternalUpload)throw new Error("SOURCE_UNAVAILABLE: no cached parse is available for "+plan.publicationId+"; explicit external upload authorization is required");
  }
  const allowUpload=args.allowExternalUpload===true&&c.research?.policy.allowExternalFulltextUpload===true;
  if(!cachedBefore&&!allowUpload)throw new Error("AUTH_REQUIRED: set allowExternalUpload=true for a MinerU upload");
  const run=await withParseLease(c.outputDir,namespace,key,()=>withParseTask(namespace+":"+key,async()=>{
    const cached=forceRemote?null:await readCachedParse(c.outputDir,namespace,key,sync?.cacheDir);if(cached)return {archive:cached.archive,pdfSha256:cached.pdfSha256,info:cached.info as Awaited<ReturnType<MinerUClient["extract"]>>["info"]};
    if(!c.mineruToken)throw new Error("MinerU credentials missing: set MINERU_API_TOKEN and reload Pi");
    const mineru=new MinerUClient({token:c.mineruToken,timeoutMs:c.mineruTimeoutMs,initialPollMs:c.mineruPollInitialMs,maxPollMs:c.mineruPollMaxMs,maxAttempts:c.mineruMaxAttempts,language:c.mineruLanguage,enableFormula:c.mineruEnableFormula,enableTable:c.mineruEnableTable,modelVersion:c.mineruModelVersion,isOcr:c.mineruIsOcr});
    const extracted=await mineru.extract(paper.selectedPdf!.localPath!,signal,stage=>onUpdate?.({content:[{type:"text",text:"MinerU: "+stage}],details:{stage}}));await writeCachedParse(c.outputDir,namespace,{archive:extracted.archive,pdfSha256:extracted.pdfSha256,parseKey:key,info:extracted.info},sync?.cacheDir);return extracted;
  }),sync?.cacheDir);
  const normalized=normalizeArchive(run.archive,"__ASSET_PREFIX__",signal,c.assetFilePrefix);const parsedAt=new Date().toISOString();
  const published=await publishPaper(c.outputDir,paper,normalized,{pdfSha256:run.pdfSha256,mineru:run.info,parsedAt},signal,{filenameSeparator:c.filenameSeparator,literaturesDirectory:c.literaturesDirectory,tagSpaceReplacement:c.tagSpaceReplacement,namespace,backupRetentionDays:sync?.backupRetentionDays,repair:args.action==="repair",targetDirectory:plan.relativePath??undefined,commit:async pub=>{await recordPublication(c.outputDir,paper,pub,{namespace,parseKey:key,managedAssets:normalized.assets.map(asset=>asset.name)});}});
  return result({status:cachedBefore?"cached":"done",zoteroKey:paper.zoteroKey,selectedAttachmentKey:paper.selectedPdf.key,...published});
}
export function registerScholarTools(pi:ExtensionAPI):void{
  pi.registerTool({name:"zotero_collections",label:"Zotero Collections",description:"Read-only list, metadata read, or item listing for Zotero Desktop collections. GET requests to loopback only. Output is limited to 50KB/2000 lines.",promptSnippet:"List or read local Zotero collections and their items",promptGuidelines:["Use zotero_collections to inspect local Zotero collection names, keys, metadata, and top-level items without modifying Zotero."],parameters:Type.Object({action:StringEnum(["list","read","items"] as const),key:Type.Optional(Type.String({pattern:"^[A-Z0-9]{8}$"})),limit:Type.Optional(Type.Integer({minimum:1,maximum:5000}))}),async execute(_id,p,signal,_onUpdate,ctx){const c=configFor(ctx);const z=zoteroFor(c);if(p.action==="read"){if(!p.key)throw new Error("zotero_collections read requires key");return result(await z.getCollection(p.key,signal));}if(p.action==="items"){if(!p.key)throw new Error("zotero_collections items requires key");return result(await z.listCollectionItems(p.key,p.limit,signal));}return result(await z.listCollections(p.limit,signal));}});
  pi.registerTool({name:"zotero_search",label:"Zotero Search",description:"Search or browse top-level items in the read-only Zotero Desktop Local API, optionally in a collection/type. Omit query (or use *) to list recently modified items. Output is limited to 50KB/2000 lines.",promptSnippet:"Search or browse the local Zotero library",promptGuidelines:["Use zotero_search to match online papers locally, preferring DOI and then normalized title/year.","For all or recent local papers, call zotero_search without query; browsing defaults to dateModified descending. A literal * is accepted as the same browse mode."],parameters:Type.Object({query:Type.Optional(Type.String({maxLength:1000})),collectionKey:Type.Optional(Type.String({pattern:"^[A-Z0-9]{8}$"})),itemType:Type.Optional(Type.String({minLength:1,maxLength:100})),sort:Type.Optional(StringEnum(["dateAdded","dateModified","title","creator","date"] as const)),direction:Type.Optional(StringEnum(["asc","desc"] as const)),limit:Type.Optional(Type.Integer({minimum:1,maximum:500}))}),async execute(_id,p,signal,_onUpdate,ctx){const c=configFor(ctx);const z=zoteroFor(c);return result(await z.searchItems(p.query??"",{...(p.collectionKey?{collectionKey:p.collectionKey}:{}),...(p.itemType?{itemType:p.itemType}:{}),...(p.sort?{sort:p.sort}:{}),...(p.direction?{direction:p.direction}:{}),...(p.limit?{limit:p.limit}:{})},signal));}});
  pi.registerTool({name:"zotero_item",label:"Zotero Item",description:"Read one raw Zotero item or its complete normalized Paper aggregate including notes, attachments, annotations, indexed-text availability and PDF location. Read-only; output limited to 50KB/2000 lines.",promptSnippet:"Read complete Zotero paper metadata and child content",promptGuidelines:["Use zotero_item with aggregate mode before analyzing or parsing a local paper."],parameters:Type.Object({key:Type.String({pattern:"^[A-Z0-9]{8}$"}),mode:StringEnum(["item","aggregate"] as const),attachmentKey:Type.Optional(Type.String({pattern:"^[A-Z0-9]{8}$"}))}),async execute(_id,p,signal,_onUpdate,ctx){const c=configFor(ctx);const z=zoteroFor(c);return result(p.mode==="item"?await z.getItem(p.key,signal):await z.getPaper(p.key,p.attachmentKey,signal));}});
  pi.registerTool({name:"pi_scholar_parse",label:"Parse Zotero PDF with MinerU",description:"Parse one Zotero PDF using safe incremental synchronization. External upload requires explicit authorization.",promptSnippet:"Parse a Zotero PDF into structured local Markdown and assets",promptGuidelines:["Use pi_scholar_parse when structured full text or figures are needed."],parameters:Type.Object({key:Type.String({pattern:"^[A-Z0-9]{8}$"}),attachmentKey:Type.Optional(Type.String({pattern:"^[A-Z0-9]{8}$"})),allowExternalUpload:Type.Optional(Type.Boolean())}),async execute(_id,p,signal,onUpdate,ctx){return executeSafeParse(p,signal,onUpdate as unknown as ((update:unknown)=>void),ctx);}});
  pi.registerTool({name:"pi_scholar_sync",label:"Pi Scholar Sync",description:"Plan and manage safe incremental synchronization with pi_scholar_sync.",promptSnippet:"Inspect or control safe Pi Scholar synchronization",promptGuidelines:["Use pi_scholar_sync status or plan before applying changes; missing publications are skipped unless restore is explicit."],parameters:Type.Object({action:StringEnum(["status","plan","apply","repair","restore","exclude","unexclude","reparse","recover"] as const),key:Type.Optional(Type.String({pattern:"^[A-Z0-9]{8}$"})),attachmentKey:Type.Optional(Type.String({pattern:"^[A-Z0-9]{8}$"})),reason:Type.Optional(Type.String({maxLength:500})),force:Type.Optional(Type.Boolean()),allowExternalUpload:Type.Optional(Type.Boolean())}),async execute(_id,p,signal,onUpdate,ctx){signal?.throwIfAborted();const c=configFor(ctx);if(p.action==="recover"){return result(await recoverSync(c.outputDir));}if(p.action==="status"&&!p.key)return result(await readSyncManifest(c.outputDir));if(!p.key)throw new Error("pi_scholar_sync "+p.action+" requires key");if(p.action==="exclude"||p.action==="unexclude"){const z=zoteroFor(c);const paper=await z.getPaper(p.key,p.attachmentKey,signal);const namespace=c.sync?.namespace??("vault-"+parseKey(Buffer.from(c.outputDir),{}).slice(0,16));const plan=await createSyncPlan({outputRoot:c.outputDir,paper,namespace,cacheDir:c.sync?.cacheDir});return result(p.action==="exclude"?await excludePublication(c.outputDir,plan.publicationId,p.reason):await unexcludePublication(c.outputDir,plan.publicationId));}if(p.action==="plan"||p.action==="status"){const z=zoteroFor(c);const paper=await z.getPaper(p.key,p.attachmentKey,signal);const namespace=c.sync?.namespace??("vault-"+parseKey(Buffer.from(c.outputDir),{}).slice(0,16));return result(await createSyncPlan({outputRoot:c.outputDir,paper,namespace,cacheDir:c.sync?.cacheDir}));}if(p.action==="apply"&&!p.force)throw new Error("Explicit force authorization is required for sync apply");return executeSafeParse({...p,key:p.key,allowExternalUpload:p.allowExternalUpload===true},signal,onUpdate as unknown as ((update:unknown)=>void),ctx);}});
}
