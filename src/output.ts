import path from "node:path";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import AdmZip from "adm-zip";
import YAML from "yaml";
import type { Paper, PublishedPaper } from "./model.js";

const INVALID=/[<>:"/\\|?*\u0000-\u001f]/g;
const RESERVED=/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const IMAGE_EXT=/^\.(png|jpe?g|gif|webp|bmp|svg)$/;
const MAX_ENTRIES=10_000;
const MAX_EXPANDED=1024*1024*1024;

function component(value:string,fallback:string):string {
  let s=value.normalize("NFC").replace(/<[^>]*>/g,"").replace(/\+/g," ").replace(INVALID," ").replace(/\s+/g," ").trim().replace(/[. ]+$/g,"");
  if(!s||s==="."||s==="..")s=fallback;
  if(RESERVED.test(s))s=`_${s}`;
  return s;
}
function utf8Limit(value:string,max:number):string {
  const points=Array.from(value);
  while(Buffer.byteLength(points.join(""),"utf8")>max)points.pop();
  return points.join("").replace(/[. ]+$/g,"")||"Untitled";
}
export function paperStem(paper: Pick<Paper,"creators"|"year"|"title">,separator="+"):string {
  const first=paper.creators.find(c=>c.creatorType==="author");
  const author=component(first?.lastName ?? first?.name ?? "UnknownAuthor","UnknownAuthor");
  const year=component(paper.year ?? "UnknownYear","UnknownYear");
  const title=component(paper.title,"Untitled");
  return utf8Limit([author,year,title].join(separator),220);
}

export interface NormalizedArchive { body:string; assets:{name:string;bytes:Buffer}[] }
function safeEntry(name:string):string {
  const n=name.replace(/\\/g,"/");
  if(!n||n.startsWith("/")||/^[A-Za-z]:/.test(n)||n.split("/").includes("..")||n.includes("\0"))throw new Error(`Unsafe MinerU archive entry: ${name}`);
  const normalized=path.posix.normalize(n).replace(/^\.\//,"");
  if(!normalized||normalized==="."||normalized.startsWith("../"))throw new Error(`Unsafe MinerU archive entry: ${name}`);
  return normalized;
}

interface CentralEntry { name:string; expanded:number; mode:number }
function inspectCentralDirectory(bytes:Buffer):CentralEntry[] {
  let eocd=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65_557);i--){if(bytes.readUInt32LE(i)===0x06054b50){eocd=i;break;}}
  if(eocd<0)throw new Error("MinerU result archive is corrupt");
  const count=bytes.readUInt16LE(eocd+10);
  const offset=bytes.readUInt32LE(eocd+16);
  if(count>MAX_ENTRIES)throw new Error(`MinerU archive exceeds ${MAX_ENTRIES} entries`);
  const entries:CentralEntry[]=[];
  let cursor=offset;
  for(let i=0;i<count;i++){
    if(cursor+46>bytes.length||bytes.readUInt32LE(cursor)!==0x02014b50)throw new Error("MinerU result archive has a malformed directory");
    const flags=bytes.readUInt16LE(cursor+8);
    if(flags&1)throw new Error("MinerU archive contains an encrypted entry");
    const expanded=bytes.readUInt32LE(cursor+24);
    const nameLength=bytes.readUInt16LE(cursor+28),extraLength=bytes.readUInt16LE(cursor+30),commentLength=bytes.readUInt16LE(cursor+32);
    const end=cursor+46+nameLength+extraLength+commentLength;
    if(end>bytes.length)throw new Error("MinerU result archive has a malformed entry");
    const nameBytes=bytes.subarray(cursor+46,cursor+46+nameLength);
    const name=(flags&0x800?nameBytes.toString("utf8"):nameBytes.toString("latin1"));
    safeEntry(name);
    entries.push({name,expanded,mode:(bytes.readUInt32LE(cursor+38)>>>16)&0xf000});
    cursor=end;
  }
  return entries;
}

export function normalizeArchive(bytes:Uint8Array,assetPrefix:string,signal?:AbortSignal,assetFilePrefix="figure"):NormalizedArchive {
  signal?.throwIfAborted();
  const buffer=Buffer.from(bytes);
  const central=inspectCentralDirectory(buffer);
  let declared=0;
  for(const entry of central){declared+=entry.expanded;if(declared>MAX_EXPANDED)throw new Error("MinerU archive expands beyond 1 GB");if(entry.mode===0xa000)throw new Error("MinerU archive contains a symbolic link");}
  let zip:AdmZip;
  try{zip=new AdmZip(buffer);}catch{throw new Error("MinerU result archive is corrupt");}
  const entries=zip.getEntries();
  if(entries.length!==central.length)throw new Error("MinerU result archive directory is inconsistent");
  let expanded=0;
  const files=new Map<string,Buffer>();
  for(let i=0;i<entries.length;i++){
    signal?.throwIfAborted();
    const entry=entries[i]!,declaredEntry=central[i]!;
    const name=safeEntry(declaredEntry.name);
    if(entry.isDirectory)continue;
    const data=entry.getData();
    expanded+=data.length;
    if(expanded>MAX_EXPANDED)throw new Error("MinerU archive expands beyond 1 GB");
    if(files.has(name))throw new Error("MinerU archive contains duplicate entries");
    files.set(name,data);
  }
  const candidates=[...files.keys()].filter(n=>path.posix.basename(n)==="full.md").sort((a,b)=>a.split("/").length-b.split("/").length||a.localeCompare(b));
  const md=candidates[0] ?? [...files.keys()].filter(n=>/\.md$/i.test(n)).sort()[0];
  if(!md)throw new Error("MinerU result archive contains no Markdown");
  let body=files.get(md)!.toString("utf8").replace(/^\uFEFF/,"").replace(/\r\n?/g,"\n");
  if(body.startsWith("---\n")){const end=body.indexOf("\n---\n",4);if(end>=0)body=body.slice(end+5);}
  const mdDir=path.posix.dirname(md);
  const assets:{name:string;bytes:Buffer}[]=[];
  const mapped=new Map<string,string>();
  const resolve=(raw:string):string=>{
    signal?.throwIfAborted();
    let clean:string;
    try{clean=decodeURIComponent(raw.trim().replace(/^<|>$/g,"").split(/[?#]/,1)[0]!);}catch{throw new Error(`MinerU Markdown contains an invalid image path: ${raw}`);}
    if(/^(?:[a-z][a-z\d+.-]*:|\/|\\|#)/i.test(clean))throw new Error("MinerU Markdown contains a non-local or absolute image reference");
    const source=safeEntry(path.posix.join(mdDir,clean));
    const data=files.get(source);
    if(!data)throw new Error(`MinerU Markdown references missing asset: ${clean}`);
    let name=mapped.get(source);
    if(!name){const ext=path.posix.extname(source).toLowerCase();if(!IMAGE_EXT.test(ext))throw new Error(`Unsupported MinerU image type: ${ext}`);name=`${assetFilePrefix}-${String(assets.length+1).padStart(2,"0")}${ext}`;mapped.set(source,name);assets.push({name,bytes:data});}
    return `${assetPrefix}/${name}`;
  };
  body=body.replace(/!\[([^\]]*)\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^"']*["'])?\s*\)/g,(_m,alt,dest)=>`![${alt}](<${resolve(dest)}>)`);
  const imageRefs=new Set<string>();
  body.replace(/!\[[^\]]*\]\[([^\]]+)\]/g,(_m,id)=>{imageRefs.add(String(id).toLowerCase());return _m;});
  body=body.replace(/^\[([^\]]+)\]:\s*(<[^>]+>|\S+)(.*)$/gm,(m,id,dest,tail)=>imageRefs.has(String(id).toLowerCase())?`[${id}]: <${resolve(dest)}>${tail}`:m);
  body=body.replace(/<img\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>/gi,(_m,before,src,after)=>{const alt=(`${before} ${after}`.match(/\balt=["']([^"']*)["']/i)?.[1]??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));return `<img src="${resolve(src)}" alt="${alt}"/>`;});
  return {body:body.trim()+"\n",assets};
}

function plainText(value:string):string{return value.replace(/^\/?jats:title>\s*/i,"").replace(/<[^>]*>/g,"").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&quot;/gi,'"').replace(/&#(?:39|x27);/gi,"'").replace(/\s+/g," ").trim();}
function authorNames(paper:Paper):string{return paper.creators.filter(creator=>creator.creatorType==="author").map(creator=>creator.name??[creator.firstName,creator.lastName].filter(Boolean).join(" ")).filter(Boolean).join("; ");}
export function obsidianTags(tags:string[],spaceReplacement:"-"|"_"="-"):string[]{return [...new Set(tags.map(value=>{let tag=value.normalize("NFKC").trim().replace(/^#+/,"").replace(/\s+/g,spaceReplacement).replace(/[^\p{L}\p{N}_\/-]+/gu,spaceReplacement);const repeated=spaceReplacement==="-"?/-+/g:/_+/g;tag=tag.replace(repeated,spaceReplacement).split("/").map(part=>part.replace(/^[-_]+|[-_]+$/g,"")).filter(Boolean).join("/");if(/^\d+$/.test(tag))tag=`tag-${tag}`;return tag;}).filter(Boolean))];}
function safeAttachments(paper:Paper):unknown[]{return paper.attachments.map(({localPath:_localPath,path:_path,...attachment})=>({...attachment,indexedText:attachment.indexedText.status==="available"?{...attachment.indexedText,content:undefined}:attachment.indexedText}));}

/** Compact, human-facing properties. Verbose provenance lives in metadata.json. */
export function frontmatter(paper:Paper,published:Omit<PublishedPaper,"markdownPath"|"assetsDirectory">,tagSpaceReplacement:"-"|"_"="-"):Record<string,unknown>{
  const authors=authorNames(paper);
  return {
    schema_version:1,
    title:plainText(paper.title),
    ...(authors?{authors}:{}),
    ...(paper.year?{year:paper.year}:{}),
    ...(paper.date&&paper.date!==paper.year?{date:paper.date}:{}),
    ...(paper.doi?{doi:paper.doi}:{}),
    ...(paper.isbn?{isbn:paper.isbn}:{}),
    ...(paper.issn?{issn:paper.issn}:{}),
    ...(paper.publicationTitle?{journal:paper.publicationTitle}:{}),
    ...(paper.volume?{volume:paper.volume}:{}),
    ...(paper.issue?{issue:paper.issue}:{}),
    ...(paper.pages?{pages:paper.pages}:{}),
    ...(paper.url?{url:paper.url}:{}),
    ...(paper.tags.length?{tags:obsidianTags(paper.tags,tagSpaceReplacement)}:{}),
    zotero:`zotero://select/library/items/${paper.zoteroKey}`,
    ...(paper.selectedPdf?{zotero_pdf:`zotero://open-pdf/library/items/${paper.selectedPdf.key}`}:{ }),
    parsed_at:published.parsedAt,
  };
}

/** Complete, path-safe provenance kept out of note-property UIs. */
export function metadataSidecar(paper:Paper,published:Omit<PublishedPaper,"markdownPath"|"assetsDirectory">):Record<string,unknown>{
  return {
    schema_version:1,
    bibliographic:{title:plainText(paper.title),authors:paper.creators,date:paper.date,year:paper.year,doi:paper.doi,isbn:paper.isbn,issn:paper.issn,publication_title:paper.publicationTitle,volume:paper.volume,issue:paper.issue,pages:paper.pages,url:paper.url,abstract:paper.abstract,tags:paper.tags,collections:paper.collections},
    zotero:{selected_key:paper.zoteroKey,selected_version:paper.zoteroVersion,selected_metadata:paper.metadata,...(paper.bibliographicEnrichment?{enrichment:{source_key:paper.bibliographicEnrichment.zoteroKey,source_version:paper.bibliographicEnrichment.zoteroVersion,match:paper.bibliographicEnrichment.match,filled_fields:paper.bibliographicEnrichment.filledFields,source_metadata:paper.bibliographicEnrichment.metadata}}:{})},
    notes:paper.notes,
    annotations:paper.annotations,
    attachments:safeAttachments(paper),
    selected_attachment_key:paper.selectedPdf?.key??null,
    pdf:{sha256:published.pdfSha256},
    mineru:published.mineru,
    parsed_at:published.parsedAt,
  };
}
export function composeMarkdown(meta:Record<string,unknown>,body:string):string{return `---\n${YAML.stringify(meta,{lineWidth:0}).trimEnd()}\n---\n\n${body.replace(/^---\n[\s\S]*?\n---\n/,"")}`;}
async function existingOwner(file:string):Promise<string|null>{try{const text=await readFile(file,"utf8");if(!text.startsWith("---\n"))return null;const end=text.indexOf("\n---\n",4);if(end<0)return null;const value=YAML.parse(text.slice(4,end));if(typeof value?.zotero_key==="string")return value.zotero_key;if(typeof value?.zotero==="string")return value.zotero.match(/\/items\/([A-Z0-9]{8})$/)?.[1]??null;return null;}catch{return null;}}
async function exists(p:string):Promise<boolean>{try{await readFile(p);return true;}catch{try{return (await readdir(p)).length>=0;}catch{return false;}}}
async function priorStem(root:string,zoteroKey:string):Promise<string|null>{for(const name of (await readdir(root)).filter(n=>n.toLowerCase().endsWith(".md")).sort()){if(await existingOwner(path.join(root,name))===zoteroKey)return name.slice(0,-3);}return null;}

async function allocateStem(root:string,base:string,zoteroKey:string,assetsSuffix:string):Promise<string>{
  const prior=await priorStem(root,zoteroKey);
  if(prior)return prior;
  for(let index=1;;index+=1){
    const stem=index===1?base:`${base} (${index})`;
    const markdownPath=path.join(root,`${stem}.md`);
    const assetsPath=path.join(root,`${stem}${assetsSuffix}`);
    const owner=await existingOwner(markdownPath);
    if(owner===zoteroKey)return stem;
    if(!await exists(markdownPath)&&!await exists(assetsPath))return stem;
  }
}

export interface OutputNamingOptions { filenameSeparator?:string; assetsSuffix?:string; metadataFileName?:string; tagSpaceReplacement?:"-"|"_" }
export async function publishPaper(outputRoot:string,paper:Paper,normalized:NormalizedArchive,data:Omit<PublishedPaper,"markdownPath"|"assetsDirectory">,signal?:AbortSignal,naming:OutputNamingOptions={}):Promise<PublishedPaper>{
  signal?.throwIfAborted();
  await mkdir(outputRoot,{recursive:true});
  const resolved=path.resolve(outputRoot);
  const locks=path.join(resolved,".pi-scholar-locks");
  await mkdir(locks,{recursive:true});
  const filenameSeparator=naming.filenameSeparator??"+",assetsSuffix=naming.assetsSuffix??".assets",metadataFileName=naming.metadataFileName??"metadata.json";
  const base=paperStem(paper,filenameSeparator);
  // Serialize name allocation and publication for the output root so two distinct
  // papers with the same sanitized basename cannot race into the same paths.
  const lock=path.join(locks,"publish.lock");
  try{await mkdir(lock);}catch{throw new Error("Another parse publication is already in progress for this output directory");}
  let stage:string|null=null;
  try{
    signal?.throwIfAborted();
    const stem=await allocateStem(resolved,base,paper.zoteroKey,assetsSuffix);
    const mdPath=path.join(resolved,`${stem}.md`),assetDir=path.join(resolved,`${stem}${assetsSuffix}`);
    if(path.dirname(mdPath)!==resolved||path.dirname(assetDir)!==resolved)throw new Error("Unsafe output path");
    stage=path.join(resolved,`.pi-scholar-${randomUUID()}`);
    const stageAssets=path.join(stage,`${stem}${assetsSuffix}`);
    await mkdir(stageAssets,{recursive:true});
    for(const asset of normalized.assets){signal?.throwIfAborted();await writeFile(path.join(stageAssets,asset.name),asset.bytes);}
    signal?.throwIfAborted();
    // Keep a true relative path. Angle-bracket Markdown destinations are emitted
    // during normalization so spaces remain readable and work in Obsidian.
    const assetUrl=`./${stem}${assetsSuffix}`;
    await writeFile(path.join(stageAssets,metadataFileName),JSON.stringify(metadataSidecar(paper,data),null,2)+"\n","utf8");
    const markdown=composeMarkdown(frontmatter(paper,data,naming.tagSpaceReplacement),normalized.body.replaceAll("__ASSET_PREFIX__",assetUrl));
    await writeFile(path.join(stage,`${stem}.md`),markdown,"utf8");
    signal?.throwIfAborted();
    const backup=path.join(resolved,`.pi-scholar-backup-${randomUUID()}`);
    await mkdir(backup);
    try{
      if(await exists(mdPath))await rename(mdPath,path.join(backup,`${stem}.md`));
      signal?.throwIfAborted();
      if(await exists(assetDir))await rename(assetDir,path.join(backup,`${stem}${assetsSuffix}`));
      signal?.throwIfAborted();
      await rename(stageAssets,assetDir);
      signal?.throwIfAborted();
      await rename(path.join(stage,`${stem}.md`),mdPath);
      signal?.throwIfAborted();
      await rm(backup,{recursive:true,force:true});
    }catch(error){
      await rm(mdPath,{force:true});await rm(assetDir,{recursive:true,force:true});
      if(await exists(path.join(backup,`${stem}.md`)))await rename(path.join(backup,`${stem}.md`),mdPath);
      if(await exists(path.join(backup,`${stem}${assetsSuffix}`)))await rename(path.join(backup,`${stem}${assetsSuffix}`),assetDir);
      throw error;
    }finally{await rm(backup,{recursive:true,force:true});}
    return{markdownPath:mdPath,assetsDirectory:assetDir,...data};
  }finally{if(stage)await rm(stage,{recursive:true,force:true});await rm(lock,{recursive:true,force:true});}
}
