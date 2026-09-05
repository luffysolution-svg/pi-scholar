import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { fetch as undiciFetch } from "undici";
import { Type } from "typebox";
import { getProxyAgent, resolveProxyUrl } from "./client.js";
import { resolveConfig } from "./config.js";

interface RemoteTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

function sanitizeToolName(name: string): string {
  return `ai4s_mcp_${name.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
}

function stringifyMcpContent(result: unknown): string {
  if (!result || typeof result !== "object") return JSON.stringify(result, null, 2);
  const value = result as { content?: unknown[]; structuredContent?: unknown; isError?: boolean };
  if (!Array.isArray(value.content)) return JSON.stringify(result, null, 2);

  const parts = value.content.map((item) => {
    if (!item || typeof item !== "object") return String(item);
    const content = item as Record<string, unknown>;
    if (content.type === "text" && typeof content.text === "string") return content.text;
    if (content.type === "image") {
      const mime = typeof content.mimeType === "string" ? content.mimeType : "image";
      const bytes = typeof content.data === "string" ? content.data.length : 0;
      return `[MCP 返回 ${mime} 图片，base64 长度 ${bytes}；完整结果见 details 或截断文件]`;
    }
    return JSON.stringify(content, null, 2);
  });
  if (value.structuredContent !== undefined) {
    parts.push(JSON.stringify(value.structuredContent, null, 2));
  }
  return parts.join("\n\n");
}

async function formatMcpResult(result: unknown, remoteName: string) {
  const readable = stringifyMcpContent(result);
  const truncation = truncateHead(readable, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  let text = truncation.content;
  let fullOutputPath: string | undefined;
  if (truncation.truncated) {
    const directory = await mkdtemp(join(tmpdir(), "pi-scholar-ai4scholar-mcp-"));
    fullOutputPath = join(directory, "response.json");
    await writeFile(fullOutputPath, JSON.stringify(result, null, 2), "utf8");
    text += `\n\n[MCP 响应已截断：${formatSize(truncation.outputBytes)}/${formatSize(truncation.totalBytes)}。完整结果：${fullOutputPath}]`;
  }
  return {
    content: [{ type: "text" as const, text }],
    details: {
      remoteTool: remoteName,
      result: truncation.truncated ? undefined : result,
      truncation,
      fullOutputPath,
    },
  };
}

export function registerMcpBridge(pi: ExtensionAPI): void {
  let client: Client | undefined;
  let transport: SSEClientTransport | undefined;
  let tools: RemoteTool[] | undefined;
  const registered = new Map<string, string>();
  let connecting: Promise<RemoteTool[]> | undefined;
  let toolCallQueue: Promise<void> = Promise.resolve();

  async function connect(ctx: ExtensionContext, signal?: AbortSignal): Promise<RemoteTool[]> {
    if (tools) return tools;
    if (connecting) return connecting;

    connecting = (async () => {
      const config = await resolveConfig(ctx);
      const apiKey = config.apiKey;
      const mcpUrl = process.env.AI4SCHOLAR_MCP_URL?.trim() || "https://mcp.ai4scholar.net/sse";
      const proxyUrl = resolveProxyUrl(config);
      const proxyFetch = proxyUrl
        ? ((input: string | URL | Request, init?: RequestInit) =>
            undiciFetch(input as any, {
              ...(init as any),
              dispatcher: getProxyAgent(proxyUrl),
            } as any) as unknown as Promise<Response>)
        : undefined;
      client = new Client({ name: "pi-scholar", version: "0.2.0" }, { capabilities: {} });
      transport = new SSEClientTransport(new URL(mcpUrl), {
        requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
        fetch: proxyFetch,
      });
      await client.connect(transport, signal ? { signal } : undefined);

      const discovered: RemoteTool[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < 100; page += 1) {
        const response = await client.listTools(cursor ? { cursor } : undefined, signal ? { signal } : undefined);
        discovered.push(...response.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as Record<string, unknown>,
        })));
        if (!response.nextCursor) break;
        if (seenCursors.has(response.nextCursor)) {
          throw new Error("Ai4Scholar MCP 返回了重复的工具分页游标。");
        }
        seenCursors.add(response.nextCursor);
        cursor = response.nextCursor;
      }
      tools = discovered;
      return tools;
    })();

    try {
      return await connecting;
    } catch (error) {
      connecting = undefined;
      tools = undefined;
      await client?.close().catch(() => undefined);
      client = undefined;
      transport = undefined;
      throw error;
    }
  }

  async function resetConnection(): Promise<void> {
    await client?.close().catch(() => undefined);
    client = undefined;
    transport = undefined;
    tools = undefined;
    connecting = undefined;
  }

  function registerRemoteTool(tool: RemoteTool): string {
    const existing = registered.get(tool.name);
    if (existing) return existing;

    let piName = sanitizeToolName(tool.name);
    const usedNames = new Set(registered.values());
    let suffix = 2;
    while (usedNames.has(piName)) piName = `${sanitizeToolName(tool.name)}_${suffix++}`;
    registered.set(tool.name, piName);

    pi.registerTool({
      name: piName,
      label: `Ai4Scholar MCP · ${tool.name}`,
      description: `Ai4Scholar remote MCP tool "${tool.name}". ${tool.description ?? ""} Calls may consume Ai4Scholar credits.`,
      parameters: Type.Unsafe<Record<string, unknown>>(tool.inputSchema),
      async execute(_id, params, signal, onUpdate, ctx) {
        onUpdate?.({ content: [{ type: "text", text: `正在调用 MCP 工具 ${tool.name}…` }], details: {} });
        const invoke = async () => {
          if (signal?.aborted) throw new Error("Ai4Scholar MCP 调用已取消。");
          await connect(ctx, signal);
          if (!client) throw new Error("Ai4Scholar MCP 未连接。");
          let result;
          try {
            result = await client.callTool(
              { name: tool.name, arguments: params },
              undefined,
              { signal, timeout: 300_000, resetTimeoutOnProgress: true },
            );
          } catch (error) {
            await resetConnection();
            throw error;
          }
          if (result.isError) {
            throw new Error(`Ai4Scholar MCP 工具 ${tool.name} 返回错误：${stringifyMcpContent(result)}`);
          }
          return formatMcpResult(result, tool.name);
        };
        const queued = toolCallQueue.then(invoke, invoke);
        toolCallQueue = queued.then(() => undefined, () => undefined);
        return queued;
      },
    });
    return piName;
  }

  pi.registerTool({
    name: "ai4scholar_mcp",
    label: "Ai4Scholar MCP",
    description:
      "Connect to Ai4Scholar's hosted MCP server, list its current tools, or dynamically load relevant MCP tools. Use action=load with a capability query or exact toolNames. The API key comes from AI4SCHOLAR_API_KEY.",
    promptSnippet: "Discover and load Ai4Scholar MCP tools for full-text reading, PDF workflows, auto-citation, and scientific figures",
    promptGuidelines: [
      "Use ai4scholar_mcp to discover Ai4Scholar MCP capabilities not covered by the direct REST tools, such as full-text reading, PDF download, auto-citation, and scientific figure operations.",
    ],
    parameters: Type.Object({
      action: StringEnum(["list", "load"] as const),
      query: Type.Optional(Type.String({ description: "Capability keywords, e.g. full text, PDF, auto cite, nano draw" })),
      toolNames: Type.Optional(Type.Array(Type.String(), { description: "Exact remote MCP tool names to load" })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "正在连接 Ai4Scholar MCP…" }], details: {} });
      const catalog = await connect(ctx, signal);
      if (params.action === "list") {
        const listing = catalog.map(({ name, description }) => ({ name, description }));
        return {
          content: [{ type: "text", text: JSON.stringify({ count: listing.length, tools: listing }, null, 2) }],
          details: { count: listing.length, tools: listing },
        };
      }

      const exact = new Set(params.toolNames ?? []);
      const terms = (params.query ?? "")
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter(Boolean);
      if (exact.size === 0 && terms.length === 0) {
        throw new Error("load 操作需要 query 或 toolNames。");
      }

      const matches = catalog
        .map((tool) => {
          const haystack = `${tool.name} ${tool.description ?? ""}`.toLowerCase();
          const score = exact.has(tool.name)
            ? 1000
            : terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
          return { tool, score };
        })
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
        .slice(0, params.limit ?? 5);

      if (matches.length === 0) {
        return {
          content: [{ type: "text", text: "没有匹配的 MCP 工具。请先用 action=list 查看目录。" }],
          details: { matches: [], added: [] },
        };
      }

      const piNames = matches.map(({ tool }) => registerRemoteTool(tool));
      const active = pi.getActiveTools();
      const added = piNames.filter((name) => !active.includes(name));
      pi.setActiveTools([...new Set([...active, ...added])]);
      const mapping = matches.map(({ tool }, index) => ({ remote: tool.name, pi: piNames[index] }));
      return {
        content: [{ type: "text", text: `已加载 MCP 工具：\n${mapping.map((item) => `- ${item.pi} ← ${item.remote}`).join("\n")}` }],
        details: { matches: mapping, added },
      };
    },
  });

  pi.on("session_shutdown", async () => {
    registered.clear();
    toolCallQueue = Promise.resolve();
    await resetConnection();
  });
}
