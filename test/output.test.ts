import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { composeMarkdown, frontmatter, metadataSidecar, normalizeArchive, obsidianTags, paperStem, publishPaper } from "../src/output.js";
import { archive, mineruInfo, paper } from "./helpers.js";

const publication={pdfSha256:"a".repeat(64),mineru:mineruInfo,parsedAt:"2026-01-02T03:04:05.000Z"};

test("paper filenames are readable, cross-platform safe and UTF-8 bounded",()=>{
  assert.equal(paperStem(paper()),"Lovelace-2024-A Study α β");
  assert.equal(paperStem(paper({creators:[],year:null,title:"CON."})),"UnknownAuthor-UnknownYear-_CON");
  assert.equal(paperStem(paper({creators:[{creatorType:"editor",firstName:"Eve",lastName:"Editor",name:null}]})),"UnknownAuthor-2024-A Study α β");
  assert.equal(paperStem(paper({title:"Ni/NiO<sub>x</sub> photothermal"})),"Lovelace-2024-Ni NiOx photothermal");
  const stem=paperStem(paper({title:"😀".repeat(200)}));assert.ok(Buffer.byteLength(stem)<=220);assert.doesNotMatch(stem,/�/);
  assert.equal(paperStem(paper({creators:[{creatorType:"author",firstName:null,lastName:"a+b",name:null}],title:"x+y"})),"a b-2024-x y");
  assert.equal(paperStem(paper(),"_"),"Lovelace_2024_A Study α β");
  assert.deepEqual(obsidianTags(["frustrated Lewis pairs","Ni/NiOx@C","#photothermal","2024","a  b"]),["frustrated-Lewis-pairs","Ni/NiOx-C","photothermal","tag-2024","a-b"]);
});

test("archive normalization preserves structure and rewrites inline, reference and HTML images in appearance order",()=>{
  const md=`---\nprivate: source/path\n---\n# Heading\n\nInline $x^2$ and:\n\n$$y=mx+b$$\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n![Figure one](images/a.PNG)\nFigure 1: caption\n\n![Second][fig]\n[fig]: images/b.jpg "title"\n\n<img class="leak" src="images/a.PNG" alt="A & B" onerror="bad">`;
  const normalized=normalizeArchive(archive(md,{"images/a.PNG":"png","images/b.jpg":"jpg"}),"__ASSET_PREFIX__");
  assert.deepEqual(normalized.assets.map(a=>a.name),["figure-01.png","figure-02.jpg"]);
  assert.match(normalized.body,/# Heading[\s\S]*\$\$y=mx\+b\$\$[\s\S]*\| A \| B \|[\s\S]*Figure 1: caption/);
  assert.match(normalized.body,/!\[Figure one\]\(<__ASSET_PREFIX__\/figure-01.png>\)/);
  assert.match(normalized.body,/\[fig\]: <__ASSET_PREFIX__\/figure-02.jpg> "title"/);
  assert.match(normalized.body,/<img src="__ASSET_PREFIX__\/figure-01.png" alt="A &amp; B"\/>/);assert.doesNotMatch(normalized.body,/onerror|private:/);
});

test("archive validation rejects missing assets, external images, cancellation and traversal",()=>{
  assert.throws(()=>normalizeArchive(archive("![x](images/no.png)"),"assets"),/missing asset/);
  assert.throws(()=>normalizeArchive(archive("![x](https://signed.example/x?secret=yes)"),"assets"),/non-local/);
  const abort=new AbortController();abort.abort(new Error("cancelled"));assert.throws(()=>normalizeArchive(archive("ok"),"assets",abort.signal),/cancelled/);
  const normal=archive("ok",{"aaa/x.png":"x"});const patched=Buffer.from(normal);for(let at=0;(at=patched.indexOf("aaa/x.png",at))>=0;at+=9)patched.write("../x?.png",at,"latin1");assert.throws(()=>normalizeArchive(patched,"assets"),/Unsafe MinerU archive entry/);
});

test("frontmatter stays compact while the sidecar retains complete Unicode provenance",()=>{
  const value=paper();const meta=frontmatter(value,publication);const doc=composeMarkdown(meta,"---\nstale: true\n---\n# Body\n");const end=doc.indexOf("\n---\n",4);const parsed=YAML.parse(doc.slice(4,end));
  assert.equal(parsed.schema_version,1);assert.equal(parsed.zotero,"zotero://select/library/items/PAPER001");assert.equal(parsed.zotero_key,undefined);assert.equal(parsed.authors,"Ada Lovelace");assert.equal(parsed.metadata_file,undefined);assert.equal(parsed.pdf_sha256,undefined);assert.equal(parsed.mineru_batch_id,undefined);assert.equal(parsed.abstract,undefined);assert.equal(parsed.attachments,undefined);assert.equal(parsed.zotero_metadata,undefined);assert.equal((doc.match(/^---$/gm)??[]).length,2);assert.match(doc,/# Body/);
  const sidecar=metadataSidecar(value,publication) as any;assert.equal(sidecar.zotero.selected_metadata.extra,"Citation Key: lovelace2024");assert.equal(sidecar.annotations[0].comment,"评论: yes");assert.equal(sidecar.bibliographic.abstract,"line one\nline two");
  const sparse=frontmatter(paper({year:null,date:null,doi:null,isbn:null,issn:null,publicationTitle:null,volume:null,issue:null,pages:null,url:null,tags:[]}),publication);assert.equal("year" in sparse,false);assert.equal("doi" in sparse,false);assert.equal("tags" in sparse,false);
});

test("publication pairs assets, uses numeric collisions and reuses a paper's prior YAML-owned path",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"pi-scholar-output-"));
  const normalized={body:"# Body\n![x](<__ASSET_PREFIX__/figure-01.png>)\n",assets:[{name:"figure-01.png",bytes:Buffer.from("image")}]};
  const first=await publishPaper(root,paper(),normalized,publication);assert.equal(path.basename(first.markdownPath),"Lovelace-2024-A Study α β.md");assert.equal(await readFile(path.join(first.assetsDirectory,"figure-01.png"),"utf8"),"image");const firstMarkdown=await readFile(first.markdownPath,"utf8");assert.match(firstMarkdown,/!\[x\]\(<\.\/Lovelace-2024-A Study α β-scholar-assets\/figure-01.png>\)/);const sidecar=JSON.parse(await readFile(path.join(first.assetsDirectory,"metadata.json"),"utf8"));assert.equal(sidecar.zotero.selected_key,"PAPER001");
  const other=paper({zoteroKey:"PAPER002"});const second=await publishPaper(root,other,normalized,publication);assert.match(path.basename(second.markdownPath),/ \(2\)\.md$/);
  const updated=await publishPaper(root,paper({title:"Renamed title"}),{body:"# Updated\n",assets:[]},publication);assert.equal(updated.markdownPath,first.markdownPath);assert.match(await readFile(first.markdownPath,"utf8"),/# Updated/);
  await writeFile(path.join(root,"Unrelated.md"),"do not overwrite");await publishPaper(root,paper({zoteroKey:"PAPER003",title:"Unrelated",creators:[],year:null}),{body:"ok\n",assets:[]},publication);assert.equal(await readFile(path.join(root,"Unrelated.md"),"utf8"),"do not overwrite");
  assert.deepEqual((await readdir(root)).filter(n=>n.startsWith(".pi-scholar-")&&!n.includes("locks")),[]);
});

test("asset directory, image prefix, metadata filename and tag style are configurable",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"pi-scholar-naming-"));const normalized=normalizeArchive(archive("![plot](images/a.png)",{"images/a.png":"png"}),"__ASSET_PREFIX__",undefined,"chart");const value=paper({tags:["deep learning"]});const published=await publishPaper(root,value,normalized,publication,undefined,{filenameSeparator:"_",assetsSuffix:"_media",metadataFileName:"source.json",tagSpaceReplacement:"_"});assert.equal(path.basename(published.markdownPath),"Lovelace_2024_A Study α β.md");assert.equal(path.basename(published.assetsDirectory),"Lovelace_2024_A Study α β_media");await readFile(path.join(published.assetsDirectory,"chart-01.png"));await readFile(path.join(published.assetsDirectory,"source.json"));const markdown=await readFile(published.markdownPath,"utf8");assert.match(markdown,/tags:\n  - deep_learning/);assert.match(markdown,/!\[plot\]\(<\.\/Lovelace_2024_A Study α β_media\/chart-01.png>\)/);
});

test("orphan asset directories are never overwritten during collision allocation",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"pi-scholar-orphan-"));
  const orphan=path.join(root,"Lovelace-2024-A Study α β-scholar-assets");await import("node:fs/promises").then(fs=>fs.mkdir(orphan));await writeFile(path.join(orphan,"keep.txt"),"unrelated");
  const published=await publishPaper(root,paper(),{body:"body\n",assets:[]},publication);
  assert.equal(path.basename(published.markdownPath),"Lovelace-2024-A Study α β (2).md");
  assert.equal(await readFile(path.join(orphan,"keep.txt"),"utf8"),"unrelated");
});

test("publication honors cancellation without emitting final artifacts",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"pi-scholar-cancel-"));const abort=new AbortController();abort.abort(new Error("cancel publication"));
  await assert.rejects(publishPaper(root,paper(),{body:"body\n",assets:[]},publication,abort.signal),/cancel publication/);
  assert.deepEqual(await readdir(root),[]);
});

test("concurrent publications cannot race on a shared readable basename",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"pi-scholar-lock-"));const normalized={body:"body\n",assets:[]};const settled=await Promise.allSettled([publishPaper(root,paper(),normalized,publication),publishPaper(root,paper({zoteroKey:"PAPER002"}),normalized,publication)]);assert.equal(settled.filter(x=>x.status==="fulfilled").length,1);assert.match(String((settled.find(x=>x.status==="rejected") as PromiseRejectedResult).reason),/Another parse publication/);
});
