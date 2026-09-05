import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ZoteroClient } from "../src/zotero.js";
import { json } from "./helpers.js";

const raw=(key:string,itemType:string,data:Record<string,unknown>={},version=1)=>({key,version,data:{itemType,...data}});

test("Zotero client pages by returned count, sends hardened GET headers, and records versions",async()=>{
  const calls:{url:URL;init:RequestInit}[]=[];
  const rows=Array.from({length:125},(_,i)=>raw(`K${String(i).padStart(7,"0")}`,"journalArticle",{title:`Paper ${i}`}));
  const fetcher:typeof fetch=async(input,init={})=>{const url=new URL(String(input));calls.push({url,init});const start=Number(url.searchParams.get("start")),limit=Number(url.searchParams.get("limit"));return json(rows.slice(start,start+limit),200,{"Total-Results":"125","Last-Modified-Version":"77"});};
  const result=await new ZoteroClient({fetch:fetcher,maxItems:1000}).listCollections(125);
  assert.equal(result.items.length,125);assert.equal(result.total,125);assert.equal(result.truncated,false);assert.equal(result.lastModifiedVersion,77);assert.deepEqual(calls.map(c=>c.url.searchParams.get("start")),["0","100"]);
  for(const call of calls){assert.equal(call.init.method,"GET");assert.equal(call.init.redirect,"manual");const h=new Headers(call.init.headers);assert.equal(h.get("Zotero-API-Version"),"3");assert.equal(h.get("Zotero-Allowed-Request"),"1");assert.doesNotMatch(h.get("User-Agent")!,/^Mozilla\//);}
});

test("pagination handles absent Total-Results and rejects repeated pages",async()=>{
  const one=raw("ITEM0001","book");const finite=await new ZoteroClient({fetch:async()=>json([one])}).listCollections(10);assert.equal(finite.total,1);assert.equal(finite.truncated,false);assert.equal(finite.lastModifiedVersion,null);
  const repeated=new ZoteroClient({fetch:async()=>json(Array.from({length:100},()=>one)),maxItems:300});await assert.rejects(repeated.listCollections(201),/repeated a page/);
});

test("collection reads filter children, deleted and indirect membership without mutation",async()=>{
  const methods:string[]=[];const fetcher:typeof fetch=async(input,init={})=>{methods.push(String(init.method));const url=new URL(String(input));assert.equal(url.pathname,"/api/users/0/collections/COLL0001/items");return json([raw("PARENT01","book",{collections:["COLL0001"]}),raw("CHILD001","attachment",{parentItem:"PARENT01",collections:["COLL0001"]}),raw("OTHER001","book",{collections:["OTHER000"]}),raw("DELETE01","book",{collections:["COLL0001"],deleted:true})]);};
  const result=await new ZoteroClient({fetch:fetcher}).listCollectionItems("COLL0001");assert.deepEqual(result.items.map(x=>x.key),["PARENT01"]);assert.deepEqual(methods,["GET"]);
  await assert.rejects(new ZoteroClient({fetch:async()=>new Response("",{status:302})}).getItem("PARENT01"),/Zotero read failed \(302\)/);
});

test("search supports queryless and wildcard browsing ordered by recent modification",async()=>{
  const calls:URL[]=[];const fetcher:typeof fetch=async input=>{calls.push(new URL(String(input)));return json([]);};const client=new ZoteroClient({fetch:fetcher});
  await client.searchItems("*",{limit:2});await client.searchItems("");await client.searchItems("photocatalysis",{sort:"date",direction:"asc"});
  assert.equal(calls[0]!.searchParams.has("q"),false);assert.equal(calls[0]!.searchParams.get("sort"),"dateModified");assert.equal(calls[0]!.searchParams.get("direction"),"desc");assert.equal(calls[1]!.searchParams.has("q"),false);assert.equal(calls[2]!.searchParams.get("q"),"photocatalysis");assert.equal(calls[2]!.searchParams.get("qmode"),"everything");assert.equal(calls[2]!.searchParams.get("sort"),"date");assert.equal(calls[2]!.searchParams.get("direction"),"asc");
});

test("Zotero connection failures include actionable desktop and port guidance",async()=>{
  const client=new ZoteroClient({fetch:async()=>{throw new TypeError("fetch failed");}});await assert.rejects(client.searchItems("test"),/Start Zotero.*port 23119.*Allow other applications/s);
});

test("collection limits apply after filtering child rows",async()=>{
  const rows=[...Array.from({length:100},(_,index)=>raw(`C${String(index).padStart(7,"0")}`,"attachment",{parentItem:"PARENT01",collections:["COLL0001"]})),raw("PARENT01","journalArticle",{title:"Match",collections:["COLL0001"]})];
  const fetcher:typeof fetch=async(input)=>{const url=new URL(String(input));const start=Number(url.searchParams.get("start"));const limit=Number(url.searchParams.get("limit"));return json(rows.slice(start,start+limit));};
  const client=new ZoteroClient({fetch:fetcher,maxItems:1000});
  assert.deepEqual((await client.listCollectionItems("COLL0001",1)).items.map(item=>item.key),["PARENT01"]);
  assert.deepEqual((await client.searchItems("Match",{collectionKey:"COLL0001",limit:1})).items.map(item=>item.key),["PARENT01"]);
});

test("complete Paper mapping includes metadata, notes, PDF annotations, indexed text and explicit selection",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"zotero-paper-"));const pdf=path.join(dir,"paper.pdf");await writeFile(pdf,"%PDF-test");const seen:string[]=[];
  const parent=raw("PARENT01","journalArticle",{title:"Complete Paper",creators:[{creatorType:"author",firstName:"Grace",lastName:"Hopper"},{creatorType:"editor",name:"Editorial Board"}],date:"Spring 2023",DOI:"10.1/x",ISBN:"978-1",ISSN:"1234-5678",publicationTitle:"Journal",volume:"4",issue:"2",pages:"1-9",url:"https://example.test",abstractNote:"Résumé",tags:[{tag:"tag-one"}],collections:["COLL0001"]},42);
  const children=[raw("NOTE0001","note",{parentItem:"PARENT01",note:"<p>note</p>"},3),raw("PDF00002","attachment",{parentItem:"PARENT01",title:"Second",filename:"b.pdf",contentType:"application/pdf",linkMode:"linked_file",path:pdf},5),raw("PDF00001","attachment",{parentItem:"PARENT01",title:"First",filename:"a.pdf",contentType:"application/pdf",linkMode:"imported_file",path:"storage:a.pdf",md5:"abc",mtime:123},4),raw("WEB00001","attachment",{parentItem:"PARENT01",title:"Web",contentType:"text/html"},1)];
  const annotation=raw("ANNO0001","annotation",{parentItem:"PDF00001",annotationText:"quoted",annotationComment:"comment",annotationColor:"#ffd400",annotationPageLabel:"7",annotationSortIndex:"00001",annotationPosition:{pageIndex:6},tags:[{tag:"ann"}]},9);
  const fetcher:typeof fetch=async(input)=>{const url=new URL(String(input));seen.push(url.pathname);if(url.pathname.endsWith("/items/PARENT01"))return json(parent);if(url.pathname.endsWith("/items/PARENT01/children"))return json(children);if(url.pathname.endsWith("/collections"))return json([raw("COLL0001","collection",{name:"My Papers"})]);if(url.pathname.endsWith("/items/PDF00001/children"))return json([annotation]);if(url.pathname.endsWith("/items/PDF00002/children"))return json([]);if(url.pathname.includes("/file/view/url"))return new Response(pathToFileURL(pdf).href);if(url.pathname.endsWith("/fulltext")){if(url.pathname.includes("PDF00001"))return json({content:"indexed",indexedPages:2,totalPages:3});return new Response("missing",{status:404});}throw new Error(`unexpected ${url}`);};
  const paper=await new ZoteroClient({fetch:fetcher}).getPaper("PARENT01","PDF00001");assert.equal(paper.zoteroVersion,42);assert.equal(paper.metadata.title,"Complete Paper");assert.equal(paper.creators[1]?.name,"Editorial Board");assert.equal(paper.year,"2023");assert.equal(paper.collections[0]?.name,"My Papers");assert.equal(paper.notes[0]?.note,"<p>note</p>");assert.equal(paper.annotations[0]?.parentAttachment,"PDF00001");assert.deepEqual(paper.annotations[0]?.position,{pageIndex:6});assert.equal(paper.selectedPdf?.key,"PDF00001");assert.equal(paper.selectedPdf?.localPath,pdf);assert.equal(paper.selectedPdf?.indexedText.status,"available");assert.ok(seen.some(x=>x.endsWith("/items/PDF00001/children")));
  await assert.rejects(new ZoteroClient({fetch:fetcher}).getPaper("PARENT01","WEB00001"),/not a child PDF/);
});

test("sparse parent metadata is conservatively enriched from one exact local duplicate",async()=>{
  const sparse=raw("SPARSE01","journalArticle",{title:"Ni/NiOx Study",creators:[{creatorType:"author",firstName:"Ada",lastName:"Lovelace"}]},7);
  const donor=raw("DONOR001","journalArticle",{title:"Ni/NiO<sub>x</sub> Study",creators:[{creatorType:"author",firstName:"Ada",lastName:"Lovelace"}],date:"2024-03-17",DOI:"10.1/enriched",publicationTitle:"Journal",volume:"4",issue:"2",pages:"1-9",url:"https://example.test",abstractNote:"Complete abstract"},9);
  const fixture=(rows:ReturnType<typeof raw>[]):typeof fetch=>async input=>{const url=new URL(String(input));if(url.pathname.endsWith("/items/SPARSE01"))return json(sparse);if(url.pathname.endsWith("/items/top"))return json(rows);if(url.pathname.endsWith("/items/SPARSE01/children"))return json([]);if(url.pathname.endsWith("/collections"))return json([]);throw new Error(`unexpected ${url}`);};
  const enriched=await new ZoteroClient({fetch:fixture([sparse,donor])}).getPaper("SPARSE01");assert.equal(enriched.year,"2024");assert.equal(enriched.doi,"10.1/enriched");assert.equal(enriched.publicationTitle,"Journal");assert.equal(enriched.zoteroKey,"SPARSE01");assert.equal(enriched.bibliographicEnrichment?.zoteroKey,"DONOR001");assert.ok(enriched.bibliographicEnrichment?.filledFields.includes("DOI"));assert.equal(enriched.metadata.DOI,undefined);
  const ambiguous=await new ZoteroClient({fetch:fixture([sparse,donor,{...donor,key:"DONOR002"}])}).getPaper("SPARSE01");assert.equal(ambiguous.doi,null);assert.equal(ambiguous.bibliographicEnrichment,undefined);
});

test("aggregate reads reject deleted parent items clearly",async()=>{
  const deleted=raw("DELETED1","journalArticle",{title:"Deleted",deleted:true});await assert.rejects(new ZoteroClient({fetch:async()=>json(deleted)}).getPaper("DELETED1"),/item is deleted/);
});

test("managed attachment fallback is constrained to dataDir/storage/key/basename",async()=>{
  const data=await mkdtemp(path.join(os.tmpdir(),"zotero-data-"));const target=path.join(data,"storage","PDF00001");await mkdir(target,{recursive:true});await writeFile(path.join(target,"paper.pdf"),"%PDF-");const client=new ZoteroClient({dataDir:data,fetch:async()=>{throw new Error("file route unavailable");}});assert.equal(await client.locateAttachment("PDF00001","storage:paper.pdf"),path.join(target,"paper.pdf"));await assert.rejects(client.locateAttachment("PDF00001","storage:../secret.pdf"),/Unsafe/);await assert.rejects(client.locateAttachment("PDF00001","storage:missing.pdf"),/cannot be read/);
});
