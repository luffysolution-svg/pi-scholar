import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import type { Paper, PublishedPaper } from "../model.js";
import { publishPaper, recoverPublications, sha256 } from "../output.js";
import { withLease } from "../storage/lease.js";

export type SyncStatus = "new"|"up_to_date"|"metadata_changed"|"parse_changed"|"render_changed"|"incomplete"|"missing"|"excluded"|"conflict"|"source_unavailable"|"recovery_required";
export type SyncAction = "skip"|"refresh_metadata"|"parse"|"render"|"repair"|"restore"|"exclude"|"unexclude"|"recover";

export interface SyncManifestEntry {
  publicationId: string; source: string; namespace: string; parentKey: string; attachmentKey: string|null;
  relativePath: string; metadataFingerprint: string; pdfSha256: string|null; parseKey: string|null; renderKey: string|null;
  parserVersion: string|null; artifacts: { markdown: string; metadata: string; assets: Record<string,string> };
  baseline: { markdownSha256: string; assets: Record<string,string>; generatedMarkdown?: string; metadataSha256?: string }|null;
  excluded: boolean; status: SyncStatus; transaction: { state: string; id?: string }|null; revision: number; updatedAt: string;
}
export interface SyncManifest { schemaVersion: 1; revision: number; entries: Record<string,SyncManifestEntry>; exclusions: Record<string,{reason?:string;at:string}>; }

export interface SyncPlan {
  revision: number; publicationId: string; status: SyncStatus; action: SyncAction; relativePath: string|null;
  metadataFingerprint: string; pdfSha256: string|null; parseKey: string|null; renderKey: string|null;
  changes: SyncStatus[];
  metadataDiff: string[]; missingFiles: string[]; userModified: string[]; cacheHit: boolean;
  remoteCall: "none"|"mineru"; estimatedCost: "none"|"unknown"; externalObjects: string[]; reason: string;
}
export interface SyncPlanInput {
  outputRoot: string; paper: Paper; pdfBytes?: Uint8Array|null; parseOptions?: Record<string,unknown>; renderOptions?: Record<string,unknown>;
  namespace?: string; source?: string; force?: boolean; cacheDir?: string; cacheAuthorizationScope?: string;
}

const manifestRelative = ".pi-scholar/manifest.json";
const cacheTasks = new Map<string, Promise<unknown>>();
const stable = (value: unknown): string => {
  if(value===null||typeof value!=="object")return JSON.stringify(value)??"null";
  if(Array.isArray(value))return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value as Record<string,unknown>).sort().map(k=>`${JSON.stringify(k)}:${stable((value as Record<string,unknown>)[k])}`).join(",")}}`;
};
const digest = (value: unknown): string => sha256(stable(value));
const rootOf = (root:string): string => path.resolve(root);
function safeRelative(value:string,label:string):string{if(!value||value.includes("\0")||path.isAbsolute(value)||/^[A-Za-z]:[\\/]/.test(value)||value.split(/[\\/]/).includes(".."))throw new Error(`Invalid manifest ${label}`);return value.replaceAll("\\","/");}
function validateManifestEntries(entries:Record<string,SyncManifestEntry>):void{for(const [id,entry] of Object.entries(entries)){if(!entry||entry.publicationId!==id)throw new Error("Invalid manifest publication identity");safeRelative(entry.relativePath,"relativePath");safeRelative(entry.artifacts?.markdown,"markdown artifact");safeRelative(entry.artifacts?.metadata,"metadata artifact");for(const name of Object.keys(entry.artifacts?.assets??{}))safeRelative(name,"asset path");}}
export function publicationId(paper: Pick<Paper,"zoteroKey"|"selectedPdf">, namespace=`vault-${sha256(rootOf(".")).slice(0,16)}`): string { return `zotero:${namespace}:${paper.zoteroKey}:${paper.selectedPdf?.key??"no-attachment"}`; }
export function metadataFingerprint(paper: Paper): string {
  return digest({zoteroKey:paper.zoteroKey,zoteroVersion:paper.zoteroVersion,itemType:paper.itemType,title:paper.title,creators:paper.creators,date:paper.date,year:paper.year,doi:paper.doi,isbn:paper.isbn,issn:paper.issn,publicationTitle:paper.publicationTitle,volume:paper.volume,issue:paper.issue,pages:paper.pages,url:paper.url,abstract:paper.abstract,tags:paper.tags,collections:paper.collections,notes:paper.notes,annotations:paper.annotations,attachments:paper.attachments.map(a=>({key:a.key,version:a.version,title:a.title,filename:a.filename,md5:a.md5,mtime:a.mtime,selected:a.selected}))});
}
export function parseKey(pdfBytes: Uint8Array, options: Record<string,unknown>={}, parserRevision="unknown"): string { return digest({pdfSha256:sha256(pdfBytes),options,parserRevision}); }
export function renderKey(artifact: Uint8Array|string, options: Record<string,unknown>={}): string { return digest({artifactSha256:sha256(artifact),options}); }

function emptyManifest(): SyncManifest { return {schemaVersion:1,revision:0,entries:{},exclusions:{}}; }
async function fileExists(p:string):Promise<boolean>{try{const info=await stat(p);return info.isFile()||info.isDirectory();}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return false;throw error;}}
async function rejectSymlink(p:string,label:string):Promise<void>{try{if((await lstat(p)).isSymbolicLink())throw new Error(`${label} must not be a symbolic link`);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}
function metadataBaselineHash(value:Record<string,unknown>):string{
  const copy=JSON.parse(JSON.stringify(value)) as Record<string,unknown>;
  if(copy.publication&&typeof copy.publication==="object")delete (copy.publication as Record<string,unknown>).baseline;
  return sha256(JSON.stringify(copy));
}
export async function readSyncManifest(outputRoot:string):Promise<SyncManifest>{
  try{
    const raw=JSON.parse(await readFile(path.join(rootOf(outputRoot),manifestRelative),"utf8")) as Partial<SyncManifest>;
    if(raw.schemaVersion!==1||!raw.entries||typeof raw.entries!=="object")throw new Error("invalid manifest");
    const entries=raw.entries as Record<string,SyncManifestEntry>;validateManifestEntries(entries);return {schemaVersion:1,revision:Number.isInteger(raw.revision)?raw.revision!:0,entries,exclusions:raw.exclusions&&typeof raw.exclusions==="object"?raw.exclusions as SyncManifest["exclusions"]:{}};
  }catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return emptyManifest();throw new Error(`Cannot read pi-scholar manifest: ${error instanceof Error?error.message:String(error)}`);}
}
async function writeAtomic(file:string,value:unknown):Promise<void>{
  await mkdir(path.dirname(file),{recursive:true});
  const tmp=`${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp,JSON.stringify(value,null,2)+"\n","utf8");
  await rename(tmp,file);
}
async function writeAtomicBytes(file:string,value:Uint8Array):Promise<void>{
  await mkdir(path.dirname(file),{recursive:true});
  const tmp=`${file}.${process.pid}.${randomUUID()}.tmp`;
  try{await writeFile(tmp,value);await rename(tmp,file);}finally{await rm(tmp,{force:true}).catch(()=>undefined);}
}
export async function writeSyncManifest(outputRoot:string,manifest:SyncManifest):Promise<void>{const root=rootOf(outputRoot);const lock=path.join(root,".pi-scholar","manifest.lock");await mkdir(path.dirname(lock),{recursive:true});await withLease(lock,async()=>{try{const current=JSON.parse(await readFile(path.join(root,manifestRelative),"utf8")) as Partial<SyncManifest>;if(Number.isInteger(current.revision)&&current.revision!==(manifest.revision-1))throw new Error("CONFLICT: synchronization manifest changed while writing");}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT"&&error instanceof Error&&error.message.startsWith("CONFLICT:"))throw error;}await writeAtomic(path.join(root,manifestRelative),manifest);},{leaseMs:30_000});}
export const getSyncStatus=readSyncManifest;
export const statusSync=readSyncManifest;

function relativeDirectory(root:string, absolute:string):string { return path.relative(rootOf(root),absolute).replaceAll(path.sep,"/"); }
async function findPublishedDirectory(root:string,id:string,paper:Paper):Promise<string|null>{
  const literature=path.join(rootOf(root),"Literatures");
  try{
    for(const entry of await readdir(literature,{withFileTypes:true})){
      if(!entry.isDirectory()||entry.name.startsWith("."))continue;
      try{
        const value=JSON.parse(await readFile(path.join(literature,entry.name,"metadata.json"),"utf8"));
        if(value?.publication?.id===id)return path.join(literature,entry.name);
        if(!value?.publication&&value?.zotero?.selected_key===paper.zoteroKey&&value?.selected_attachment_key===(paper.selectedPdf?.key??null))return path.join(literature,entry.name);
      }catch{/* unrelated or incomplete directory */}
    }
  }catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  return null;
}
async function pendingTransaction(root:string,id:string):Promise<boolean>{
  try{for(const file of await readdir(path.join(root,".pi-scholar","transactions"))){if(!file.endsWith(".json"))continue;try{const value=JSON.parse(await readFile(path.join(root,".pi-scholar","transactions",file),"utf8"));if(value?.publicationId===id&&["prepared","original_staged","new_installed","manifest_committed","cleanup_pending","recovery_required"].includes(value.state))return true;}catch{/* malformed journal is handled by recovery */}}}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}return false;
}
async function artifactState(directory:string,entry:SyncManifestEntry):Promise<{missing:string[];modified:string[]}>{
  await rejectSymlink(directory,"published directory");
  const missing:string[]=[];const modified:string[]=[];
  const md=path.join(directory,path.basename(entry.artifacts.markdown));
  await rejectSymlink(md,"markdown artifact");
  if(!await fileExists(md))missing.push(entry.artifacts.markdown);
  else if(entry.baseline&&sha256(await readFile(md))!==entry.baseline.markdownSha256)modified.push(entry.artifacts.markdown);
  const meta=path.join(directory,path.basename(entry.artifacts.metadata));
  await rejectSymlink(meta,"metadata artifact");
  if(!await fileExists(meta))missing.push(entry.artifacts.metadata);
  else if(entry.baseline?.metadataSha256){
    try{
      const value=JSON.parse(await readFile(meta,"utf8")) as Record<string,unknown>;
      if(metadataBaselineHash(value)!==entry.baseline.metadataSha256)modified.push(entry.artifacts.metadata);
    }catch{modified.push(entry.artifacts.metadata);}
  }
  const assetsDirectory=path.join(directory,"assets");
  await rejectSymlink(assetsDirectory,"assets directory");
  for(const [name,hash] of Object.entries(entry.artifacts.assets??{})){
    const p=path.join(directory,"assets",name);
    await rejectSymlink(p,"asset artifact");
    if(!await fileExists(p))missing.push(`assets/${name}`); else if(entry.baseline&&entry.baseline.assets[name]&&sha256(await readFile(p))!==entry.baseline.assets[name])modified.push(`assets/${name}`);
    void hash;
  }
  return {missing,modified};
}

export async function createSyncPlan(input:SyncPlanInput):Promise<SyncPlan>{
  const root=rootOf(input.outputRoot);const namespace=input.namespace??`vault-${sha256(root).slice(0,16)}`;const id=publicationId(input.paper,namespace);
  const manifest=await readSyncManifest(root);const entry=manifest.entries[id];const metadata=metadataFingerprint(input.paper);
  const pdfHash=input.pdfBytes?sha256(input.pdfBytes):null;
  const pkey=input.pdfBytes?parseKey(input.pdfBytes,input.parseOptions):null;const rkey=entry?.renderKey??null;
  const relative=entry?.relativePath??null;const missing:string[]=[];const modified:string[]=[];let status:SyncStatus;let action:SyncAction;let reason="";let candidateRenderKey:string|null=null;let cacheHit=false;
  if(manifest.exclusions[id]||entry?.excluded){status="excluded";action="skip";reason="publication is explicitly excluded";}
  else if(await pendingTransaction(root,id)){status="recovery_required";action="recover";reason="publication has an unfinished transaction journal";}
  else if(entry?.transaction&&entry.transaction.state!=="done"){status="recovery_required";action="recover";reason="previous publication transaction is incomplete";}
  else if(!entry){const directory=await findPublishedDirectory(root,id,input.paper);if(directory){status="incomplete";action="repair";reason="legacy publication found without manifest entry";}else{status="new";action="parse";reason="no publication record exists";}}
  else {
    const directory=path.join(root,entry.relativePath);if(!await fileExists(directory)){status="missing";action="skip";reason="published directory is absent; explicit restore is required";}
    else {
      const state=await artifactState(directory,entry);missing.push(...state.missing);modified.push(...state.modified);
      if(input.renderOptions){try{candidateRenderKey=renderKey(await readFile(path.join(directory,path.basename(entry.artifacts.markdown))),input.renderOptions);}catch{/* missing is handled above */}}
      const metadataChanged=metadata!==entry.metadataFingerprint;
      const parseChanged=Boolean(pkey&&(entry.parseKey?pkey!==entry.parseKey:true)||(pdfHash&&entry.pdfSha256&&pdfHash!==entry.pdfSha256));
      const renderChanged=Boolean(candidateRenderKey&&entry.renderKey&&candidateRenderKey!==entry.renderKey);
      if(modified.length){status="conflict";action="skip";reason="local generated content differs from the recorded baseline";}
      else if(missing.length){status="incomplete";action="repair";reason="managed artifacts are missing or invalid";}
      else if(parseChanged){status="parse_changed";action="parse";reason="PDF bytes or effective parser options changed";}
      else if(renderChanged){status="render_changed";action="render";reason="local rendering inputs changed";}
      else if(metadataChanged){status="metadata_changed";action="refresh_metadata";reason="bibliographic or Zotero child metadata changed";}
      else{status="up_to_date";action="skip";reason="inputs and managed artifacts match the manifest";}
    }
  }
  if(entry?.parseKey)cacheHit=Boolean(await readCachedParse(root,namespace,entry.parseKey,input.cacheDir,input.cacheAuthorizationScope??"default"));
  if(action==="parse"&&pkey)cacheHit=Boolean(await readCachedParse(root,namespace,pkey,input.cacheDir,input.cacheAuthorizationScope??"default"));
  const changes:SyncStatus[]=[];if(modified.length)changes.push("conflict");if(missing.length)changes.push("incomplete");if(entry&&metadata!==entry.metadataFingerprint)changes.push("metadata_changed");if(entry&&pkey&&(entry.parseKey?pkey!==entry.parseKey:true)||(entry&&pdfHash&&entry.pdfSha256&&pdfHash!==entry.pdfSha256))changes.push("parse_changed");if(entry&&candidateRenderKey&&entry.renderKey&&candidateRenderKey!==entry.renderKey)changes.push("render_changed");const parseNeeded=action==="parse";const remote=parseNeeded&&!cacheHit;return {revision:manifest.revision,publicationId:id,status,action,relativePath:relative,metadataFingerprint:metadata,pdfSha256:pdfHash,parseKey:pkey,renderKey:candidateRenderKey??rkey,changes,metadataDiff:entry&&metadata!==entry.metadataFingerprint?["bibliographic metadata"]:[],missingFiles:missing,userModified:modified,cacheHit,remoteCall:remote?"mineru":"none",estimatedCost:remote?"unknown":"none",externalObjects:remote&&input.pdfBytes?["PDF bytes to MinerU"]:[],reason};
}
export const planSync=createSyncPlan;

/** Execute a caller supplied write operation only when its local plan is still current. */
export async function applySync<T>(plan:SyncPlan,input:SyncPlanInput,apply:(plan:SyncPlan)=>Promise<T>|T):Promise<T>{
  const current=await createSyncPlan(input);
  if(current.revision!==plan.revision||current.publicationId!==plan.publicationId||current.metadataFingerprint!==plan.metadataFingerprint||current.pdfSha256!==plan.pdfSha256||current.status!==plan.status)throw new Error("CONFLICT: synchronization plan is stale; replan required");
  if(current.status==="conflict"||current.status==="recovery_required")throw new Error(`CONFLICT: ${current.reason}`);
  return apply(current);
}

export async function recordPublication(outputRoot:string,paper:Paper,published:PublishedPaper,opts:{namespace?:string;source?:string;parseKey?:string;renderKey?:string;renderOptions?:Record<string,unknown>;metadataFingerprint?:string;managedAssets?:string[]}={}):Promise<SyncManifestEntry>{
  const root=rootOf(outputRoot);const namespace=opts.namespace??published.namespace??`vault-${sha256(root).slice(0,16)}`;const id=published.publicationId??publicationId(paper,namespace);const manifest=await readSyncManifest(root);
  const relative=relativeDirectory(root,path.dirname(published.markdownPath));const markdown=await readFile(published.markdownPath);const assets:Record<string,string>={};let sidecar:Record<string,unknown>|undefined;let recordedBaseline:SyncManifestEntry["baseline"]=null;
  try{sidecar=JSON.parse(await readFile(published.metadataPath,"utf8"));const publication=sidecar&&sidecar.publication;const raw=publication&&typeof publication==="object"?(publication as Record<string,unknown>).baseline:undefined;if(raw&&typeof raw==="object"){const value=raw as Record<string,unknown>;if(typeof value.markdownSha256==="string"&&value.assets&&typeof value.assets==="object")recordedBaseline={markdownSha256:value.markdownSha256,assets:value.assets as Record<string,string>,...(typeof value.generatedMarkdown==="string"?{generatedMarkdown:value.generatedMarkdown}:{}),...(typeof value.metadataSha256==="string"?{metadataSha256:value.metadataSha256}:{})};}}catch{/* malformed sidecar is reported by the publisher */}
  let sidecarManaged:string[]|undefined=opts.managedAssets;
  const publication=sidecar?.publication;
  const baselineValue=publication&&typeof publication==="object"?(publication as Record<string,unknown>).baseline:undefined;
  if(!sidecarManaged&&baselineValue&&typeof baselineValue==="object"){
    const raw=(baselineValue as Record<string,unknown>).assets;
    if(raw&&typeof raw==="object")sidecarManaged=Object.keys(raw);
  }
  try{for(const name of sidecarManaged??await readdir(published.assetsDirectory))assets[name]=sha256(await readFile(path.join(published.assetsDirectory,name)));}catch{/* no assets directory is valid */}
  const fingerprint=opts.metadataFingerprint??metadataFingerprint(paper);const key=opts.parseKey??null;const rendered=opts.renderKey??renderKey(markdown,opts.renderOptions??{});const artifacts={markdown:path.basename(published.markdownPath),metadata:path.basename(published.metadataPath),assets};const existing=manifest.entries[id];
  if(existing&&existing.source===(opts.source??existing.source)&&existing.namespace===namespace&&existing.parentKey===paper.zoteroKey&&existing.attachmentKey===(paper.selectedPdf?.key??null)&&existing.relativePath===relative&&existing.metadataFingerprint===fingerprint&&existing.pdfSha256===published.pdfSha256&&existing.parseKey===key&&existing.renderKey===rendered&&JSON.stringify(existing.artifacts)===JSON.stringify(artifacts)&&JSON.stringify(existing.baseline)===JSON.stringify(recordedBaseline??{markdownSha256:sha256(markdown),assets})&&existing.excluded===false&&existing.transaction?.state==="done")return existing;
  const entry:SyncManifestEntry={publicationId:id,source:opts.source??"zotero",namespace,parentKey:paper.zoteroKey,attachmentKey:paper.selectedPdf?.key??null,relativePath:relative,metadataFingerprint:fingerprint,pdfSha256:published.pdfSha256,parseKey:key,renderKey:rendered,parserVersion:published.mineru.parserVersion,artifacts,baseline:recordedBaseline??{markdownSha256:sha256(markdown),assets},excluded:false,status:"up_to_date",transaction:{state:"done"},revision:manifest.revision+1,updatedAt:new Date().toISOString()};
  manifest.revision+=1;manifest.entries[id]=entry;delete manifest.exclusions[id];await writeSyncManifest(root,manifest);return entry;
}
export async function setExcluded(outputRoot:string,id:string,excluded:boolean,reason?:string):Promise<SyncManifest>{const manifest=await readSyncManifest(outputRoot);manifest.revision+=1;if(excluded){manifest.exclusions[id]={...(reason?{reason}:{}),at:new Date().toISOString()};if(manifest.entries[id])manifest.entries[id]!.excluded=true;}else{delete manifest.exclusions[id];if(manifest.entries[id])manifest.entries[id]!.excluded=false;}await writeSyncManifest(outputRoot,manifest);return manifest;}
export const excludePublication=(root:string,id:string,reason?:string)=>setExcluded(root,id,true,reason);
export const unexcludePublication=(root:string,id:string)=>setExcluded(root,id,false);

export interface CachedParse { pdfSha256:string; parseKey:string; archive:Uint8Array; info:unknown; }
function cacheRoot(outputRoot:string,namespace:string,parseKeyValue:string,configured?:string):string{const base=configured?rootOf(configured):path.join(os.homedir(),".cache","pi-scholar","parse");return path.join(base,`vault-${sha256(rootOf(outputRoot)).slice(0,24)}`,namespace,parseKeyValue);}
export async function readCachedParse(outputRoot:string,namespace:string,key:string,configuredCacheDir?:string,authorizationScope="default"):Promise<CachedParse|null>{try{const scopedNamespace=`${namespace}-${sha256(authorizationScope).slice(0,16)}`;const dir=cacheRoot(outputRoot,scopedNamespace,key,configuredCacheDir);const [archive,meta]=await Promise.all([readFile(path.join(dir,"result.zip")),readFile(path.join(dir,"meta.json"))]);const value=JSON.parse(meta.toString("utf8"));if(String(value.parseKey)!==key||String(value.authorizationScope)!==authorizationScope||sha256(archive)!==String(value.archiveSha256))return null;return {pdfSha256:String(value.pdfSha256),parseKey:key,archive,info:value.info};}catch{return null;}}
export async function writeCachedParse(outputRoot:string,namespace:string,value:CachedParse,configuredCacheDir?:string,authorizationScope="default"):Promise<void>{const scopedNamespace=`${namespace}-${sha256(authorizationScope).slice(0,16)}`;const dir=cacheRoot(outputRoot,scopedNamespace,value.parseKey,configuredCacheDir);await mkdir(dir,{recursive:true});await writeAtomicBytes(path.join(dir,"result.zip"),value.archive);await writeAtomic(path.join(dir,"meta.json"),{pdfSha256:value.pdfSha256,parseKey:value.parseKey,authorizationScope,archiveSha256:sha256(value.archive),info:value.info});}
export async function withParseTask<T>(key:string,task:()=>Promise<T>):Promise<T>{const running=cacheTasks.get(key) as Promise<T>|undefined;if(running)return running;const current=task();cacheTasks.set(key,current);try{return await current;}finally{if(cacheTasks.get(key)===current)cacheTasks.delete(key);}}
export async function withParseLease<T>(outputRoot:string,namespace:string,key:string,task:()=>Promise<T>,configuredCacheDir?:string):Promise<T>{const lock=path.join(cacheRoot(outputRoot,namespace,key,configuredCacheDir),"in-flight.lock");await mkdir(path.dirname(lock),{recursive:true});return withLease(lock,async()=>task(),{leaseMs:3_600_000});}

export async function restorePublication(outputRoot:string,id:string):Promise<SyncPlan>{const manifest=await readSyncManifest(outputRoot);const entry=manifest.entries[id];if(!entry)throw new Error(`NOT_FOUND: ${id}`);if(manifest.exclusions[id]||entry.excluded)throw new Error(`EXCLUDED: ${id}; call unexclude first`);const dir=path.join(rootOf(outputRoot),entry.relativePath);if(await fileExists(dir))return {revision:manifest.revision,publicationId:id,status:"up_to_date",action:"skip",relativePath:entry.relativePath,metadataFingerprint:entry.metadataFingerprint,pdfSha256:entry.pdfSha256,parseKey:entry.parseKey,renderKey:entry.renderKey,changes:[],metadataDiff:[],missingFiles:[],userModified:[],cacheHit:Boolean(entry.parseKey),remoteCall:"none",estimatedCost:"none",externalObjects:[],reason:"publication is already present"};return {revision:manifest.revision,publicationId:id,status:"missing",action:"restore",relativePath:entry.relativePath,metadataFingerprint:entry.metadataFingerprint,pdfSha256:entry.pdfSha256,parseKey:entry.parseKey,renderKey:entry.renderKey,changes:["missing"],metadataDiff:[],missingFiles:[entry.relativePath],userModified:[],cacheHit:Boolean(entry.parseKey),remoteCall:entry.parseKey?"none":"mineru",estimatedCost:entry.parseKey?"none":"unknown",externalObjects:[],reason:"restore requested explicitly"};}
export const repairPublication=restorePublication;

/** Refresh bibliographic/Zotero-managed metadata from the existing generated parse.
 * This deliberately never reads the PDF or calls MinerU. The normal publication
 * transaction still protects the note and sidecar if the final commit fails.
 */
export async function refreshPublicationMetadata(outputRoot:string,paper:Paper,opts:{namespace?:string;filenameSeparator?:string;literaturesDirectory?:string;tagSpaceReplacement?:"-"|"_";backupRetentionDays?:number}={}):Promise<SyncManifestEntry>{
  const root=rootOf(outputRoot);const namespace=opts.namespace??`vault-${sha256(root).slice(0,16)}`;const id=publicationId(paper,namespace);const manifest=await readSyncManifest(root);const entry=manifest.entries[id];
  if(!entry)throw new Error(`NOT_FOUND: ${id}`);if(manifest.exclusions[id]||entry.excluded)throw new Error(`EXCLUDED: ${id}; call unexclude first`);
  const directory=path.join(root,entry.relativePath);const markdownPath=path.join(directory,path.basename(entry.artifacts.markdown));const metadataPath=path.join(directory,path.basename(entry.artifacts.metadata));
  const current=await readFile(markdownPath,"utf8");const match=/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/.exec(current);if(!match)throw new Error("CONFLICT: generated Markdown frontmatter is missing or malformed");
  const body=current.slice(match[0].length).replace(/^\r?\n/,"");const sidecar=JSON.parse(await readFile(metadataPath,"utf8")) as Record<string,unknown>;const pdf=sidecar.pdf&&typeof sidecar.pdf==="object"?(sidecar.pdf as Record<string,unknown>):{};const parsedAt=typeof sidecar.parsed_at==="string"?sidecar.parsed_at:new Date().toISOString();const mineru=sidecar.mineru;
  if(!mineru||typeof mineru!=="object")throw new Error("SOURCE_UNAVAILABLE: existing parse metadata is incomplete");
  const assets:{name:string;bytes:Buffer}[]=[];for(const name of Object.keys(entry.artifacts.assets??{})){assets.push({name,bytes:await readFile(path.join(directory,"assets",name))});}
  const pdfSha256=typeof pdf.sha256==="string"?pdf.sha256:entry.pdfSha256;if(!pdfSha256)throw new Error("SOURCE_UNAVAILABLE: existing PDF hash is missing");
  const data={pdfSha256,mineru:mineru as PublishedPaper["mineru"],parsedAt};
  const normalized={body,assets};
  const published=await publishPaper(root,paper,normalized,data,undefined,{namespace,filenameSeparator:opts.filenameSeparator,literaturesDirectory:opts.literaturesDirectory,tagSpaceReplacement:opts.tagSpaceReplacement,backupRetentionDays:opts.backupRetentionDays,targetDirectory:entry.relativePath,baseline:entry.baseline??undefined,commit:async pub=>{await recordPublication(root,paper,pub,{namespace,parseKey:entry.parseKey??undefined,renderKey:entry.renderKey??undefined,managedAssets:Object.keys(entry.artifacts.assets??{})});}});
  return (await readSyncManifest(root)).entries[id]!;
}
function recoverPaper(sidecar:Record<string,unknown>,published:PublishedPaper):Paper{
  const bibliographic=sidecar.bibliographic&&typeof sidecar.bibliographic==="object"?sidecar.bibliographic as Record<string,unknown>:{};
  const zotero=sidecar.zotero&&typeof sidecar.zotero==="object"?sidecar.zotero as Record<string,unknown>:{};
  const publication=sidecar.publication&&typeof sidecar.publication==="object"?sidecar.publication as Record<string,unknown>:{};
  const parentKey=typeof publication.parent_key==="string"?publication.parent_key:typeof zotero.selected_key==="string"?zotero.selected_key:"";
  const attachmentKey=typeof publication.attachment_key==="string"?publication.attachment_key:typeof sidecar.selected_attachment_key==="string"?sidecar.selected_attachment_key:null;
  if(!parentKey||published.publicationId===undefined)throw new Error("CONFLICT: transaction sidecar does not prove publication identity");
  const rawAttachments=Array.isArray(sidecar.attachments)?sidecar.attachments:[];
  const attachments=rawAttachments.map(value=>{if(!value||typeof value!=="object")throw new Error("CONFLICT: transaction sidecar has invalid attachment metadata");return {...value,localPath:null,path:null};}) as Paper["attachments"];
  const selectedPdf=attachments.find(attachment=>attachment.key===attachmentKey)??(attachmentKey?{key:attachmentKey,version:0,parentItem:parentKey,title:"",filename:null,contentType:"application/pdf",linkMode:null,path:null,md5:null,mtime:null,selected:true,localPath:null,indexedText:{status:"unavailable" as const},annotations:[]}:null);
  const creators=Array.isArray(bibliographic.authors)?bibliographic.authors:[];
  const collections=Array.isArray(bibliographic.collections)?bibliographic.collections:[];
  const notes=Array.isArray(sidecar.notes)?sidecar.notes:[];const annotations=Array.isArray(sidecar.annotations)?sidecar.annotations:[];
  return {zoteroKey:parentKey,zoteroVersion:typeof zotero.selected_version==="number"?zotero.selected_version:0,itemType:typeof (zotero.selected_metadata as Record<string,unknown>|undefined)?.itemType==="string"?(zotero.selected_metadata as Record<string,unknown>).itemType as string:"journalArticle",title:typeof bibliographic.title==="string"?bibliographic.title:"Recovered publication",creators:creators as Paper["creators"],metadata:zotero.selected_metadata&&typeof zotero.selected_metadata==="object"?zotero.selected_metadata as Record<string,unknown>:{},date:typeof bibliographic.date==="string"?bibliographic.date:null,year:typeof bibliographic.year==="string"?bibliographic.year:null,doi:typeof bibliographic.doi==="string"?bibliographic.doi:null,isbn:typeof bibliographic.isbn==="string"?bibliographic.isbn:null,issn:typeof bibliographic.issn==="string"?bibliographic.issn:null,publicationTitle:typeof bibliographic.publication_title==="string"?bibliographic.publication_title:null,volume:typeof bibliographic.volume==="string"?bibliographic.volume:null,issue:typeof bibliographic.issue==="string"?bibliographic.issue:null,pages:typeof bibliographic.pages==="string"?bibliographic.pages:null,url:typeof bibliographic.url==="string"?bibliographic.url:null,abstract:typeof bibliographic.abstract==="string"?bibliographic.abstract:null,tags:Array.isArray(bibliographic.tags)?bibliographic.tags.filter((value):value is string=>typeof value==="string"):[],collections:collections as Paper["collections"],notes:notes as Paper["notes"],annotations:annotations as Paper["annotations"],attachments,selectedPdf};
}
/** Recover unfinished publication transactions while holding the same output lease as publishing. */
export async function recoverSync(outputRoot:string):Promise<Array<{id:string;state:string;reason?:string}>>{
  const root=rootOf(outputRoot);try{const info=await lstat(root);if(!info.isDirectory()||info.isSymbolicLink())throw new Error("CONFLICT: output root must be a regular directory");}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return [];throw error;}
  const lock=path.join(root,".pi-scholar-locks","publish.lock");await mkdir(path.dirname(lock),{recursive:true});
  return withLease(lock,async()=>recoverPublications(root,async published=>{
    const sidecar=JSON.parse(await readFile(published.metadataPath,"utf8")) as Record<string,unknown>;const paper=recoverPaper(sidecar,published);const namespace=published.namespace??`vault-${sha256(root).slice(0,16)}`;const manifest=await readSyncManifest(root);const current=manifest.entries[published.publicationId!];
    await recordPublication(root,paper,published,{namespace,parseKey:current?.parseKey??undefined,renderKey:current?.renderKey??undefined,managedAssets:current?Object.keys(current.artifacts.assets):undefined});
  }));
}
export async function listSyncTransactions(outputRoot:string):Promise<Record<string,unknown>[]> {const out:Record<string,unknown>[]=[];try{for(const name of await readdir(path.join(rootOf(outputRoot),".pi-scholar","transactions"))){if(name.endsWith(".json")){try{out.push(JSON.parse(await readFile(path.join(rootOf(outputRoot),".pi-scholar","transactions",name),"utf8")));}catch{/* malformed journal */}}}}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}return out;}
export const listSyncState=listSyncTransactions;
export async function clearParseCache(outputRoot:string,configuredCacheDir?:string):Promise<void>{const base=configuredCacheDir?rootOf(configuredCacheDir):path.join(os.homedir(),".cache","pi-scholar","parse");const vault=path.join(base,`vault-${sha256(rootOf(outputRoot)).slice(0,24)}`);try{await rm(vault,{recursive:true,force:true});}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}
