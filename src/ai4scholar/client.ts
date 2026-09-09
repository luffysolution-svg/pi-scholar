import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { loadConfig as loadScholarConfig } from "../config.js";
import { resolveApiKey } from "../credentials.js";

export type QueryValue = string | number | boolean | null | undefined | readonly (string | number | boolean)[];
export type Query = Record<string, QueryValue>;

export interface Ai4ScholarConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  crawlerTimeoutMs?: number;
  proxyUrl?: string;
}

export interface Ai4ScholarResponse<T = unknown> {
  data: T;
  status: number;
  url: string;
  creditsCharged?: number;
  creditsRemaining?: number;
  requestId?: string;
}

export interface Ai4ScholarSseEvent {
  event?: string;
  data: unknown;
}

export class Ai4ScholarError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly url?: string,
    public readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = "Ai4ScholarError";
  }
}

export function getConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PI_SCHOLAR_CONFIG?.trim()) return resolve(process.cwd(), env.PI_SCHOLAR_CONFIG);
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  const native = join(env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent"), "pi-scholar.json");
  if (existsSync(native)) return native;
  return join(home, ".config", "pi-scholar", "config.json");
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: { configPath?: string | null; cwd?: string; projectTrusted?: boolean } = {},
): Ai4ScholarConfig {
  const useUnified = options.configPath !== null;
  const storedUnifiedPath = getConfigPath(env);
  const effectiveEnv = options.configPath !== undefined
    ? { ...env, PI_SCHOLAR_CONFIG: options.configPath ?? undefined }
    : env !== process.env && !env.PI_SCHOLAR_CONFIG && existsSync(storedUnifiedPath)
      ? { ...env, PI_SCHOLAR_CONFIG: storedUnifiedPath }
      : env;
  const unified = useUnified ? loadScholarConfig(effectiveEnv, options.cwd ?? process.cwd(), options.projectTrusted === true).ai4scholar : undefined;
  const apiKey = resolveApiKey(unified, env, ["AI4SCHOLAR_API_KEY"]) ?? "";
  const baseUrl = (env.AI4SCHOLAR_BASE_URL?.trim() || unified?.baseUrl?.trim() || "https://ai4scholar.net").replace(/\/+$/, "");
  const parsedTimeout = Number(env.AI4SCHOLAR_TIMEOUT_MS || unified?.timeoutMs || 30_000);
  const timeoutMs = parsedTimeout;
  const proxyUrl = env.AI4SCHOLAR_PROXY?.trim() || unified?.proxyUrl?.trim() || env.HTTPS_PROXY?.trim() || env.HTTP_PROXY?.trim() || undefined;

  const crawlerTimeoutMs = Number(env.AI4SCHOLAR_CRAWLER_TIMEOUT_MS || unified?.crawlerTimeoutMs || env.AI4SCHOLAR_TIMEOUT_MS || unified?.timeoutMs || 60_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000 || !Number.isInteger(crawlerTimeoutMs) || crawlerTimeoutMs < 1 || crawlerTimeoutMs > 3_600_000) {
    throw new Ai4ScholarError("Ai4Scholar timeout must be an integer between 1 and 3600000 ms");
  }
  return { apiKey, baseUrl, timeoutMs, crawlerTimeoutMs, proxyUrl };
}

export async function saveStoredApiKey(apiKey: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const normalized = apiKey.trim();
  if (!/^sk-[A-Za-z0-9_-]{8,}$/.test(normalized)) {
    throw new Ai4ScholarError("API Key 格式不正确，应为 sk- 开头的 Ai4Scholar 密钥。");
  }
  const path = getConfigPath(env);
  let root: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      loadScholarConfig({ ...env, PI_SCHOLAR_CONFIG: path }, process.cwd(), false);
      const parsed = JSON.parse(await readFile(path, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("root must be an object");
      root = parsed as Record<string, unknown>;
    } catch (error) {
      throw new Ai4ScholarError(`无法更新统一配置：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const current = root.ai4scholar && typeof root.ai4scholar === "object" && !Array.isArray(root.ai4scholar)
    ? root.ai4scholar as Record<string, unknown>
    : {};
  const next = { ...root, schemaVersion: 3, ai4scholar: { ...current, apiKey: normalized } };
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try { await rename(temporary, path); }
  catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
  await chmod(path, 0o600).catch(() => undefined);
  return path;
}

export async function clearStoredApiKey(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const path = getConfigPath(env);
  try {
    const root = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    const current = root.ai4scholar && typeof root.ai4scholar === "object" && !Array.isArray(root.ai4scholar)
      ? root.ai4scholar as Record<string, unknown>
      : undefined;
    if (!current || !Object.hasOwn(current, "apiKey")) return false;
    const { apiKey: _removed, ...remaining } = current;
    const next = { ...root, ai4scholar: remaining };
    const temporary = `${path}.${process.pid}-${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    try { await rename(temporary, path); }
    catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export function requireApiKey(config: Ai4ScholarConfig): string {
  if (!config.apiKey) {
    throw new Ai4ScholarError(
      "缺少 Ai4Scholar API Key。请在统一配置的 ai4scholar.apiKey 中填写，或设置 AI4SCHOLAR_API_KEY 后重启 Pi。密钥可在 https://ai4scholar.net/open-platform 创建。",
    );
  }
  return config.apiKey;
}

export function buildUrl(baseUrl: string, path: string, query?: Query): URL {
  if (!path.startsWith("/")) {
    throw new Ai4ScholarError(`API 路径必须以 / 开头：${path}`);
  }

  const base = new URL(baseUrl);
  const url = new URL(path, `${baseUrl.replace(/\/+$/, "")}/`);
  if (base.protocol !== "https:" || base.username || base.password || url.origin !== base.origin) {
    throw new Ai4ScholarError("Ai4Scholar requires an HTTPS URL and a same-origin API path");
  }
  for (const [key, rawValue] of Object.entries(query ?? {})) {
    if (rawValue === undefined || rawValue === null || rawValue === "") continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) url.searchParams.append(key, String(value));
  }
  return url;
}

function parseNumericHeader(headers: { get(name: string): string | null }, name: string): number | undefined {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

let detectedSystemProxy: string | null | undefined;
const proxyAgents = new Map<string, ProxyAgent>();

function normalizeProxyUrl(raw: string): string | undefined {
  let value = raw.trim();
  if (!value) return undefined;
  if (value.includes(";")) {
    const entries = Object.fromEntries(value.split(";").map((part) => part.split("=", 2)));
    value = entries.https || entries.http || value;
  }
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  try {
    new URL(value);
    return value;
  } catch {
    return undefined;
  }
}

export function parseWindowsProxySettings(output: string): string | undefined {
  const enabled = output.match(/ProxyEnable\s+REG_DWORD\s+(0x[0-9a-f]+|\d+)/i);
  if (!enabled || Number(enabled[1]) === 0) return undefined;
  const server = output.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i);
  return server ? normalizeProxyUrl(server[1]) : undefined;
}

export function detectWindowsProxy(): string | undefined {
  if (process.platform !== "win32") return undefined;
  if (detectedSystemProxy !== undefined) return detectedSystemProxy || undefined;
  try {
    const output = execFileSync(
      "reg.exe",
      ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"],
      { encoding: "utf8", windowsHide: true, timeout: 2000 },
    );
    detectedSystemProxy = parseWindowsProxySettings(output) ?? null;
  } catch {
    detectedSystemProxy = null;
  }
  return detectedSystemProxy || undefined;
}

export function resolveProxyUrl(config: Ai4ScholarConfig): string | undefined {
  if (config.proxyUrl?.toLowerCase() === "direct") return undefined;
  return config.proxyUrl ? normalizeProxyUrl(config.proxyUrl) : detectWindowsProxy();
}

export function getProxyAgent(proxyUrl: string): ProxyAgent {
  let agent = proxyAgents.get(proxyUrl);
  if (!agent) {
    agent = new ProxyAgent(proxyUrl);
    proxyAgents.set(proxyUrl, agent);
  }
  return agent;
}

interface RequestOptions {
  method?: "GET" | "POST";
  path: string;
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
  accept?: string;
  timeoutMs?: number;
  onProgress?: (message: string) => void;
}

async function fetchAi4ScholarResponse(
  config: Ai4ScholarConfig,
  options: RequestOptions,
): Promise<{ response: Response; url: URL }> {
  const apiKey = requireApiKey(config);
  const url = buildUrl(config.baseUrl, options.path, options.query);
  const method = options.method ?? (options.body === undefined ? "GET" : "POST");
  const headers: Record<string, string> = {
    Accept: options.accept ?? "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  let body: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const proxyUrl = resolveProxyUrl(config);
  try {
    const timeoutMs = options.timeoutMs ?? (options.path.startsWith("/google-scholar/") ? config.crawlerTimeoutMs ?? config.timeoutMs : config.timeoutMs);
    const response = proxyUrl
      ? await undiciFetch(url, {
          method,
          headers,
          body,
          signal: combineSignals(options.signal, timeoutMs),
          dispatcher: getProxyAgent(proxyUrl),
          redirect: "error",
        })
      : await fetch(url, {
          redirect: "error",
          method,
          headers,
          body,
          signal: combineSignals(options.signal, timeoutMs),
        });
    return { response: response as Response, url };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cause = error && typeof error === "object" ? (error as { cause?: unknown }).cause : undefined;
    const causeMessage = cause instanceof Error ? cause.message : cause ? String(cause) : "";
    const detail = causeMessage && causeMessage !== message ? `${message}（${causeMessage}）` : message;
    options.signal?.throwIfAborted();
    const proxyHint = proxyUrl ? "（已启用代理）" : "";
    throw new Ai4ScholarError(`Ai4Scholar 请求失败${proxyHint}：${detail}`, undefined, url.toString());
  }
}

function responseMeta<T>(response: Response, url: URL, data: T): Ai4ScholarResponse<T> {
  return {
    data,
    status: response.status,
    url: url.toString(),
    creditsCharged: parseNumericHeader(response.headers, "x-credits-charged"),
    creditsRemaining: parseNumericHeader(response.headers, "x-credits-remaining"),
    requestId: response.headers.get("x-request-id") ?? undefined,
  };
}

async function throwResponseError(response: Response, url: URL): Promise<never> {
  const parsed = parseBody(await response.text());
  const detail = typeof parsed === "string" ? parsed.slice(0, 1000) : JSON.stringify(parsed).slice(0, 1000);
  throw new Ai4ScholarError(
    `Ai4Scholar API 返回 HTTP ${response.status}${detail ? `：${detail}` : ""}`,
    response.status,
    url.toString(),
    parsed,
  );
}

export async function requestAi4Scholar<T = unknown>(
  config: Ai4ScholarConfig,
  options: RequestOptions,
): Promise<Ai4ScholarResponse<T>> {
  const crawler = options.path.startsWith("/google-scholar/");
  const budget = options.timeoutMs ?? (crawler ? config.crawlerTimeoutMs ?? config.timeoutMs : config.timeoutMs);
  const deadline = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  const timer = setTimeout(() => deadline.abort(new DOMException("Ai4Scholar request timed out", "TimeoutError")), budget);
  const start = Date.now();
  const progress = options.onProgress ? setInterval(() => options.onProgress?.(`Ai4Scholar ${crawler ? "爬虫代理" : "结构化 API"}：已等待 ${Math.floor((Date.now() - start) / 1000)} 秒，预算 ${budget / 1000} 秒，可取消。`), 3000) : undefined;
  let abortHandler: (() => void) | undefined;
  try {
    signal.throwIfAborted();
    const aborted = new Promise<never>((_, reject) => {
      abortHandler = () => reject(signal.reason);
      signal.addEventListener("abort", abortHandler, { once: true });
    });
    const operation = (async () => {
      const { response, url } = await fetchAi4ScholarResponse(config, { ...options, signal, timeoutMs: budget });
      if (!response.ok) return throwResponseError(response, url);
      return responseMeta(response, url, parseBody(await response.text()) as T);
    })();
    return await Promise.race([operation, aborted]);
  } catch (error) {
    options.signal?.throwIfAborted();
    if (deadline.signal.aborted) throw new Ai4ScholarError(`Ai4Scholar 请求超过 ${budget} ms。${crawler ? "爬虫源暂不可用；普通论文检索可改用 semantic_scholar 或 pubmed（来源与筛选语义不同），或显式提高 crawlerTimeoutMs。未自动重试或切换来源，避免重复计费。" : "请稍后重试或缩小查询范围。"}`);
    throw error;
  } finally {
    clearTimeout(timer);
    if (progress) clearInterval(progress);
    if (abortHandler) signal.removeEventListener("abort", abortHandler);
  }
}

function parseSseBlock(block: string): Ai4ScholarSseEvent | undefined {
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return undefined;
  const raw = dataLines.join("\n");
  if (raw === "[DONE]") return undefined;
  return { event, data: parseBody(raw) };
}

export async function requestAi4ScholarSse(
  config: Ai4ScholarConfig,
  options: RequestOptions & { onEvent?: (event: Ai4ScholarSseEvent) => void },
): Promise<Ai4ScholarResponse<Ai4ScholarSseEvent[]>> {
  const { response, url } = await fetchAi4ScholarResponse(config, {
    ...options,
    accept: "text/event-stream",
  });
  if (!response.ok) return throwResponseError(response, url);
  if (!response.body) throw new Ai4ScholarError("Ai4Scholar SSE 响应没有内容。", response.status, url.toString());

  const events: Ai4ScholarSseEvent[] = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consume = (block: string) => {
    const event = parseSseBlock(block);
    if (!event) return;
    events.push(event);
    options.onEvent?.(event);
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let separator = buffer.match(/\r?\n\r?\n/);
    while (separator?.index !== undefined) {
      consume(buffer.slice(0, separator.index));
      buffer = buffer.slice(separator.index + separator[0].length);
      separator = buffer.match(/\r?\n\r?\n/);
    }
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);

  const failure = events.find((event) => event.event === "error");
  if (failure) {
    throw new Ai4ScholarError(`Ai4Scholar SSE 返回错误：${JSON.stringify(failure.data)}`, response.status, url.toString(), failure.data);
  }
  return responseMeta(response, url, events);
}

export function encodeId(id: string): string {
  // Keep Semantic Scholar's identifier separator readable while encoding DOI slashes.
  return id.split(":", 2).length === 2
    ? `${encodeURIComponent(id.slice(0, id.indexOf(":")))}:${encodeURIComponent(id.slice(id.indexOf(":") + 1))}`
    : encodeURIComponent(id);
}
