import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../config.js'
import type { Capability, JsonObject } from './types.js'

export interface CustomAsyncConfig {
  idPath: string
  statusPath: string
  pollEndpoint: string
  resultPath?: string
  cancelEndpoint?: string
  successValues?: string[]
  failureValues?: string[]
}
export interface CustomEndpointConfig {
  path: string
  method?: string
  format?: 'json' | 'multipart'
  async?: CustomAsyncConfig
}
export interface CustomModelConfig {
  id: string
  vendor: string
  capabilities: Capability[]
  endpoints: Partial<Record<Capability, string | CustomEndpointConfig>>
}
export interface CustomProviderConfig {
  id: string
  name?: string
  baseUrl: string
  apiKey?: string
  apiKeyEnv?: string
  auth?: 'bearer' | 'x-api-key' | 'none'
  headers?: Record<string, string>
  models: CustomModelConfig[]
}
export interface MediaConfig {
  outputDir?: string
  maxArtifactBytes?: number
  artifactTimeoutMs?: number
  customProviders: CustomProviderConfig[]
  providerOptions?: Record<string, JsonObject>
  defaultModels?: Record<string, Partial<Record<Capability, string>>>
}
export const MEDIA_KEY_ENVS: Record<string, readonly string[]> = {
  openai: ['OPENAI_API_KEY'], gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  xai: ['XAI_API_KEY'], fal: ['FAL_KEY', 'FAL_API_KEY'],
  dashscope: ['DASHSCOPE_API_KEY'], qwencloud: ['QWENCLOUD_API_KEY', 'DASHSCOPE_API_KEY'],
  atlas: ['ATLAS_API_KEY'],
}
export function expandHomePath(rawPath: string | undefined): string | undefined {
  if (rawPath === '~') return homedir()
  if (rawPath?.startsWith('~/') || rawPath?.startsWith('~\\')) return join(homedir(), rawPath.slice(2))
  return rawPath
}
export async function loadMediaConfig(cwd: string, projectTrusted = false, env: NodeJS.ProcessEnv = process.env): Promise<MediaConfig> {
  const scholar = loadConfig(env, cwd, projectTrusted)
  const raw = scholar.media
  const base = scholar.configPath ? dirname(scholar.configPath) : cwd
  const providerOptions: Record<string, JsonObject> = {}
  for (const id of new Set([...Object.keys(MEDIA_KEY_ENVS), ...Object.keys(raw?.providerOptions ?? {}), ...(raw?.customProviders ?? []).map(p => p.id)])) {
    const custom = raw?.customProviders?.find(p => p.id === id)
    const options = { ...(raw?.providerOptions?.[id] ?? {}) }
    const keyEnv = options.apiKeyEnv ?? custom?.apiKeyEnv
    const key = options.apiKey ?? custom?.apiKey ?? (typeof keyEnv === 'string' ? env[keyEnv] : undefined) ?? (MEDIA_KEY_ENVS[id] ?? []).map(name => env[name]).find(Boolean)
    if (key) options.apiKey = key
    providerOptions[id] = options
  }
  const vertex = { ...(providerOptions.vertex ?? {}) }
  const credentialsBase = typeof vertex.credentialsFile === 'string' ? base : cwd
  vertex.credentialsFile ??= env.GOOGLE_APPLICATION_CREDENTIALS ?? env.VERTEX_CREDENTIALS_FILE
  vertex.location ??= env.GOOGLE_CLOUD_LOCATION ?? env.VERTEX_LOCATION
  vertex.project ??= env.GOOGLE_CLOUD_PROJECT ?? env.GCLOUD_PROJECT
  if (typeof vertex.credentialsFile === 'string') {
    const expanded = expandHomePath(vertex.credentialsFile)!
    vertex.credentialsFile = expanded.startsWith('file://') ? fileURLToPath(expanded) : resolve(credentialsBase, expanded)
  }
  // Keep Vertex credential loading lazy so an optional/missing Vertex file does not
  // prevent Gemini, OpenAI, or another configured provider from being used.
  providerOptions.vertex = vertex
  return {
    ...raw,
    outputDir: raw?.outputDir ? resolve(base, expandHomePath(raw.outputDir)!) : join(scholar.outputDir, 'images'),
    maxArtifactBytes: raw?.maxArtifactBytes ?? 50 * 1024 * 1024,
    artifactTimeoutMs: raw?.artifactTimeoutMs ?? 120_000,
    customProviders: (raw?.customProviders ?? []).map(p => ({ ...p, ...(typeof providerOptions[p.id]?.apiKey === 'string' ? { apiKey: providerOptions[p.id]!.apiKey as string } : {}) })),
    providerOptions,
  }
}
export async function resolveVertexProjectOptions(options: JsonObject): Promise<JsonObject> {
  if (typeof options.project === 'string' && options.project.trim()) return options
  if (typeof options.credentialsFile !== 'string') return options
  try {
    if ((await stat(options.credentialsFile)).size > 1024 * 1024) throw new Error('oversized credentials')
    const credentials: unknown = JSON.parse(await readFile(options.credentialsFile, 'utf8'))
    const project = credentials && typeof credentials === 'object' ? (credentials as JsonObject).project_id : undefined
    return typeof project === 'string' && project.trim() ? { ...options, project: project.trim() } : options
  } catch {
    throw new Error('Cannot read Vertex credentialsFile; check the configured service-account JSON file')
  }
}
