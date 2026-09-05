import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MinerUClient, readResponseBytes } from "../src/mineru.js";
import { archive, json } from "./helpers.js";

async function pdfFile():Promise<string>{const dir=await mkdtemp(path.join(os.tmpdir(),"mineru-"));const file=path.join(dir,"paper.pdf");await writeFile(file,"%PDF-mocked-content");return file;}

test("MinerU performs signed raw PUT, bounded polling and archive download without exposing secrets",async()=>{
  const pdf=await pdfFile();const zip=archive("# Result\n![x](images/x.png)",{"images/x.png":"image"});const calls:{url:string;init:RequestInit}[]=[];let polls=0;const stages:string[]=[];
  const fetcher:typeof fetch=async(input,init={})=>{const url=String(input);calls.push({url,init});if(url.endsWith("/file-urls/batch"))return json({code:0,data:{batch_id:"batch-secret",file_urls:["https://signed.example/upload?signature=SECRET"]}});if(url.startsWith("https://signed.example/upload"))return new Response(null,{status:200});if(url.includes("/extract-results/batch/")){polls++;return json({code:0,data:{extract_result:[polls===1?{data_id:"different",state:"pending"}:{state:"done",file_name:"paper.pdf",full_zip_url:"https://download.example/result?signature=SECRET",model_version:"vlm",version:"2.5"}]}});}if(url.startsWith("https://download.example/"))return new Response(zip.buffer.slice(zip.byteOffset,zip.byteOffset+zip.byteLength) as ArrayBuffer,{status:200,headers:{"content-length":String(zip.length)}});throw new Error("unexpected request");};
  const client=new MinerUClient({token:"TOP-SECRET",initialPollMs:1,maxPollMs:2,maxAttempts:5},fetcher,async()=>{});const run=await client.extract(pdf,undefined,s=>stages.push(s));assert.match(run.pdfSha256,/^[a-f0-9]{64}$/);assert.equal(run.info.batchId,"batch-secret");assert.equal(polls,2);assert.deepEqual(stages,["requesting signed upload","uploading PDF","waiting for extraction","downloading result"]);
  const creation=calls[0]!,upload=calls[1]!;assert.equal(creation.init.method,"POST");assert.equal(new Headers(creation.init.headers).get("Authorization"),"Bearer TOP-SECRET");assert.equal(upload.init.method,"PUT");assert.equal(new Headers(upload.init.headers).has("Content-Type"),false);assert.equal(Buffer.from(upload.init.body as Uint8Array).subarray(0,5).toString(),"%PDF-");assert.equal(calls.at(-1)?.init.method,"GET");
});

test("MinerU retries documented transient application errors and redacts terminal failures",async()=>{
  const pdf=await pdfFile();let creates=0,polls=0;const fetcher:typeof fetch=async(input)=>{const url=String(input);if(url.endsWith("/file-urls/batch")){creates++;if(creates<3)return json({code:-10001,msg:"service busy"});return json({code:0,data:{batch_id:"batch",file_urls:["https://signed.example/u"]}});}if(url.startsWith("https://signed.example"))return new Response(null,{status:200});polls++;return json({code:0,data:{extract_result:[{state:"failed",err_msg:"LEAK-ME at https://signed.example/private?q=LEAK-ME"}]}});};
  const client=new MinerUClient({token:"LEAK-ME",maxAttempts:10},fetcher,async()=>{});await assert.rejects(client.extract(pdf),error=>{assert.match(String(error),/MinerU parse failed/);assert.doesNotMatch(String(error),/LEAK-ME|signed\.example/);return true;});assert.equal(creates,3);assert.equal(polls,1);
});

test("polling skips delay after the final attempt",async()=>{
  const pdf=await pdfFile();const sleeps:number[]=[];const fetcher:typeof fetch=async(input)=>{const url=String(input);if(url.endsWith("/file-urls/batch"))return json({code:0,data:{batch_id:"batch",file_urls:["https://signed.example/u"]}});if(url.startsWith("https://signed.example"))return new Response(null,{status:200});return json({code:0,data:{extract_result:[{state:"pending"}]}});};
  await assert.rejects(new MinerUClient({token:"token",timeoutMs:10_000,initialPollMs:60_000,maxPollMs:60_000,maxAttempts:1},fetcher,async ms=>{sleeps.push(ms);}).extract(pdf),/polling timed out/);assert.deepEqual(sleeps,[]);
});

test("response bodies are streamed and cancelled at the configured byte limit",async()=>{
  const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array([1,2]));controller.enqueue(new Uint8Array([3,4]));controller.close();}});
  await assert.rejects(readResponseBytes(new Response(stream),3),/exceeds .* limit/);
  assert.deepEqual([...await readResponseBytes(new Response(new Uint8Array([1,2,3])),3)],[1,2,3]);
});

test("MinerU validates PDF, size/signing responses, redacts service echoes and honors cancellation",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"mineru-invalid-"));const bad=path.join(dir,"bad.pdf");await writeFile(bad,"not pdf");await assert.rejects(new MinerUClient({token:"token"}).extract(bad),/not a readable PDF/);
  const pdf=await pdfFile();await assert.rejects(new MinerUClient({token:"SECRET"},async()=>json({code:2,msg:"token SECRET at https://signed.example/?q=SECRET"})).extract(pdf),error=>{assert.doesNotMatch(String(error),/SECRET|signed\.example/);return true;});
  await assert.rejects(new MinerUClient({token:"token"},async()=>json({code:0,data:{batch_id:"batch",file_urls:["http://insecure.example/upload"]}})).extract(pdf),/signed-upload URL must be an HTTPS URL/);
  const abort=new AbortController();abort.abort(new Error("cancel upload"));const cancellation=new MinerUClient({token:"token"},async(_input,init)=>{init?.signal?.throwIfAborted();return json({});},async()=>{});await assert.rejects(cancellation.extract(pdf,abort.signal),/cancel upload/);
});
