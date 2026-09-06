import { ArtifactDownloader } from './artifacts.js'
import type { MediaConfig } from './config.js'
import { asMediaError, MediaError } from './errors.js'
import { HttpClient, type FetchLike } from './http.js'
import { InputResolver } from './input.js'
import type { AdapterContext, Capability, MediaRequest, ModelDescriptor, ModelDiscoveryContext, NormalizedResult, ProviderAdapter } from './types.js'
import { AtlasAdapter } from './adapters/atlas.js'
import { CustomOpenAICompatibleAdapter } from './adapters/custom.js'
import { DashScopeAdapter } from './adapters/dashscope.js'
import { FalAdapter } from './adapters/fal.js'
import { GoogleMediaAdapter } from './adapters/google.js'
import { OpenAIAdapter } from './adapters/openai.js'

import { XAIAdapter } from './adapters/xai.js'

export interface RouterOptions {
  cwd: string
  config: MediaConfig
  env?: NodeJS.ProcessEnv
  fetch?: FetchLike
}

export class CapabilityRouter {
  private readonly adapters = new Map<string, ProviderAdapter>()
  private readonly downloader: ArtifactDownloader
  private readonly env: NodeJS.ProcessEnv
  private readonly providerDefaults: Record<string, Record<string, unknown>>
  private readonly noAuthProviders: ReadonlySet<string>

  constructor(options: RouterOptions) {
    const http = new HttpClient(options.fetch)
    const input = new InputResolver(http, options.cwd)
    const dependencies = { http, input, ...(options.env ? { env: options.env } : {}) }
    this.env = options.env ?? process.env
    this.providerDefaults = options.config.providerOptions ?? {}
    this.noAuthProviders = new Set(options.config.customProviders.filter(provider => provider.auth === 'none').map(provider => provider.id))
    const builtins: ProviderAdapter[] = [

      new FalAdapter(dependencies),
      new DashScopeAdapter('dashscope', 'https://dashscope.aliyuncs.com', dependencies),
      new DashScopeAdapter('qwencloud', 'https://dashscope-intl.aliyuncs.com', dependencies),
      new OpenAIAdapter(dependencies),
      new GoogleMediaAdapter('gemini', dependencies),
      new GoogleMediaAdapter('vertex', dependencies),
      new XAIAdapter(dependencies),
      new AtlasAdapter(dependencies),
      ...options.config.customProviders.map(provider => new CustomOpenAICompatibleAdapter(provider, dependencies)),
    ]
    for (const adapter of builtins) this.adapters.set(adapter.id, adapter)
    this.downloader = new ArtifactDownloader(http, options.config.outputDir, options.config.maxArtifactBytes, options.config.artifactTimeoutMs)
  }

  private isConfigured(adapter: ProviderAdapter): boolean {
    if (this.noAuthProviders.has(adapter.id)) return true
    if (adapter.id === 'vertex') {
      const vertexOpts = this.providerDefaults['vertex']
      if (typeof vertexOpts?.credentialsFile === 'string' && vertexOpts.credentialsFile.trim()) return true
      if (typeof vertexOpts?.project === 'string' && vertexOpts.project.trim()) return true
      if (this.env.GOOGLE_APPLICATION_CREDENTIALS || this.env.VERTEX_CREDENTIALS_FILE || this.env.GOOGLE_CLOUD_PROJECT || this.env.GCLOUD_PROJECT) return true
      return false
    }
    const configKey = this.providerDefaults[adapter.id]?.apiKey
    if (typeof configKey === 'string' && configKey.trim()) return true
    if ([adapter.envKey, ...(adapter.fallbackEnvKeys ?? [])].some(key => key && this.env[key])) return true
    return false
  }

  list(provider?: string, capability?: Capability): Array<ModelDescriptor & { configured: boolean }> {
    const adapters = this.selectedAdapters(provider)
    return adapters.flatMap(adapter => adapter.models()
      .filter(model => !capability || model.capabilities.includes(capability))
      .map(model => ({ ...model, configured: this.isConfigured(adapter), availability: 'unknown' as const, source: 'built-in' as const })))
  }

  async discover(provider?: string, capability?: Capability, context: AdapterContext & { probe?: boolean } = {}): Promise<Array<ModelDescriptor & { configured: boolean }>> {
    const groups = await Promise.all(this.selectedAdapters(provider).map(async adapter => {
      const configured = this.isConfigured(adapter)
      const discoveryContext: ModelDiscoveryContext = {
        ...(context.signal ? { signal: context.signal } : {}),
        providerOptions: this.providerDefaults[adapter.id] ?? {},
      }
      let models: ModelDescriptor[]
      if (!configured || !adapter.discoverModels) {
        models = adapter.models().map(model => ({ ...model, availability: 'unknown', source: 'built-in' }))
      } else {
        try {
          models = (await adapter.discoverModels(discoveryContext)).map(model => ({
            ...model,
            availability: model.availability ?? 'available',
            source: 'discovered',
          }))
        } catch (error) {
          const normalized = asMediaError(error, adapter.id)
          const message = normalized.status ? `HTTP ${normalized.status}` : normalized.message.split('\n', 1)[0]
          models = adapter.models().map(model => ({
            ...model,
            availability: 'unknown',
            source: 'built-in',
            notes: [model.notes, `Discovery failed: ${message}`].filter(Boolean).join('; '),
          }))
        }
      }
      models = models.filter(model => !capability || model.capabilities.includes(capability))
      if (configured && context.probe !== false && adapter.probeModel) {
        models = await Promise.all(models.map(async model => {
          try {
            const probeCapability = capability ?? model.capabilities[0]
            const available = probeCapability ? await adapter.probeModel?.(model, probeCapability, discoveryContext) : undefined
            return available === undefined ? model : { ...model, availability: available ? 'available' as const : 'unavailable' as const }
          } catch (error) {
            const normalized = asMediaError(error, adapter.id)
            const unavailable = normalized.status === 400 || normalized.status === 403 || normalized.status === 404
            const probeMessage = unavailable
              ? `Probe failed: HTTP ${normalized.status} (model unavailable to the configured project/location)`
              : `Probe failed: ${normalized.message.split('\n', 1)[0]}`
            return {
              ...model,
              availability: unavailable ? 'unavailable' as const : 'unknown' as const,
              notes: [model.notes, probeMessage].filter(Boolean).join('; '),
            }
          }
        }))
      }
      const knownOrder = new Map(adapter.models().map((model, index) => [model.id, index]))
      const sorted = models.sort((left, right) => compareModels(left, right, knownOrder))
      const defaultIndex = sorted.findIndex(model => model.availability !== 'unavailable' && !isPlaceholderModel(model.id))
      return sorted.map((model, index) => ({ ...model, configured, ...(index === defaultIndex ? { isDefault: true } : {}) }))
    }))
    return groups.flat()
  }

  async defaultModel(provider: string, capability: Capability, context: AdapterContext = {}): Promise<string> {
    if (!this.adapters.has(provider)) throw new MediaError('CONFIG', `Unknown media provider: ${provider}`)
    const models = await this.discover(provider, capability, { ...context, probe: true })
    const selected = models.find(model => model.isDefault)
    if (!selected) throw new MediaError('CONFIG', `No usable ${capability} model was discovered for ${provider}; specify a model explicitly`, { provider })
    return selected.id
  }

  providers(): Array<{ id: string; name: string; configured: boolean; envKey?: string }> {
    return [...this.adapters.values()].map(adapter => ({
      id: adapter.id,
      name: adapter.displayName,
      configured: this.isConfigured(adapter),
      ...(adapter.envKey ? { envKey: adapter.envKey } : {}),
    }))
  }

  private selectedAdapters(provider?: string): ProviderAdapter[] {
    return provider ? [this.adapters.get(provider)].filter((item): item is ProviderAdapter => Boolean(item)) : [...this.adapters.values()]
  }

  async execute(request: MediaRequest, context: AdapterContext = {}): Promise<NormalizedResult> {
    const adapter = this.adapters.get(request.provider)
    if (!adapter) throw new MediaError('CONFIG', `Unknown media provider: ${request.provider}`)
    assertNoCredentialOverrides(request.providerOptions, request.provider)
    const providerOptions = { ...(this.providerDefaults[request.provider] ?? {}), ...(request.providerOptions ?? {}) }
    const resolvedRequest: MediaRequest = { ...request, providerOptions }
    try {

      const result = await adapter.execute(resolvedRequest, context)
      const artifacts = await this.downloader.downloadAll(result.artifacts, context.signal)
      return {
        provider: result.provider,
        model: result.model,
        capability: result.capability,
        artifacts,
        warnings: result.warnings ?? [],
        ...(result.jobId ? { jobId: result.jobId } : {}),
        ...(result.text ? { text: result.text } : {}),
      }
    } catch (error) {
      throw asMediaError(error, adapter.id)
    }
  }
}

const CONFIG_ONLY_PROVIDER_OPTIONS = new Set([
  'apikey', 'baseurl', 'endpoint', 'taskendpoint', 'websocketurl', 'credentialsfile',
  'project', 'location', 'workspace', 'headers', 'authorization', 'token', 'accesstoken',
])
const NORMALIZED_REQUEST_OPTIONS = new Set([
  'provider', 'model', 'capability', 'prompt', 'text', 'input', 'n', 'count', 'duration',
  'resolution', 'size', 'aspectratio', 'seed', 'voice', 'language', 'responseformat',
  'outputformat', 'format', 'quality', 'compression', 'background', 'operation', 'generateaudio',
])

function assertNoCredentialOverrides(options: MediaRequest['providerOptions'], provider: string): void {
  if (!options) return
  const forbidden = Object.keys(options).find(name => {
    const normalized = name.toLowerCase().replace(/[-_]/g, '')
    return CONFIG_ONLY_PROVIDER_OPTIONS.has(normalized) || NORMALIZED_REQUEST_OPTIONS.has(normalized)
  })
  if (forbidden) {
    throw new MediaError('INPUT', `providerOptions.${forbidden} is reserved; use the typed tool parameter or pi-scholar config`, { provider })
  }
}

function compareModels(left: ModelDescriptor, right: ModelDescriptor, knownOrder: ReadonlyMap<string, number> = new Map()): number {
  const availability = { available: 2, unknown: 1, unavailable: 0 }
  const availabilityDifference = availability[right.availability ?? 'unknown'] - availability[left.availability ?? 'unknown']
  if (availabilityDifference) return availabilityDifference
  if (left.source === 'built-in' && right.source === 'built-in') return 0
  const leftKnown = knownOrder.get(left.id)
  const rightKnown = knownOrder.get(right.id)
  if (leftKnown !== undefined && rightKnown !== undefined && leftKnown !== rightKnown) return leftKnown - rightKnown
  const familyDifference = modelFamilyPriority(right.id) - modelFamilyPriority(left.id)
  if (familyDifference) return familyDifference
  const leftVersion = modelVersion(left.id)
  const rightVersion = modelVersion(right.id)
  for (let index = 0; index < Math.max(leftVersion.length, rightVersion.length); index += 1) {
    const difference = (rightVersion[index] ?? 0) - (leftVersion[index] ?? 0)
    if (difference) return difference
  }
  const previewDifference = Number(/(?:preview|experimental)/i.test(left.id)) - Number(/(?:preview|experimental)/i.test(right.id))
  return previewDifference || right.id.localeCompare(left.id)
}

function modelFamilyPriority(id: string): number {
  if (/gpt-image/i.test(id)) return 2
  if (/dall-e/i.test(id)) return 1
  return 0
}

function modelVersion(id: string): number[] {
  return [...id.matchAll(/\d+/g)].map(match => Number(match[0]))
}

function isPlaceholderModel(id: string): boolean {
  return /^<.*>$/.test(id.trim())
}
