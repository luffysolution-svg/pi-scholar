import { MediaError } from '../errors.js'
import { MediaJob, mapJobState } from '../media-job.js'
import { BaseAdapter, artifactsOrThrow, bearerHeaders, dataUris, makeModel, mergeOptions, payloadOptions, requirePrompt } from './base.js'
import type { AdapterContext, AdapterResult, Capability, JobStatus, JsonObject, MediaRequest, ModelDescriptor, ModelDiscoveryContext } from '../types.js'

export class AtlasAdapter extends BaseAdapter {
  readonly id = 'atlas'
  readonly displayName = 'Atlas API (aixoras.com)'
  readonly envKey = 'ATLAS_API_KEY'
  private readonly baseUrl = 'https://api.aixoras.com/v1'

  models(): ModelDescriptor[] {
    return [
      makeModel(this.id, 'openai', 'gpt-image-2-1k', ['image.text_to_image', 'image.image_to_image', 'image.edit'], 'Atlas proxy backend; aspect ratio only, pixel dimensions are not guaranteed'),
            makeModel(this.id, 'openai', 'gpt-image-2-2k', ['image.text_to_image', 'image.image_to_image', 'image.edit'], 'Documented edit example; suffix does not guarantee pixel dimensions'),
      makeModel(this.id, 'bytedance', 'bytedance/seedance-2.0/text-to-video', ['video.text_to_video', 'video.reference', 'video.native_audio']),
      makeModel(this.id, 'bytedance', 'bytedance/seedance-2.0/image-to-video', ['video.image_to_video', 'video.first_last_frame', 'video.reference', 'video.native_audio']),
    ]
  }

  async discoverModels(context: ModelDiscoveryContext): Promise<ModelDescriptor[]> {
    const key = this.keyFromOptions(context.providerOptions)
    const payload = await this.http.json<{ data?: Array<{ id?: string; owned_by?: string }> }>(`${this.apiBase(context.providerOptions)}/models`, {
      headers: bearerHeaders(key), signal: context.signal, provider: this.id, secrets: [key], timeoutMs: 30_000,
    })
    return (payload.data ?? []).flatMap(entry => {
      if (!entry.id) return []
      const capabilities = atlasCapabilities(entry.id, this.models())
      return capabilities.length ? [makeModel(this.id, entry.owned_by ?? 'multi-vendor', entry.id, capabilities)] : []
    })
  }

  supports(capability: Capability, model: string): boolean {
    return atlasCapabilities(model, this.models()).includes(capability)
  }

  async execute(request: MediaRequest, context: AdapterContext): Promise<AdapterResult> {
    this.assertSupport(request)
    if (request.capability.startsWith('video.')) return this.video(request, context)
    validateAtlasImage(request)
    if (request.capability === 'image.text_to_image' && !request.inputImage && !request.referenceImages?.length) return this.imageGenerate(request, context)
    return this.imageEdit(request, context)
  }

  private async imageGenerate(request: MediaRequest, context: AdapterContext): Promise<AdapterResult> {
    const key = this.key(request)
    const asyncMode = request.providerOptions?.async === true
    const safeOptions = payloadOptions(request.providerOptions)
    const nativeExtra = safeOptions.extra_fields && typeof safeOptions.extra_fields === 'object' ? safeOptions.extra_fields as JsonObject : {}
    const { extra_fields: _extraFields, ...nativeOptions } = safeOptions
    const extraFields = { ...nativeExtra, ...(request.seed !== undefined ? { seed: request.seed } : {}) }
    const payload = mergeOptions({
      model: request.model, prompt: requirePrompt(request), n: request.count ?? 1,
      ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
      ...(atlasSize(request) ? { size: atlasSize(request) } : {}),
      response_format: 'url',
      ...(Object.keys(extraFields).length ? { extra_fields: extraFields } : {}),
      ...(request.background ? { background: request.background } : {}),
      ...(request.outputFormat ? { output_format: request.outputFormat } : {}),
      ...(request.quality ? { quality: request.quality } : {}),
      ...(request.compression !== undefined ? { output_compression: request.compression } : {}),
    }, nativeOptions)
    const submitted = await this.http.json<Record<string, unknown>>(`${this.apiBase(request.providerOptions)}/images/generations${asyncMode ? '/async' : ''}`, {
      method: 'POST', headers: bearerHeaders(key, { 'Content-Type': 'application/json' }), body: JSON.stringify(payload),
      signal: context.signal, provider: this.id, secrets: [key], timeoutMs: 120_000,
    })
    return asyncMode ? this.waitImage(request, submitted, context) : artifactsOrThrow(this.result(request, submitted, 'image'))
  }

  private async imageEdit(request: MediaRequest, context: AdapterContext): Promise<AdapterResult> {
    const key = this.key(request)
    const sources = [request.inputImage, ...(request.referenceImages ?? [])].filter((value): value is string => Boolean(value))
    if (!sources.length) throw new MediaError('INPUT', 'Atlas image edit requires inputImage or referenceImages', { provider: this.id })
    if (sources.length > 1) throw new MediaError('CAPABILITY_UNSUPPORTED', 'Atlas documentation defines one image upload for image edits', { provider: this.id })
    if (request.mask) throw new MediaError('CAPABILITY_UNSUPPORTED', 'Atlas image editing does not document a mask upload', { provider: this.id })
    const asyncMode = request.providerOptions?.async === true
    const form = new FormData()
    const safeOptions = payloadOptions(request.providerOptions)
    const nativeExtra = safeOptions.extra_fields && typeof safeOptions.extra_fields === 'object' ? safeOptions.extra_fields as JsonObject : {}
    for (const [name, value] of Object.entries(safeOptions)) {
      if (name !== 'extra_fields') form.set(name, typeof value === 'string' ? value : JSON.stringify(value))
    }
    form.set('model', request.model)
    form.set('prompt', requirePrompt(request))
    form.set('n', String(request.count ?? 1))
    form.set('response_format', 'url')
    if (request.aspectRatio) form.set('aspect_ratio', request.aspectRatio)
    const size = atlasSize(request)
    if (size) form.set('size', size)
    if (request.background) form.set('background', request.background)
    if (request.outputFormat) form.set('output_format', request.outputFormat)
    if (request.quality) form.set('quality', request.quality)
    if (request.compression !== undefined) form.set('output_compression', String(request.compression))
    if (request.seed !== undefined || Object.keys(nativeExtra).length) form.set('extra_fields', JSON.stringify({ ...nativeExtra, ...(request.seed !== undefined ? { seed: request.seed } : {}) }))
    for (const source of sources) {
      const image = await this.input.asBlob(source, context.signal)
      form.append(sources.length === 1 ? 'image' : 'image[]', image.blob, image.fileName)
    }
    const submitted = await this.http.json<Record<string, unknown>>(`${this.apiBase(request.providerOptions)}/images/edits${asyncMode ? '/async' : ''}`, {
      method: 'POST', headers: bearerHeaders(key), body: form, signal: context.signal,
      provider: this.id, secrets: [key], timeoutMs: 120_000,
    })
    return asyncMode ? this.waitImage(request, submitted, context) : artifactsOrThrow(this.result(request, submitted, 'image'))
  }

  private async waitImage(request: MediaRequest, submitted: Record<string, unknown>, context: AdapterContext): Promise<AdapterResult> {
    const key = this.key(request)
    const taskId = stringId(submitted)
    if (!taskId) return artifactsOrThrow(this.result(request, submitted, 'image'))
    const completed = await this.pollTask<Record<string, unknown>>(
      taskId, `${this.apiBase(request.providerOptions)}/images/tasks/${encodeURIComponent(taskId)}`, key, request, context,
    )
    return artifactsOrThrow(this.result(request, completed, 'image', { jobId: taskId }))
  }

  private async video(request: MediaRequest, context: AdapterContext): Promise<AdapterResult> {
    validateAtlasVideo(request)
    const key = this.key(request)
    const inputImage = request.inputImage ? await this.input.asDataUri(request.inputImage, context.signal) : undefined
    const endImage = request.endImage ? await this.input.asDataUri(request.endImage, context.signal) : undefined
    const references = await dataUris(this.input, request.referenceImages, context.signal)
    const referenceVideos = await dataUris(this.input, request.referenceVideos, context.signal)
    const referenceAudios = await dataUris(this.input, request.referenceAudios, context.signal)
    const inputVideo = request.inputVideo ? await this.input.asDataUri(request.inputVideo, context.signal) : undefined
    const images = [...new Set([inputImage, endImage, ...references].filter((value): value is string => Boolean(value)))]
    const metadata: JsonObject = {
      ...((request.providerOptions?.metadata && typeof request.providerOptions.metadata === 'object') ? request.providerOptions.metadata as JsonObject : {}),
      ...(references.length ? { reference_images: references } : {}),
      ...(referenceVideos.length ? { reference_videos: referenceVideos } : {}),
      ...(referenceAudios.length ? { reference_audios: referenceAudios } : {}),
      ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
      ...(request.generateAudio !== undefined ? { generate_audio: request.generateAudio } : {}),
      ...(inputVideo ? { input_video: inputVideo } : {}),
      ...(request.operation ? { operation: request.operation } : {}),
    }
    const { metadata: _metadata, timeoutMs: _timeoutMs, ...nativeOptions } = request.providerOptions ?? {}
    const payload = mergeOptions({
      model: request.model, prompt: requirePrompt(request),
      ...(request.duration ? { duration: request.duration, seconds: String(request.duration) } : {}),
      ...(request.resolution ? { resolution: request.resolution, size: request.resolution } : {}),
      ...(images.length ? { images, image: images[0], input_reference: images[0] } : {}),
      metadata,
    }, nativeOptions)
    const submitted = await this.http.json<Record<string, unknown>>(`${this.apiBase(request.providerOptions)}/video/generations`, {
      method: 'POST', headers: bearerHeaders(key, { 'Content-Type': 'application/json' }), body: JSON.stringify(payload),
      signal: context.signal, provider: this.id, secrets: [key], timeoutMs: 60_000,
    })
    const taskId = stringId(submitted)
    if (!taskId) return artifactsOrThrow(this.result(request, submitted, 'video'))
    const completed = await this.pollTask<Record<string, unknown>>(
      taskId, `${this.apiBase(request.providerOptions)}/video/generations/${encodeURIComponent(taskId)}`, key, request, context,
    )
    return artifactsOrThrow(this.result(request, completed, 'video', { jobId: taskId }))
  }

  private apiBase(options?: JsonObject): string {
    return (typeof options?.baseUrl === 'string' ? options.baseUrl : this.baseUrl).replace(/\/+$/, '')
  }

  private async pollTask<T extends Record<string, unknown>>(taskId: string, url: string, key: string, request: MediaRequest, context: AdapterContext): Promise<T> {
    const job = new MediaJob<T>({
      id: taskId, provider: this.id, signal: context.signal, timeoutMs: timeout(request), minDelayMs: 3_000, maxDelayMs: 5_000,
      onProgress: status => context.onProgress?.(`Atlas ${taskId}: ${status.state}`),
      poll: async signal => {
        const status = await this.http.json<T>(url, {
          headers: bearerHeaders(key), signal, provider: this.id, secrets: [key], timeoutMs: 30_000,
        })
        const state = mapJobState(status.status ?? status.raw_status)
        const message = typeof status.fail_reason === 'string' ? status.fail_reason : undefined
        return { state, ...(state === 'succeeded' ? { result: status } : {}), ...(message ? { message } : {}) } satisfies JobStatus<T>
      },
    })
    return job.wait()
  }
}

function atlasCapabilities(id: string, declared: ModelDescriptor[]): Capability[] {
  const known = declared.find(model => model.id === id)
  if (known) return known.capabilities
  if (/^gpt-image-2(?:-[12]k)?$/i.test(id)) return ['image.text_to_image', 'image.image_to_image', 'image.edit']
  if (/(?:video|veo|seedance|kling|sora)/i.test(id)) return ['video.text_to_video', 'video.image_to_video', 'video.first_last_frame', 'video.reference', 'video.native_audio']
  return []
}

function validateAtlasImage(request: MediaRequest): void {
  if (!Number.isInteger(request.count ?? 1) || (request.count ?? 1) < 1) throw new MediaError('INPUT', 'Atlas image count must be a positive integer', { provider: request.provider })
  if (/^gpt-image-2/i.test(request.model) && request.resolution && !/^\d+x\d+$/i.test(request.resolution)) throw new MediaError('INPUT', 'Atlas GPT Image 2 resolution must be explicit pixels such as 1024x1024; 1K/2K/4K aliases are unsupported', { provider: request.provider })
  if (request.aspectRatio && !['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'].includes(request.aspectRatio)) throw new MediaError('INPUT', 'Unsupported Atlas image aspect ratio', { provider: request.provider })
  if (request.compression !== undefined && (!Number.isInteger(request.compression) || request.compression < 0 || request.compression > 100)) throw new MediaError('INPUT', 'Atlas compression must be 0–100', { provider: request.provider })
  if (request.outputFormat && !['png', 'jpeg', 'jpg', 'webp'].includes(request.outputFormat.toLowerCase())) {
    throw new MediaError('INPUT', 'Atlas image outputFormat must be png, jpeg, jpg, or webp', { provider: request.provider })
  }
  if (request.background === 'transparent' && request.outputFormat && !['png', 'webp'].includes(request.outputFormat.toLowerCase())) {
    throw new MediaError('INPUT', 'Transparent Atlas images require PNG or WebP output', { provider: request.provider })
  }
}

function atlasSize(request: MediaRequest): string | undefined {
  if (/^gpt-image-2/i.test(request.model)) return request.resolution ?? '1024x1024'
  return request.resolution
}

function validateAtlasVideo(request: MediaRequest): void {
  const media = [request.inputImage, request.endImage, request.inputVideo, ...(request.referenceImages ?? []), ...(request.referenceVideos ?? []), ...(request.referenceAudios ?? [])]
    .filter((value): value is string => Boolean(value))
  if (media.some(value => !/^https?:\/\//i.test(value))) {
    throw new MediaError('INPUT', 'Atlas video reference media must use public HTTP(S) URLs; local paths and data URIs are not documented', { provider: request.provider })
  }
  if ((request.referenceImages?.length ?? 0) > 9) throw new MediaError('INPUT', 'Atlas Seedance supports at most 9 reference images', { provider: request.provider })
  if ((request.referenceVideos?.length ?? 0) > 3) throw new MediaError('INPUT', 'Atlas Seedance supports at most 3 reference videos', { provider: request.provider })
  if ((request.referenceAudios?.length ?? 0) > 3) throw new MediaError('INPUT', 'Atlas Seedance supports at most 3 reference audios', { provider: request.provider })
  if (request.aspectRatio && !['16:9', '9:16', '4:3', '3:4', '1:1', '21:9'].includes(request.aspectRatio)) {
    throw new MediaError('INPUT', 'Unsupported Atlas Seedance aspect ratio', { provider: request.provider })
  }
}

function stringId(payload: Record<string, unknown>): string | undefined {
  return typeof payload.task_id === 'string' ? payload.task_id : typeof payload.id === 'string' ? payload.id : undefined
}

function timeout(request: MediaRequest): number {
  const value = request.providerOptions?.timeoutMs
  return typeof value === 'number' && value > 0 ? value : 30 * 60_000
}
