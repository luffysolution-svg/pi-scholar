import { createHash, randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { readFileBounded, readResponseBytes } from "./io.js";
export { readResponseBytes } from "./io.js";
import type { MinerUInfo } from "./model.js";

const API_BASE = "https://mineru.net";
const MAX_PDF_BYTES = 200 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_HTTP_ATTEMPTS = 4;

export interface MinerUOptions {
  token: string;
  /** Overall polling window. Individual HTTP attempts are capped at 60 seconds. */
  timeoutMs?: number;
  initialPollMs?: number;
  maxPollMs?: number;
  maxAttempts?: number;
  language?: string;
  enableFormula?: boolean;
  enableTable?: boolean;
  isOcr?: boolean;
  modelVersion?: string;
}

export interface MinerURun {
  archive: Uint8Array;
  info: MinerUInfo;
  pdfSha256: string;
}

export type Progress = (stage: string) => void;
type Sleeper = (ms: number, signal?: AbortSignal) => Promise<void>;

const delay: Sleeper = (ms, signal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) {
    reject(signal.reason ?? new Error("MinerU operation cancelled"));
    return;
  }
  const onAbort = () => {
    clearTimeout(timer);
    reject(signal?.reason ?? new Error("MinerU operation cancelled"));
  };
  const timer = setTimeout(() => {
    signal?.removeEventListener("abort", onAbort);
    resolve();
  }, ms);
  signal?.addEventListener("abort", onAbort, { once: true });
});

const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

function secretSafe(error: unknown, secrets: string[] = []): string {
  let message = error instanceof Error ? error.message : String(error);
  message = message
    .replace(/https?:\/\/\S+/g, "[redacted URL]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  for (const secret of secrets) {
    if (secret) message = message.replaceAll(secret, "[redacted]");
  }
  return message;
}

function secureRemoteUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} was malformed`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(`${label} must be an HTTPS URL without user info`);
  }
  return url.toString();
}

export class MinerUClient {
  constructor(
    private readonly options: MinerUOptions,
    private readonly fetcher: typeof fetch = fetch,
    private readonly sleeper: Sleeper = delay,
  ) {
    if (!options.token) throw new Error("MinerU credentials missing: set MINERU_API_TOKEN");
  }

  private remaining(deadline?: number): number | undefined {
    return deadline === undefined ? undefined : Math.max(0, deadline - Date.now());
  }

  private async wait(requestedMs: number, signal?: AbortSignal, deadline?: number): Promise<boolean> {
    const remaining = this.remaining(deadline);
    if (remaining !== undefined && remaining <= 0) return false;
    const maxDelay = Math.max(1, this.options.maxPollMs ?? 15_000);
    const bounded = Math.min(Math.max(0, requestedMs), maxDelay, remaining ?? Number.POSITIVE_INFINITY);
    if (bounded <= 0) return false;
    await this.sleeper(bounded, signal);
    return true;
  }

  private async control(
    pathname: string,
    init: RequestInit,
    signal?: AbortSignal,
    deadline?: number,
  ): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < MAX_HTTP_ATTEMPTS; attempt += 1) {
      const response = await this.retry(
        `${API_BASE}${pathname}`,
        {
          ...init,
          headers: {
            Authorization: `Bearer ${this.options.token}`,
            ...(init.body ? { "Content-Type": "application/json" } : {}),
            ...init.headers,
          },
        },
        signal,
        "MinerU API",
        deadline,
      );
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(Buffer.from(await readResponseBytes(response, 2 * 1024 * 1024, signal)).toString("utf8")) as Record<string, unknown>;
        if (!json || typeof json !== "object" || Array.isArray(json) || !["number", "string"].includes(typeof json.code)) throw new Error("Malformed response");
      } catch {
        throw new Error(init.method === "POST" ? "AMBIGUOUS_SUBMISSION: MinerU task response was unreadable; do not resubmit automatically" : "MinerU API returned malformed JSON");
      }
      if (json.code === 0) return json;
      if (json.code !== -10001 || attempt === MAX_HTTP_ATTEMPTS - 1) {
        throw new Error(
          `MinerU API rejected request (code ${String(json.code)}): ${secretSafe(json.msg ?? "unknown error", [this.options.token])}`,
        );
      }
      const waited = await this.wait(1000 * 2 ** attempt, signal, deadline);
      if (!waited) break;
    }
    throw new Error("MinerU API timed out during bounded retries");
  }

  private async retry(
    url: string,
    init: RequestInit,
    signal: AbortSignal | undefined,
    stage: string,
    deadline?: number,
  ): Promise<Response> {
    let last: unknown;
    const safeToRetry = !init.method || init.method === "GET" || init.method === "HEAD";
    for (let attempt = 0; attempt < MAX_HTTP_ATTEMPTS; attempt += 1) {
      const remaining = this.remaining(deadline);
      if (remaining !== undefined && remaining <= 0) break;
      const requestTimeoutMs = Math.min(
        Math.max(this.options.timeoutMs ?? 600_000, 1_000),
        60_000,
        remaining ?? Number.POSITIVE_INFINITY,
      );
      try {
        const timeout = AbortSignal.timeout(Math.max(1, requestTimeoutMs));
        const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
        const response = await this.fetcher(url, { ...init, redirect: "error", signal: requestSignal });
        if (response.ok) return response;
        await response.body?.cancel().catch(() => undefined);
        if (response.status < 500 && (response.status !== 429 || !safeToRetry)) {
          throw new Error(`${stage} rejected (${response.status})`);
        }
        if (!safeToRetry) throw new Error(`AMBIGUOUS_SUBMISSION: ${stage} returned ${response.status}; do not resubmit automatically`);
        last = new Error(`${stage} transient failure (${response.status})`);
        if (attempt < MAX_HTTP_ATTEMPTS - 1) {
          const retryAfterSeconds = Number(response.headers.get("retry-after"));
          const requestedDelay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? retryAfterSeconds * 1000
            : 1000 * 2 ** attempt;
          if (!await this.wait(requestedDelay, signal, deadline)) break;
        }
      } catch (error) {
        if (error instanceof Error && /rejected \(4\d\d\)/.test(error.message)) throw error;
        if (!safeToRetry) throw new Error(`AMBIGUOUS_SUBMISSION: ${stage} may have succeeded; do not resubmit automatically`);
        if (signal?.aborted) throw signal.reason ?? new Error("MinerU operation cancelled");
        last = error;
        if (attempt < MAX_HTTP_ATTEMPTS - 1 && !await this.wait(1000 * 2 ** attempt, signal, deadline)) break;
      }
    }
    if (deadline !== undefined && Date.now() >= deadline) throw new Error(`${stage} timed out`);
    throw new Error(`${stage} failed after retries: ${secretSafe(last, [this.options.token])}`);
  }

  async extract(pdfPath: string, signal?: AbortSignal, progress?: Progress): Promise<MinerURun> {
    const deadline = Date.now() + (this.options.timeoutMs ?? 600_000);
    const totalTimeout = AbortSignal.timeout(Math.max(1, this.options.timeoutMs ?? 600_000));
    signal = signal ? AbortSignal.any([signal, totalTimeout]) : totalTimeout;
    const info = await stat(pdfPath);
    if (!info.isFile()) throw new Error("Selected Zotero PDF is not a file");
    if (info.size > MAX_PDF_BYTES) throw new Error("Selected PDF exceeds MinerU's 200 MB limit");

    signal?.throwIfAborted();
    const bytes = await readFileBounded(pdfPath, MAX_PDF_BYTES, signal);
    if (bytes.subarray(0, 5).toString() !== "%PDF-") {
      throw new Error("Selected Zotero attachment is not a readable PDF");
    }
    const hash = createHash("sha256").update(bytes).digest("hex");
    const name = pdfPath.replace(/\\/g, "/").split("/").pop() ?? "paper.pdf";
    const dataId = randomUUID();
    const requestBody = {
      files: [{ name, data_id: dataId, is_ocr: this.options.isOcr ?? false }],
      model_version: this.options.modelVersion ?? "vlm",
      enable_formula: this.options.enableFormula ?? true,
      enable_table: this.options.enableTable ?? true,
      language: this.options.language ?? "en",
    };

    progress?.("requesting signed upload");
    const creation = await this.control(
      "/api/v4/file-urls/batch",
      { method: "POST", body: JSON.stringify(requestBody) },
      signal,
      deadline,
    );
    const data = creation.data as Record<string, unknown> | undefined;
    const batchId = String(data?.batch_id ?? "");
    const signed = (data?.file_urls as unknown[] | undefined)?.[0];
    if (!batchId || typeof signed !== "string") throw new Error("AMBIGUOUS_SUBMISSION: MinerU signed-upload response was malformed");

    progress?.("uploading PDF");
    await this.retry(
      secureRemoteUrl(signed, "MinerU signed-upload URL"),
      { method: "PUT", body: bytes as unknown as BodyInit },
      signal,
      "MinerU signed upload",
      deadline,
    );

    progress?.("waiting for extraction");
    const maxAttempts = this.options.maxAttempts ?? 120;
    let interval = this.options.initialPollMs ?? 3000;
    let completed: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < maxAttempts && Date.now() < deadline; attempt += 1) {
      const polled = await this.control(
        `/api/v4/extract-results/batch/${encodeURIComponent(batchId)}`,
        { method: "GET" },
        signal,
        deadline,
      );
      const rows = ((polled.data as Record<string, unknown> | undefined)?.extract_result as unknown[] | undefined) ?? [];
      const row = (rows.find((value) => String((value as Record<string, unknown>).data_id ?? "") === dataId)
        ?? rows[0]) as Record<string, unknown> | undefined;
      if (!row) throw new Error("MinerU poll response did not contain the submitted file");
      const state = String(row.state);
      if (state === "failed") {
        throw new Error(`MinerU parse failed: ${secretSafe(row.err_msg ?? "unknown service error", [this.options.token])}`);
      }
      if (state === "done") {
        completed = row;
        break;
      }
      if (attempt + 1 >= maxAttempts) break;
      if (!await this.wait(interval, signal, deadline)) break;
      interval = Math.min(Math.ceil(interval * 1.5), this.options.maxPollMs ?? 15_000);
    }

    if (!completed) throw new Error("MinerU polling timed out before extraction completed");
    const archiveUrl = completed.full_zip_url;
    if (typeof archiveUrl !== "string") throw new Error("MinerU completed without a result archive");

    progress?.("downloading result");
    const archiveResponse = await this.retry(
      secureRemoteUrl(archiveUrl, "MinerU result archive URL"),
      { method: "GET" },
      signal,
      "MinerU result download",
      deadline,
    );
    const archive = await readResponseBytes(archiveResponse, MAX_ARCHIVE_BYTES, signal);

    return {
      archive,
      pdfSha256: hash,
      info: {
        batchId,
        state: "done",
        fileName: String(completed.file_name ?? name),
        dataId: stringOrNull(completed.data_id),
        modelVersion: stringOrNull(completed.model_version ?? requestBody.model_version),
        parserVersion: stringOrNull(completed.version),
        options: {
          language: requestBody.language,
          enableFormula: requestBody.enable_formula,
          enableTable: requestBody.enable_table,
          isOcr: requestBody.files[0].is_ocr,
        },
      },
    };
  }
}
