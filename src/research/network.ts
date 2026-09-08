import { ResearchError, mapHttpError, redactSecrets } from "./errors.js";
import { readResponseBytes } from "../io.js";

export const OFFICIAL_HOSTS = {
  "semantic-scholar": ["api.semanticscholar.org"],
  crossref: ["api.crossref.org"],
  pubmed: ["eutils.ncbi.nlm.nih.gov", "www.ncbi.nlm.nih.gov"],
  arxiv: ["export.arxiv.org", "arxiv.org"],
  openalex: ["api.openalex.org"],
  unpaywall: ["api.unpaywall.org"],
  easyscholar: ["www.easyscholar.cc"],
  "cas-common-chemistry": ["commonchemistry.cas.org"],
} as const;

export interface RequestOptions {
  provider: string;
  url: string | URL;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  /** Tests and embedders may provide a fetch implementation; production defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

function officialUrl(provider: string, raw: string | URL): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ResearchError("SOURCE_UNAVAILABLE", "Provider URL is invalid", provider); }
  const hosts = (OFFICIAL_HOSTS as Record<string, readonly string[]>)[provider];
  if (!hosts?.includes(url.hostname) || url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password) throw new ResearchError("SOURCE_UNAVAILABLE", "Provider URL is not an approved HTTPS official endpoint", provider);
  return url;
}

function retryAfter(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(30_000, Math.max(0, seconds * 1000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(30_000, Math.max(0, date - Date.now())) : undefined;
}

function timeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function requestJson<T = unknown>(options: RequestOptions): Promise<{ data: T; response: Response; url: string }> {
  const url = officialUrl(options.provider, options.url);
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
  let body: string | undefined;
  if (options.body !== undefined) { headers["content-type"] ??= "application/json"; body = JSON.stringify(options.body); }
  const attempts = method === "GET" ? Math.max(0, Math.min(options.retries ?? 2, 3)) : 0;
  const fetcher = options.fetchImpl ?? fetch;
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  for (let attempt = 0; ; attempt++) {
    const remaining = Math.max(1, deadline - Date.now());
    let response: Response;
    const operationSignal = timeoutSignal(options.signal, remaining);
    try {
      response = await fetcher(url, { method, headers, body, signal: operationSignal, redirect: "manual" });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (attempt < attempts && Date.now() < deadline) { await delay(Math.min(1000 * 2 ** attempt, 5000), options.signal); continue; }
      throw new ResearchError("SOURCE_UNAVAILABLE", `${options.provider} request failed`, options.provider, undefined, redactSecrets(String(error)));
    }
    if (response.status >= 300 && response.status < 400) throw new ResearchError("SOURCE_UNAVAILABLE", `${options.provider} redirected; credentials were not forwarded`, options.provider, response.status);
    const raw = new TextDecoder().decode(await readResponseBytes(response, 16 * 1024 * 1024, operationSignal));
    let parsed: unknown = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw.slice(0, 20_000); }
    if (response.ok) return { data: redactSecrets(parsed) as T, response, url: redactSecrets(url.toString()) };
    if ((response.status === 429 || response.status >= 500) && attempt < attempts && Date.now() < deadline) {
      await delay(Math.min(retryAfter(response) ?? Math.min(250 * 2 ** attempt, 5000), Math.max(1, deadline - Date.now())), options.signal);
      continue;
    }
    throw mapHttpError(response.status, options.provider, parsed);
  }
}

export async function requestText(options: RequestOptions): Promise<{ text: string; response: Response; url: string }> {
  const url = officialUrl(options.provider, options.url);
  const headers: Record<string, string> = { Accept: "application/xml,text/plain,*/*", ...options.headers };
  const method = options.method ?? "GET";
  const attempts = method === "GET" ? Math.max(0, Math.min(options.retries ?? 2, 3)) : 0;
  const fetcher = options.fetchImpl ?? fetch;
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  for (let attempt = 0; ; attempt++) {
    const remaining = Math.max(1, deadline - Date.now());
    const operationSignal = timeoutSignal(options.signal, remaining);
    let response: Response;
    try {
      response = await fetcher(url, { method, headers, signal: operationSignal, redirect: "manual" });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (attempt < attempts && Date.now() < deadline) { await delay(Math.min(1000 * 2 ** attempt, 5000), options.signal); continue; }
      throw new ResearchError("SOURCE_UNAVAILABLE", `${options.provider} request failed`, options.provider, undefined, redactSecrets(String(error)));
    }
    if (response.status >= 300 && response.status < 400) throw new ResearchError("SOURCE_UNAVAILABLE", `${options.provider} redirected; credentials were not forwarded`, options.provider, response.status);
    const text = new TextDecoder().decode(await readResponseBytes(response, 16 * 1024 * 1024, operationSignal));
    if (response.ok) return { text: redactSecrets(text), response, url: redactSecrets(url.toString()) };
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* XML/plain error */ }
    if ((response.status === 429 || response.status >= 500) && attempt < attempts && Date.now() < deadline) {
      await delay(Math.min(retryAfter(response) ?? Math.min(250 * 2 ** attempt, 5000), Math.max(1, deadline - Date.now())), options.signal);
      continue;
    }
    throw mapHttpError(response.status, options.provider, body);
  }
}

/** Fetch bounded binary content without decoding it as UTF-8 (for example a PDF). */
export async function requestBytes(options: RequestOptions): Promise<{ bytes: Uint8Array; response: Response; url: string }> {
  const url = officialUrl(options.provider, options.url);
  const headers: Record<string, string> = { Accept: "application/octet-stream,*/*", ...options.headers };
  const method = options.method ?? "GET";
  const attempts = method === "GET" ? Math.max(0, Math.min(options.retries ?? 2, 3)) : 0;
  const fetcher = options.fetchImpl ?? fetch;
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  for (let attempt = 0; ; attempt++) {
    const remaining = Math.max(1, deadline - Date.now());
    const operationSignal = timeoutSignal(options.signal, remaining);
    let response: Response;
    try { response = await fetcher(url, { method, headers, signal: operationSignal, redirect: "manual" }); }
    catch (error) {
      if (options.signal?.aborted) throw error;
      if (attempt < attempts && Date.now() < deadline) { await delay(Math.min(1000 * 2 ** attempt, 5000), options.signal); continue; }
      throw new ResearchError("SOURCE_UNAVAILABLE", `${options.provider} request failed`, options.provider, undefined, redactSecrets(String(error)));
    }
    if (response.status >= 300 && response.status < 400) throw new ResearchError("SOURCE_UNAVAILABLE", `${options.provider} redirected; credentials were not forwarded`, options.provider, response.status);
    const bytes = await readResponseBytes(response, 16 * 1024 * 1024, operationSignal);
    if (response.ok) return { bytes, response, url: redactSecrets(url.toString()) };
    const body = new TextDecoder().decode(bytes).slice(0, 20_000);
    if ((response.status === 429 || response.status >= 500) && attempt < attempts && Date.now() < deadline) { await delay(Math.min(retryAfter(response) ?? Math.min(250 * 2 ** attempt, 5000), Math.max(1, deadline - Date.now())), options.signal); continue; }
    throw mapHttpError(response.status, options.provider, redactSecrets(body));
  }
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) { signal.throwIfAborted(); }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(signal?.reason ?? new Error("aborted")); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function appendQuery(base: string, query: Record<string, unknown>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  return url.toString();
}
