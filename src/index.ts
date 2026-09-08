import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerOnlineResearchTools from "./ai4scholar/index.js";
import { registerScholarCommand } from "./command.js";
import { registerScholarTools } from "./tools.js";
import { registerMediaTools } from "./media/tools.js";
import { registerResearchTools } from "./research/tools.js";
import { registerMaterialsTools } from "./materials-project/index.js";
import { registerChemistryTools } from "./chemistry/index.js";
import { loadConfig } from "./config.js";

const loaded=new WeakSet<object>();
export default function piScholarExtension(pi:ExtensionAPI):void {
  if(loaded.has(pi as object))return;
  loaded.add(pi as object);
  registerOnlineResearchTools(pi);
  registerScholarTools(pi);
  registerResearchTools(pi);
  registerMaterialsTools(pi, ctx => loadConfig(process.env, ctx.cwd, ctx.isProjectTrusted()).data?.providers?.["materials-project"] ?? { enabled: false });
  registerChemistryTools(pi, ctx => loadConfig(process.env, ctx.cwd, ctx.isProjectTrusted()).data?.providers?.["cas-common-chemistry"] ?? { enabled: false });
  registerMediaTools(pi);
  registerScholarCommand(pi);
}
export * from "./model.js";
export * from "./zotero.js";
export * from "./mineru.js";
export * from "./output.js";
