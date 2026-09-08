import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { archive, mineruInfo, paper } from "./helpers.js";
import { normalizeArchive, publishPaper, sha256 } from "../src/output.js";
import { applySync, createSyncPlan, excludePublication, parseKey, readCachedParse, recordPublication, recoverSync, refreshPublicationMetadata, unexcludePublication, writeCachedParse } from "../src/sync/index.js";

const publication={pdfSha256:"a".repeat(64),mineru:mineruInfo,parsedAt:"2026-01-02T03:04:05.000Z"};

test("A01 preserves modified generated content and user files as a conflict",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"pi-scholar-sync-a01-"));
  const normalized=normalizeArchive(archive("# Original\n"),"__ASSET_PREFIX__");
  const first=await publishPaper(root,paper(),normalized,publication);
  const directory=path.dirname(first.markdownPath);await writeFile(first.markdownPath,"# User edit\n");await writeFile(path.join(directory,"notes.md"),"keep me\n");
  await assert.rejects(publishPaper(root,paper(),normalizeArchive(archive("# Replacement\n"),"__ASSET_PREFIX__"),publication),/CONFLICT/);
  assert.equal(await readFile(first.markdownPath,"utf8"),"# User edit\n");assert.equal(await readFile(path.join(directory,"notes.md"),"utf8"),"keep me\n");
});

test("manifest cache validates archive bytes and exclusion survives unexclude",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"pi-scholar-sync-cache-"));const cache=path.join(root,"cache");const bytes=Buffer.from("zip");
  await writeCachedParse(root,"library",{pdfSha256:"b".repeat(64),parseKey:"key",archive:bytes,info:{state:"done"}},cache,"licensed");
  assert.equal((await readCachedParse(root,"library","key",cache,"licensed"))?.pdfSha256,"b".repeat(64));
  await excludePublication(root,"zotero:library:PAPER001:no-attachment","user request");const excluded=await createSyncPlan({outputRoot:root,paper:paper(),namespace:"library"});assert.equal(excluded.status,"excluded");await unexcludePublication(root,excluded.publicationId);const restored=await createSyncPlan({outputRoot:root,paper:paper(),namespace:"library"});assert.notEqual(restored.status,"excluded");
});

test("applySync rejects a stale plan after local input changes",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"pi-scholar-sync-plan-"));const value=paper();const plan=await createSyncPlan({outputRoot:root,paper:value,namespace:"library"});const changed=paper({title:"Changed"});await assert.rejects(applySync(plan,{outputRoot:root,paper:changed,namespace:"library"},()=>true),/stale/);
});

test("recordPublication creates a revisioned manifest",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"pi-scholar-sync-manifest-"));const p=paper();const published=await publishPaper(root,p,{body:"# Body\n",assets:[]},publication,undefined,{namespace:"library"});await recordPublication(root,p,published,{namespace:"library",parseKey:"parse-key",managedAssets:[]});const plan=await createSyncPlan({outputRoot:root,paper:p,namespace:"library"});assert.equal(plan.status,"up_to_date");assert.equal(plan.remoteCall,"none");
});

test("publication identity separates attachments of one Zotero parent",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"pi-scholar-sync-attachments-"));
  const firstAttachment={key:"PDF00001",version:1,parentItem:"PAPER001",title:"one.pdf",filename:"one.pdf",contentType:"application/pdf",linkMode:"imported_file",path:null,md5:null,mtime:null,selected:true,localPath:null,indexedText:{status:"unavailable" as const},annotations:[]};
  const secondAttachment={...firstAttachment,key:"PDF00002",filename:"two.pdf"};
  const first=paper({attachments:[firstAttachment],selectedPdf:firstAttachment});const second=paper({attachments:[secondAttachment],selectedPdf:secondAttachment});
  const a=await publishPaper(root,first,{body:"one\n",assets:[]},publication);const b=await publishPaper(root,second,{body:"two\n",assets:[]},publication);
  assert.notEqual(path.dirname(a.markdownPath),path.dirname(b.markdownPath));
});

test("manifest detects user edits to the managed metadata sidecar",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"pi-scholar-sync-sidecar-"));const p=paper();
  const published=await publishPaper(root,p,{body:"body\n",assets:[]},publication);
  await recordPublication(root,p,published,{parseKey:"parse-key",managedAssets:[]});
  const sidecar=JSON.parse(await readFile(published.metadataPath,"utf8"));sidecar.user_field="keep";
  await writeFile(published.metadataPath,JSON.stringify(sidecar,null,2)+"\n");
  const plan=await createSyncPlan({outputRoot:root,paper:p});
  assert.equal(plan.status,"conflict");assert.deepEqual(plan.userModified,["metadata.json"]);
});

test("a simultaneous metadata and PDF change plans parsing, not metadata-only refresh",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"pi-scholar-sync-combined-"));const p=paper();const bytes=Buffer.from("pdf-v1");
  const published=await publishPaper(root,p,{body:"body\n",assets:[]},publication);
  await recordPublication(root,p,published,{parseKey:parseKey(bytes,{}),managedAssets:[]});
  const plan=await createSyncPlan({outputRoot:root,paper:paper({title:"Changed"}),pdfBytes:Buffer.from("pdf-v2")});
  assert.equal(plan.status,"parse_changed");assert.equal(plan.action,"parse");assert.ok(plan.changes.includes("metadata_changed"));assert.ok(plan.changes.includes("parse_changed"));
});

test("plans report an existing parse cache and avoid remote cost",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"pi-scholar-sync-cache-plan-"));const cache=path.join(root,"cache");const p=paper();const bytes=Buffer.from("pdf");const key=parseKey(bytes,{});
  const namespace="vault-x";const published=await publishPaper(root,p,{body:"body\n",assets:[]},publication,undefined,{namespace});
  await recordPublication(root,p,published,{namespace,parseKey:key,managedAssets:[]});
  await writeCachedParse(root,namespace,{pdfSha256:sha256(bytes),parseKey:key,archive:Buffer.from("zip"),info:{}},cache);
  // The cache namespace is the plan's default namespace; use the same one for the fixture.
  const plan=await createSyncPlan({outputRoot:root,paper:p,pdfBytes:bytes,namespace,cacheDir:cache});
  assert.equal(plan.cacheHit,true);assert.equal(plan.remoteCall,"none");
});

test("metadata refresh updates managed fields from the existing parse without a cache or PDF",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"pi-scholar-sync-metadata-"));const original=paper();
  const published=await publishPaper(root,original,{body:"parsed body\n",assets:[]},publication);
  await recordPublication(root,original,published,{managedAssets:[]});
  const changed=paper({title:"Updated title"});const refreshed=await refreshPublicationMetadata(root,changed);
  assert.equal(refreshed.status,"up_to_date");assert.match(await readFile(published.markdownPath,"utf8"),/title: Updated title/);assert.match(await readFile(published.markdownPath,"utf8"),/parsed body/);
});

test("recoverSync commits an installed publication and is idempotent",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"pi-scholar-sync-recover-"));const p=paper();
  await publishPaper(root,p,{body:"original\n",assets:[]},publication);
  await assert.rejects(publishPaper(root,p,{body:"replacement\n",assets:[]},publication,undefined,{commit:async()=>{throw new Error("injected commit failure");}}),/RECOVERY_REQUIRED/);
  const first=await recoverSync(root);assert.ok(first.some(item=>item.state==="done"));
  const manifest=JSON.parse(await readFile(path.join(root,".pi-scholar","manifest.json"),"utf8"));const revision=manifest.revision;
  const second=await recoverSync(root);assert.ok(second.every(item=>item.state==="done"));
  const manifestAgain=JSON.parse(await readFile(path.join(root,".pi-scholar","manifest.json"),"utf8"));assert.equal(manifestAgain.revision,revision);
});
