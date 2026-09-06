import { MediaError } from '../errors.js'
import { extractArtifacts } from '../artifacts.js'
import type { Capability, MediaKind, MediaRequest, ModelDescriptor, ProviderAdapter, AdapterContext, AdapterResult, JsonObject } from '../types.js'
import type { HttpClient } from '../http.js'
import type { InputResolver } from '../input.js'

export interface AdapterDependencies {
  http: HttpClient
  input: InputResolver
  env?: NodeJS.ProcessEnv
}

export abstract class BaseAdapter implements ProviderAdapter {
  abstract readonly id: string
  abstract readonly displayName: string
  abstract readonly envKey?: string
  readonly fallbackEnvKeys?: readonly string[]
  protected readonly http: HttpClient
  protected readonly input: InputResolver
  protected readonly env: NodeJS.ProcessEnv

  constructor(dependencies: AdapterDependencies) {
    this.http = dependencies.http
    this.input = dependencies.input
    this.env = dependencies.env ?? process.env
  }

  abstract models(): ModelDescriptor[]
  abstract supports(capability: Capability, model: string): boolean
  abstract execute(request: MediaRequest, context: AdapterContext): Promise<AdapterResult>

  protected key(request: MediaRequest): string {
    return this.keyFromOptions(request.providerOptions)
  }

  protected keyFromOptions(options?: JsonObject): string {
    const configKey = options?.apiKey
    const envKeys = [this.envKey, ...(this.fallbackEnvKeys ?? [])].filter((key): key is string => Boolean(key))
    const envValue = envKeys.map(key => this.env[key]).find(value => Boolean(value))
    const value = (typeof configKey === 'string' && configKey.trim() ? configKey.trim() : undefined) ?? envValue
    if (!value) throw new MediaError('AUTH', `${envKeys.join(' or ') || `${this.id} API key`} is not set in environment or config`, { provider: this.id })
    return value
  }

  protected assertSupport(request: MediaRequest): void {
    if (!this.supports(request.capability, request.model)) {
      throw new MediaError('CAPABILITY_UNSUPPORTED', `${this.displayName} model ${request.model} does not declare ${request.capability}`, { provider: this.id })
    }
  }

  protected result(request: MediaRequest, payload: unknown, fallback: MediaKind, options: { jobId?: string; text?: string; warnings?: string[] } = {}): AdapterResult {
    const artifacts = extractArtifacts(payload, fallback)
    return {
      provider: this.id,
      model: request.model,
      capability: request.capability,
      artifacts,
      ...(options.jobId ? { jobId: options.jobId } : {}),
      ...(options.text ? { text: options.text } : {}),
      ...(options.warnings?.length ? { warnings: options.warnings } : {}),
    }
  }
}

const NON_PAYLOAD_OPTIONS = new Set([
  'apikey', 'baseurl', 'endpoint', 'taskendpoint', 'websocketurl', 'credentialsfile',
  'project', 'location', 'timeoutms', 'requesttimeoutms', 'connecttimeoutms', 'workspace', 'async',
  'headers', 'authorization', 'token', 'accesstoken',
])

export function payloadOptions(options?: JsonObject, excluded: readonly string[] = []): JsonObject {
  if (!options) return {}
  const blocked = new Set([...NON_PAYLOAD_OPTIONS, ...excluded.map(normalizeOptionName)])
  return Object.fromEntries(Object.entries(options).filter(([key, value]) => value !== undefined && !blocked.has(normalizeOptionName(key))))
}

function normalizeOptionName(name: string): string {
  return name.toLowerCase().replace(/[-_]/g, '')
}

export function mergeOptions(base: JsonObject, options?: JsonObject, excluded: readonly string[] = []): JsonObject {
  return options ? { ...payloadOptions(options, excluded), ...base } : base
}

export function bearerHeaders(key: string, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${key}`, ...extra }
}

export function requirePrompt(request: MediaRequest): string {
  if (!request.prompt?.trim()) throw new MediaError('INPUT', `${request.capability} requires prompt`, { provider: request.provider })
  return request.prompt
}

export async function dataUris(input: InputResolver, sources: readonly string[] | undefined, signal?: AbortSignal): Promise<string[]> {
  if (!sources) return []
  return Promise.all(sources.map(source => input.asDataUri(source, signal)))
}

export function artifactsOrThrow(result: AdapterResult): AdapterResult {
  if (result.artifacts.length === 0 && !result.text) {
    throw new MediaError('PROVIDER', `${result.provider} returned no media artifact`, { provider: result.provider })
  }
  return result
}

export function makeModel(provider: string, vendor: string, id: string, capabilities: Capability[], notes?: string): ModelDescriptor {
  return { provider, vendor, id, capabilities, ...(notes ? { notes } : {}) }
}

export function extractText(payload: unknown): string | undefined {
  const candidates: string[] = []
  function walk(value: unknown, key = ''): void {
    if (typeof value === 'string' && /^(?:text|transcript|transcription|output_text)$/i.test(key)) {
      candidates.push(value)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, key)
      return
    }
    if (!value || typeof value !== 'object') return
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) walk(child, childKey)
  }
  walk(payload)
  return candidates.length ? [...new Set(candidates)].join('\n') : undefined
}
