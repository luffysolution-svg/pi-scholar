import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Submit through Pi's input/skill expansion and ordinary model/tool permission flow. */
export function registerScholarCommand(pi: ExtensionAPI): void {
  pi.registerCommand("pi-scholar", {
    description: "文献检索、Zotero 阅读与 MinerU 解析（可直接附自然语言需求）",
    handler: async (args, ctx) => {
      let request = args.trim();
      if (!request) {
        if (!ctx.hasUI) throw new Error("Usage: /pi-scholar <研究需求>; no dialog is available in print/JSON mode.");
        request = (await ctx.ui.input("Pi Scholar：你想研究什么？", "例如：查找光热催化论文，并匹配本地 Zotero", { timeout: 120_000 }))?.trim() ?? "";
        if (!request) return;
      }
      if (!pi.getCommands().some(command => command.name === "skill:pi-scholar" && command.source === "skill")) {
        throw new Error("pi-scholar skill is unavailable. Enable package skills and enableSkillCommands, then /reload.");
      }
      pi.sendUserMessage(`/skill:pi-scholar ${request}`, {
        expandPromptTemplates: true,
        deliverAs: "followUp",
      });
    },
  });
}
