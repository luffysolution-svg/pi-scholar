import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { discoverConfigPath, loadConfig, validateZoteroBaseUrl } from "../src/config.js";
import { scholarlyIdentity } from "../src/model.js";
import { truncate, registerScholarTools } from "../src/tools.js";

test("Zotero base URL only accepts the two exact loopback API origins",()=>{
  assert.equal(validateZoteroBaseUrl("http://localhost:23119/api/"),"http://localhost:23119/api");
  assert.equal(validateZoteroBaseUrl("http://127.0.0.1:23119/api"),"http://127.0.0.1:23119/api");
  for(const bad of ["https://localhost:23119/api","http://localhost:80/api","http://localhost.evil:23119/api","http://user@localhost:23119/api","http://[::1]:23119/api","http://127.0.0.1:23119/api/items","//localhost:23119/api"]){assert.throws(()=>validateZoteroBaseUrl(bad),/exactly|valid URL/);}
});

test("configuration parses defaults, bounds and booleans",()=>{
  const c=loadConfig({HOME:"/tmp",MINERU_ENABLE_FORMULA:"no",MINERU_MAX_ATTEMPTS:"7",ZOTERO_BASE_URL:"http://localhost:23119/api"});
  assert.equal(c.filenameSeparator,"-");assert.equal(c.assetsSuffix,"scholar-assets");assert.equal(c.mineruEnableFormula,false);assert.equal(c.mineruEnableTable,true);assert.equal(c.mineruMaxAttempts,7);
  assert.throws(()=>loadConfig({MINERU_MAX_ATTEMPTS:"0"}),/Invalid numeric configuration/);
  assert.throws(()=>loadConfig({MINERU_ENABLE_TABLE:"ture"}),/Invalid boolean configuration/);
});

test("JSON configuration is discoverable, resolves relative paths and yields to environment overrides",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"pi-scholar-config-"));const file=path.join(dir,"pi-scholar.config.json");await writeFile(file,JSON.stringify({zotero:{timeoutMs:9000,maxItems:321},output:{directory:"./vault",filenameSeparator:"_",assetsSuffix:"_media",assetFilePrefix:"image",metadataFileName:"source.json",tagSpaceReplacement:"_"},mineru:{language:"ch",enableFormula:false,tokenEnv:"CUSTOM_MINERU_TOKEN"}}));
  assert.equal(discoverConfigPath({PI_SCHOLAR_CONFIG:file},dir,dir),file);const c=loadConfig({PI_SCHOLAR_CONFIG:file,CUSTOM_MINERU_TOKEN:"secret",MINERU_LANGUAGE:"en"});assert.equal(c.configPath,file);assert.equal(c.outputDir,path.join(dir,"vault"));assert.equal(c.filenameSeparator,"_");assert.equal(c.assetsSuffix,"_media");assert.equal(c.assetFilePrefix,"image");assert.equal(c.metadataFileName,"source.json");assert.equal(c.tagSpaceReplacement,"_");assert.equal(c.zoteroTimeoutMs,9000);assert.equal(c.zoteroMaxItems,321);assert.equal(c.mineruToken,"secret");assert.equal(c.mineruLanguage,"en");assert.equal(c.mineruEnableFormula,false);
  await writeFile(file,JSON.stringify({output:{assetsSuffix:"../unsafe"}}));assert.throws(()=>loadConfig({PI_SCHOLAR_CONFIG:file}),/safe filename component/);
});

test("scholarly identity prefers normalized DOI then title/year",()=>{
  assert.equal(scholarlyIdentity({doi:"https://doi.org/10.1000/ABC",title:"ignored",year:"2020"}),"doi:10.1000/abc");
  assert.equal(scholarlyIdentity({doi:null,title:"  Café—Study! ",year:"2024"}),"title-year:café study:2024");
});

test("truncation is line and UTF-8 byte aware and discloses totals",()=>{
  const lines=truncate(Array.from({length:2100},(_,i)=>`行 ${i}`).join("\n"));assert.equal(lines.truncated,true);assert.ok(Buffer.byteLength(lines.text)<=50*1024);assert.match(lines.text,/displayed 2000\/2100 lines/);
  const bytes=truncate("😀".repeat(30_000));assert.equal(bytes.truncated,true);assert.ok(Buffer.byteLength(bytes.text)<=50*1024);assert.doesNotMatch(bytes.text,/�/);assert.match(bytes.text,/Truncated/);
  assert.deepEqual(truncate("ok"),{text:"ok",truncated:false,bytes:2,lines:1});
});

test("local tools register exactly once with strict action schemas and named guidance",()=>{
  const tools:any[]=[];registerScholarTools({registerTool:(tool:any)=>tools.push(tool)} as any);
  assert.deepEqual(tools.map(t=>t.name),["zotero_collections","zotero_search","zotero_item","pi_scholar_parse"]);
  for(const tool of tools){assert.ok(tool.label&&tool.description&&tool.promptSnippet);assert.ok(tool.promptGuidelines.every((g:string)=>g.includes(tool.name)));assert.equal(typeof tool.execute,"function");}
  const collections=tools[0].parameters;assert.ok(collections.required.includes("action"));assert.deepEqual(collections.properties.action.enum,["list","read","items"]);
});
