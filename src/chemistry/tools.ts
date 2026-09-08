import { Type } from "typebox";
import { loadConfig } from "../config.js";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CASCommonChemistryClient, type CASCommonChemistryConfig } from "./client.js";

export type ChemistryConfigResolver = (ctx: ExtensionContext) => CASCommonChemistryConfig | undefined;

const output = (value: unknown) => {
  const text = JSON.stringify(value, null, 2);
  return { content: [{ type: "text" as const, text: text.length > 50 * 1024 ? `${text.slice(0, 50 * 1024)}\n[output truncated]` : text }], details: { source: "cas-common-chemistry" } };
};

function configFor(ctx: ExtensionContext, resolver?: ChemistryConfigResolver): CASCommonChemistryConfig {
  if (resolver) return resolver(ctx) ?? {};
  const loaded = loadConfig(process.env, ctx.cwd, ctx.isProjectTrusted()) as unknown as { data?: { providers?: Record<string, unknown> } };
  return (loaded.data?.providers?.["cas-common-chemistry"] ?? {}) as CASCommonChemistryConfig;
}

export function registerChemistryTools(pi: ExtensionAPI, resolver?: ChemistryConfigResolver): void {
  pi.registerTool({
    name: "chemical_sources",
    label: "Chemical Sources",
    description: "Show CAS Common Chemistry status without making a network request.",
    promptSnippet: "Inspect chemical data source status",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _update, ctx) { return output(new CASCommonChemistryClient(configFor(ctx, resolver)).status); },
  });
  pi.registerTool({
    name: "chemical_search",
    label: "Chemical Search",
    description: "Search CAS Common Chemistry substance records when an approved API contract and permission are available.",
    promptSnippet: "Search chemical substance names, CAS RNs, or structures",
    parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 500 }), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }),
    async execute(_id, params, _signal, _update, ctx) { return output(await new CASCommonChemistryClient(configFor(ctx, resolver)).search(params)); },
  });
  pi.registerTool({
    name: "chemical_get",
    label: "Chemical Get",
    description: "Fetch one CAS Common Chemistry substance by CAS RN when its approved API contract is available.",
    promptSnippet: "Get a chemical substance by CAS Registry Number",
    parameters: Type.Object({ casRn: Type.String({ minLength: 1, maxLength: 32 }) }),
    async execute(_id, params, signal, _update, ctx) { return output(await new CASCommonChemistryClient(configFor(ctx, resolver)).get(params.casRn, signal)); },
  });
}

export default registerChemistryTools;
