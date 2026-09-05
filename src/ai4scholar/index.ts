import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAdvancedTools } from "./advanced-tools.js";
import { registerMcpBridge } from "./mcp.js";
import { registerRestTools } from "./rest-tools.js";

/** Register the integrated online research tools without adding a separate command. */
export default function registerOnlineResearchTools(pi: ExtensionAPI): void {
  registerRestTools(pi);
  registerAdvancedTools(pi);
  registerMcpBridge(pi);
}
