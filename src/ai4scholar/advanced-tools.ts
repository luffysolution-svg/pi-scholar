import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import {
  Ai4ScholarError,
  encodeId,
  requestAi4Scholar,
  type Ai4ScholarResponse,
  type Query,
} from "./client.js";
import { resolveConfig } from "./config.js";
import { toToolResult } from "./rest-tools.js";
import { loadConfig as loadScholarConfig } from "../config.js";
import { ArtifactDownloader, extractArtifacts } from "../media/artifacts.js";
import { HttpClient } from "../media/http.js";

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""),
  ) as Partial<T>;
}

function imageMime(data: Buffer): string | undefined {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.subarray(0, 6).toString("ascii").match(/^GIF8[79]a$/)) return "image/gif";
  if (data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return undefined;
}

function replaceDownloadedUrls(value: unknown, urls: Set<string>): unknown {
  if (typeof value === "string") return urls.has(value) ? "[downloaded to local artifact]" : value;
  if (Array.isArray(value)) return value.map(item => replaceDownloadedUrls(item, urls));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceDownloadedUrls(item, urls)]));
}

export function registerAdvancedTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "ai4scholar_dataset",
    label: "Ai4Scholar Dataset",
    description:
      "Access Semantic Scholar dataset releases, release contents, signed dataset download URLs, and incremental diffs through Ai4Scholar.",
    promptSnippet: "Inspect and download Semantic Scholar dataset releases through Ai4Scholar",
    parameters: Type.Object({
      action: StringEnum(["list_releases", "release_detail", "dataset_download", "diffs"] as const),
      releaseId: Type.Optional(Type.String({ description: "Release ID for release_detail or dataset_download" })),
      datasetName: Type.Optional(Type.String({ description: "Dataset name for dataset_download or diffs" })),
      startReleaseId: Type.Optional(Type.String({ description: "Starting release ID for diffs" })),
      endReleaseId: Type.Optional(Type.String({ description: "Ending release ID for diffs" })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      let path: string;
      if (params.action === "list_releases") {
        path = "/datasets/v1/release";
      } else if (params.action === "release_detail") {
        if (!params.releaseId) throw new Error("release_detail 需要 releaseId。");
        path = `/datasets/v1/release/${encodeURIComponent(params.releaseId)}`;
      } else if (params.action === "dataset_download") {
        if (!params.releaseId || !params.datasetName) {
          throw new Error("dataset_download 需要 releaseId 和 datasetName。");
        }
        path = `/datasets/v1/release/${encodeURIComponent(params.releaseId)}/dataset/${encodeURIComponent(params.datasetName)}`;
      } else {
        if (!params.startReleaseId || !params.endReleaseId || !params.datasetName) {
          throw new Error("diffs 需要 startReleaseId、endReleaseId 和 datasetName。");
        }
        path = `/datasets/v1/diffs/${encodeURIComponent(params.startReleaseId)}/to/${encodeURIComponent(params.endReleaseId)}/${encodeURIComponent(params.datasetName)}`;
      }
      const response = await requestAi4Scholar(await resolveConfig(ctx), { path, signal });
      return toToolResult(response, `dataset:${params.action}`);
    },
  });

  pi.registerTool({
    name: "ai4scholar_journal",
    label: "Ai4Scholar Journal",
    description:
      "Search JCR/CAS journal metrics, fetch journal details and categories, or recommend journals for a manuscript through Ai4Scholar. Calls consume credits.",
    promptSnippet: "Look up journal rankings and recommend submission venues through Ai4Scholar",
    promptGuidelines: [
      "Use ai4scholar_journal for impact factors, JCR/CAS quartiles, journal details, categories, and manuscript-to-journal recommendations.",
    ],
    parameters: Type.Object({
      action: StringEnum(["search", "detail", "categories", "recommend"] as const),
      id: Type.Optional(Type.String({ description: "Journal ISSN or eISSN for detail" })),
      query: Type.Optional(Type.String({ description: "Journal name query" })),
      category: Type.Optional(Type.String()),
      jcrQuartile: Type.Optional(Type.String({ description: "JCR quartiles, e.g. Q1,Q2" })),
      casQuartile: Type.Optional(Type.String({ description: "CAS quartiles, e.g. 1区,2区" })),
      minImpactFactor: Type.Optional(Type.Number({ minimum: 0 })),
      maxImpactFactor: Type.Optional(Type.Number({ minimum: 0 })),
      isOpenAccess: Type.Optional(Type.Boolean()),
      sort: Type.Optional(Type.String({ description: "Journal/category sort mode" })),
      limit: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      fields: Type.Optional(Type.Array(Type.String(), { description: "Field groups for recommendations" })),
      fieldGroup: Type.Optional(Type.String({ description: "Comma-separated field groups for journal search/detail" })),
      title: Type.Optional(Type.String({ minLength: 5, description: "Manuscript title for recommendations" })),
      abstract: Type.Optional(Type.String()),
      topN: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
      categories: Type.Optional(Type.Array(Type.String())),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const config = await resolveConfig(ctx);
      let response: Ai4ScholarResponse;
      if (params.action === "search") {
        response = await requestAi4Scholar(config, {
          path: "/jcr/v1/journals",
          query: compactObject({
            query: params.query,
            category: params.category,
            jcr_quartile: params.jcrQuartile,
            cas_quartile: params.casQuartile,
            min_if: params.minImpactFactor,
            max_if: params.maxImpactFactor,
            is_oa: params.isOpenAccess,
            sort: params.sort,
            limit: params.limit ?? 20,
            offset: params.offset,
            fields: params.fieldGroup,
          }) as Query,
          signal,
        });
      } else if (params.action === "detail") {
        if (!params.id) throw new Error("detail 需要期刊 ISSN/eISSN 参数 id。");
        response = await requestAi4Scholar(config, {
          path: `/jcr/v1/journals/${encodeId(params.id)}`,
          query: { fields: params.fieldGroup ?? "all" },
          signal,
        });
      } else if (params.action === "categories") {
        response = await requestAi4Scholar(config, {
          path: "/jcr/v1/categories",
          query: { sort: params.sort, limit: params.limit ?? 0 },
          signal,
        });
      } else {
        if (!params.title) throw new Error("recommend 需要至少 5 个字符的 title。");
        response = await requestAi4Scholar(config, {
          method: "POST",
          path: "/jrec/v1/recommend",
          body: compactObject({
            title: params.title,
            abstract: params.abstract,
            top_n: params.topN ?? 10,
            filters: compactObject({
              min_impact_factor: params.minImpactFactor,
              max_impact_factor: params.maxImpactFactor,
              jcr_quartiles: params.jcrQuartile?.split(",").map((item) => item.trim()).filter(Boolean),
              cas_quartiles: params.casQuartile?.split(",").map((item) => item.trim()).filter(Boolean),
              is_oa: params.isOpenAccess,
              categories: params.categories,
            }),
            fields: params.fields,
          }),
          signal,
        });
      }
      return toToolResult(response, `journal:${params.action}`);
    },
  });

  pi.registerTool({
    name: "ai4scholar_citation_candidates",
    label: "Ai4Scholar Citation Candidates",
    description:
      "Find verifiable Semantic Scholar citation candidates for [CITE] markers or selected academic statements. Returns candidates for model/human review; it never silently inserts or fabricates a citation.",
    promptSnippet: "Find and verify citation candidates for academic claims through Semantic Scholar",
    promptGuidelines: [
      "Use ai4scholar_citation_candidates to retrieve candidate sources, then verify relevance and let the user/model select and format citations; do not treat the first result as automatically authoritative.",
    ],
    parameters: Type.Object({
      text: Type.String({ minLength: 20, maxLength: 10_000 }),
      mode: Type.Optional(StringEnum(["markers", "statements"] as const, { description: "markers uses text before [CITE]; statements searches sentence-like claims." })),
      maxClaims: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
      candidatesPerClaim: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
      year: Type.Optional(Type.String({ description: "Optional Semantic Scholar year/range filter." })),
      fieldsOfStudy: Type.Optional(Type.String()),
      citationStyle: Type.Optional(StringEnum(["ieee", "apa", "nature", "vancouver", "mla", "chicago", "harvard", "gbt7714"] as const, { description: "Requested downstream formatting style; candidates remain unformatted." })),
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      const mode = params.mode ?? (params.text.includes("[CITE]") ? "markers" : "statements");
      const maxClaims = params.maxClaims ?? 5;
      const contexts = mode === "markers"
        ? params.text.split("[CITE]").slice(0, -1).map(part => part.split(/(?<=[.!?。！？])\s*/).filter(Boolean).at(-1)?.trim() ?? "")
        : params.text.split(/(?<=[.!?。！？])\s*/).map(value => value.trim()).filter(value => value.length >= 30);
      const claims = contexts.filter(Boolean).slice(0, maxClaims);
      if (!claims.length) throw new Error(mode === "markers" ? "未找到 [CITE] 标记或其前置论述。" : "未找到足够完整的待引证陈述。");
      const config = await resolveConfig(ctx);
      const matched: Array<{ claim: string; candidates: unknown[] }> = [];
      let charged = 0;
      let remaining: number | undefined;
      for (let index = 0; index < claims.length; index += 1) {
        signal?.throwIfAborted();
        onUpdate?.({ content: [{ type: "text", text: `正在为第 ${index + 1}/${claims.length} 条论述检索候选文献…` }], details: {} });
        const response = await requestAi4Scholar<Record<string, unknown>>(config, {
          path: "/graph/v1/paper/search",
          query: compactObject({
            query: claims[index]!.slice(0, 500),
            fields: "paperId,title,authors,year,venue,citationCount,externalIds,url,openAccessPdf",
            limit: params.candidatesPerClaim ?? 3,
            year: params.year,
            fieldsOfStudy: params.fieldsOfStudy,
          }) as Query,
          signal,
        });
        charged += response.creditsCharged ?? 0;
        remaining = response.creditsRemaining ?? remaining;
        matched.push({ claim: claims[index]!, candidates: Array.isArray(response.data.data) ? response.data.data : [] });
      }
      return toToolResult({
        status: 200,
        url: `${config.baseUrl}/graph/v1/paper/search`,
        creditsCharged: charged || undefined,
        creditsRemaining: remaining,
        data: {
          mode,
          requestedCitationStyle: params.citationStyle ?? "apa",
          reviewRequired: true,
          instruction: "Verify relevance, identifiers, and claims before selecting and formatting any candidate.",
          matches: matched,
        },
      }, "citation-candidates");
    },
  });

  pi.registerTool({
    name: "ai4scholar_figure",
    label: "Ai4Scholar Figure",
    description:
      "Generate, edit, style, compose, iterate, critique, or vectorize scientific figures with Ai4Scholar Nano. Generated artifacts are securely downloaded to the unified output directory; supported images are also returned inline for direct model viewing. Calls consume credits.",
    promptSnippet: "Generate and revise scientific figures with Ai4Scholar Nano, including GPT Image 2",
    promptGuidelines: [
      "Use ai4scholar_figure for Ai4Scholar scientific image generation, editing, critique, iteration, composition, style transfer, or PNG/JPG-to-PDF/PPTX vectorization.",
      "Treat AI-generated scientific figures as drafts: verify labels, mechanisms, structures, and quantitative claims before publication.",
    ],
    parameters: Type.Object({
      action: StringEnum(["smart", "generate", "edit", "style", "compose", "iterate", "critic", "vectorize"] as const),
      prompt: Type.Optional(Type.String()),
      model: Type.Optional(StringEnum(["flash", "flash31", "pro", "gptimage"] as const)),
      imageSize: Type.Optional(StringEnum(["512px", "1K", "2K", "4K"] as const)),
      aspectRatio: Type.Optional(Type.String({ description: "Aspect ratio such as 1:1, 16:9, 4:3, or 3:2" })),
      images: Type.Optional(Type.Array(Type.String({ format: "uri" }), { minItems: 1 })),
      stylePreset: Type.Optional(StringEnum(["biorender", "nature", "textbook", "sketch", "threed", "infograph", "schematic", "electron"] as const)),
      lang: Type.Optional(StringEnum(["en", "zh"] as const)),
      vectorizeMode: Type.Optional(StringEnum(["fast", "standard", "premium"] as const)),
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      if (!new Set(["critic", "vectorize"]).has(params.action) && !params.prompt) {
        throw new Error(`${params.action} 需要 prompt。`);
      }
      if (new Set(["edit", "style", "compose", "iterate", "critic", "vectorize"]).has(params.action) && !params.images?.length) {
        throw new Error(`${params.action} 需要至少一个公网可访问的 images URL。`);
      }
      onUpdate?.({ content: [{ type: "text", text: `Ai4Scholar Nano 正在执行 ${params.action}…` }], details: {} });
      const model = params.model ?? "flash";
      let response: Ai4ScholarResponse;
      try {
        response = await requestAi4Scholar(await resolveConfig(ctx), {
          method: "POST",
          path: "/api/proxy/nano/generate",
          body: compactObject({
            action: params.action,
            prompt: params.prompt,
            model,
            imageSize: params.imageSize ?? "2K",
            aspectRatio: params.aspectRatio ?? "1:1",
            images: params.images,
            stylePreset: params.stylePreset,
            lang: params.lang ?? "en",
            vectorizeMode: params.vectorizeMode ?? "fast",
          }),
          signal,
          timeoutMs: 300_000,
        });
      } catch (error) {
        if (["pro", "flash31"].includes(model) && error instanceof Ai4ScholarError && /other side closed|socket.*closed|UND_ERR_SOCKET/i.test(error.message)) {
          throw new Ai4ScholarError("科研绘图的上游连接在模型完成前被关闭。客户端已允许 300 秒等待，这通常需要服务端延长网关超时；可先改用 flash，或稍后重试。为避免重复扣费，本次不会自动重试。", error.status, error.url, error.responseBody);
        }
        throw error;
      }
      const remote = extractArtifacts(response.data, "image");
      if (!remote.length) return toToolResult(response, `figure:${params.action}`);
      onUpdate?.({ content: [{ type: "text", text: `生成完成，正在下载并验证 ${remote.length} 个文件…` }], details: {} });
      const root = loadScholarConfig(process.env, ctx.cwd, ctx.isProjectTrusted?.() === true);
      const downloaded = await new ArtifactDownloader(new HttpClient(), join(root.outputDir, "ai4scholar-images"), 50 * 1024 * 1024, 120_000).downloadAll(remote, signal);
      const localArtifacts: Array<{ path: string; bytes: number; mimeType?: string; viewable: boolean }> = [];
      const inline: Array<{ type: "image"; data: string; mimeType: string }> = [];
      for (const artifact of downloaded) {
        const bytes = await readFile(artifact.path);
        const mimeType = imageMime(bytes);
        localArtifacts.push({ path: artifact.path, bytes: artifact.bytes ?? bytes.byteLength, ...(mimeType ? { mimeType } : artifact.mimeType ? { mimeType: artifact.mimeType } : {}), viewable: Boolean(mimeType) });
        if (mimeType && bytes.byteLength <= 20 * 1024 * 1024) inline.push({ type: "image", data: bytes.toString("base64"), mimeType });
      }
      const remoteUrls = new Set(remote.flatMap(item => item.url ? [item.url] : []));
      const result = await toToolResult({
        ...response,
        data: {
          result: replaceDownloadedUrls(response.data, remoteUrls),
          localArtifacts,
          instruction: inline.length ? "Images are attached for direct viewing; local paths are retained for later read/edit operations." : "Artifacts were saved locally; non-image artifacts are not attached inline.",
        },
      }, `figure:${params.action}`);
      return { ...result, content: [...result.content, ...inline], details: { ...result.details, localArtifacts } };
    },
  });
}
