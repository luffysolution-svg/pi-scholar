export interface Creator { creatorType: string; firstName: string | null; lastName: string | null; name: string | null }
export interface CollectionRef { key: string; name: string | null }
export interface PaperNote { key: string; version: number; parentItem: string; note: string }
export interface PaperAnnotation {
  key: string; version: number; parentAttachment: string; text: string | null; comment: string | null;
  color: string | null; pageLabel: string | null; sortIndex: string | null; position: unknown | null; tags: string[];
}
export type IndexedText = { status: "available"; content: string; indexedPages?: number; totalPages?: number } | { status: "unavailable" };
export interface PaperAttachment {
  key: string; version: number; parentItem: string; title: string; filename: string | null; contentType: string | null;
  linkMode: string | null; path: string | null; md5: string | null; mtime: number | null; selected: boolean;
  localPath: string | null; indexedText: IndexedText; annotations: PaperAnnotation[];
}
export interface BibliographicEnrichment {
  zoteroKey: string; zoteroVersion: number; match: "normalized-title-first-author"; filledFields: string[];
  /** Complete donor-item data retained in the metadata sidecar for provenance. */
  metadata: Record<string, unknown>;
}
export interface Paper {
  zoteroKey: string; zoteroVersion: number; itemType: string; title: string; creators: Creator[];
  /** Complete selected parent-item data, retained in the metadata sidecar. */
  metadata: Record<string, unknown>;
  /** Optional exact local duplicate used only to fill missing bibliographic fields. */
  bibliographicEnrichment?: BibliographicEnrichment;
  date: string | null; year: string | null; doi: string | null; isbn: string | null; issn: string | null;
  publicationTitle: string | null; volume: string | null; issue: string | null; pages: string | null;
  url: string | null; abstract: string | null; tags: string[]; collections: CollectionRef[];
  notes: PaperNote[]; annotations: PaperAnnotation[]; attachments: PaperAttachment[]; selectedPdf: PaperAttachment | null;
}
export interface MinerUInfo { batchId: string; state: "done"; fileName: string; dataId: string | null; modelVersion: string | null; parserVersion: string | null; options: Record<string, unknown> }
export interface PublishedPaper {
  markdownPath: string; metadataPath: string; assetsDirectory: string; pdfSha256: string; mineru: MinerUInfo; parsedAt: string;
  /** Stable local publication identity and manifest namespace. */
  publicationId?: string; namespace?: string;
  /** True when the old backup could not be removed after commit. */
  cleanupPending?: boolean;
}

export function zoteroPublicationId(namespace: string, paper: Pick<Paper, "zoteroKey"|"selectedPdf">): string {
  return `zotero:${namespace}:${paper.zoteroKey}:${paper.selectedPdf?.key ?? "no-attachment"}`;
}

export function scholarlyIdentity(paper: Pick<Paper, "doi" | "title" | "year">): string {
  if (paper.doi) return `doi:${paper.doi.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "")}`;
  return `title-year:${paper.title.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()}:${paper.year ?? ""}`;
}
