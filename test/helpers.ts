import type { Paper, MinerUInfo } from "../src/model.js";
import AdmZip from "adm-zip";

export function paper(overrides:Partial<Paper>={}):Paper{return {
  zoteroKey:"PAPER001",zoteroVersion:12,itemType:"journalArticle",title:"A Study: α/β",creators:[{creatorType:"author",firstName:"Ada",lastName:"Lovelace",name:null}],metadata:{itemType:"journalArticle",title:"A Study: α/β",extra:"Citation Key: lovelace2024"},date:"2024-05-01",year:"2024",doi:"10.1000/Test",isbn:null,issn:"1234-5678",publicationTitle:"Journal: Test",volume:"2",issue:"3",pages:"10-20",url:"https://example.test/paper",abstract:"line one\nline two",tags:["α","review"],collections:[{key:"COLL0001",name:"Reading"}],notes:[{key:"NOTE0001",version:1,parentItem:"PAPER001",note:"note: **text**"}],annotations:[{key:"ANNO0001",version:2,parentAttachment:"PDF00001",text:"highlight",comment:"评论: yes",color:"#ffff00",pageLabel:"2",sortIndex:"0001",position:{pageIndex:1},tags:["important"]}],attachments:[],selectedPdf:null,...overrides
};}
export const mineruInfo:MinerUInfo={batchId:"batch-1",state:"done",fileName:"paper.pdf",dataId:"data-1",modelVersion:"vlm",parserVersion:"2.5",options:{language:"en",enableFormula:true,enableTable:true,isOcr:false}};
export function archive(markdown:string,assets:Record<string,string|Buffer>={}):Buffer{const zip=new AdmZip();zip.addFile("result/full.md",Buffer.from(markdown));for(const [name,data] of Object.entries(assets))zip.addFile(`result/${name}`,Buffer.isBuffer(data)?data:Buffer.from(data));return zip.toBuffer();}
export function json(value:unknown,status=200,headers:Record<string,string>={}):Response{return new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json",...headers}});}
