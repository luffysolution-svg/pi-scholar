import { MediaError } from '../errors.js'
import { MediaJob, mapJobState } from '../media-job.js'
import type { CustomEndpointConfig, CustomModelConfig, CustomProviderConfig } from '../config.js'
import type { AdapterContext, AdapterResult, Capability, JobStatus, JsonObject, MediaRequest, ModelDescriptor, ModelDiscoveryContext } from '../types.js'
import type { AdapterDependencies } from './base.js'
import { BaseAdapter, artifactsOrThrow, dataUris, makeModel, mergeOptions, payloadOptions } from './base.js'

export class CustomOpenAICompatibleAdapter extends BaseAdapter {
  readonly id: string
  readonly displayName: string
  readonly envKey: string | undefined

  constructor(private readonly config: CustomProviderConfig, dependencies: AdapterDependencies) {
    super(dependencies)
    this.id = config.id
    this.displayName = config.name ?? config.id
    this.envKey = config.apiKeyEnv
  }

  models(): ModelDescriptor[] {
    return this.config.models.map(model => makeModel(this.id, model.vendor, model.id, model.capabilities, 'Explicit custom-provider declaration; no /models capability inference'))
  }

  async discoverModels(context: ModelDiscoveryContext): Promise<ModelDescriptor[]> {
    const key = this.config.auth === 'none' ? undefined : this.keyFromOptions(context.providerOptions)
    const headers = { ...this.authHeaders(key), ...(this.config.headers ?? {}) }
    const payload = await this.http.json<{ data?: Array<{ id?: string }> }>(this.url('/models'), {
      headers, signal: context.signal, provider: this.id, secrets: key ? [key] : [], timeoutMs: 30_000,
    })
    const visible = new Set((payload.data ?? []).flatMap(entry => typeof entry.id === 'string' ? [entry.id] : []))
    const models = this.models().filter(model => visible.has(model.id)).map(model => ({ ...model, availability: 'available' as const }))
    if (!models.length) throw new MediaError('PROVIDER', `${this.id} model catalog contained none of the explicitly declared image models`, { provider: this.id })
    return models
  }

  supports(capability: Capability, model: string): boolean {
    return Boolean(this.model(model)?.capabilities.includes(capability))
  }

  async execute(request: MediaRequest, context: AdapterContext): Promise<AdapterResult> {
    this.assertSupport(request)
    const model = this.model(request.model)
    if (!model) throw new MediaError('CONFIG', `Unknown custom model ${this.id}/${request.model}`, { provider: this.id })
    const declared = model.endpoints[request.capability]
    if (!declared) throw new MediaError('CONFIG', `No endpoint declared for ${request.capability}`, { provider: this.id })
    const endpoint: CustomEndpointConfig = typeof declared === 'string' ? { path: declared } : declared
    const key = this.config.auth === 'none' ? undefined : this.key(request)
    const headers = { ...this.authHeaders(key), ...(this.config.headers ?? {}) }
    const { body, contentType } = await this.body(request, endpoint.format ?? 'json', context.signal)
    const submitted = await this.http.json<Record<string, unknown>>(this.url(endpoint.path), {
      method: endpoint.method ?? 'POST', headers: { ...headers, ...(contentType ? { 'Content-Type': contentType } : {}) }, body,
      signal: context.signal, provider: this.id, secrets: key ? [key] : [], timeoutMs: 120_000,
    })
    if (!endpoint.async) return artifactsOrThrow(this.result(request, submitted, kind(request), { text: textResult(submitted) }))
    const asyncConfig = endpoint.async
    const jobId = getPath(submitted, asyncConfig.idPath)
    if (typeof jobId !== 'string') throw new MediaError('PROVIDER', `${this.id} async response did not contain ${asyncConfig.idPath}`, { provider: this.id })
    const pollUrl = this.url(asyncConfig.pollEndpoint.replace('{id}', encodeURIComponent(jobId)))
    const job = new MediaJob<Record<string, unknown>>({
      id: jobId, provider: this.id, signal: context.signal, timeoutMs: timeout(request),
      onProgress: status => context.onProgress?.(`${this.id} ${jobId}: ${status.state}`),
      poll: async signal => {
        const status = await this.http.json<Record<string, unknown>>(pollUrl, {
          headers, signal, provider: this.id, secrets: key ? [key] : [], timeoutMs: 30_000,
        })
        const raw = String(getPath(status, asyncConfig.statusPath) ?? '')
        const state = customState(raw, asyncConfig)
        const selected = asyncConfig.resultPath ? getPath(status, asyncConfig.resultPath) : status
        return {
          state,
          ...(state === 'succeeded' ? { result: (selected && typeof selected === 'object' ? selected : status) as Record<string, unknown> } : {}),
        } satisfies JobStatus<Record<string, unknown>>
      },
      ...(asyncConfig.cancelEndpoint ? { cancel: async (signal: AbortSignal) => {
        await this.http.request(this.url(asyncConfig.cancelEndpoint?.replace('{id}', encodeURIComponent(jobId)) ?? ''), {
          method: 'POST', headers, signal, provider: this.id, secrets: key ? [key] : [], timeoutMs: 10_000,
        })
      } } : {}),
    })
    const completed = await job.wait()
    return artifactsOrThrow(this.result(request, completed, kind(request), { jobId, text: textResult(completed) }))
  }

  private model(id: string): CustomModelConfig | undefined { return this.config.models.find(model => model.id === id) }

  private authHeaders(key?: string): Record<string, string> {
    if (this.config.auth === 'none') return {}
    if (!key) throw new MediaError('AUTH', `${this.id} API key is not configured`, { provider: this.id })
    if (this.config.auth === 'x-api-key') return { 'x-api-key': key }
    return { Authorization: `Bearer ${key}` }
  }

  private url(path: string): string {
    if (/^https?:\/\//i.test(path)) return path
    return `${this.config.baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
  }

  private async body(request: MediaRequest, format: 'json' | 'multipart', signal?: AbortSignal): Promise<{ body: BodyInit; contentType?: string }> {
    const sources = [request.inputImage, ...(request.referenceImages ?? [])].filter((value): value is string => Boolean(value))
    if (format === 'multipart') {
      const form = new FormData()
      for (const [key, value] of Object.entries(payloadOptions(request.providerOptions))) form.set(key, typeof value === 'string' ? value : JSON.stringify(value))
      form.set('model', request.model)
      if (request.prompt) form.set('prompt', request.prompt)
      if (request.text) form.set('input', request.text)
      if (request.count) form.set('n', String(request.count))
      if (request.resolution) form.set('size', request.resolution)
      if (request.aspectRatio) form.set('aspect_ratio', request.aspectRatio)
      if (request.background) form.set('background', request.background)
      if (request.outputFormat) form.set('output_format', request.outputFormat)
      if (request.quality) form.set('quality', request.quality)
      if (request.compression !== undefined) form.set('output_compression', String(request.compression))
      for (const source of sources) {
        const file = await this.input.asBlob(source, signal)
        form.append(sources.length > 1 ? 'image[]' : 'image', file.blob, file.fileName)
      }
      if (request.mask) {
        const mask = await this.input.asBlob(request.mask, signal)
        form.set('mask', mask.blob, mask.fileName)
      }
      if (request.inputAudio) {
        const file = await this.input.asBlob(request.inputAudio, signal)
        form.set('file', file.blob, file.fileName)
      }
      if (request.inputVideo) {
        const file = await this.input.asBlob(request.inputVideo, signal)
        form.set('video', file.blob, file.fileName)
      }
      return { body: form }
    }
    const references = await dataUris(this.input, sources, signal)
    const payload = mergeOptions({
      model: request.model,
      ...(request.prompt ? { prompt: request.prompt } : {}),
      ...(request.text ? { input: request.text } : {}),
      ...(references[0] ? { image: references[0] } : {}),
      ...(references.length ? { images: references } : {}),
      ...(request.mask ? { mask: await this.input.asDataUri(request.mask, signal) } : {}),
      ...(request.inputVideo ? { video: await this.input.asDataUri(request.inputVideo, signal) } : {}),
      ...(request.inputAudio ? { audio: await this.input.asDataUri(request.inputAudio, signal) } : {}),
      ...(request.endImage ? { end_image: await this.input.asDataUri(request.endImage, signal) } : {}),
      ...(request.duration ? { duration: request.duration } : {}),
      ...(request.resolution ? { size: request.resolution } : {}),
      ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
      ...(request.seed !== undefined ? { seed: request.seed } : {}),
      ...(request.generateAudio !== undefined ? { generate_audio: request.generateAudio } : {}),
      ...(request.voice ? { voice: request.voice } : {}),
      ...(request.language ? { language: request.language } : {}),
      ...(request.responseFormat ? { response_format: request.responseFormat } : {}),
      ...(request.operation ? { operation: request.operation } : {}),
      ...(request.background ? { background: request.background } : {}),
      ...(request.outputFormat ? { output_format: request.outputFormat } : {}),
      ...(request.quality ? { quality: request.quality } : {}),
      ...(request.compression !== undefined ? { output_compression: request.compression } : {}),
    }, request.providerOptions)
    return { body: JSON.stringify(payload), contentType: 'application/json' }
  }
}

function getPath(value: unknown, path: string): unknown {
  return path.split('.').filter(Boolean).reduce<unknown>((current, key) => current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, value)
}

function customState(raw: string, config: CustomEndpointConfig['async']): JobStatus<never>['state'] {
  const normalized = raw.toLowerCase()
  if (config?.successValues?.some(value => value.toLowerCase() === normalized)) return 'succeeded'
  if (config?.failureValues?.some(value => value.toLowerCase() === normalized)) return 'failed'
  return mapJobState(raw)
}

function kind(request: MediaRequest): 'image' | 'video' | 'audio' | 'text' {
  return request.capability.startsWith('image.') ? 'image' : request.capability.startsWith('video.') ? 'video' : request.capability === 'speech.stt' ? 'text' : 'audio'
}

function textResult(payload: unknown): string | undefined {
  const text = getPath(payload, 'text') ?? getPath(payload, 'data.text')
  return typeof text === 'string' ? text : undefined
}

function timeout(request: MediaRequest): number {
  const value = request.providerOptions?.timeoutMs
  return typeof value === 'number' && value > 0 ? value : 30 * 60_000
}
