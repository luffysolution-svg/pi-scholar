import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  encodeId,
  requestAi4Scholar,
  type Ai4ScholarResponse,
  type Query,
} from "./client.js";
import { resolveConfig } from "./config.js";

const DEFAULT_PAPER_FIELDS =
  "paperId,title,abstract,authors,year,venue,citationCount,externalIds,openAccessPdf";
const DEFAULT_AUTHOR_FIELDS =
  "authorId,name,affiliations,homepage,paperCount,citationCount,hIndex";

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""),
  ) as Partial<T>;
}

export async function toToolResult(response: Ai4ScholarResponse, label: string) {
  const envelope = {
    meta: compactObject({
      service: "Ai4Scholar",
      operation: label,
      requestUrl: response.url,
      httpStatus: response.status,
      creditsCharged: response.creditsCharged,
      creditsRemaining: response.creditsRemaining,
      requestId: response.requestId,
    }),
    data: response.data,
  };
  const full = JSON.stringify(envelope, null, 2);
  const truncation = truncateHead(full, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  let text = truncation.content;
  let fullOutputPath: string | undefined;
  if (truncation.truncated) {
    const directory = await mkdtemp(join(tmpdir(), "pi-scholar-ai4scholar-"));
    fullOutputPath = join(directory, "response.json");
    await writeFile(fullOutputPath, full, "utf8");
    text += `\n\n[响应已截断：显示 ${truncation.outputLines}/${truncation.totalLines} 行、${formatSize(truncation.outputBytes)}/${formatSize(truncation.totalBytes)}。完整 JSON：${fullOutputPath}]`;
  }

  return {
    content: [{ type: "text" as const, text }],
    details: {
      ...envelope.meta,
      data: truncation.truncated ? undefined : response.data,
      truncation,
      fullOutputPath,
    },
  };
}

export function registerRestTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "ai4scholar_search",
    label: "Ai4Scholar Search",
    description:
      "Search Semantic Scholar, PubMed, Google Scholar, or Google Patents through Ai4Scholar. Each successful search may consume credits. Output is truncated to 2000 lines or 50KB.",
    promptSnippet: "Search scholarly papers and patents through Ai4Scholar",
    promptGuidelines: [
      "Use ai4scholar_search for academic literature or patent searches when the user asks to query Ai4Scholar.",
      "Prefer ai4scholar_batch over repeated ai4scholar_paper calls when several known IDs must be fetched, because Ai4Scholar batch endpoints use fixed-price billing.",
    ],
    parameters: Type.Object({
      source: StringEnum(["semantic_scholar", "pubmed", "google_scholar", "google_patents"] as const, {
        description: "Data source",
      }),
      query: Type.String({ description: "Search query" }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Result count" })),
      offset: Type.Optional(Type.Integer({ minimum: 0, description: "Offset for Semantic Scholar or PubMed" })),
      page: Type.Optional(Type.Integer({ minimum: 1, description: "Page for Google Scholar or Patents" })),
      fields: Type.Optional(Type.String({ description: "Comma-separated Semantic Scholar return fields" })),
      semanticMode: Type.Optional(StringEnum(["relevance", "bulk", "match", "autocomplete"] as const, {
        description: "Semantic Scholar search mode; defaults to relevance",
      })),
      token: Type.Optional(Type.String({ description: "Semantic Scholar bulk-search pagination token" })),
      publicationTypes: Type.Optional(Type.String({ description: "Semantic Scholar publication types, comma-separated" })),
      publicationDateOrYear: Type.Optional(Type.String({ description: "Semantic Scholar date range, e.g. 2020-01-01:2024-12-31" })),
      minDate: Type.Optional(Type.String({ description: "PubMed earliest date, YYYY/MM/DD" })),
      maxDate: Type.Optional(Type.String({ description: "PubMed latest date, YYYY/MM/DD" })),
      cites: Type.Optional(Type.String({ description: "Google Scholar cited-by search ID" })),
      cluster: Type.Optional(Type.String({ description: "Google Scholar versions cluster ID" })),
      yearFrom: Type.Optional(Type.Integer({ minimum: 1000, maximum: 3000 })),
      yearTo: Type.Optional(Type.Integer({ minimum: 1000, maximum: 3000 })),
      sort: Type.Optional(Type.String({ description: "Semantic Scholar field:direction, PubMed relevance/date, or Patents new/old" })),
      reviewOnly: Type.Optional(Type.Boolean({ description: "Google Scholar: reviews only" })),
      sortByDate: Type.Optional(Type.Boolean({ description: "Google Scholar: sort by date" })),
      openAccessOnly: Type.Optional(Type.Boolean({ description: "Semantic Scholar: require open-access PDF" })),
      minCitationCount: Type.Optional(Type.Integer({ minimum: 0 })),
      venue: Type.Optional(Type.String()),
      fieldsOfStudy: Type.Optional(Type.String()),
      country: Type.Optional(Type.String({ description: "Patent country codes, comma-separated, e.g. US,CN,WO" })),
      language: Type.Optional(Type.String({ description: "Patent languages, comma-separated" })),
      status: Type.Optional(StringEnum(["GRANT", "APPLICATION"] as const)),
      patentType: Type.Optional(StringEnum(["PATENT", "DESIGN"] as const)),
      inventor: Type.Optional(Type.String()),
      assignee: Type.Optional(Type.String()),
      before: Type.Optional(Type.String({ description: "Patent cutoff, e.g. publication:20231231" })),
      after: Type.Optional(Type.String({ description: "Patent start, e.g. filing:20200101" })),
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: `正在搜索 ${params.source}…` }], details: {} });
      const config = await resolveConfig(ctx);
      let response: Ai4ScholarResponse;

      if (params.source === "semantic_scholar") {
        const year = params.yearFrom || params.yearTo
          ? `${params.yearFrom ?? ""}-${params.yearTo ?? ""}`
          : undefined;
        const mode = params.semanticMode ?? "relevance";
        const path = mode === "bulk"
          ? "/graph/v1/paper/search/bulk"
          : mode === "match"
            ? "/graph/v1/paper/search/match"
            : mode === "autocomplete"
              ? "/graph/v1/paper/autocomplete"
              : "/graph/v1/paper/search";
        const query = mode === "autocomplete"
          ? { query: params.query }
          : compactObject({
              query: params.query,
              fields: params.fields ?? DEFAULT_PAPER_FIELDS,
              limit: mode === "relevance" ? params.limit ?? 10 : undefined,
              offset: mode === "relevance" ? params.offset : undefined,
              token: mode === "bulk" ? params.token : undefined,
              sort: mode === "bulk" ? params.sort : undefined,
              publicationTypes: params.publicationTypes,
              publicationDateOrYear: params.publicationDateOrYear,
              year,
              openAccessPdf: params.openAccessOnly ? true : undefined,
              minCitationCount: params.minCitationCount,
              venue: params.venue,
              fieldsOfStudy: params.fieldsOfStudy,
            });
        response = await requestAi4Scholar(config, { path, query: query as Query, signal });
      } else if (params.source === "pubmed") {
        response = await requestAi4Scholar(config, {
          method: "POST",
          path: "/pubmed/v1/paper/search",
          body: compactObject({
            query: params.query,
            limit: params.limit ?? 10,
            offset: params.offset,
            sort: params.sort ?? "relevance",
            minDate: params.minDate ?? (params.yearFrom ? `${params.yearFrom}/01/01` : undefined),
            maxDate: params.maxDate ?? (params.yearTo ? `${params.yearTo}/12/31` : undefined),
          }),
          signal,
        });
      } else if (params.source === "google_scholar") {
        response = await requestAi4Scholar(config, {
          method: "POST",
          path: "/google-scholar/v1/search",
          body: compactObject({
            query: params.query,
            page: params.page ?? 1,
            yearFrom: params.yearFrom,
            yearTo: params.yearTo,
            reviewOnly: params.reviewOnly,
            sortByDate: params.sortByDate,
            cites: params.cites,
            cluster: params.cluster,
          }),
          signal,
        });
      } else {
        response = await requestAi4Scholar(config, {
          method: "POST",
          path: "/google-scholar/v1/patents",
          body: compactObject({
            query: params.query,
            page: params.page ?? 1,
            num: params.limit ?? 10,
            sort: params.sort,
            status: params.status,
            type: params.patentType,
            country: params.country,
            language: params.language,
            inventor: params.inventor,
            assignee: params.assignee,
            before: params.before,
            after: params.after,
          }),
          signal,
        });
      }

      return toToolResult(response, `search:${params.source}`);
    },
  });

  pi.registerTool({
    name: "ai4scholar_paper",
    label: "Ai4Scholar Paper",
    description:
      "Get paper detail, citations, references, related papers, authors, or single-paper recommendations from Semantic Scholar/PubMed through Ai4Scholar. Calls may consume credits.",
    promptSnippet: "Inspect an Ai4Scholar paper and its citation network",
    parameters: Type.Object({
      source: StringEnum(["semantic_scholar", "pubmed"] as const),
      action: StringEnum(["detail", "citations", "references", "related", "authors", "recommendations"] as const),
      id: Type.String({ description: "Semantic Scholar paper ID/DOI/arXiv/PMID, or PubMed PMID" }),
      fields: Type.Optional(Type.String({ description: "Comma-separated Semantic Scholar fields" })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      publicationDateOrYear: Type.Optional(Type.String({ description: "Semantic Scholar date range filter" })),
      recommendationPool: Type.Optional(StringEnum(["recent", "all-cs"] as const)),
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: `正在获取 ${params.source} ${params.action}…` }], details: {} });
      const config = await resolveConfig(ctx);
      const id = encodeId(params.id);
      let path: string;
      let query: Query | undefined;

      if (params.source === "semantic_scholar") {
        const supported = new Set(["detail", "citations", "references", "authors", "recommendations"]);
        if (!supported.has(params.action)) throw new Error("Semantic Scholar 不支持 related；请使用 recommendations。");
        if (params.action === "recommendations") {
          if ((params.limit ?? 20) > 500) throw new Error("Semantic Scholar recommendations 单次最多 500 条。");
          path = `/recommendations/v1/papers/forpaper/${id}`;
          query = compactObject({
            from: params.recommendationPool ?? "recent",
            limit: params.limit ?? 20,
            fields: params.fields ?? DEFAULT_PAPER_FIELDS,
          }) as Query;
        } else {
          const suffix = params.action === "detail" ? "" : `/${params.action}`;
          path = `/graph/v1/paper/${id}${suffix}`;
          query = compactObject({
            fields: params.fields ?? (params.action === "authors" ? DEFAULT_AUTHOR_FIELDS : DEFAULT_PAPER_FIELDS),
            limit: params.action === "detail" ? undefined : params.limit ?? 20,
            offset: params.offset,
            publicationDateOrYear: params.action === "citations" ? params.publicationDateOrYear : undefined,
          }) as Query;
        }
      } else {
        if (!new Set(["detail", "citations", "related"]).has(params.action)) {
          throw new Error("PubMed 仅支持 detail、citations、related。");
        }
        const suffix = params.action === "detail" ? "" : `/${params.action}`;
        path = `/pubmed/v1/paper/${id}${suffix}`;
        query = params.action === "detail" ? undefined : { limit: params.limit ?? 20 };
      }

      return toToolResult(await requestAi4Scholar(config, { path, query, signal }), `paper:${params.source}:${params.action}`);
    },
  });

  pi.registerTool({
    name: "ai4scholar_author",
    label: "Ai4Scholar Author",
    description:
      "Search authors or fetch author details/papers from Semantic Scholar and Google Scholar through Ai4Scholar. Calls may consume credits.",
    parameters: Type.Object({
      source: StringEnum(["semantic_scholar", "google_scholar"] as const),
      action: StringEnum(["search", "detail", "papers"] as const),
      query: Type.Optional(Type.String({ description: "Author name for search" })),
      authorId: Type.Optional(Type.String({ description: "Author ID for detail or papers" })),
      fields: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      sort: Type.Optional(StringEnum(["title", "pubdate"] as const)),
      afterAuthor: Type.Optional(Type.String({ description: "Google Scholar pagination token" })),
      publicationDateOrYear: Type.Optional(Type.String({ description: "Semantic Scholar author-paper date range" })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const config = await resolveConfig(ctx);
      let response: Ai4ScholarResponse;
      if (params.action === "search" && !params.query) throw new Error("search 操作需要 query。");
      if (params.action !== "search" && !params.authorId) throw new Error(`${params.action} 操作需要 authorId。`);

      if (params.source === "semantic_scholar") {
        const path = params.action === "search"
          ? "/graph/v1/author/search"
          : `/graph/v1/author/${encodeId(params.authorId!)}${params.action === "papers" ? "/papers" : ""}`;
        response = await requestAi4Scholar(config, {
          path,
          query: compactObject({
            query: params.query,
            fields: params.fields ?? (params.action === "papers" ? DEFAULT_PAPER_FIELDS : DEFAULT_AUTHOR_FIELDS),
            limit: params.action === "detail" ? undefined : params.limit ?? 20,
            offset: params.offset,
            publicationDateOrYear: params.action === "papers" ? params.publicationDateOrYear : undefined,
          }) as Query,
          signal,
        });
      } else {
        if (params.action === "papers") throw new Error("Google Scholar 作者论文包含在 detail 响应中，请使用 detail。");
        response = await requestAi4Scholar(config, {
          method: "POST",
          path: params.action === "search" ? "/google-scholar/v1/profiles" : "/google-scholar/v1/author",
          body: params.action === "search"
            ? compactObject({ authorName: params.query, afterAuthor: params.afterAuthor })
            : compactObject({ authorId: params.authorId, sort: params.sort }),
          signal,
        });
      }
      return toToolResult(response, `author:${params.source}:${params.action}`);
    },
  });

  pi.registerTool({
    name: "ai4scholar_batch",
    label: "Ai4Scholar Batch",
    description:
      "Fetch many Semantic Scholar papers/authors or PubMed papers in one fixed-price Ai4Scholar batch request. Prefer this over repeated detail calls.",
    parameters: Type.Object({
      source: StringEnum(["semantic_papers", "semantic_authors", "pubmed_papers"] as const),
      ids: Type.Array(Type.String(), { minItems: 1, maxItems: 1000 }),
      fields: Type.Optional(Type.String({ description: "Semantic Scholar fields" })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const maximum = params.source === "semantic_papers" ? 500 : params.source === "pubmed_papers" ? 100 : 1000;
      if (params.ids.length > maximum) throw new Error(`${params.source} 单次最多 ${maximum} 个 ID。`);
      const path = params.source === "semantic_papers"
        ? "/graph/v1/paper/batch"
        : params.source === "semantic_authors"
          ? "/graph/v1/author/batch"
          : "/pubmed/v1/paper/batch";
      const query = params.source === "pubmed_papers"
        ? undefined
        : { fields: params.fields ?? (params.source === "semantic_papers" ? DEFAULT_PAPER_FIELDS : DEFAULT_AUTHOR_FIELDS) };
      const response = await requestAi4Scholar(await resolveConfig(ctx), {
        method: "POST",
        path,
        query,
        body: { ids: params.ids },
        signal,
      });
      return toToolResult(response, `batch:${params.source}`);
    },
  });

  pi.registerTool({
    name: "ai4scholar_recommend",
    label: "Ai4Scholar Recommend",
    description: "Recommend Semantic Scholar papers from positive and optional negative seed-paper IDs. Calls may consume credits.",
    parameters: Type.Object({
      positivePaperIds: Type.Array(Type.String(), { minItems: 1 }),
      negativePaperIds: Type.Optional(Type.Array(Type.String())),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
      fields: Type.Optional(Type.String()),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const response = await requestAi4Scholar(await resolveConfig(ctx), {
        method: "POST",
        path: "/recommendations/v1/papers/",
        query: { limit: params.limit ?? 20, fields: params.fields ?? DEFAULT_PAPER_FIELDS },
        body: compactObject({
          positivePaperIds: params.positivePaperIds,
          negativePaperIds: params.negativePaperIds,
        }),
        signal,
      });
      return toToolResult(response, "recommend:seeds");
    },
  });

  pi.registerTool({
    name: "ai4scholar_cite",
    label: "Ai4Scholar Cite",
    description: "Get MLA, APA, Chicago, Harvard, Vancouver, BibTeX, and EndNote citation data for a Google Scholar result ID.",
    parameters: Type.Object({
      paperId: Type.String({ description: "Google Scholar search-result paper id" }),
      language: Type.Optional(Type.String({ description: "Citation language, default en" })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const response = await requestAi4Scholar(await resolveConfig(ctx), {
        method: "POST",
        path: "/google-scholar/v1/cite",
        body: { paperId: params.paperId, language: params.language ?? "en" },
        signal,
      });
      return toToolResult(response, "google-scholar:cite");
    },
  });

  pi.registerTool({
    name: "ai4scholar_snippets",
    label: "Ai4Scholar Snippets",
    description: "Search matching full-text snippets (about 500 words) in Semantic Scholar papers. Calls may consume credits.",
    parameters: Type.Object({
      query: Type.String(),
      fields: Type.Optional(Type.String({ description: "Comma-separated snippet return fields" })),
      paperIds: Type.Optional(Type.String({ description: "Comma-separated paper IDs" })),
      authors: Type.Optional(Type.String()),
      year: Type.Optional(Type.String({ description: "Year/range, e.g. 2020-2024" })),
      publicationDateOrYear: Type.Optional(Type.String({ description: "Exact publication date/year range" })),
      venue: Type.Optional(Type.String()),
      fieldsOfStudy: Type.Optional(Type.String()),
      minCitationCount: Type.Optional(Type.Integer({ minimum: 0 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const response = await requestAi4Scholar(await resolveConfig(ctx), {
        path: "/graph/v1/snippet/search",
        query: compactObject({ ...params, limit: params.limit ?? 10 }) as Query,
        signal,
      });
      return toToolResult(response, "semantic-scholar:snippets");
    },
  });

  pi.registerTool({
    name: "ai4scholar_credits",
    label: "Ai4Scholar Credits",
    description: "Check Ai4Scholar credit balance. This endpoint is documented as free.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal, _onUpdate, ctx) {
      return toToolResult(
        await requestAi4Scholar(await resolveConfig(ctx), { path: "/api/credits", signal }),
        "credits",
      );
    },
  });
}
