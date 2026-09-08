import path from "node:path";
import type { MediaConfig } from "./media/config.js";
import os from "node:os";
import { existsSync, readFileSync, statSync } from "node:fs";
import { validateResearchConfig, type ResearchConfig } from "./research/config.js";
import { resolveApiKey, validateApiKeyEnv } from "./credentials.js";

export interface SyncConfig {
  missingPolicy: "skip-and-report";
  conflictPolicy: "preserve-local";
  metadataPolicy: "three-way-merge";
  reparsePolicy: "when-required-and-authorized";
  namespace?: string;
  cacheDir: string;
  backupRetentionDays: number;
}
export interface DataProviderConfig {
  enabled?: boolean;
  apiKey?: string;
  apiKeyEnv?: string;
  timeoutMs?: number;
  maxRequests?: number;
  maxPages?: number;
  maxResults?: number;
  maxResponseBytes?: number;
}
export interface DataConfig {
  providers?: {
    "materials-project"?: DataProviderConfig;
    "cas-common-chemistry"?: DataProviderConfig;
  };
}
export interface Ai4ScholarConfig {
  apiKey?: string;
  apiKeyEnv?: string;
  baseUrl?: string;
  timeoutMs?: number;
  proxyUrl?: string;
}

export interface ScholarConfig {
  schemaVersion?: 3;
  research?: ResearchConfig;
  data?: DataConfig;
  ai4scholar?: Ai4ScholarConfig;
  sync?: SyncConfig;
  configPath?: string;
  media?: MediaConfig;
  zoteroBaseUrl: string;
  zoteroDataDir?: string;
  zoteroTimeoutMs: number;
  zoteroMaxItems: number;
  outputDir: string;
  filenameSeparator: string;
  literaturesDirectory: string;
  assetFilePrefix: string;

  tagSpaceReplacement: "-" | "_";
  mineruToken?: string;
  mineruTimeoutMs: number;
  mineruPollInitialMs: number;
  mineruPollMaxMs: number;
  mineruMaxAttempts: number;
  mineruLanguage: string;
  mineruEnableFormula: boolean;
  mineruEnableTable: boolean;
  mineruIsOcr: boolean;
  mineruModelVersion: string;
}

interface ConfigFile {
  schemaVersion?: 3;
  research?: ResearchConfig;
  data?: DataConfig;
  ai4scholar?: Ai4ScholarConfig;
  sync?: Partial<SyncConfig>;
  media?: MediaConfig;
  zotero?: { baseUrl?: string; dataDir?: string; timeoutMs?: number; maxItems?: number };
  output?: {
    directory?: string;
    filenameSeparator?: string;
    literaturesDirectory?: string;
    assetFilePrefix?: string;
    tagSpaceReplacement?: "-" | "_";
  };
  mineru?: {
    apiKey?: string;
    apiKeyEnv?: string;
    timeoutMs?: number;
    pollInitialMs?: number;
    pollMaxMs?: number;
    maxAttempts?: number;
    language?: string;
    enableFormula?: boolean;
    enableTable?: boolean;
    isOcr?: boolean;
    modelVersion?: string;
  };
}

export function validateZoteroBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Zotero base URL must be a valid URL"); }
  if (url.protocol !== "http:" || url.port !== "23119" || !["localhost", "127.0.0.1"].includes(url.hostname) || url.username || url.password || url.search || url.hash || (url.pathname !== "/api" && url.pathname !== "/api/")) {
    throw new Error("Zotero base URL must be exactly http://localhost:23119/api or http://127.0.0.1:23119/api");
  }
  return `${url.protocol}//${url.host}/api`;
}

const bool = (value: string | boolean | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (/^(1|true|yes)$/i.test(value)) return true;
  if (/^(0|false|no)$/i.test(value)) return false;
  throw new Error(`Invalid boolean configuration: ${value}`);
};
const integer = (value: string | number | undefined, fallback: number, min: number, max: number): number => {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid numeric configuration: ${String(value)}`);
  return n;
};
const configuredString = (value: unknown, label: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
};
export function safeName(value: unknown, label: string, max = 64): string {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > max || /[. ]$/.test(value) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(value) || /[<>:"/\|?*\u0000-\u001F\u007F]/.test(value)) {
    throw new Error(`${label} must be a safe filename component`);
  }
  return value;
}

const configTypes: Record<string, Record<string, "string" | "number" | "boolean">> = {
  zotero: { baseUrl: "string", dataDir: "string", timeoutMs: "number", maxItems: "number" },
  output: { directory: "string", literaturesDirectory: "string", filenameSeparator: "string", assetFilePrefix: "string", tagSpaceReplacement: "string" },
  mineru: { apiKey: "string", apiKeyEnv: "string", timeoutMs: "number", pollInitialMs: "number", pollMaxMs: "number", maxAttempts: "number", language: "string", enableFormula: "boolean", enableTable: "boolean", isOcr: "boolean", modelVersion: "string" },
};
function readConfig(file: string): ConfigFile {
  let value: unknown;
  try { if (statSync(file).size > 64 * 1024) throw new Error("config exceeds 64 KB"); value = JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`Cannot read pi-scholar config ${file}: ${error instanceof Error ? error.message : String(error)}`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`pi-scholar config ${file} must contain a JSON object`);
  for (const [section, fields] of Object.entries(value)) {
    if (section === "schemaVersion") { if (fields !== 3) throw new Error("Unsupported schemaVersion"); continue; }
    if (section === "research") { validateResearchConfig(fields); continue; }
    if (section === "data") { validateDataConfig(fields); continue; }
    if (section === "ai4scholar") { validateAi4ScholarConfig(fields); continue; }
    if (section === "sync") { validateSyncConfig(fields); continue; }
    if (section === "media") { validateMediaConfig(fields); continue; }
    if (!Object.hasOwn(configTypes, section) || !fields || typeof fields !== "object" || Array.isArray(fields)) throw new Error(`Invalid config section: ${section}`);
    for (const [key, field] of Object.entries(fields)) {
      const type = configTypes[section]![key];
      if (!Object.hasOwn(configTypes[section]!, key) || typeof field !== type || (type === "string" && !(field as string).trim())) throw new Error(`Invalid config field: ${section}.${key}; expected ${type ?? "known field"}`);
    }
  }
  const config = value as ConfigFile;
  // Validate JSON values even when an environment override is present.
  integer(config.zotero?.timeoutMs, 15000, 1000, 120000);
  integer(config.zotero?.maxItems, 5000, 1, 50000);
  integer(config.mineru?.timeoutMs, 600000, 10000, 3600000);
  integer(config.mineru?.pollInitialMs, 3000, 100, 60000);
  integer(config.mineru?.pollMaxMs, 15000, 100, 120000);
  integer(config.mineru?.maxAttempts, 120, 1, 1000);
  if (config.zotero?.baseUrl !== undefined) validateZoteroBaseUrl(config.zotero.baseUrl);
  for (const key of ["literaturesDirectory", "assetFilePrefix"] as const) if (config.output?.[key] !== undefined) safeName(config.output[key], `output.${key}`);
  if (config.output?.filenameSeparator !== undefined && !/^[+._ -]{1,3}$/.test(config.output.filenameSeparator)) throw new Error("Invalid output.filenameSeparator");
  if (config.output?.tagSpaceReplacement !== undefined && !["-", "_"].includes(config.output.tagSpaceReplacement)) throw new Error("Invalid output.tagSpaceReplacement");
  validateApiKeyEnv(config.mineru?.apiKeyEnv, "mineru.apiKeyEnv");
  if (config.mineru?.apiKey !== undefined && (typeof config.mineru.apiKey !== "string" || !config.mineru.apiKey.trim())) throw new Error("mineru.apiKey must be a non-empty string");
  return config;
}

function validateAi4ScholarConfig(value: unknown): void {
  const config = mediaObject(value, "ai4scholar");
  mediaFields(config, ["apiKey", "apiKeyEnv", "baseUrl", "timeoutMs", "proxyUrl"], "ai4scholar");
  if (config.apiKey !== undefined && (typeof config.apiKey !== "string" || !config.apiKey.trim())) throw new Error("ai4scholar.apiKey must be a non-empty string");
  validateApiKeyEnv(config.apiKeyEnv, "ai4scholar.apiKeyEnv");
  if (config.baseUrl !== undefined) {
    mediaUrl(config.baseUrl, "ai4scholar.baseUrl");
    if (new URL(config.baseUrl as string).protocol !== "https:") throw new Error("ai4scholar.baseUrl must use HTTPS");
  }
  if (config.proxyUrl !== undefined) {
    if (config.proxyUrl !== "direct") mediaUrl(config.proxyUrl, "ai4scholar.proxyUrl");
  }
  if (config.timeoutMs !== undefined) integer(config.timeoutMs as number, 30_000, 1, 3_600_000);
}

function validateDataConfig(value: unknown): void {
  const data = mediaObject(value, "data");
  mediaFields(data, ["providers"], "data");
  if (data.providers === undefined) return;
  const providers = mediaObject(data.providers, "data.providers");
  const supported = ["materials-project", "cas-common-chemistry"] as const;
  mediaFields(providers, [...supported], "data.providers");
  for (const id of supported) {
    if (providers[id] === undefined) continue;
    const provider = mediaObject(providers[id], id);
    mediaFields(provider, ["enabled", "apiKey", "apiKeyEnv", "timeoutMs", "maxRequests", "maxPages", "maxResults", "maxResponseBytes"], id);
    if (provider.enabled !== undefined && typeof provider.enabled !== "boolean") throw new Error(`${id}.enabled must be boolean`);
    if (provider.apiKey !== undefined && (typeof provider.apiKey !== "string" || !provider.apiKey.trim())) throw new Error(`${id}.apiKey must be a non-empty string`);
    validateApiKeyEnv(provider.apiKeyEnv, `${id}.apiKeyEnv`);
    for (const [key, min, max] of [["timeoutMs", 1000, 300000], ["maxRequests", 1, 1000], ["maxPages", 1, 100], ["maxResults", 1, 10000], ["maxResponseBytes", 1024, 64 * 1024 * 1024]] as const) {
      if (provider[key] !== undefined && typeof provider[key] !== "number") throw new Error(`${id}.${key} must be numeric`);
      integer(provider[key] as number | undefined, min, min, max);
    }
  }
}

function normalizeDataConfig(value: DataConfig | undefined, env: NodeJS.ProcessEnv): DataConfig | undefined {
  if (!value?.providers) return value;
  const providers = { ...value.providers };
  for (const id of ["materials-project", "cas-common-chemistry"] as const) {
    const provider = providers[id];
    if (!provider) continue;
    const apiKey = resolveApiKey(provider, env, id === "materials-project" ? ["MP_API_KEY"] : ["CAS_API_KEY"]);
    providers[id] = { ...provider, ...(apiKey ? { apiKey } : {}) };
  }
  return { ...value, providers };
}

function validateSyncConfig(value: unknown): void {
  const sync = mediaObject(value, "sync");
  mediaFields(sync, ["missingPolicy", "conflictPolicy", "metadataPolicy", "reparsePolicy", "namespace", "cacheDir", "backupRetentionDays"], "sync");
  const policies = { missingPolicy: "skip-and-report", conflictPolicy: "preserve-local", metadataPolicy: "three-way-merge", reparsePolicy: "when-required-and-authorized" };
  for (const [key, expected] of Object.entries(policies)) if (sync[key] !== undefined && sync[key] !== expected) throw new Error(`Unsupported sync.${key}`);
  if (sync.namespace !== undefined && (typeof sync.namespace !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(sync.namespace))) throw new Error("Invalid sync.namespace");
  configuredString(sync.cacheDir, "sync.cacheDir");
  if (sync.backupRetentionDays !== undefined && typeof sync.backupRetentionDays !== "number") throw new Error("sync.backupRetentionDays must be numeric");
  integer(sync.backupRetentionDays as number | undefined, 30, 1, 3650);
}

const imageCapabilities = new Set(["image.text_to_image", "image.image_to_image", "image.edit", "image.multi_reference"]);
const mediaProviders = new Set(["openai", "gemini", "vertex", "xai", "fal", "dashscope", "qwencloud", "atlas"]);
function mediaObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}: expected object`);
  return value as Record<string, unknown>;
}
function mediaFields(value: Record<string, unknown>, allowed: string[], label: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Invalid config field: ${label}.${key}`);
}
function mediaUrl(value: unknown, label: string): void {
  configuredString(value, label);
  let url: URL;
  try { url = new URL(value as string); } catch { throw new Error(`Invalid ${label}: expected URL`); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error(`Invalid ${label}: expected HTTP(S) URL without credentials, query or fragment`);
}
export function validateMediaConfig(value: unknown): void {
  const media = mediaObject(value, "media");
  mediaFields(media, ["outputDir", "maxArtifactBytes", "artifactTimeoutMs", "providerOptions", "customProviders", "defaultModels"], "media");
  configuredString(media.outputDir, "media.outputDir");
  for (const [key, min, max] of [["maxArtifactBytes", 1, 1024 * 1024 * 1024], ["artifactTimeoutMs", 1000, 3600000]] as const) {
    if (media[key] !== undefined && typeof media[key] !== "number") throw new Error(`Invalid media.${key}`);
    integer(media[key] as number | undefined, min, min, max);
  }
  const customIds = new Set<string>();
  if (media.customProviders !== undefined) {
    if (!Array.isArray(media.customProviders)) throw new Error("media.customProviders must be an array");
    for (const raw of media.customProviders) {
      const p = mediaObject(raw, "custom provider");
      mediaFields(p, ["id", "name", "baseUrl", "apiKey", "apiKeyEnv", "auth", "headers", "models"], "custom provider");
      configuredString(p.id, "custom provider id");
      if (typeof p.id !== "string" || !/^[a-z][a-z0-9_-]*$/.test(p.id) || mediaProviders.has(p.id) || customIds.has(p.id)) throw new Error("Invalid or duplicate custom provider id");
      customIds.add(p.id);
      mediaUrl(p.baseUrl, "custom provider baseUrl");
      for (const key of ["name", "apiKey", "apiKeyEnv"]) configuredString(p[key], `custom provider ${key}`);
      if (p.apiKeyEnv !== undefined && !/^[A-Z_][A-Z0-9_]*$/.test(p.apiKeyEnv as string)) throw new Error("Invalid custom apiKeyEnv");
      if (p.auth !== undefined && !["bearer", "x-api-key", "none"].includes(p.auth as string)) throw new Error("Invalid custom auth");
      if (p.headers !== undefined) for (const v of Object.values(mediaObject(p.headers, "custom headers"))) configuredString(v, "custom header");
      if (!Array.isArray(p.models) || !p.models.length) throw new Error("Custom provider requires models");
      const ids = new Set<string>();
      for (const rawModel of p.models) {
        const m = mediaObject(rawModel, "custom model");
        mediaFields(m, ["id", "vendor", "capabilities", "endpoints"], "custom model");
        if (!configuredString(m.id, "model id") || !configuredString(m.vendor, "model vendor") || ids.has(m.id as string)) throw new Error("Invalid or duplicate model");
        ids.add(m.id as string);
        if (!Array.isArray(m.capabilities) || !m.capabilities.length || m.capabilities.some(c => !imageCapabilities.has(c))) throw new Error("Custom models support image capabilities only");
        const endpoints = mediaObject(m.endpoints, "model endpoints");
        mediaFields(endpoints, m.capabilities as string[], "model endpoints");
        for (const c of m.capabilities as string[]) {
          const endpoint = endpoints[c];
          if (typeof endpoint === "string") { if (!endpoint.trim()) throw new Error("Empty model endpoint"); }
          else {
            const e = mediaObject(endpoint, "model endpoint");
            mediaFields(e, ["path", "method", "format"], "model endpoint");
            if (!configuredString(e.path, "endpoint path")) throw new Error("Endpoint requires path");
            if (e.method !== undefined && e.method !== "POST") throw new Error("Image endpoint method must be POST");
            if (e.format !== undefined && !["json", "multipart"].includes(e.format as string)) throw new Error("Invalid endpoint format");
          }
        }
      }
    }
  }
  if (media.providerOptions !== undefined) for (const [id, raw] of Object.entries(mediaObject(media.providerOptions, "media.providerOptions"))) {
    if (!mediaProviders.has(id) && !customIds.has(id)) throw new Error("Unknown media provider");
    const options = mediaObject(raw, "provider options");
    const credentialFields = ["apiKey", "apiKeyEnv"];
    const allowed = customIds.has(id)
      ? credentialFields
      : id === "vertex"
        ? ["credentialsFile", "project", "location"]
        : id === "dashscope" || id === "qwencloud"
          ? [...credentialFields, "baseUrl", "workspace"]
          : id === "fal"
            ? credentialFields
            : [...credentialFields, "baseUrl"];
    mediaFields(options, allowed, `provider options.${id}`);
    for (const [key, v] of Object.entries(options)) {
      configuredString(v, `media provider ${key}`);
      if (key === "baseUrl") mediaUrl(v, `media provider ${key}`);
      if (key === "apiKeyEnv" && !/^[A-Z_][A-Z0-9_]*$/.test(v as string)) throw new Error("Invalid media apiKeyEnv");
      if (id === "vertex" && key === "location" && !/^(?:global|[a-z]+(?:-[a-z0-9]+)+[0-9])$/.test(v as string)) throw new Error("Invalid Vertex location");
    }
  }
  if (media.defaultModels !== undefined) for (const [id, raw] of Object.entries(mediaObject(media.defaultModels, "media.defaultModels"))) {
    if (!mediaProviders.has(id) && !customIds.has(id)) throw new Error("Unknown default model provider");
    const pins = mediaObject(raw, "default models");
    for (const [capability, model] of Object.entries(pins)) {
      if (!imageCapabilities.has(capability)) throw new Error("Default model requires image capability");
      configuredString(model, "default model");
    }
  }
}

export function discoverConfigPath(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd(), home = os.homedir(), projectTrusted = false): string | undefined {
  if (env.PI_SCHOLAR_CONFIG) {
    const explicit = path.resolve(cwd, env.PI_SCHOLAR_CONFIG);
    if (!existsSync(explicit)) throw new Error(`PI_SCHOLAR_CONFIG does not exist: ${explicit}`);
    return explicit;
  }
  let current = path.resolve(cwd);
  while (projectTrusted) {
    const candidate = path.join(current, "pi-scholar.config.json");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const candidate of [path.join(home, ".config", "pi-scholar", "config.json"), path.join(home, ".pi-scholar.json")]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd(), projectTrusted = false): ScholarConfig {
  // Explicit custom env objects (used by embedders/tests) stay isolated unless they
  // set PI_SCHOLAR_CONFIG. Normal runtime calls discover project/user config files.
  const home = env.HOME ?? env.USERPROFILE ?? os.homedir();
  const configPath = env.PI_SCHOLAR_CONFIG || env === process.env ? discoverConfigPath(env, cwd, home, projectTrusted) : undefined;
  const file = configPath ? readConfig(configPath) : {};
  const baseDir = configPath ? path.dirname(configPath) : cwd;
  const ai4scholarKey = resolveApiKey(file.ai4scholar, env, ["AI4SCHOLAR_API_KEY"]);
  const ai4scholar = file.ai4scholar ? { ...file.ai4scholar, ...(ai4scholarKey ? { apiKey: ai4scholarKey } : {}) } : undefined;
  const fileOutput = configuredString(file.output?.directory, "output.directory");
  const fileDataDir = configuredString(file.zotero?.dataDir, "zotero.dataDir");
  const outputDir = env.PI_SCHOLAR_OUTPUT_DIR
    ? path.resolve(cwd, env.PI_SCHOLAR_OUTPUT_DIR)
    : fileOutput ? path.resolve(baseDir, fileOutput) : path.join(home, "pi-scholar");
  const dataDir = env.ZOTERO_DATA_DIR
    ? path.resolve(cwd, env.ZOTERO_DATA_DIR)
    : fileDataDir ? path.resolve(baseDir, fileDataDir) : undefined;
  const mineruToken = resolveApiKey(file.mineru, env, ["MINERU_API_TOKEN"]);

  const filenameSeparator = env.PI_SCHOLAR_FILENAME_SEPARATOR ?? file.output?.filenameSeparator ?? "-";
  if (!/^[+._ -]{1,3}$/.test(filenameSeparator)) throw new Error("output.filenameSeparator must contain 1-3 safe separator characters");
  const literaturesDirectory = safeName(env.PI_SCHOLAR_LITERATURES_DIR ?? file.output?.literaturesDirectory ?? "Literatures", "output.literaturesDirectory");
  const assetFilePrefix = safeName(env.PI_SCHOLAR_ASSET_FILE_PREFIX ?? file.output?.assetFilePrefix ?? "figure", "output.assetFilePrefix");
  const tagSpaceReplacement = env.PI_SCHOLAR_TAG_SPACE_REPLACEMENT ?? file.output?.tagSpaceReplacement ?? "-";
  if (tagSpaceReplacement !== "-" && tagSpaceReplacement !== "_") throw new Error("output.tagSpaceReplacement must be '-' or '_'");

  return {
    schemaVersion: file.schemaVersion ?? 3,
    ...(file.research ? { research: validateResearchConfig(file.research, env) } : {}),
    ...(file.data ? { data: normalizeDataConfig(file.data, env) } : {}),
    ...(ai4scholar ? { ai4scholar } : {}),
    sync: {
      missingPolicy: "skip-and-report", conflictPolicy: "preserve-local",
      metadataPolicy: "three-way-merge", reparsePolicy: "when-required-and-authorized",
      ...(file.sync?.namespace ? { namespace: file.sync.namespace } : {}),
      cacheDir: path.resolve(baseDir, file.sync?.cacheDir ?? path.join(home, ".cache", "pi-scholar", "parse")),
      backupRetentionDays: file.sync?.backupRetentionDays ?? 30,
    },
    ...(configPath ? { configPath } : {}),
    ...(file.media ? { media: file.media } : {}),
    zoteroBaseUrl: validateZoteroBaseUrl(env.ZOTERO_BASE_URL ?? file.zotero?.baseUrl ?? "http://127.0.0.1:23119/api"),
    ...(dataDir ? { zoteroDataDir: dataDir } : {}),
    zoteroTimeoutMs: integer(env.ZOTERO_TIMEOUT_MS, file.zotero?.timeoutMs ?? 15_000, 1_000, 120_000),
    zoteroMaxItems: integer(env.ZOTERO_MAX_ITEMS, file.zotero?.maxItems ?? 5_000, 1, 50_000),
    outputDir,
    filenameSeparator,
    literaturesDirectory,
    assetFilePrefix,
    tagSpaceReplacement,
    ...(mineruToken ? { mineruToken } : {}),
    mineruTimeoutMs: integer(env.MINERU_TIMEOUT_MS, file.mineru?.timeoutMs ?? 600_000, 10_000, 3_600_000),
    mineruPollInitialMs: integer(env.MINERU_POLL_INITIAL_MS, file.mineru?.pollInitialMs ?? 3_000, 100, 60_000),
    mineruPollMaxMs: integer(env.MINERU_POLL_MAX_MS, file.mineru?.pollMaxMs ?? 15_000, 100, 120_000),
    mineruMaxAttempts: integer(env.MINERU_MAX_ATTEMPTS, file.mineru?.maxAttempts ?? 120, 1, 1_000),
    mineruLanguage: configuredString(env.MINERU_LANGUAGE, "MINERU_LANGUAGE") ?? file.mineru?.language ?? "en",
    mineruEnableFormula: bool(env.MINERU_ENABLE_FORMULA, file.mineru?.enableFormula ?? true),
    mineruEnableTable: bool(env.MINERU_ENABLE_TABLE, file.mineru?.enableTable ?? true),
    mineruIsOcr: bool(env.MINERU_IS_OCR, file.mineru?.isOcr ?? false),
    mineruModelVersion: configuredString(env.MINERU_MODEL_VERSION, "MINERU_MODEL_VERSION") ?? file.mineru?.modelVersion ?? "vlm",
  };
}
