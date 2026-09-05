import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import ai4ScholarExtension from "pi-ai4scholar";
import { registerScholarCommand } from "./command.js";
import { registerScholarTools } from "./tools.js";

const loaded=new WeakSet<object>();
export default function piScholarExtension(pi:ExtensionAPI):void {
  if(loaded.has(pi as object))return;
  loaded.add(pi as object);
  ai4ScholarExtension(pi);
  registerScholarTools(pi);
  registerScholarCommand(pi);
}
export * from "./model.js";
export * from "./zotero.js";
export * from "./mineru.js";
export * from "./output.js";
