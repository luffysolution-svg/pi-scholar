import path from "node:path";
import { copyFile, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import AdmZip from "adm-zip";
import YAML from "yaml";
import { zoteroPublicationId, type Paper, type PublishedPaper } from "./model.js";
import { withLease } from "./storage/lease.js";
import { confinedPath, installPublication, snapshotTree, type PublicationHooks } from "./storage/publication.js";
import { inertMarkdownHtml, validateStaticSvg } from "./storage/markup.js";
export { recoverPublications, cleanupPublicationBackups } from "./storage/publication.js";

const INVALID=/[<>:"/\\|?*\u0000-\u001f]/g;
const RESERVED=/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const IMAGE_EXT=/^\.(png|jpe?g|gif|webp|bmp|svg)$/;
const MAX_ENTRIES=10_000;
const MAX_EXPANDED=1024*1024*1024;
const MAX_PORTABLE_PATH_LENGTH=240;
const MAX_STEM_BYTES=220;
const MIN_READABLE_STEM_LENGTH=16;
const ASSET_NAME_LENGTH_RESERVE=80;

function component(value:string,fallback:string):string {
  let s=value.normalize("NFC").replace(/<[^>]*>/g,"").replace(/\+/g," ").replace(INVALID," ").replace(/\s+/g," ").trim().replace(/[. ]+$/g,"");
  if(!s||s==="."||s==="..")s=fallback;
  if(RESERVED.test(s))s=`_${s}`;
  return s;
}
function utf8Limit(value:string,maxBytes:number,maxCharacters=Number.POSITIVE_INFINITY):string {
  const points=Array.from(value);
  while(points.length){const candidate=points.join("");if(Buffer.byteLength(candidate,"utf8")<=maxBytes&&candidate.length<=maxCharacters)break;points.pop();}
  return points.join("").replace(/[. ]+$/g,"")||"Untitled";
}
export function paperStem(paper: Pick<Paper,"creators"|"year"|"title">,separator="-",maxCharacters=MAX_STEM_BYTES):string {
  const first=paper.creators.find(c=>c.creatorType==="author");
  const author=component(first?.lastName ?? first?.name ?? "UnknownAuthor","UnknownAuthor");
  const year=component(paper.year ?? "UnknownYear","UnknownYear");
  const title=component(paper.title,"Untitled");
  return utf8Limit([author,year,title].join(separator),MAX_STEM_BYTES,maxCharacters);
}

export interface NormalizedArchive { body:string; assets:{name:string;bytes:Buffer}[] }

export function sha256(value: Uint8Array|string): string {
  return createHash("sha256").update(value).digest("hex");
}
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
    if(!name){const ext=path.posix.extname(source).toLowerCase();if(!IMAGE_EXT.test(ext))throw new Error(`Unsupported MinerU image type: ${ext}`);if(ext===".svg")validateStaticSvg(data);name=`${assetFilePrefix}-${String(assets.length+1).padStart(2,"0")}${ext}`;mapped.set(source,name);assets.push({name,bytes:data});}
    return `${assetPrefix}/${name}`;
  };
  body=body.replace(/!\[([^\]]*)\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^"']*["'])?\s*\)/g,(_m,alt,dest)=>`![${alt}](<${resolve(dest)}>)`);
  const imageRefs=new Set<string>();
  body.replace(/!\[[^\]]*\]\[([^\]]+)\]/g,(_m,id)=>{imageRefs.add(String(id).toLowerCase());return _m;});
  body=body.replace(/^\[([^\]]+)\]:\s*(<[^>]+>|\S+)(.*)$/gm,(m,id,dest,tail)=>imageRefs.has(String(id).toLowerCase())?`[${id}]: <${resolve(dest)}>${tail}`:m);
  body=body.replace(/<img\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>/gi,(_m,before,src,after)=>{const alt=(`${before} ${after}`.match(/\balt=["']([^"']*)["']/i)?.[1]??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));return `<img src="${resolve(src)}" alt="${alt}"/>`;});
  return {body:inertMarkdownHtml(body).trim()+"\n",assets};
}

function plainText(value:string):string{return value.replace(/^\/?jats:title>\s*/i,"").replace(/<[^>]*>/g,"").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&quot;/gi,'"').replace(/&#(?:39|x27);/gi,"'").replace(/\s+/g," ").trim();}
function authorNames(paper:Paper):string{return paper.creators.filter(creator=>creator.creatorType==="author").map(creator=>creator.name??[creator.firstName,creator.lastName].filter(Boolean).join(" ")).filter(Boolean).join("; ");}
export function obsidianTags(tags:string[],spaceReplacement:"-"|"_"="-"):string[]{return [...new Set(tags.map(value=>{let tag=value.normalize("NFKC").trim().replace(/^#+/,"").replace(/\s+/g,spaceReplacement).replace(/[^\p{L}\p{N}_\/-]+/gu,spaceReplacement);const repeated=spaceReplacement==="-"?/-+/g:/_+/g;tag=tag.replace(repeated,spaceReplacement).split("/").map(part=>part.replace(/^[-_]+|[-_]+$/g,"")).filter(Boolean).join("/");if(/^\d+$/.test(tag))tag=`tag-${tag}`;return tag;}).filter(Boolean))];}
function safeAttachments(paper:Paper):unknown[]{return paper.attachments.map(({localPath:_localPath,path:_path,...attachment})=>({...attachment,indexedText:attachment.indexedText.status==="available"?{...attachment.indexedText,content:undefined}:attachment.indexedText}));}

/** Compact, human-facing properties. Verbose provenance lives in metadata.json. */
export function frontmatter(paper:Paper,published:Omit<PublishedPaper,"markdownPath"|"metadataPath"|"assetsDirectory">,tagSpaceReplacement:"-"|"_"="-"):Record<string,unknown>{
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
export function metadataSidecar(paper:Paper,published:Omit<PublishedPaper,"markdownPath"|"metadataPath"|"assetsDirectory">):Record<string,unknown>{
  return {
    schema_version:1,
    bibliographic:{title:plainText(paper.title),authors:paper.creators,date:paper.date,year:paper.year,doi:paper.doi,isbn:paper.isbn,issn:paper.issn,publication_title:paper.publicationTitle,volume:paper.volume,issue:paper.issue,pages:paper.pages,url:paper.url,abstract:paper.abstract,tags:paper.tags,collections:paper.collections},
    zotero:{selected_key:paper.zoteroKey,selected_version:paper.zoteroVersion,selected_metadata:paper.metadata,...(paper.bibliographicEnrichment?{enrichment:{source_key:paper.bibliographicEnrichment.zoteroKey,source_version:paper.bibliographicEnrichment.zoteroVersion,match:paper.bibliographicEnrichment.match,filled_fields:paper.bibliographicEnrichment.filledFields,source_metadata:paper.bibliographicEnrichment.metadata}}:{})},
    notes:paper.notes,
    annotations:paper.annotations,
    attachments:safeAttachments(paper),
    selected_attachment_key:paper.selectedPdf?.key??null,
    publication:{
      id: published.publicationId ?? null,
      namespace: published.namespace ?? null,
      parent_key: paper.zoteroKey,
      attachment_key: paper.selectedPdf?.key ?? null,
    },
    pdf:{sha256:published.pdfSha256},
    mineru:published.mineru,
    parsed_at:published.parsedAt,
  };
}
export function composeMarkdown(meta:Record<string,unknown>,body:string):string{return `---\n${YAML.stringify(meta,{lineWidth:0}).trimEnd()}\n---\n\n${body.replace(/^---\n[\s\S]*?\n---\n/,"")}`;}
interface DirectoryOwner { id:string|null; parent:string|null; attachment:string|null; hasPublication:boolean }
async function existingOwner(directory:string):Promise<DirectoryOwner>{
  try{
    const value=JSON.parse(await readFile(path.join(directory,"metadata.json"),"utf8"));
    const parent=typeof value?.publication?.parent_key==="string"?value.publication.parent_key:typeof value?.zotero?.selected_key==="string"?value.zotero.selected_key:null;
    const attachment=typeof value?.publication?.attachment_key==="string"?value.publication.attachment_key:typeof value?.selected_attachment_key==="string"?value.selected_attachment_key:null;
    const id=typeof value?.publication?.id==="string"?value.publication.id:null;
    return {id,parent,attachment,hasPublication:Boolean(value?.publication&&typeof value.publication==="object")};
  }catch{return {id:null,parent:null,attachment:null,hasPublication:false};}
}
async function exists(p:string):Promise<boolean>{try{await stat(p);return true;}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return false;throw error;}}
async function rejectSymbolicDirectory(p:string,label:string):Promise<void>{const stat=await lstat(p);if(stat.isSymbolicLink())throw new Error(`${label} must not be a symbolic link or directory junction`);}
async function priorStem(root:string,zoteroKey:string,attachmentKey:string|null,publicationId:string):Promise<string|null>{
  const matches:string[]=[];
  for(const entry of (await readdir(root,{withFileTypes:true})).filter(entry=>entry.isDirectory()&&!entry.name.startsWith(".pi-scholar-")).sort((a,b)=>a.name.localeCompare(b.name))){
    const owner=await existingOwner(path.join(root,entry.name));
    if(owner.id===publicationId){matches.push(entry.name);continue;}
    // Legacy sidecars predate the publication identity. Re-associate only when
    // their attachment identity agrees; old records without an attachment are
    // retained for backwards compatibility with parent-only Zotero records.
    if(!owner.hasPublication&&owner.parent===zoteroKey&&(owner.attachment===attachmentKey||owner.attachment===null&&attachmentKey===null))matches.push(entry.name);
  }
  if(matches.length>1)throw new Error(`CONFLICT: multiple paper directories claim publication ${publicationId}: ${matches.join(", ")}`);
  return matches[0]??null;
}
function portablePathsFit(root:string,stem:string):boolean{return path.join(root,stem,`${stem}.md`).length<=MAX_PORTABLE_PATH_LENGTH&&path.join(root,stem,"assets","x".repeat(ASSET_NAME_LENGTH_RESERVE)).length<=MAX_PORTABLE_PATH_LENGTH;}
function stemCharacterLimit(root:string):number{
  for(let length=MAX_STEM_BYTES;length>=MIN_READABLE_STEM_LENGTH;length-=1)if(portablePathsFit(root,"x".repeat(length)))return length;
  throw new Error(`output.directory is too deeply nested to keep paper paths within ${MAX_PORTABLE_PATH_LENGTH} characters`);
}
async function allocateStem(root:string,base:string,maxCharacters:number):Promise<string>{
  for(let index=1;;index+=1){
    const suffix=index===1?"":` (${index})`;
    if(suffix.length>=maxCharacters)throw new Error("Too many papers share the same readable filename");
    const stem=`${utf8Limit(base,MAX_STEM_BYTES-Buffer.byteLength(suffix,"utf8"),maxCharacters-suffix.length)}${suffix}`;
    if(!await exists(path.join(root,stem)))return stem;
  }
}

export interface OutputNamingOptions {
  filenameSeparator?:string; literaturesDirectory?:string; tagSpaceReplacement?:"-"|"_"; namespace?:string; backupRetentionDays?:number;
  targetDirectory?:string; repair?:boolean; baseline?:GenerationBaseline;
  commit?: (published:PublishedPaper)=>Promise<void>;
  transactionHooks?: Omit<PublicationHooks,"commit">;
}

export interface GenerationBaseline { markdownSha256:string; assets:Record<string,string>; metadataSha256?:string; generatedMarkdown?:string }

/** Replace only unchanged generated YAML values; unknown user fields keep their exact bytes. */
export function mergeGeneratedMarkdown(base:string,current:string,next:string):string {
  if(current===base)return next;
  const split=(text:string)=>{const match=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?/.exec(text);if(!match)throw new Error("CONFLICT: Markdown frontmatter changed structure");return {yaml:match[1]!,prefix:text.slice(0,match[0].indexOf(match[1]!)),body:text.slice(match[0].length),closing:match[0].slice(match[0].indexOf(match[1]!)+match[1]!.length)};};
  const old=split(base),local=split(current),fresh=split(next);
  const parse=(text:string)=>{const doc=YAML.parseDocument(text,{uniqueKeys:true});if(doc.errors.length||!YAML.isMap(doc.contents))throw new Error("CONFLICT: invalid YAML frontmatter");return doc;};
  const oldDoc=parse(old.yaml),localDoc=parse(local.yaml),newDoc=parse(fresh.yaml);
  const oldValues=oldDoc.toJS() as Record<string,unknown>,localValues=localDoc.toJS() as Record<string,unknown>,newValues=newDoc.toJS() as Record<string,unknown>;
  const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
  const edits:Array<{start:number;end:number;text:string}>=[];
  let appended="";
  for(const key of new Set([...Object.keys(oldValues),...Object.keys(newValues)])){
    const oldHas=Object.hasOwn(oldValues,key),localHas=Object.hasOwn(localValues,key),newHas=Object.hasOwn(newValues,key);
    if(oldHas===newHas&&equal(oldValues[key],newValues[key]))continue;
    if(localHas===newHas&&equal(localValues[key],newValues[key]))continue;
    if(localHas!==oldHas||!equal(localValues[key],oldValues[key]))throw new Error(`CONFLICT: both local and source changed YAML field ${key}`);
    if(!newHas)throw new Error(`CONFLICT: removal of YAML field ${key} needs review in an edited note`);
    if(!localHas){appended+=`\n${JSON.stringify(key)}: ${JSON.stringify(newValues[key])}`;continue;}
    const node=localDoc.get(key,true);
    if(!YAML.isNode(node)||!node.range)throw new Error(`CONFLICT: cannot safely locate YAML field ${key}`);
    const priorValue=local.yaml.slice(node.range[0],node.range[1]);
    edits.push({start:node.range[0],end:node.range[1],text:JSON.stringify(newValues[key])+(/\r?\n$/.exec(priorValue)?.[0]??"")});
  }
  let yaml=local.yaml;
  for(const edit of edits.sort((a,b)=>b.start-a.start))yaml=yaml.slice(0,edit.start)+edit.text+yaml.slice(edit.end);
  yaml+=appended;
  parse(yaml);
  const body=local.body===old.body?fresh.body:fresh.body===old.body||local.body===fresh.body?local.body:null;
  if(body===null)throw new Error("CONFLICT: both local and parser changed the generated body");
  return local.prefix+yaml+local.closing+body;
}
function metadataBaselineHash(value:Record<string,unknown>):string{
  const copy=JSON.parse(JSON.stringify(value)) as Record<string,unknown>;
  if(copy.publication&&typeof copy.publication==="object")delete (copy.publication as Record<string,unknown>).baseline;
  return sha256(JSON.stringify(copy));
}
async function readGenerationBaseline(directory:string):Promise<GenerationBaseline|null>{
  try{
    const value=JSON.parse(await readFile(path.join(directory,"metadata.json"),"utf8"));
    const raw=value?.publication?.baseline;
    if(!raw||typeof raw.markdownSha256!=="string"||!raw.assets||typeof raw.assets!=="object")return null;
    return {markdownSha256:raw.markdownSha256,assets:raw.assets as Record<string,string>,...(typeof raw.metadataSha256==="string"?{metadataSha256:raw.metadataSha256}:{}),...(typeof raw.generatedMarkdown==="string"?{generatedMarkdown:raw.generatedMarkdown}:{})};
  }catch{return null;}
}
async function directoryModified(directory:string,baseline:GenerationBaseline):Promise<boolean>{
  try{
    const markdown=await readFile(path.join(directory,`${path.basename(directory)}.md`));
    if(sha256(markdown)!==baseline.markdownSha256)return true;
    for(const [name,digest] of Object.entries(baseline.assets)){
      try{if(sha256(await readFile(path.join(directory,"assets",name)))!==digest)return true;}catch{return true;}
    }
    if(baseline.metadataSha256){
      const value=JSON.parse(await readFile(path.join(directory,"metadata.json"),"utf8")) as Record<string,unknown>;
      if(metadataBaselineHash(value)!==baseline.metadataSha256)return true;
    }
    return false;
  }catch{return true;}
}
async function copyTree(source:string,target:string,skip:(relative:string)=>boolean,relative=""):Promise<void>{
  for(const entry of await readdir(source,{withFileTypes:true})){
    const childRelative=relative?path.posix.join(relative,entry.name):entry.name;
    if(skip(childRelative))continue;
    const from=path.join(source,entry.name);const to=path.join(target,entry.name);const info=await lstat(from);
    if(info.isSymbolicLink())throw new Error(`User file ${childRelative} is a symbolic link; publication stopped`);
    if(info.isDirectory()){await mkdir(to,{recursive:true});await copyTree(from,to,skip,childRelative);}
    else if(info.isFile())await copyFile(from,to);
  }
}
async function saveConflict(root:string,publicationId:string,markdown:string,assets:{name:string;bytes:Buffer}[]):Promise<string>{
  const conflictRoot=path.join(root,".pi-scholar-conflicts");
  await mkdir(conflictRoot,{recursive:true});
  const directory=path.join(conflictRoot,`${component(publicationId,"publication")}-${randomUUID()}`);
  await mkdir(path.join(directory,"assets"),{recursive:true});
  await writeFile(path.join(directory,"candidate.md"),markdown,"utf8");
  for(const asset of assets)await writeFile(path.join(directory,"assets",asset.name),asset.bytes);
  return directory;
}
export async function publishPaper(outputRoot:string,paper:Paper,normalized:NormalizedArchive,data:Omit<PublishedPaper,"markdownPath"|"metadataPath"|"assetsDirectory">,signal?:AbortSignal,naming:OutputNamingOptions={}):Promise<PublishedPaper>{
  signal?.throwIfAborted();
  for(const asset of normalized.assets)if(!asset.name||asset.name==="."||asset.name===".."||/[<>:"/\\|?*\u0000-\u001f]/.test(asset.name)||/[. ]$/.test(asset.name)||RESERVED.test(asset.name))throw new Error("Unsafe normalized asset filename");
  const resolved=path.resolve(outputRoot);
  const literaturesDirectory=naming.literaturesDirectory??"Literatures";
  const literatureRoot=path.join(resolved,literaturesDirectory);
  if(path.dirname(literatureRoot)!==resolved)throw new Error("Unsafe literature directory");
  await confinedPath(resolved,literatureRoot);
  await mkdir(literatureRoot,{recursive:true});
  await rejectSymbolicDirectory(literatureRoot,"Literature directory");
  const locks=path.join(resolved,".pi-scholar-locks");
  await confinedPath(resolved,locks);
  await mkdir(locks,{recursive:true});
  const filenameSeparator=naming.filenameSeparator??"-";
  const maxStemCharacters=stemCharacterLimit(literatureRoot);
  const base=paperStem(paper,filenameSeparator,maxStemCharacters);
  const namespace=naming.namespace??`vault-${sha256(resolved).slice(0,16)}`;
  const publicationId=zoteroPublicationId(namespace,paper);
  const lock=path.join(locks,"publish.lock");
  return withLease(lock, async leaseSignal => {
  signal=leaseSignal;
  let stage:string|null=null;
  try{
    signal?.throwIfAborted();
    const prior=await priorStem(literatureRoot,paper.zoteroKey,paper.selectedPdf?.key??null,publicationId);
    if(prior)await rejectSymbolicDirectory(path.join(literatureRoot,prior),"Paper directory");
    const requested=naming.targetDirectory?await confinedPath(resolved,naming.targetDirectory):null;
    if(requested&&path.dirname(requested)!==literatureRoot)throw new Error("CONFLICT: requested publication directory is outside the configured literature directory");
    const stem=requested?path.basename(requested):prior&&portablePathsFit(literatureRoot,prior)?prior:await allocateStem(literatureRoot,base,maxStemCharacters);
    const paperDirectory=requested??path.join(literatureRoot,stem);
    const migrationDirectory=prior&&prior!==stem?path.join(literatureRoot,prior):null;
    if(migrationDirectory&&await exists(paperDirectory))throw new Error("Cannot shorten paper path because the target directory already exists");
    if(await exists(paperDirectory))await rejectSymbolicDirectory(paperDirectory,"Paper directory");
    const replacedDirectory=migrationDirectory??(await exists(paperDirectory)?paperDirectory:null);
    const before=replacedDirectory?await snapshotTree(replacedDirectory):null;
    const mdPath=path.join(paperDirectory,`${stem}.md`);
    const assetDir=path.join(paperDirectory,"assets");
    stage=path.join(literatureRoot,`.pi-scholar-${randomUUID()}`);
    const stageAssets=path.join(stage,"assets");
    await mkdir(stageAssets,{recursive:true});
    for(const asset of normalized.assets){signal?.throwIfAborted();await writeFile(path.join(stageAssets,asset.name),asset.bytes);}
    signal?.throwIfAborted();
    const publicationData={...data,publicationId,namespace};
    const markdown=composeMarkdown(frontmatter(paper,publicationData,naming.tagSpaceReplacement),normalized.body.replaceAll("__ASSET_PREFIX__","./assets"));
    const baseline:GenerationBaseline={markdownSha256:sha256(markdown),generatedMarkdown:markdown,assets:Object.fromEntries(normalized.assets.map(asset=>[asset.name,sha256(asset.bytes)]))};
    const sidecar=metadataSidecar(paper,publicationData);
    baseline.metadataSha256=metadataBaselineHash(sidecar);
    (sidecar.publication as Record<string,unknown>).baseline=baseline;
    await writeFile(path.join(stage,"metadata.json"),JSON.stringify(sidecar,null,2)+"\n","utf8");
    await writeFile(path.join(stage,`${stem}.md`),markdown,"utf8");
    signal?.throwIfAborted();
    if(replacedDirectory){
      const baselineBefore=naming.baseline??await readGenerationBaseline(replacedDirectory);
      // A directory with only a legacy sidecar is safe to migrate. Any other
      // legacy content has no trustworthy generated baseline and is protected.
      const entries=await readdir(replacedDirectory);
      if(naming.repair){
        if(!baselineBefore)throw new Error("CONFLICT: repair requires a trusted generation baseline");
        // Fill missing files only. Existing bytes, including local modifications, win.
        await copyTree(replacedDirectory,stage,()=>false);
      }else if(baselineBefore){
        if(await directoryModified(replacedDirectory,baselineBefore)){
          let merged:string|null=null;
          if(baselineBefore.generatedMarkdown){
            try{
              const localMetadata=JSON.parse(await readFile(path.join(replacedDirectory,"metadata.json"),"utf8"));
              if(baselineBefore.metadataSha256&&metadataBaselineHash(localMetadata)!==baselineBefore.metadataSha256)throw new Error("Modified metadata");
              for(const [name,hash] of Object.entries(baselineBefore.assets))if(sha256(await readFile(path.join(replacedDirectory,"assets",name)))!==hash)throw new Error("Modified asset");
              merged=mergeGeneratedMarkdown(baselineBefore.generatedMarkdown,await readFile(path.join(replacedDirectory,`${path.basename(replacedDirectory)}.md`),"utf8"),markdown);
            }catch{/* Preserve the local version and write a review candidate below. */}
          }
          if(merged!==null)await writeFile(path.join(stage,`${stem}.md`),merged,"utf8");
          else{
          const candidate=await saveConflict(resolved,publicationId,markdown,normalized.assets);
          throw new Error(`CONFLICT: local paper content was modified; generated candidate saved at ${candidate}`);
          }
        }
      }else if(entries.some(name=>name!=="metadata.json")){
        const candidate=await saveConflict(resolved,publicationId,markdown,normalized.assets);
        throw new Error(`CONFLICT: paper directory has no trusted generation baseline; generated candidate saved at ${candidate}`);
      }
      // Preserve files that are outside the generated set. This includes
      // user-created notes and additional assets; generated files have already
      // been checked against the baseline above.
      if(!naming.repair){
        const generatedAssets=new Set(normalized.assets.map(asset=>`assets/${asset.name}`));
        for(const asset of normalized.assets){
          if(!baselineBefore?.assets[asset.name]&&await exists(path.join(replacedDirectory,"assets",asset.name)))throw new Error(`CONFLICT: generated asset collides with a user file: ${asset.name}`);
        }
        await copyTree(replacedDirectory,stage,(relative)=>relative==="metadata.json"||relative===`${stem}.md`||relative.startsWith("assets/")&&generatedAssets.has(relative));
      }
    }
    const published={markdownPath:mdPath,metadataPath:path.join(paperDirectory,"metadata.json"),assetsDirectory:assetDir,...data,publicationId,namespace};
    const preparedStage=stage;
    stage=null; // The journal owns the candidate from this point, including failures.
    return await installPublication({root:resolved,stage:preparedStage,destination:paperDirectory,original:replacedDirectory,before,published,retentionDays:naming.backupRetentionDays,signal,hooks:{...naming.transactionHooks,commit:naming.commit}});
  }finally{if(stage)await rm(stage,{recursive:true,force:true});}
  },{signal});
}
