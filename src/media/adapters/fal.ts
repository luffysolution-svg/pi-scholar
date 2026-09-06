import { MediaError } from '../errors.js'
import { MediaJob, mapJobState } from '../media-job.js'
import { BaseAdapter, artifactsOrThrow, extractText, makeModel, mergeOptions } from './base.js'
import type { AdapterContext, AdapterResult, Capability, JobStatus, JsonObject, MediaRequest, ModelDescriptor } from '../types.js'
import { requestPublic } from '../url-policy.js'

interface FalSubmit { request_id?: string; status_url?: string; response_url?: string; cancel_url?: string; status?: string }

export class FalAdapter extends BaseAdapter {
  readonly id = 'fal'
  readonly displayName = 'fal.ai'
  readonly envKey = 'FAL_KEY'

  models(): ModelDescriptor[] {
    return [
      makeModel(this.id, 'google', 'fal-ai/nano-banana-2', ['image.text_to_image']),
      makeModel(this.id, 'google', 'fal-ai/nano-banana-2/edit', ['image.image_to_image', 'image.edit', 'image.multi_reference']),
    ]
  }

  supports(capability: Capability, model: string): boolean {
    const known = this.models().find(entry => entry.id === model)
    return known ? known.capabilities.includes(capability) : false
  }

  async execute(request: MediaRequest, context: AdapterContext): Promise<AdapterResult> {
    this.assertSupport(request)
    if (!request.prompt?.trim()) throw new MediaError('INPUT', 'fal image generation requires prompt', { provider: this.id })
    const sources = (request.inputImage ? 1 : 0) + (request.referenceImages?.length ?? 0)
    if (request.model.endsWith('/edit') ? sources < 1 || sources > 14 : sources > 0) throw new MediaError('INPUT', 'Use the fal /edit endpoint with 1–14 source images', { provider: this.id })
    if (!Number.isInteger(request.count ?? 1) || (request.count ?? 1) < 1) throw new MediaError('INPUT', 'fal image count must be a positive integer', { provider: this.id })
    if (request.resolution && !['0.5K', '1K', '2K', '4K'].includes(request.resolution.toUpperCase())) throw new MediaError('INPUT', 'fal Nano Banana resolution must be 0.5K, 1K, 2K, or 4K', { provider: this.id })
    if (request.mask || request.background || request.quality || request.compression !== undefined) throw new MediaError('CAPABILITY_UNSUPPORTED', 'fal Nano Banana does not expose mask/background/quality/compression controls', { provider: this.id })
    if (request.outputFormat && !['png', 'jpeg', 'webp'].includes(request.outputFormat)) throw new MediaError('INPUT', 'fal outputFormat must be png, jpeg, or webp', { provider: this.id })
    const key = this.key(request)
    const payload = await this.payload(request, key, context.signal)
    const endpoint = `https://queue.fal.run/${request.model.replace(/^\/+/, '')}`
    const submitted = await this.http.json<FalSubmit>(endpoint, {
      method: 'POST', headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      signal: context.signal, provider: this.id, secrets: [key], timeoutMs: 60_000,
    })
    if (!submitted.request_id && !submitted.response_url) {
      return artifactsOrThrow(this.result(request, submitted, this.kind(request), {
        ...(request.capability === 'speech.stt' ? { text: extractText(submitted) } : {}),
      }))
    }
    const requestId = submitted.request_id ?? 'fal-job'
    const statusUrl = trustedQueueUrl(submitted.status_url ?? `${endpoint}/requests/${encodeURIComponent(requestId)}/status`, endpoint)
    const responseUrl = trustedQueueUrl(submitted.response_url ?? `${endpoint}/requests/${encodeURIComponent(requestId)}`, endpoint)
    const cancelUrl = trustedQueueUrl(submitted.cancel_url ?? `${endpoint}/requests/${encodeURIComponent(requestId)}/cancel`, endpoint)

    const job = new MediaJob<unknown>({
      id: requestId,
      provider: this.id,
      signal: context.signal,
      timeoutMs: this.timeout(request),
      minDelayMs: 800,
      maxDelayMs: 5_000,
      onProgress: status => context.onProgress?.(`fal ${requestId}: ${status.state}`),
      poll: async signal => {
        const status = await this.http.json<Record<string, unknown>>(statusUrl, {
          headers: { Authorization: `Key ${key}` }, signal, provider: this.id, secrets: [key], timeoutMs: 30_000,
        })
        const state = mapJobState(status.status)
        if (state === 'succeeded') {
          const result = await this.http.json<unknown>(responseUrl, {
            headers: { Authorization: `Key ${key}` }, signal, provider: this.id, secrets: [key], timeoutMs: 60_000,
          })
          return { state, result } satisfies JobStatus<unknown>
        }
        return { state, ...(typeof status.error === 'string' ? { message: status.error } : {}) } satisfies JobStatus<unknown>
      },
      cancel: async signal => {
        await this.http.request(cancelUrl, {
          method: 'PUT', headers: { Authorization: `Key ${key}` }, signal, provider: this.id, secrets: [key], timeoutMs: 10_000,
        })
      },
    })
    const data = await job.wait()
    return artifactsOrThrow(this.result(request, data, this.kind(request), {
      jobId: requestId,
      ...(request.capability === 'speech.stt' ? { text: extractText(data) } : {}),
    }))
  }

  private async payload(request: MediaRequest, key: string, signal?: AbortSignal): Promise<JsonObject> {
    const resolveMany = async (sources: readonly string[] | undefined) => Promise.all((sources ?? []).map(source => this.asFalUrl(source, key, signal)))
    const refs = await resolveMany(request.referenceImages)
    const videos = await resolveMany(request.referenceVideos)
    const audios = await resolveMany(request.referenceAudios)
    const imageUrl = request.inputImage ? await this.asFalUrl(request.inputImage, key, signal) : undefined
    const endImageUrl = request.endImage ? await this.asFalUrl(request.endImage, key, signal) : undefined
    const videoUrl = request.inputVideo ? await this.asFalUrl(request.inputVideo, key, signal) : undefined
    const audioUrl = request.inputAudio ? await this.asFalUrl(request.inputAudio, key, signal) : undefined
    return mergeOptions({
      ...(request.prompt ? { prompt: request.prompt } : {}),
      ...(request.text ? { text: request.text } : {}),
      ...((imageUrl || refs.length) ? { image_urls: [...(imageUrl ? [imageUrl] : []), ...refs] } : {}),
      ...(endImageUrl ? { end_image_url: endImageUrl } : {}),

      ...(videos.length ? { reference_video_urls: videos } : {}),
      ...(audios.length ? { reference_audio_urls: audios } : {}),
      ...(videoUrl ? { video_url: videoUrl } : {}),
      ...(audioUrl ? { audio_url: audioUrl } : {}),
      ...(request.duration ? { duration: request.duration } : {}),
      ...(request.resolution ? { resolution: request.resolution.toUpperCase() } : {}),
      ...(request.count ? { num_images: request.count } : {}),
      ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
      ...(request.seed !== undefined ? { seed: request.seed } : {}),
      ...(request.generateAudio !== undefined ? { generate_audio: request.generateAudio } : {}),
      ...(request.voice ? { voice: request.voice } : {}),
      ...(request.language ? { language: request.language } : {}),
      ...(request.responseFormat ? { output_format: request.responseFormat } : {}),
      ...(request.operation ? { operation: request.operation } : {}),
      ...(request.background ? { background: request.background } : {}),
      ...(request.outputFormat ? { output_format: request.outputFormat } : {}),
      ...(request.quality ? { quality: request.quality } : {}),
      ...(request.compression !== undefined ? { compression: request.compression } : {}),
      ...(request.referenceAudioVoices?.length ? { reference_audio_voices: request.referenceAudioVoices } : {}),
    }, request.providerOptions)
  }

  private async asFalUrl(source: string, key: string, signal?: AbortSignal): Promise<string> {
    const resolved = await this.input.resolve(source, signal)
    if (resolved.kind === 'url') return resolved.url ?? source
    const file = await this.input.asBlob(source, signal)
    const upload = await this.http.json<{ upload_url?: string; file_url?: string }>('https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3', {
      method: 'POST', headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_type: file.mimeType, file_name: file.fileName, file_size: file.blob.size }),
      signal, provider: this.id, secrets: [key], timeoutMs: 30_000,
    })
    if (!upload.upload_url || !upload.file_url) throw new Error('fal CDN upload initiation returned no upload_url/file_url')
    await requestPublic(this.http, upload.upload_url, {
      method: 'PUT', headers: { 'Content-Type': file.mimeType }, body: file.blob, signal,
      provider: this.id, timeoutMs: 120_000,
    })
    return upload.file_url
  }

  private kind(request: MediaRequest): 'image' | 'video' | 'audio' | 'text' {
    if (request.capability.startsWith('image.')) return 'image'
    if (request.capability.startsWith('video.')) return 'video'
    if (request.capability === 'speech.stt') return 'text'
    return 'audio'
  }

  private timeout(request: MediaRequest): number {
    const value = request.providerOptions?.timeoutMs
    return typeof value === 'number' && value > 0 ? value : 30 * 60_000
  }
}

function trustedQueueUrl(value: string, endpoint: string): string {
  const url = new URL(value)
  if (url.origin !== new URL(endpoint).origin) {
    throw new MediaError('PROVIDER', `fal returned an untrusted authenticated job URL: ${url.origin}`, { provider: 'fal' })
  }
  return url.toString()
}
