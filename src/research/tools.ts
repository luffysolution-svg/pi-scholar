import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../config.js";
import { disabledResearchConfig, loadResearchConfig, type ResearchConfig } from "./config.js";
import { redactSecrets, ResearchError } from "./errors.js";
import { createResearchRouter, type DefaultResearchRouter } from "./router.js";

const OUTPUT_MAX_BYTES = 50 * 1024;
const OUTPUT_MAX_LINES = 2000;
function boundedOutput(value: unknown): { text: string; truncated: boolean } {
  const serialized = JSON.stringify(redactSecrets(value), null, 2);
  const lines = serialized.split("\n");
  const limitedLines = lines.length > OUTPUT_MAX_LINES ? lines.slice(0, OUTPUT_MAX_LINES - 1) : lines;
  let text = limitedLines.join("\n");
  let truncated = limitedLines.length !== lines.length;
  const marker = "[output truncated]";
  if (Buffer.byteLength(text, "utf8") + (truncated ? marker.length + 1 : 0) > OUTPUT_MAX_BYTES) {
    const bytes = Buffer.from(text, "utf8").subarray(0, OUTPUT_MAX_BYTES - marker.length - 2);
    text = bytes.toString("utf8").replace(/[\uD800-\uDFFF]$/, "");
    truncated = true;
  }
  if (truncated) text = `${text}\n${marker}`;
  return { text, truncated };
}
function output(value: unknown) {
  const bounded = boundedOutput(value);
  return { content: [{ type: "text" as const, text: bounded.text }], details: bounded.truncated ? { truncated: true, preview: bounded.text } : redactSecrets(value) };
}
function requireQuery(query: string) { if (!query.trim()) throw new ResearchError("SCHEMA_MISMATCH", "query must not be empty"); }

async function saveBinaryFulltext(cacheDir: string, id: string, bytes: Uint8Array): Promise<{ localPath: string; sha256: string; bytes: number }> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const idHash = createHash("sha256").update(id).digest("hex").slice(0, 20);
  const directory = path.resolve(cacheDir, "fulltext", "arxiv");
  await mkdir(directory, { recursive: true });
  if ((await lstat(directory)).isSymbolicLink()) throw new ResearchError("CONFLICT", "Research full-text cache must not be a symbolic link", "arxiv");
  const destination = path.join(directory, `${idHash}-${sha256.slice(0, 20)}.pdf`);
  const temporary = path.join(directory, `.download-${process.pid}-${randomUUID()}.tmp`);
  await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
  try {
    try { await link(temporary, destination); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const info = await lstat(destination);
      if (!info.isFile() || info.isSymbolicLink() || createHash("sha256").update(await readFile(destination)).digest("hex") !== sha256) {
        throw new ResearchError("CONFLICT", "Existing arXiv cache entry does not match the fetched PDF", "arxiv");
      }
    }
  } finally { await rm(temporary, { force: true }); }
  return { localPath: destination, sha256, bytes: bytes.byteLength };
}

export type ResearchDataStatusProvider = () => unknown;

export function registerResearchTools(pi: ExtensionAPI, config?: ResearchConfig, dataStatus?: ResearchDataStatusProvider): void {
  // Resolve configuration at execution time so an invalid optional research section
  // cannot prevent the rest of the extension from loading, and edits take effect.
  let cachedKey = "";
  let cachedRouter: DefaultResearchRouter | undefined;
  const getRouter = (ctx?: { cwd?: string; isProjectTrusted?: () => boolean }) => {
    const loaded = config ? undefined : loadConfig(process.env, ctx?.cwd ?? process.cwd(), ctx?.isProjectTrusted?.() === true) as unknown as { research?: unknown };
    const effective = config ?? (loaded?.research === undefined ? disabledResearchConfig() : loadResearchConfig(loaded.research));
    // Include only credential presence (never the secret itself), so rotating or
    // adding an environment credential refreshes status without leaking it into cache keys.
    const credentialState = Object.entries(effective.providers).map(([id, provider]) => `${id}:${provider.credentialEnv ? Boolean(process.env[provider.credentialEnv]) : false}`).join("|");
    const key = `${JSON.stringify(effective)}|${credentialState}`;
    if (!cachedRouter || key !== cachedKey) { cachedKey = key; cachedRouter = createResearchRouter(effective); }
    return cachedRouter;
  };
  pi.registerTool({
    name: "research_sources", label: "Research Sources", promptSnippet: "List configured research providers and their actual capabilities", description: "List literature providers, credentials, entitlements, validation state, and limitations. This does not make network requests.",
    parameters: Type.Object({}), async execute(_id, _params, _signal, _update, ctx) { const literature = getRouter(ctx).listSources(); return output(dataStatus ? { literature, data: dataStatus() } : literature); },
  });
  pi.registerTool({
    name: "literature_search", label: "Literature Search", promptSnippet: "Search explicitly selected scholarly literature sources", description: "Search enabled official literature APIs. Paid providers are never selected implicitly; specify provider/providers or allowPaid.",
    parameters: Type.Object({ query: Type.String({ minLength: 1 }), provider: Type.Optional(Type.String()), providers: Type.Optional(Type.Array(Type.String(), { minItems: 1, maxItems: 8 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })), offset: Type.Optional(Type.Integer({ minimum: 0 })), yearFrom: Type.Optional(Type.Integer({ minimum: 1000, maximum: 3000 })), yearTo: Type.Optional(Type.Integer({ minimum: 1000, maximum: 3000 })), openAccessOnly: Type.Optional(Type.Boolean()), fields: Type.Optional(Type.Array(Type.String())), allowPaid: Type.Optional(Type.Boolean()) }),
    async execute(_id, params, signal, _update, ctx) { requireQuery(params.query); return output(await getRouter(ctx).search({ ...params, signal })); },
  });
  pi.registerTool({
    name: "literature_get", label: "Literature Get", promptSnippet: "Fetch a paper by a verified provider identifier", description: "Fetch metadata from one explicitly selected provider.",
    parameters: Type.Object({ provider: Type.String(), id: Type.String({ minLength: 1 }) }),
    async execute(_id, params, signal, _update, ctx) { return output(await getRouter(ctx).get(params.provider, params.id, signal)); },
  });
  pi.registerTool({
    name: "literature_graph", label: "Literature Graph", promptSnippet: "Inspect citations or references from a selected literature source", description: "Fetch citations, references, or recommendations where the selected provider actually implements that relation.",
    parameters: Type.Object({ provider: Type.String(), id: Type.String({ minLength: 1 }), kind: StringEnum(["references", "citations", "recommendations"] as const), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })), offset: Type.Optional(Type.Integer({ minimum: 0 })) }),
    async execute(_id, params, signal, _update, ctx) { return output(await getRouter(ctx).graph(params.provider, params.id, params.kind, { limit: params.limit, offset: params.offset, signal })); },
  });
  pi.registerTool({
    name: "journal_metrics", label: "Journal Metrics", promptSnippet: "Look up journal metrics only when a verified provider supports them", description: "Retrieve journal metrics with their source and year. Contract-blocked services fail explicitly.",
    parameters: Type.Object({ provider: Type.String(), query: Type.String({ minLength: 1 }) }),
    async execute(_id, params, signal, _update, ctx) { return output(await getRouter(ctx).metrics(params.provider, params.query, signal)); },
  });
  pi.registerTool({
    name: "literature_fulltext", label: "Literature Full Text", promptSnippet: "Resolve or fetch legally available provider full text", description: "Resolve a full-text resource separately from downloading it. Provider entitlement and content license remain authoritative.",
    parameters: Type.Object({ provider: Type.String(), id: Type.String({ minLength: 1 }), action: StringEnum(["resolve", "fetch"] as const) }),
    async execute(_id, params, signal, _update, ctx) {
      const value = await getRouter(ctx).fulltext(params.provider, params.id, params.action, signal);
      if (value && typeof value === "object" && (value as Record<string, unknown>).content instanceof Uint8Array) {
        const { content, ...metadata } = value as Record<string, unknown> & { content: Uint8Array };
        const loaded = loadConfig(process.env, ctx.cwd, ctx.isProjectTrusted?.() === true);
        const cacheDir = config?.cacheDir ?? loaded.research?.cacheDir ?? path.join(os.homedir(), ".cache", "pi-scholar", "research");
        return output({ ...metadata, ...await saveBinaryFulltext(cacheDir, `${params.provider}:${params.id}`, content) });
      }
      return output(value);
    },
  });
}
