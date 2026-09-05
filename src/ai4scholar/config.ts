import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  Ai4ScholarError,
  loadConfig,
  saveStoredApiKey,
  type Ai4ScholarConfig,
} from "./client.js";

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

  const path = await saveStoredApiKey(apiKey);
  ctx.ui.notify(`Ai4Scholar 已配置，密钥保存在 ${path}`, "info");
  return { ...loadConfig(), apiKey: apiKey.trim() };
}

export async function resolveConfig(ctx: ExtensionContext): Promise<Ai4ScholarConfig> {
  const config = loadConfig();
  return config.apiKey ? config : promptAndSaveApiKey(ctx);
}
