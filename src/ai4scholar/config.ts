import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  Ai4ScholarError,
  loadConfig,
  saveStoredApiKey,
  type Ai4ScholarConfig,
} from "./client.js";
import { loadConfig as loadScholarConfig } from "../config.js";

export async function promptAndSaveApiKey(ctx: ExtensionContext): Promise<Ai4ScholarConfig> {
  if (!ctx.hasUI) {
    throw new Ai4ScholarError(
      "尚未配置 Ai4Scholar。请在交互模式运行 /pi-scholar setup，或设置 AI4SCHOLAR_API_KEY。",
    );
  }

  const apiKey = await ctx.ui.input(
    "配置 Ai4Scholar",
    "粘贴 sk-user-... API Key（仅保存在本机，不发送给模型）",
  );
  if (!apiKey?.trim()) {
    throw new Ai4ScholarError("已取消 Ai4Scholar 配置。");
  }

  const root = loadScholarConfig(process.env, ctx.cwd, ctx.isProjectTrusted?.() === true);
  const saveEnv = root.configPath ? { ...process.env, PI_SCHOLAR_CONFIG: root.configPath } : process.env;
  const path = await saveStoredApiKey(apiKey, saveEnv);
  ctx.ui.notify(`Ai4Scholar 已写入统一配置 ${path}`, "info");
  return { ...loadConfig(process.env, { cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted?.() === true }), apiKey: apiKey.trim() };
}

export async function resolveConfig(ctx: ExtensionContext): Promise<Ai4ScholarConfig> {
  const config = loadConfig(process.env, { cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted?.() === true });
  return config.apiKey ? config : promptAndSaveApiKey(ctx);
}
