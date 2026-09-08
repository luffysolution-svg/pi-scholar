import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  clearStoredApiKey,
  getConfigPath,
  loadConfig as loadOnlineConfig,
  requestAi4Scholar,
  resolveProxyUrl,
} from "./ai4scholar/client.js";
import { promptAndSaveApiKey, resolveConfig as resolveOnlineConfig } from "./ai4scholar/config.js";
import { loadMediaConfig } from "./media/config.js";
import { CapabilityRouter } from "./media/router.js";
import { loadConfig as loadScholarConfig } from "./config.js";
import { DEFAULT_PROVIDERS } from "./research/config.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

const ADMIN_ACTIONS = ["setup", "status", "credits", "docs", "clear-key", "setup-sources"] as const;
const DATA_PROVIDER_DEFAULTS = {
  "materials-project": { apiKeyEnv: "MP_API_KEY" },
  "cas-common-chemistry": {},
} as const;

/** Route research requests through the orchestrator skill and keep setup under one command. */
export function registerScholarCommand(pi: ExtensionAPI): void {
  pi.registerCommand("pi-scholar", {
    description: "科研入口：/pi-scholar <自然语言|setup|status|credits|docs|clear-key|setup-sources>",
    getArgumentCompletions(prefix) {
      const items = ADMIN_ACTIONS
        .filter((value) => value.startsWith(prefix))
        .map((value) => ({ value, label: value }));
      return items.length ? items : null;
    },
    handler: async (args, ctx) => {
      const raw = args.trim();
      const action = raw.toLowerCase();

      if (action === "setup-sources") {
        if (!ctx.hasUI) throw new Error("Source setup requires interactive Pi; edit apiKey or apiKeyEnv in the example config in noninteractive mode.");
        const config = loadScholarConfig(process.env, ctx.cwd, ctx.isProjectTrusted());
        const providerId = await ctx.ui.select("选择要配置的来源（不进行联网测试）", [...Object.keys(DEFAULT_PROVIDERS), ...Object.keys(DATA_PROVIDER_DEFAULTS)]);
        if (!providerId) return;
        const isDataProvider = Object.hasOwn(DATA_PROVIDER_DEFAULTS, providerId);
        const defaults = isDataProvider ? DATA_PROVIDER_DEFAULTS[providerId as keyof typeof DATA_PROVIDER_DEFAULTS] : DEFAULT_PROVIDERS[providerId]!;
        const rawApiKeyEnv = (defaults as { apiKeyEnv?: unknown }).apiKeyEnv;
        const apiKeyEnv = typeof rawApiKeyEnv === "string" ? rawApiKeyEnv : undefined;
        const credentialRequired = providerId === "materials-project" || providerId === "easyscholar";
        const reference = apiKeyEnv ? (await ctx.ui.input(credentialRequired ? "凭据环境变量名（直接密钥请编辑统一配置）" : "可选凭据环境变量名（可留空）", apiKeyEnv))?.trim() : undefined;
        if (credentialRequired && !reference) return;
        if (reference && !/^[A-Z_][A-Z0-9_]*$/.test(reference)) throw new Error("Expected an uppercase environment variable name, not a secret.");
        const original = config.configPath ? await readFile(config.configPath, "utf8") : "{}";
        const proposed = JSON.parse(original);
        proposed.schemaVersion = 3;
        const section = isDataProvider ? "data" : "research";
        proposed[section] ??= {};
        proposed[section].providers ??= {};
        proposed[section].providers[providerId] = { ...proposed[section].providers[providerId], enabled: true, ...(reference ? { apiKeyEnv: reference } : {}) };
        const base = config.configPath ?? path.join(os.homedir(), ".config", "pi-scholar", "config.json");
        const candidate = `${base}.sources-${randomUUID()}.json`;
        const preview = `启用 ${providerId}${reference ? `，凭据引用 ${reference}` : ""}；不推断账户授权。生成独立配置 ${candidate}，保留当前配置。`;
        if (!await ctx.ui.confirm("保存来源配置候选", preview)) return;
        if (config.configPath && await readFile(config.configPath, "utf8") !== original) throw new Error("Configuration changed; restart source setup.");
        await mkdir(path.dirname(candidate), { recursive: true });
        await writeFile(candidate, JSON.stringify(proposed, null, 2) + "\n", { flag: "wx", mode: 0o600 });
        loadScholarConfig({ PI_SCHOLAR_CONFIG: candidate });
        ctx.ui.notify(`已生成 ${candidate}；检查后用 PI_SCHOLAR_CONFIG 选择。可在 apiKey 中直接填写密钥，或使用 apiKeyEnv。`, "info");
        return;
      }

      if (action === "setup") {
        if (!ctx.hasUI) throw new Error("Setup requires interactive Pi; alternatively set AI4SCHOLAR_API_KEY.");
        if (process.env.AI4SCHOLAR_API_KEY) {
          ctx.ui.notify("当前密钥来自 AI4SCHOLAR_API_KEY；请在启动 Pi 的环境中修改或移除该变量。", "warning");
          return;
        }
        const current = loadOnlineConfig(process.env, { cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted?.() === true });
        if (current.apiKey && !await ctx.ui.confirm("重新配置在线科研服务", "当前已有密钥，是否替换？")) return;
        try { await promptAndSaveApiKey(ctx); }
        catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning"); }
        return;
      }

      if (action === "clear-key") {
        const root = loadScholarConfig(process.env, ctx.cwd, ctx.isProjectTrusted());
        const removed = await clearStoredApiKey(root.configPath ? { ...process.env, PI_SCHOLAR_CONFIG: root.configPath } : process.env);
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
        const current = loadOnlineConfig(process.env, { cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted?.() === true });
        const source = process.env.AI4SCHOLAR_API_KEY ? "环境变量" : current.apiKey ? `本机配置 ${getConfigPath()}` : "未配置";
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
