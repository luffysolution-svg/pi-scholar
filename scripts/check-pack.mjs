import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const dir=mkdtempSync(path.join(tmpdir(),"pi-scholar-pack-"));
try{const npmCli=process.env.npm_execpath;if(!npmCli)throw new Error("check-pack must be run through npm run pack:check");const name=execFileSync(process.execPath,[npmCli,"pack","--json","--pack-destination",dir],{encoding:"utf8"});const info=JSON.parse(name)[0];const files=new Set(info.files.map(x=>x.path));for(const required of ["package.json","src/index.ts","skills/pi-scholar/SKILL.md","bin/pi-scholar.mjs","README.md","LICENSE","THIRD_PARTY_NOTICES.md",".env.example","pi-scholar.config.example.json","node_modules/pi-ai4scholar/package.json","node_modules/pi-ai4scholar/src/index.ts"])if(!files.has(required))throw new Error(`packed artifact missing ${required}`);const pkg=JSON.parse(readFileSync("package.json","utf8"));if(pkg.dependencies["pi-ai4scholar"]!=="0.4.2")throw new Error("unexpected bundled pi-ai4scholar version");console.log(`verified ${info.filename}: ${files.size} files`);}finally{rmSync(dir,{recursive:true,force:true});}
