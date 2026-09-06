import { MediaError } from '../errors.js'
import { MediaJob, mapJobState } from '../media-job.js'
import { BaseAdapter, artifactsOrThrow, bearerHeaders, dataUris, makeModel, mergeOptions, requirePrompt } from './base.js'
import type { AdapterContext, AdapterResult, Capability, JobStatus, JsonObject, MediaRequest, ModelDescriptor, ModelDiscoveryContext } from '../types.js'

const IMAGE_CAPS: Capability[] = ['image.text_to_image', 'image.image_to_image', 'image.edit', 'image.multi_reference']
const VIDEO_CAPS: Capability[] = ['video.text_to_video', 'video.image_to_video', 'video.reference', 'video.edit', 'video.extend', 'video.native_audio']

export class XAIAdapter extends BaseAdapter {
  readonly id = 'xai'
  readonly displayName = 'xAI / Grok Imagine'
  readonly envKey = 'XAI_API_KEY'
  private readonly baseUrl = 'https://api.x.ai/v1'

  models(): ModelDescriptor[] {
    return [
      makeModel(this.id, 'xai', 'grok-imagine-image-2.0', IMAGE_CAPS),
      makeModel(this.id, 'xai', 'grok-imagine-video-1.5', VIDEO_CAPS.filter(capability => capability !== 'video.edit' && capability !== 'video.extend'), 'T2V/I2V supports 1080p; reference-to-video is capped at 720p'),
      makeModel(this.id, 'xai', 'grok-imagine-video', ['video.edit', 'video.extend'], 'Current official edit/extend examples use this model id'),
    ]
  }

  async discoverModels(context: ModelDiscoveryContext): Promise<ModelDescriptor[]> {
    const key = this.keyFromOptions(context.providerOptions)
    const payload = await this.http.json<{ data?: Array<{ id?: string }> }>(`${this.apiBase(context.providerOptions)}/models`, {
      headers: bearerHeaders(key), signal: context.signal, provider: this.id, secrets: [key], timeoutMs: 30_000,
    })
    return (payload.data ?? []).flatMap(entry => {
      if (!entry.id) return []
      const capabilities = [...IMAGE_CAPS, ...VIDEO_CAPS].filter(capability => this.supports(capability, entry.id as string))
      return capabilities.length ? [makeModel(this.id, 'xai', entry.id, capabilities)] : []
    })
  }

  supports(capability: Capability, model: string): boolean {
    const known = this.models().find(candidate => candidate.id === model)
    if (known) return known.capabilities.includes(capability)
    if (capability.startsWith('image.')) return IMAGE_CAPS.includes(capability) && /^grok-imagine-image(?:-2\.0)?$/.test(model)
    if (capability.startsWith('video.')) {
      if (!/video/i.test(model) || !VIDEO_CAPS.includes(capability)) return false
      if (/video-1\.5$/i.test(model) && ['video.edit', 'video.extend'].includes(capability)) return false
      return true
    }
    return false
  }

  async execute(request: MediaRequest, context: AdapterContext): Promise<AdapterResult> {
    this.assertSupport(request)
    return request.capability.startsWith('image.') ? this.image(request, context) : this.video(request, context)
  }

  private async image(request: MediaRequest, context: AdapterContext): Promise<AdapterResult> {
    if (!Number.isInteger(request.count ?? 1) || (request.count ?? 1) < 1 || (request.count ?? 1) > 10) throw new MediaError('INPUT', 'xAI images support at most 10 outputs', { provider: this.id })
    if (request.mask) throw new MediaError('CAPABILITY_UNSUPPORTED', 'xAI image editing does not expose mask input', { provider: this.id })
    if (request.resolution && !['1k', '2k'].includes(request.resolution.toLowerCase())) throw new MediaError('INPUT', 'xAI image resolution must be 1K or 2K; 4K and explicit dimensions are unsupported', { provider: this.id })
        if (request.quality && (request.model !== 'grok-imagine-image-2.0' || !['low', 'medium', 'auto'].includes(request.quality))) throw new MediaError('INPUT', 'Grok Imagine Image 2.0 quality must be low, medium, or auto', { provider: this.id })
        if (request.background || request.outputFormat || request.compression !== undefined) {
      throw new MediaError('CAPABILITY_UNSUPPORTED', 'xAI does not document these image output controls', { provider: this.id })
    }
    const key = this.key(request)
    const sources = [request.inputImage, ...(request.referenceImages ?? [])].filter((value): value is string => Boolean(value))
    const editing = request.capability !== 'image.text_to_image' || sources.length > 0
    if (editing && !sources.length) throw new MediaError('INPUT', 'xAI image editing requires source images', { provider: this.id })
        const images = await dataUris(this.input, sources, context.signal)
    if (images.length > 5) throw new MediaError('INPUT', 'xAI image editing supports at most 5 source images', { provider: this.id })
    const payload = mergeOptions({
      model: request.model,
      prompt: requirePrompt(request),
      ...(editing ? images.length === 1 ? { image: { url: images[0], type: 'image_url' } } : { images: images.map(url => ({ url, type: 'image_url' })) } : {}),
            ...(request.quality ? { quality: request.quality } : {}),
      ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
      ...(request.resolution ? { resolution: request.resolution.toLowerCase() } : {}),
      ...(request.count ? { n: request.count } : {}),
      response_format: 'url',
    }, request.providerOptions)
    const data = await this.http.json<unknown>(`${this.apiBase(request.providerOptions)}/images/${editing ? 'edits' : 'generations'}`, {
      method: 'POST', headers: bearerHeaders(key, { 'Content-Type': 'application/json' }), body: JSON.stringify(payload),
      signal: context.signal, provider: this.id, secrets: [key], timeoutMs: 180_000,
    })
    return artifactsOrThrow(this.result(request, data, 'image'))
  }

  private apiBase(options?: JsonObject): string {
    return (typeof options?.baseUrl === 'string' ? options.baseUrl : this.baseUrl).replace(/\/+$/, '')
  }

  private async video(request: MediaRequest, context: AdapterContext): Promise<AdapterResult> {
    const key = this.key(request)
    const operation = capabilityOperation(request.capability)
    const path = operation === 'edit' ? 'edits' : operation === 'extend' ? 'extensions' : 'generations'
    const image = request.inputImage ? await this.input.asDataUri(request.inputImage, context.signal) : undefined
    const video = request.inputVideo ? await this.input.asDataUri(request.inputVideo, context.signal) : undefined
    const referenceImages = await dataUris(this.input, request.referenceImages, context.signal)
    if (request.referenceAudios?.length) throw new MediaError('CAPABILITY_UNSUPPORTED', 'xAI public reference audio uses preset voice IDs, not audio files', { provider: this.id })
    const referenceAudioVoices = request.referenceAudioVoices ?? []
    if (referenceAudioVoices.length > 3) throw new MediaError('INPUT', 'xAI reference-to-video supports at most 3 preset voice IDs', { provider: this.id })
    if (request.referenceVideos?.length) throw new MediaError('CAPABILITY_UNSUPPORTED', 'xAI reference-to-video does not document reference video inputs', { provider: this.id })
    if (operation === 'reference' && referenceImages.length > 7) {
      throw new MediaError('INPUT', 'xAI reference-to-video supports at most 7 reference images', { provider: this.id })
    }
    if (operation === 'reference' && image) throw new MediaError('INPUT', 'xAI image-to-video and reference-to-video inputs are mutually exclusive', { provider: this.id })
    if ((operation === 'edit' || operation === 'extend') && (image || referenceImages.length || referenceAudioVoices.length)) {
      throw new MediaError('INPUT', `xAI video ${operation} cannot include frame or reference inputs`, { provider: this.id })
    }
    validateVideoOptions(request, operation)
    if ((operation === 'edit' || operation === 'extend') && !video) {
      throw new MediaError('INPUT', `xAI video ${operation} requires inputVideo`, { provider: this.id })
    }
    const base: JsonObject = {
      model: request.model,
      prompt: requirePrompt(request),
      ...(video ? { video: { url: video } } : {}),
      ...(image ? { image: { url: image } } : {}),
      ...(referenceImages.length ? { reference_images: referenceImages.map(url => ({ url })) } : {}),
      ...(referenceAudioVoices.length ? { reference_audios: referenceAudioVoices.map(voiceId => ({ voice_id: voiceId })) } : {}),
      ...((operation !== 'edit') && request.duration ? { duration: request.duration } : {}),
      ...((operation !== 'edit') && request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
      ...((operation !== 'edit') && request.resolution ? { resolution: request.resolution } : {}),
      ...(request.generateAudio !== undefined ? { generate_audio: request.generateAudio } : {}),
    }
    const submitted = await this.http.json<Record<string, unknown>>(`${this.apiBase(request.providerOptions)}/videos/${path}`, {
      method: 'POST', headers: bearerHeaders(key, { 'Content-Type': 'application/json' }), body: JSON.stringify(mergeOptions(base, request.providerOptions)),
      signal: context.signal, provider: this.id, secrets: [key], timeoutMs: 60_000,
    })
    const requestId = typeof submitted.request_id === 'string' ? submitted.request_id : undefined
    if (!requestId) return artifactsOrThrow(this.result(request, submitted, 'video'))
    const job = new MediaJob<Record<string, unknown>>({
      id: requestId, provider: this.id, signal: context.signal, timeoutMs: timeout(request), minDelayMs: 1_000, maxDelayMs: 8_000,
      onProgress: status => context.onProgress?.(`xAI ${requestId}: ${status.state}`),
      poll: async signal => {
        const status = await this.http.json<Record<string, unknown>>(`${this.apiBase(request.providerOptions)}/videos/${encodeURIComponent(requestId)}`, {
          headers: bearerHeaders(key), signal, provider: this.id, secrets: [key], timeoutMs: 30_000,
        })
        const state = mapJobState(status.status)
        const error = status.error && typeof status.error === 'object'
          ? JSON.stringify(status.error)
          : typeof status.error === 'string' ? status.error : undefined
        return { state, ...(state === 'succeeded' ? { result: status } : {}), ...(error ? { message: error } : {}) } satisfies JobStatus<Record<string, unknown>>
      },
    })
    const completed = await job.wait()
    return artifactsOrThrow(this.result(request, completed, 'video', { jobId: requestId }))
  }
}

function capabilityOperation(capability: Capability): string {
  if (capability === 'video.edit') return 'edit'
  if (capability === 'video.extend') return 'extend'
  if (capability === 'video.reference') return 'reference'
  return 'generate'
}

function validateVideoOptions(request: MediaRequest, operation: string): void {
  const resolution = request.resolution?.toLowerCase()
  if (resolution && !['480p', '720p', '1080p'].includes(resolution)) {
    throw new MediaError('INPUT', 'xAI video resolution must be 480p, 720p, or 1080p', { provider: request.provider })
  }
  if ((operation === 'reference' || operation === 'edit' || operation === 'extend') && resolution === '1080p') {
    throw new MediaError('INPUT', `xAI video ${operation} is limited to 720p`, { provider: request.provider })
  }
  if ((operation === 'edit' || operation === 'extend') && (request.resolution || request.aspectRatio)) {
    throw new MediaError('INPUT', `xAI video ${operation} inherits resolution and aspect ratio from the input`, { provider: request.provider })
  }
  if (operation === 'edit' && request.duration !== undefined) {
    throw new MediaError('INPUT', 'xAI video edit inherits duration from the input', { provider: request.provider })
  }
  if (request.aspectRatio && !['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'].includes(request.aspectRatio)) {
    throw new MediaError('INPUT', 'Unsupported xAI video aspect ratio', { provider: request.provider })
  }
  if (request.duration !== undefined) {
    const [minimum, maximum] = operation === 'extend' ? [2, 10] : [1, 15]
    if (!Number.isInteger(request.duration) || request.duration < minimum || request.duration > maximum) {
      throw new MediaError('INPUT', `xAI video ${operation} duration must be an integer from ${minimum} to ${maximum} seconds`, { provider: request.provider })
    }
  }
}

function timeout(request: MediaRequest): number {
  const value = request.providerOptions?.timeoutMs
  return typeof value === 'number' && value > 0 ? value : 15 * 60_000
}
