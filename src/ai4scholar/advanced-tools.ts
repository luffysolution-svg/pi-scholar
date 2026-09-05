import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  encodeId,
  requestAi4Scholar,
  requestAi4ScholarSse,
  type Ai4ScholarResponse,
  type Query,
} from "./client.js";
import { resolveConfig } from "./config.js";
import { toToolResult } from "./rest-tools.js";

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""),
  ) as Partial<T>;
}

function objectValue(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
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
        path = "/datasets/v1/release/";
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
    name: "ai4scholar_auto_cite",
    label: "Ai4Scholar Auto Cite",
    description:
      "Automatically identify citation points in 100-10,000 characters of academic text and return annotated text plus formatted references. Uses Ai4Scholar's streaming Auto-Cite API and consumes credits per citation.",
    promptSnippet: "Automatically add verified scholarly citations to academic text through Ai4Scholar",
    promptGuidelines: [
      "Use ai4scholar_auto_cite when the user asks Ai4Scholar to annotate academic prose with references; explain that automatic mode charges by minCitations and manual mode by [CITE] marker count.",
    ],
    parameters: Type.Object({
      text: Type.String({ minLength: 100, maxLength: 10_000 }),
      mode: Type.Optional(StringEnum(["auto", "manual"] as const)),
      minCitations: Type.Optional(Type.Integer({ minimum: 1 })),
      maxReferences: Type.Optional(Type.Integer({ minimum: 1 })),
      preferredVenues: Type.Optional(Type.Array(Type.String())),
      field: Type.Optional(Type.String()),
      yearPreference: Type.Optional(Type.Integer({ minimum: 1000, maximum: 3000 })),
      excludePreprints: Type.Optional(Type.Boolean()),
      excludeConferences: Type.Optional(Type.Boolean()),
      citationStyle: Type.Optional(StringEnum([
        "ieee", "apa", "apa6", "nature", "vancouver", "mla", "chicago", "harvard",
        "acs", "ama", "acm", "turabian", "cse", "asce", "gbt7714",
      ] as const)),
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      const response = await requestAi4ScholarSse(await resolveConfig(ctx), {
        method: "POST",
        path: "/api/proxy/auto-cite",
        body: compactObject({
          ...params,
          mode: params.mode ?? "auto",
          minCitations: params.minCitations ?? 10,
          citationStyle: params.citationStyle ?? "ieee",
        }),
        signal,
        timeoutMs: 180_000,
        onEvent(event) {
          if (event.event !== "progress") return;
          const message = objectValue(event.data, "message");
          const percent = objectValue(event.data, "percent");
          onUpdate?.({
            content: [{ type: "text", text: `${typeof message === "string" ? message : "正在自动标注文献…"}${typeof percent === "number" ? ` (${percent}%)` : ""}` }],
            details: { event },
          });
        },
      });
      const result = [...response.data].reverse().find((event) => event.event === "result")?.data
        ?? [...response.data].reverse().find((event) => objectValue(event.data, "annotatedText") !== undefined)?.data
        ?? { events: response.data };
      return toToolResult({ ...response, data: result }, "auto-cite");
    },
  });

  pi.registerTool({
    name: "ai4scholar_figure",
    label: "Ai4Scholar Figure",
    description:
      "Generate, edit, style, compose, iterate, critique, or vectorize scientific figures with Ai4Scholar Nano. Supports flash, flash31, pro, and GPT Image 2 (model=gptimage). Calls consume credits.",
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
      const response = await requestAi4Scholar(await resolveConfig(ctx), {
        method: "POST",
        path: "/api/proxy/nano/generate",
        body: compactObject({
          action: params.action,
          prompt: params.prompt,
          model: params.model ?? "flash",
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
      return toToolResult(response, `figure:${params.action}`);
    },
  });
}
