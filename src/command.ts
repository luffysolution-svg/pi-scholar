import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  loadConfig as loadOnlineConfig,
  requestAi4Scholar,
  resolveProxyUrl,
} from "./ai4scholar/client.js";
import { resolveConfig as resolveOnlineConfig } from "./ai4scholar/config.js";
import { loadMediaConfig } from "./media/config.js";
import { CapabilityRouter } from "./media/router.js";
import { loadConfig as loadScholarConfig } from "./config.js";
const ADMIN_ACTIONS = ["status", "credits", "docs"] as const;

/** Research entry point with read-only diagnostics; credentials are file/env only. */
export function registerScholarCommand(pi: ExtensionAPI): void {
  pi.registerCommand("pi-scholar", {
    description: "科研入口：/pi-scholar <自然语言|status|credits|docs>；凭据仅通过配置文件或环境变量设置",
    getArgumentCompletions(prefix) {
      const items = ADMIN_ACTIONS
        .filter((value) => value.startsWith(prefix))
        .map((value) => ({ value, label: value }));
      return items.length ? items : null;
    },
    handler: async (args, ctx) => {
      const raw = args.trim();
      const action = raw.toLowerCase();

      if (["setup", "setup-sources", "clear-key"].includes(action)) {
        throw new Error("配置命令已移除。请编辑统一配置的 apiKey/apiKeyEnv，或设置对应环境变量；Pi Scholar 不会写入或删除凭据。");
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
        const current = loadOnlineConfig(process.env, { cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted?.() === true });
        const source = current.apiKey ? "已配置（配置文件或环境变量；未验证权限）" : "未配置";
        let imageProviders = "未配置";
        let researchProviders = "未启用";
        let materials = "未启用";
        let chemistry = "未启用";
        try {
          const config = loadScholarConfig(process.env, ctx.cwd, ctx.isProjectTrusted());
          const enabled = Object.entries(config.research?.providers ?? {}).filter(([, provider]) => provider.enabled).map(([id, provider]) => {
            if (id === "unpaywall") return `${id}(${provider.contact ?? config.research?.contact ? "联系邮箱已配置" : "缺少联系邮箱"})`;
            return `${id}(${provider.apiKey ? "凭据已配置/权限未验证" : provider.apiKeyEnv ? "基本访问；可选凭据未配置" : "无需凭据/权限未验证"})`;
          });
          if (enabled.length) researchProviders = enabled.join(", ");
          const mp = config.data?.providers?.["materials-project"];
          if (mp?.enabled) materials = mp.apiKey ? "凭据已配置/权限未验证" : "凭据未配置";
          const cas = config.data?.providers?.["cas-common-chemistry"];
          if (cas?.enabled) chemistry = "需按 CAS 提供的 API 接入资料验证权限";
        } catch { researchProviders = "配置错误"; }
        try {
          const media = await loadMediaConfig(ctx.cwd, ctx.isProjectTrusted());
          const configured = new CapabilityRouter({ cwd: ctx.cwd, config: media }).providers().filter(provider => provider.configured).map(provider => provider.id);
          if (configured.length) imageProviders = configured.join(", ");
        } catch { imageProviders = "配置错误"; }
        ctx.ui.notify(`Pi Scholar：Ai4Scholar 密钥 ${source}；在线服务 ${current.baseUrl}；网络 ${resolveProxyUrl(current) ? "已配置代理" : "直连"}；绘图供应商 ${imageProviders}；文献来源 ${researchProviders}；Materials Project ${materials}；CAS Common Chemistry ${chemistry}。状态查询不测试账户权限、不消耗远端额度。`, current.apiKey || imageProviders !== "未配置" ? "info" : "warning");
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
