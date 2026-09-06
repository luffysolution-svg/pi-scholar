import type { GoogleAuth as GoogleAuthClient } from 'google-auth-library'
import { fileURLToPath } from 'node:url'
import { MediaError } from '../errors.js'
import { MediaJob } from '../media-job.js'
import { BaseAdapter, artifactsOrThrow, makeModel, payloadOptions } from './base.js'
import { expandHomePath } from '../config.js'
import type { AdapterContext, AdapterResult, Capability, JobStatus, JsonObject, MediaRequest, ModelDescriptor, ModelDiscoveryContext } from '../types.js'
import type { AdapterDependencies } from './base.js'

export class GoogleMediaAdapter extends BaseAdapter {
  readonly displayName: string
  readonly envKey: string | undefined

  constructor(readonly id: 'gemini' | 'vertex', dependencies: AdapterDependencies) {
    super(dependencies)
    this.displayName = id === 'gemini' ? 'Google Gemini API' : 'Google Vertex AI (ADC)'
    this.envKey = id === 'gemini' ? 'GEMINI_API_KEY' : undefined
  }

  models(): ModelDescriptor[] {
    const imageCaps: Capability[] = ['image.text_to_image', 'image.image_to_image', 'image.edit', 'image.multi_reference']
    const veoCaps: Capability[] = ['video.text_to_video', 'video.image_to_video', 'video.first_last_frame', 'video.reference', 'video.extend', 'video.native_audio']
    return [
      makeModel(this.id, 'google', 'gemini-3.1-flash-image', imageCaps),
      makeModel(this.id, 'google', 'gemini-3.1-flash-lite-image', imageCaps),
      makeModel(this.id, 'google', 'gemini-3-pro-image', imageCaps),
      makeModel(this.id, 'google', 'gemini-2.5-flash-image', imageCaps),
      makeModel(this.id, 'google', 'imagen-4.0-generate-001', ['image.text_to_image']),
      ...(this.id === 'vertex' ? [makeModel(this.id, 'google', 'imagen-3.0-capability-001', imageCaps)] : []),
      makeModel(this.id, 'google', this.id === 'gemini' ? 'veo-3.1-generate-preview' : 'veo-3.1-generate-001', veoCaps),
      makeModel(this.id, 'google', this.id === 'gemini' ? 'veo-3.1-fast-generate-preview' : 'veo-3.1-fast-generate-001', veoCaps),
      makeModel(this.id, 'google', 'gemini-2.5-flash-preview-tts', ['speech.tts']),
      makeModel(this.id, 'google', 'gemini-2.5-flash', ['speech.stt']),
      ...(this.id === 'vertex' ? [makeModel(this.id, 'google', 'lyria-002', ['audio.generate'])] : []),
    ]
  }

  async discoverModels(context: ModelDiscoveryContext): Promise<ModelDescriptor[]> {
    return this.id === 'gemini' ? this.discoverGeminiModels(context) : this.discoverVertexModels(context)
  }

  async probeModel(model: ModelDescriptor, _capability: Capability, context: ModelDiscoveryContext): Promise<boolean | undefined> {
    if (/^gemini-/i.test(model.id)) {
      const { url, headers } = await this.requestForModel(model.id, context.providerOptions, 'countTokens')
      await this.http.json<Record<string, unknown>>(url, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'availability check' }] }] }),
        signal: context.signal, provider: this.id, secrets: this.discoverySecrets(context.providerOptions), timeoutMs: 30_000, retries: 0,
      })
      return true
    }
    // Invalid predict requests do not prove image-generation permission or quota.
    return undefined
  }

  supports(capability: Capability, model: string): boolean {
    return googleCapabilities(model, this.models()).includes(capability)
  }

  async execute(request: MediaRequest, context: AdapterContext): Promise<AdapterResult> {
    this.assertSupport(request)
    validateGoogleRequest(request, this.id)
    if (request.capability.startsWith('video.')) return this.longRunning(request, context)
    if (request.capability === 'audio.generate' || (request.capability.startsWith('image.') && /^imagen-/i.test(request.model))) {
      return this.predictMedia(request, context)
    }
    return this.generateContent(request, context)
  }

  private async generateContent(request: MediaRequest, context: AdapterContext): Promise<AdapterResult> {
    const parts: JsonObject[] = []
    if (request.prompt || request.text) parts.push({ text: request.text ?? request.prompt })
    const sources = [request.inputImage, ...(request.referenceImages ?? []), request.inputAudio]
      .filter((value): value is string => Boolean(value))
    for (const source of sources) parts.push({ inlineData: await this.input.asInlineData(source, context.signal) })
    if (request.capability === 'speech.stt' && !request.prompt) parts.unshift({ text: 'Transcribe this audio accurately. Return only the transcript.' })
    const generationConfig: JsonObject = request.capability === 'speech.tts'
      ? {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: request.voice ?? 'Kore' } } },
        }
      : request.capability.startsWith('image.')
        ? {
            responseModalities: ['TEXT', 'IMAGE'],
            ...(request.seed !== undefined ? { seed: request.seed } : {}),
            ...(request.aspectRatio || request.resolution ? { imageConfig: {
              ...(request.aspectRatio ? { aspectRatio: request.aspectRatio } : {}),
              ...((request.resolution && !/^gemini-2\.5-/.test(request.model)) ? { imageSize: request.resolution.toUpperCase() } : {}),
            } } : {}),
          }
        : { responseModalities: ['TEXT'] }
    const native = googleNativeOptions(request.providerOptions)
    const nativeGenerationConfig = native.generationConfig && typeof native.generationConfig === 'object' && !Array.isArray(native.generationConfig)
      ? native.generationConfig as JsonObject
      : {}
    const { generationConfig: _generationConfig, ...nativeRoot } = native
    const body = { ...nativeRoot, contents: [{ role: 'user', parts }], generationConfig: { ...nativeGenerationConfig, ...generationConfig } }
    const { url, headers } = await this.modelRequest(request, "generateContent")
    const payload = await this.http.json<Record<string, unknown>>(url, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      signal: context.signal, provider: this.id, secrets: this.secrets(request), timeoutMs: 180_000,
    })
    const kind = request.capability.startsWith('image.') ? 'image' : request.capability === 'speech.tts' ? 'audio' : 'text'
    const text = findText(payload)
    if (request.capability === 'speech.stt' && !text?.trim()) throw new MediaError('PROVIDER', 'Google transcription returned no text', { provider: this.id })
    const result = bindSameOriginHeaders(this.result(request, payload, kind, { ...(text ? { text } : {}) }), headers, url)
    if (kind === 'image' && !result.artifacts.length) throw new MediaError('PROVIDER', 'Google returned no image; the request may have been filtered or answered with text only', { provider: this.id })
        return request.capability === 'speech.stt' ? result : artifactsOrThrow(result)
  }

  private async predictMedia(request: MediaRequest, context: AdapterContext): Promise<AdapterResult> {
    const kind = request.capability === 'audio.generate' ? 'audio' : 'image'
    const instance: JsonObject = { prompt: request.prompt ?? request.text ?? '' }
    if (kind === 'image') {
      const sources = [request.inputImage, ...(request.referenceImages ?? [])].filter((value): value is string => Boolean(value))
      const referenceImages = await Promise.all(sources.map(async (source, index) => ({
        referenceType: 'REFERENCE_TYPE_RAW',
        referenceId: index + 1,
        referenceImage: await this.googleMedia(source, context.signal),
      })))
      if (request.mask) referenceImages.push({
        referenceType: 'REFERENCE_TYPE_MASK',
        referenceId: referenceImages.length + 1,
        referenceImage: await this.googleMedia(request.mask, context.signal),
      })
      if (referenceImages.length) instance.referenceImages = referenceImages
    }
    const body = request.capability === 'audio.generate'
      ? { instances: [instance], parameters: googleNativeOptions(request.providerOptions) }
      : { instances: [instance], parameters: {
          ...googleNativeOptions(request.providerOptions),
          sampleCount: request.count ?? 1,
          ...(request.aspectRatio ? { aspectRatio: request.aspectRatio } : {}),
          ...(request.resolution ? { sampleImageSize: request.resolution.toUpperCase() } : {}),
          ...(request.seed !== undefined ? { seed: request.seed } : {}),
        } }
    const { url, headers } = await this.modelRequest(request, "predict")
    const payload = await this.http.json<Record<string, unknown>>(url, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      signal: context.signal, provider: this.id, secrets: this.secrets(request), timeoutMs: 180_000,
    })
    return artifactsOrThrow(bindSameOriginHeaders(this.result(request, payload, kind), headers, url))
  }

  private async longRunning(request: MediaRequest, context: AdapterContext): Promise<AdapterResult> {
    const instance: JsonObject = { ...(request.prompt ? { prompt: request.prompt } : {}) }
    if (request.inputImage) instance.image = await this.googleMedia(request.inputImage, context.signal)
    if (request.endImage) instance.lastFrame = await this.googleMedia(request.endImage, context.signal)
    if (request.inputVideo) instance.video = await this.googleMedia(request.inputVideo, context.signal)
    if (request.referenceVideos?.length || request.referenceAudios?.length || request.referenceAudioVoices?.length) {
      throw new MediaError('CAPABILITY_UNSUPPORTED', 'Google Veo does not accept reference video or audio inputs in this API', { provider: this.id })
    }
    if (request.referenceImages?.length) {
      instance.referenceImages = await Promise.all(request.referenceImages.map(async source => ({
        image: await this.googleMedia(source, context.signal), referenceType: 'asset',
      })))
    }
    const parameters: JsonObject = {
      ...(request.aspectRatio ? { aspectRatio: request.aspectRatio } : {}),
      ...(request.resolution ? { resolution: request.resolution } : {}),
      ...(request.duration ? { durationSeconds: request.duration } : {}),
      ...(request.seed !== undefined ? { seed: request.seed } : {}),
      ...(request.generateAudio !== undefined ? { generateAudio: request.generateAudio } : {}),
      ...(request.count ? { sampleCount: request.count } : {}),
    }
    const body = { instances: [instance], parameters: { ...googleNativeOptions(request.providerOptions), ...parameters } }
    const { url, headers, operationsBase } = await this.modelRequest(request, "predictLongRunning")
    const submitted = await this.http.json<Record<string, unknown>>(url, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      signal: context.signal, provider: this.id, secrets: this.secrets(request), timeoutMs: 60_000,
    })
    const name = typeof submitted.name === 'string' ? submitted.name : undefined
    if (!name) return artifactsOrThrow(bindSameOriginHeaders(this.result(request, submitted, request.capability === 'audio.generate' ? 'audio' : 'video'), headers, url))
    const operationUrl = `${operationsBase}/${name.replace(/^\/+/, '')}`
    const vertexPollUrl = url.replace(/:predictLongRunning$/, ':fetchPredictOperation')
    const job = new MediaJob<Record<string, unknown>>({
      id: name, provider: this.id, signal: context.signal, timeoutMs: timeout(request), minDelayMs: 5_000, maxDelayMs: 15_000,
      onProgress: () => context.onProgress?.(`${this.id} operation ${name}: running`),
      poll: async signal => {
        const status = this.id === 'vertex'
          ? await this.http.json<Record<string, unknown>>(vertexPollUrl, {
              method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({ operationName: name }), signal, provider: this.id, secrets: this.secrets(request), timeoutMs: 30_000,
              retries: 2, retryUnsafe: true,
            })
          : await this.http.json<Record<string, unknown>>(operationUrl, {
              headers, signal, provider: this.id, secrets: this.secrets(request), timeoutMs: 30_000,
            })
        if (status.error) return { state: 'failed', message: JSON.stringify(status.error) }
        return status.done === true
          ? { state: 'succeeded', result: status }
          : { state: 'running' }
      },
    })
    const completed = await job.wait()
    return artifactsOrThrow(bindSameOriginHeaders(this.result(request, completed, request.capability === 'audio.generate' ? 'audio' : 'video', { jobId: name }), headers, url))
  }

  private async googleMedia(source: string, signal?: AbortSignal): Promise<JsonObject> {
    const resolved = await this.input.resolve(source, signal)
    if (resolved.kind === 'url') return { uri: resolved.url, mimeType: resolved.mimeType }
    const inline = await this.input.asInlineData(source, signal)
    return this.id === 'gemini'
      ? { inlineData: { data: inline.data, mimeType: inline.mimeType } }
      : { bytesBase64Encoded: inline.data, mimeType: inline.mimeType }
  }

  private async discoverGeminiModels(context: ModelDiscoveryContext): Promise<ModelDescriptor[]> {
    const key = this.keyFromOptions(context.providerOptions)
    const models: ModelDescriptor[] = []
    let pageToken: string | undefined
    do {
      const base = (typeof context.providerOptions?.baseUrl === 'string' ? context.providerOptions.baseUrl : 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '')
      const url = new URL(`${base}/models`)
      url.searchParams.set('pageSize', '1000')
      if (pageToken) url.searchParams.set('pageToken', pageToken)
      const payload = await this.http.json<{ models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>; nextPageToken?: string }>(url.toString(), {
        headers: { 'x-goog-api-key': key }, signal: context.signal, provider: this.id, secrets: [key], timeoutMs: 30_000,
      })
      for (const entry of payload.models ?? []) {
        const id = entry.name?.replace(/^models\//, '')
        if (!id) continue
        const capabilities = googleCapabilities(id, this.models())
        if (capabilities.length) models.push({ ...makeModel(this.id, 'google', id, capabilities), availability: 'available' })
      }
      pageToken = payload.nextPageToken
    } while (pageToken)
    return uniqueModels(models)
  }

  private async discoverVertexModels(context: ModelDiscoveryContext): Promise<ModelDescriptor[]> {
    const { auth, location } = await this.vertexSettings(context.providerOptions)
    const models: ModelDescriptor[] = []
    let pageToken: string | undefined
    do {
      const url = new URL(`${vertexApiOrigin(location)}/v1beta1/publishers/google/models`)
      url.searchParams.set('pageSize', '100')
      url.searchParams.set('listAllVersions', 'true')
      if (pageToken) url.searchParams.set('pageToken', pageToken)
      const authHeaders = await auth.getRequestHeaders(url.toString())
      const headers: Record<string, string> = {}
      for (const [key, value] of authHeaders.entries()) headers[key] = value
      const payload = await this.http.json<{ publisherModels?: Array<{ name?: string; launchStage?: string }>; nextPageToken?: string }>(url.toString(), {
        headers, signal: context.signal, provider: this.id, timeoutMs: 30_000,
      })
      for (const entry of payload.publisherModels ?? []) {
        const id = entry.name?.split('/').pop()
        if (!id) continue
        const capabilities = googleCapabilities(id, this.models())
        if (capabilities.length) models.push({
          ...makeModel(this.id, 'google', id, capabilities, entry.launchStage ? `Vertex Model Garden: ${entry.launchStage}` : undefined),
          availability: 'unknown',
        })
      }
      pageToken = payload.nextPageToken
    } while (pageToken)
    return uniqueModels(models)
  }

  private async modelRequest(request: MediaRequest, method: string): Promise<{ url: string; headers: Record<string, string>; operationsBase: string }> {
    return this.requestForModel(request.model, request.providerOptions, method)
  }

  private async requestForModel(model: string, options: JsonObject | undefined, method: string): Promise<{ url: string; headers: Record<string, string>; operationsBase: string }> {
    if (this.id === 'gemini') {
      const key = this.keyFromOptions(options)
      const base = (typeof options?.baseUrl === 'string' ? options.baseUrl : 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '')
      return { url: `${base}/models/${encodeURIComponent(model)}:${method}`, headers: { 'x-goog-api-key': key }, operationsBase: base }
    }
    const { auth, project, location } = await this.vertexSettings(options)
    const base = `${vertexApiOrigin(location)}/v1`
    const resource = `projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}`
    const url = `${base}/${resource}:${method}`
    const authHeaders = await auth.getRequestHeaders(url)
    const headers: Record<string, string> = {}
    for (const [key, value] of authHeaders.entries()) headers[key] = value
    return { url, headers, operationsBase: base }
  }

  private async vertexSettings(options?: JsonObject): Promise<{ auth: GoogleAuthClient; project: string; location: string }> {
    const configuredFile = typeof options?.credentialsFile === 'string' ? options.credentialsFile : undefined
    const rawKeyFilename = configuredFile ?? this.env.VERTEX_CREDENTIALS_FILE ?? this.env.GOOGLE_APPLICATION_CREDENTIALS
    const expandedKeyFile = expandHomePath(rawKeyFilename)
    const keyFilename = expandedKeyFile?.startsWith('file://') ? fileURLToPath(expandedKeyFile) : expandedKeyFile
    const { GoogleAuth } = await import('google-auth-library')
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      ...(keyFilename ? { keyFilename } : {}),
    })
    const configuredProject = typeof options?.project === 'string' && !isProjectPlaceholder(options.project) ? options.project : undefined
    const project = configuredProject ?? this.env.GOOGLE_CLOUD_PROJECT ?? this.env.GCLOUD_PROJECT ?? await auth.getProjectId()
    const configuredLocation = typeof options?.location === 'string' ? options.location : undefined
    const location = configuredLocation ?? this.env.GOOGLE_CLOUD_LOCATION ?? 'us-central1'
    if (!project) throw new MediaError('CONFIG', 'Vertex AI requires a project id from providerOptions.vertex.project, environment, ADC, or the credentials JSON', { provider: this.id })
    return { auth, project, location }
  }

  private discoverySecrets(options?: JsonObject): string[] {
    const configKey = typeof options?.apiKey === 'string' ? options.apiKey : undefined
    const envKey = this.envKey && this.env[this.envKey] ? this.env[this.envKey] as string : undefined
    return [configKey, envKey].filter((val): val is string => Boolean(val))
  }

  private secrets(request: MediaRequest): string[] {
    const configKey = typeof request.providerOptions?.apiKey === 'string' ? request.providerOptions.apiKey : undefined
    const envKey = this.envKey && this.env[this.envKey] ? this.env[this.envKey] as string : undefined
    return [configKey, envKey].filter((val): val is string => Boolean(val))
  }
}

export function vertexApiOrigin(location: string): string {
  if (!/^(?:global|[a-z]+(?:-[a-z0-9]+)+[0-9])$/.test(location)) {
    throw new MediaError('CONFIG', 'Vertex location must be global or a valid Google Cloud region such as us-central1', { provider: 'vertex' })
  }
  return location === 'global' ? 'https://aiplatform.googleapis.com' : `https://${location}-aiplatform.googleapis.com`
}

function googleCapabilities(id: string, declared: ModelDescriptor[]): Capability[] {
  const known = declared.find(model => model.id === id)
  if (known) return known.capabilities
  if (/^imagen-.*(?:capability|customization)/i.test(id)) return ['image.text_to_image', 'image.image_to_image', 'image.edit', 'image.multi_reference']
  if (/^imagen-/i.test(id)) return ['image.text_to_image']
  if (/^gemini-.*image(?:-|$)/i.test(id)) return ['image.text_to_image', 'image.image_to_image', 'image.edit', 'image.multi_reference']
  if (/^veo-3\.1/i.test(id)) return ['video.text_to_video', 'video.image_to_video', 'video.first_last_frame', 'video.reference', 'video.extend', 'video.native_audio']
  if (/^veo-/i.test(id)) return ['video.text_to_video', 'video.image_to_video', 'video.native_audio']
  if (/^lyria-/i.test(id)) return ['audio.generate']
  if (/tts/i.test(id)) return ['speech.tts']
  if (/transcri|speech-to-text/i.test(id)) return ['speech.stt']
  return []
}

function uniqueModels(models: ModelDescriptor[]): ModelDescriptor[] {
  return [...new Map(models.map(model => [model.id, model])).values()]
}

function isProjectPlaceholder(value: string): boolean {
  return /^(?:my-gcp-project|your[-_ ]?(?:gcp[-_ ])?project(?:[-_ ]?id)?|<.*>)$/i.test(value.trim())
}

function findText(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const candidates = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates
  const values = candidates?.flatMap(candidate => candidate.content?.parts?.map(part => part.text).filter((text): text is string => Boolean(text)) ?? []) ?? []
  return values.length ? values.join('\n') : undefined
}

function googleNativeOptions(options?: JsonObject): JsonObject {
  const safe = payloadOptions(options)
  const {
    project: _project,
    location: _location,
    ...native
  } = safe
  return native
}

function validateGoogleRequest(request: MediaRequest, provider: string): void {
  if (request.capability.startsWith('image.')) {
    if (!request.prompt?.trim()) throw new MediaError('INPUT', 'Google image requests require prompt', { provider })
    const count = request.count ?? 1
    if (!Number.isInteger(count) || count < 1) throw new MediaError('INPUT', 'Image count must be a positive integer', { provider })
    const sources = (request.inputImage ? 1 : 0) + (request.referenceImages?.length ?? 0)
    if (request.capability !== 'image.text_to_image' && !sources) throw new MediaError('INPUT', 'Image editing requires source images', { provider })
    if (/^imagen-/.test(request.model) && !/capability|customization/.test(request.model) && sources) throw new MediaError('CAPABILITY_UNSUPPORTED', 'This Imagen model is text-to-image only', { provider })
    if (/^gemini-3/.test(request.model) && sources > 14) throw new MediaError('INPUT', 'Gemini 3 image models accept at most 14 reference images', { provider })
    const sizes = /^gemini-2\.5-/.test(request.model) ? ['1K'] : /^imagen-/.test(request.model) ? ['1K', '2K'] : ['1K', '2K', '4K']
    if (request.resolution && !sizes.includes(request.resolution.toUpperCase())) throw new MediaError('INPUT', `${request.model} resolution must be ${sizes.join(', ')}`, { provider })
    if (/^gemini-/i.test(request.model) && (request.count ?? 1) !== 1) {
      throw new MediaError('INPUT', 'Gemini native image generation returns one image per request', { provider })
    }
    if (/^imagen-/i.test(request.model) && (request.count ?? 1) > 4) {
      throw new MediaError('INPUT', 'Imagen supports at most 4 images per request', { provider })
    }
    if (request.background || request.outputFormat || request.quality || request.compression !== undefined) {
      throw new MediaError('CAPABILITY_UNSUPPORTED', 'Google image output background/format/quality controls are not exposed by this adapter', { provider })
    }
    if (request.mask && !/^imagen-.*(?:capability|customization)/i.test(request.model)) {
      throw new MediaError('CAPABILITY_UNSUPPORTED', `${request.model} does not expose mask editing through this adapter`, { provider })
    }
  }
  if (request.capability.startsWith('video.')) {
    if ((request.count ?? 1) > 4) throw new MediaError('INPUT', 'Veo supports at most 4 videos per request', { provider })
    if (request.referenceImages?.length && (request.inputImage || request.endImage)) {
      throw new MediaError('INPUT', 'Veo reference-image and first/last-frame modes are mutually exclusive', { provider })
    }
    if ((request.referenceImages?.length ?? 0) > 3) throw new MediaError('INPUT', 'Veo supports at most 3 reference images', { provider })
    if (request.duration !== undefined && ![4, 6, 8].includes(request.duration)) {
      throw new MediaError('INPUT', 'Veo duration must be 4, 6, or 8 seconds', { provider })
    }
    if (request.resolution && !['720p', '1080p', '4k'].includes(request.resolution.toLowerCase())) {
      throw new MediaError('INPUT', 'Veo resolution must be 720p, 1080p, or 4k', { provider })
    }
  }
  if (request.capability === 'speech.tts' && request.responseFormat && request.responseFormat.toLowerCase() !== 'pcm') {
    throw new MediaError('INPUT', 'Gemini TTS returns raw PCM audio; responseFormat must be pcm', { provider })
  }
}

function bindSameOriginHeaders(result: AdapterResult, headers: Record<string, string>, requestUrl: string): AdapterResult {
  const origin = new URL(requestUrl).origin
  result.artifacts = result.artifacts.map(artifact => artifact.url && new URL(artifact.url).origin === origin
    ? { ...artifact, headers, headerOrigin: origin }
    : artifact)
  return result
}

function timeout(request: MediaRequest): number {
  const value = request.providerOptions?.timeoutMs
  return typeof value === 'number' && value > 0 ? value : 40 * 60_000
}
