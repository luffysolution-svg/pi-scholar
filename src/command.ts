import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  clearStoredApiKey,
  getConfigPath,
  loadConfig as loadOnlineConfig,
  requestAi4Scholar,
  resolveProxyUrl,
} from "./ai4scholar/client.js";
import { promptAndSaveApiKey, resolveConfig as resolveOnlineConfig } from "./ai4scholar/config.js";

const ADMIN_ACTIONS = ["setup", "status", "credits", "docs", "clear-key"] as const;

/** Route research requests through the orchestrator skill and keep setup under one command. */
export function registerScholarCommand(pi: ExtensionAPI): void {
  pi.registerCommand("pi-scholar", {
    description: "科研入口：/pi-scholar <自然语言|setup|status|credits|docs|clear-key>",
    getArgumentCompletions(prefix) {
      const items = ADMIN_ACTIONS
        .filter((value) => value.startsWith(prefix))
        .map((value) => ({ value, label: value }));
      return items.length ? items : null;
    },
    handler: async (args, ctx) => {
      const raw = args.trim();
      const action = raw.toLowerCase();

      if (action === "setup") {
        if (!ctx.hasUI) throw new Error("Setup requires interactive Pi; alternatively set AI4SCHOLAR_API_KEY.");
        if (process.env.AI4SCHOLAR_API_KEY) {
          ctx.ui.notify("当前密钥来自 AI4SCHOLAR_API_KEY；请在启动 Pi 的环境中修改或移除该变量。", "warning");
          return;
        }
        const current = loadOnlineConfig();
        if (current.apiKey && !await ctx.ui.confirm("重新配置在线科研服务", "当前已有密钥，是否替换？")) return;
        try { await promptAndSaveApiKey(ctx); }
        catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning"); }
        return;
      }

      if (action === "clear-key") {
        const removed = await clearStoredApiKey();
        const envStillSet = Boolean(process.env.AI4SCHOLAR_API_KEY);
        ctx.ui.notify(envStillSet ? "已删除本机配置，但环境变量中的密钥仍然生效。" : removed ? "已删除本机保存的在线服务密钥。" : "没有找到本机保存的密钥。", envStillSet ? "warning" : "info");
        return;
      }

      if (action === "docs") {
        ctx.ui.notify("配置文档：https://github.com/luffysolution-svg/pi-scholar/blob/main/docs/CONFIGURATION.md", "info");
        return;
      }

      if (action === "credits") {
        try {
          const response = await requestAi4Scholar(await resolveOnlineConfig(ctx), { path: "/api/credits" });
          ctx.ui.notify(`在线科研服务积分：${JSON.stringify(response.data)}`, "info");
        } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"); }
        return;
      }

      if (action === "status") {
        const current = loadOnlineConfig();
        const source = process.env.AI4SCHOLAR_API_KEY ? "环境变量" : current.apiKey ? `本机配置 ${getConfigPath()}` : "未配置";
        ctx.ui.notify(`Pi Scholar：密钥 ${source}；在线服务 ${current.baseUrl}；网络 ${resolveProxyUrl(current) ? "已配置代理" : "直连"}`, current.apiKey ? "info" : "warning");
        return;
      }

      let request = raw;
      if (!request) {
        if (!ctx.hasUI) throw new Error("Usage: /pi-scholar <研究需求>; no dialog is available in print/JSON mode.");
        request = (await ctx.ui.input("Pi Scholar：你想研究什么？", "例如：查找光热催化论文，并匹配本地 Zotero", { timeout: 120_000 }))?.trim() ?? "";
        if (!request) return;
      }
      if (!pi.getCommands().some(command => command.name === "skill:pi-scholar" && command.source === "skill")) throw new Error("pi-scholar skill is unavailable. Enable package skills and enableSkillCommands, then /reload.");
      pi.sendUserMessage(`/skill:pi-scholar ${request}`, { expandPromptTemplates: true, deliverAs: "followUp" });
    },
  });
}
