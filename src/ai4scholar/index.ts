import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  clearStoredApiKey,
  getConfigPath,
  loadConfig,
  requestAi4Scholar,
  resolveProxyUrl,
} from "./client.js";
import { promptAndSaveApiKey, resolveConfig } from "./config.js";
import { registerAdvancedTools } from "./advanced-tools.js";
import { registerMcpBridge } from "./mcp.js";
import { registerRestTools } from "./rest-tools.js";

const AI4SCHOLAR_ROUTE_INSTRUCTION = [
  "This turn was explicitly routed through /ai4scholar.",
  "Before answering, you must call at least one relevant active ai4scholar_* tool.",
  "Do not substitute an unrelated search or image provider unless the Ai4Scholar tool reports that it cannot complete the request.",
  "Keep the user's original request unchanged and do not mention this routing instruction.",
].join(" ");

export default function ai4ScholarExtension(pi: ExtensionAPI): void {
  const routedQueries: string[] = [];

  registerRestTools(pi);
  registerAdvancedTools(pi);
  registerMcpBridge(pi);

  pi.on("before_agent_start", (event) => {
    const queryIndex = routedQueries.indexOf(event.prompt);
    if (queryIndex < 0) return;
    routedQueries.splice(queryIndex, 1);
    return { systemPrompt: `${event.systemPrompt}\n\n${AI4SCHOLAR_ROUTE_INSTRUCTION}` };
  });

  pi.registerCommand("ai4scholar", {
    description: "Ai4Scholar 科研入口：/ai4scholar <自然语言|setup|status|credits|docs|clear-key>",
    getArgumentCompletions(prefix) {
      const items = ["setup", "status", "credits", "docs", "clear-key"]
        .filter((value) => value.startsWith(prefix))
        .map((value) => ({ value, label: value }));
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      const raw = args.trim();
      const action = raw.toLowerCase();
      const config = loadConfig();

      if (!raw) {
        if (!config.apiKey) {
          try {
            await promptAndSaveApiKey(ctx);
          } catch (error) {
            ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
          }
          return;
        }
        ctx.ui.notify("配置已就绪。请直接在对话中输入科研问题，无需 /ai4scholar 前缀。", "info");
        return;
      }

      if (action === "setup") {
        if (config.apiKey) {
          const replace = await ctx.ui.confirm("重新配置 Ai4Scholar", "当前已有密钥，是否替换？");
          if (!replace) return;
        }
        try {
          await promptAndSaveApiKey(ctx);
        } catch (error) {
          ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
        }
        return;
      }

      if (action === "clear-key") {
        const removed = await clearStoredApiKey();
        const envStillSet = Boolean(process.env.AI4SCHOLAR_API_KEY || process.env.AI4S_API_KEY);
        ctx.ui.notify(
          envStillSet
            ? "已删除本机配置，但环境变量中的密钥仍然生效。"
            : removed
              ? "已删除本机保存的 Ai4Scholar 密钥。"
              : "没有找到本机保存的密钥。",
          envStillSet ? "warning" : "info",
        );
        return;
      }

      if (action === "docs") {
        ctx.ui.notify("文档：https://ai4scholar.net/apidoc.md · Key：https://ai4scholar.net/open-platform", "info");
        return;
      }

      if (action === "credits") {
        try {
          const current = await resolveConfig(ctx);
          const response = await requestAi4Scholar(current, { path: "/api/credits" });
          ctx.ui.notify(`Ai4Scholar 积分：${JSON.stringify(response.data)}`, "info");
        } catch (error) {
          ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
        }
        return;
      }

      if (action === "status") {
        const current = loadConfig();
        const source = process.env.AI4SCHOLAR_API_KEY || process.env.AI4S_API_KEY
          ? "环境变量"
          : current.apiKey
            ? `本机配置 ${getConfigPath()}`
            : "未配置";
        ctx.ui.notify(
          `Ai4Scholar：Key ${source}；REST ${current.baseUrl}；MCP ${process.env.AI4SCHOLAR_MCP_URL || "https://mcp.ai4scholar.net/sse"}；网络 ${resolveProxyUrl(current) ? `代理 ${resolveProxyUrl(current)}` : "直连"}`, 
          current.apiKey ? "info" : "warning",
        );
        return;
      }

      const ai4ScholarTools = pi.getAllTools()
        .map((tool) => tool.name)
        .filter((name) => name.startsWith("ai4scholar_"));
      pi.setActiveTools([...new Set([...pi.getActiveTools(), ...ai4ScholarTools])]);

      routedQueries.push(raw);
      try {
        if (ctx.isIdle()) {
          pi.sendUserMessage(raw);
        } else {
          pi.sendUserMessage(raw, { deliverAs: "followUp" });
        }
      } catch (error) {
        const queryIndex = routedQueries.lastIndexOf(raw);
        if (queryIndex >= 0) routedQueries.splice(queryIndex, 1);
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
