import assert from "node:assert/strict";
import test from "node:test";
import piScholarExtension from "../src/index.js";

function harness(){const tools:any[]=[];const commands:string[]=[];const hooks:string[]=[];const pi={registerTool:(tool:any)=>tools.push(tool),registerCommand:(name:string)=>commands.push(name),on:(event:string)=>{hooks.push(event);},getAllTools:()=>tools,getActiveTools:()=>[],setActiveTools:()=>{},sendUserMessage:()=>{}};piScholarExtension(pi as any);return{pi,tools,commands,hooks};}

test("new research, materials, and chemical tools are exposed once without network initialization", () => {
  const { pi, tools } = harness();
  piScholarExtension(pi as any);
  for (const name of ["research_sources", "literature_search", "literature_get", "literature_graph", "journal_metrics", "literature_fulltext", "materials_capabilities", "materials_search", "materials_get", "materials_export", "chemical_sources", "chemical_search", "chemical_get"]) {
    assert.equal(tools.filter(tool => tool.name === name).length, 1, name);
  }
});

test("Pi entry point registers integrated Ai4Scholar and local tools exactly once",()=>{
  const h=harness();const names=h.tools.map(t=>t.name);for(const name of ["ai4scholar_search","ai4scholar_paper","ai4scholar_cite","ai4scholar_mcp","zotero_collections","zotero_search","zotero_item","pi_scholar_parse","pi_scholar_image_models","pi_scholar_image_generate","pi_scholar_image_edit","pi_scholar_image_service"])assert.equal(names.filter(n=>n===name).length,1,`${name} registration`);
  assert.deepEqual(names.filter(n=>n.startsWith("zotero_")||n==="pi_scholar_parse"),["zotero_collections","zotero_search","zotero_item","pi_scholar_parse"]);assert.deepEqual(h.commands,["pi-scholar"]);const count=h.tools.length;piScholarExtension(h.pi as any);assert.equal(h.tools.length,count);assert.deepEqual(h.commands,["pi-scholar"]);
});

test("integrated Ai4Scholar search is callable through pi-scholar",async t=>{
  const h=harness();const tool=h.tools.find(x=>x.name==="ai4scholar_search");assert.ok(tool);const originalFetch=globalThis.fetch;const old={key:process.env.AI4SCHOLAR_API_KEY,base:process.env.AI4SCHOLAR_BASE_URL,proxy:process.env.AI4SCHOLAR_PROXY};process.env.AI4SCHOLAR_API_KEY="test-key";process.env.AI4SCHOLAR_BASE_URL="https://ai.example.test";process.env.AI4SCHOLAR_PROXY="direct";t.after(()=>{globalThis.fetch=originalFetch;for(const [key,value] of [["AI4SCHOLAR_API_KEY",old.key],["AI4SCHOLAR_BASE_URL",old.base],["AI4SCHOLAR_PROXY",old.proxy]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}});let requested="";globalThis.fetch=async(input)=>{requested=String(input);return new Response(JSON.stringify({data:[{paperId:"online-1",title:"Mock result"}]}),{status:200,headers:{"content-type":"application/json"}});};const result=await tool.execute("call",{source:"semantic_scholar",query:"mock research"},undefined,undefined,{});assert.equal(new URL(requested).pathname,"/graph/v1/paper/search");assert.match(result.content[0].text,/Mock result/);
});
