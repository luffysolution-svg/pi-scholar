import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig, requireApiKey, type Ai4ScholarConfig } from "./client.js";

/** Tool execution never prompts for or writes credentials. */
export async function resolveConfig(ctx: ExtensionContext): Promise<Ai4ScholarConfig> {
  const config = loadConfig(process.env, { cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted?.() === true });
  requireApiKey(config);
  return config;
}
