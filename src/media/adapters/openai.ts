import { MediaError } from '../errors.js'
import { BaseAdapter, artifactsOrThrow, bearerHeaders, makeModel, mergeOptions, payloadOptions, requirePrompt } from './base.js'
import type { AdapterContext, AdapterResult, Capability, MediaRequest, ModelDescriptor, ModelDiscoveryContext } from '../types.js'

const IMAGE_CAPS: Capability[] = ['image.text_to_image', 'image.image_to_image', 'image.edit', 'image.multi_reference']
const SPEECH_CAPS: Capability[] = ['speech.tts', 'speech.stt']

export class OpenAIAdapter extends BaseAdapter {
  readonly id = 'openai'
  readonly displayName = 'OpenAI API'
  readonly envKey = 'OPENAI_API_KEY'
  private readonly baseUrl = 'https://api.openai.com/v1'

  models(): ModelDescriptor[] {
    return [
      makeModel(this.id, 'openai', 'gpt-image-2', IMAGE_CAPS),
      makeModel(this.id, 'openai', 'gpt-image-1.5', IMAGE_CAPS),
      makeModel(this.id, 'openai', 'gpt-image-1', IMAGE_CAPS),
            makeModel(this.id, 'openai', 'gpt-image-1-mini', IMAGE_CAPS),
      makeModel(this.id, 'openai', 'gpt-4o-mini-tts', ['speech.tts']),
      makeModel(this.id, 'openai', 'gpt-4o-transcribe', ['speech.stt']),
      makeModel(this.id, 'openai', 'gpt-4o-mini-transcribe', ['speech.stt']),
      makeModel(this.id, 'openai', 'whisper-1', ['speech.stt']),
    ]
  }

  async discoverModels(context: ModelDiscoveryContext): Promise<ModelDescriptor[]> {
    const key = this.keyFromOptions(context.providerOptions)
    const payload = await this.http.json<{ data?: Array<{ id?: string }> }>(`${this.apiBase(context.providerOptions)}/models`, {
      headers: bearerHeaders(key), signal: context.signal, provider: this.id, secrets: [key], timeoutMs: 30_000,
    })
    return (payload.data ?? []).flatMap(entry => {
      if (!entry.id) return []
      const capabilities = [...IMAGE_CAPS, ...SPEECH_CAPS].filter(capability => this.supports(capability, entry.id as string))
      return capabilities.length ? [makeModel(this.id, 'openai', entry.id, capabilities)] : []
    })
  }

  supports(capability: Capability, model: string): boolean {
    if (capability.startsWith('video.') || capability === 'audio.generate') return false
    if (capability.startsWith('image.')) {
      if (/^dall-e-3$/i.test(model)) return capability === 'image.text_to_image'
      if (/^dall-e-2$/i.test(model)) return ['image.text_to_image', 'image.image_to_image', 'image.edit'].includes(capability)
      return IMAGE_CAPS.includes(capability) && /^gpt-image-(?:1(?:\.5|-mini)?|2)(?:-\d{4}-\d{2}-\d{2})?$/i.test(model)
    }
    if (capability === 'speech.tts') return /tts/i.test(model)
    if (capability === 'speech.stt') return /(?:transcribe|whisper)/i.test(model)
    return false
  }

  async execute(request: MediaRequest, context: AdapterContext): Promise<AdapterResult> {
    this.assertSupport(request)
    if (request.capability === 'speech.tts') return this.tts(request, context)
    if (request.capability === 'speech.stt') return this.stt(request, context)
    if (request.capability === 'image.text_to_image' && !request.inputImage && !request.referenceImages?.length) return this.generateImage(request, context)
    return this.editImage(request, context)
  }

  private async generateImage(request: MediaRequest, context: AdapterContext): Promise<AdapterResult> {
    validateImageRequest(request)
    if (request.mask) throw new MediaError('INPUT', 'OpenAI mask requires source images', { provider: this.id })
    const key = this.key(request)
    const payload = mergeOptions(imagePayload(request), request.providerOptions)
    const data = await this.http.json<unknown>(`${this.apiBase(request.providerOptions)}/images/generations`, {
      method: 'POST', headers: bearerHeaders(key, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload), signal: context.signal, provider: this.id, secrets: [key], timeoutMs: 120_000,
    })
    return artifactsOrThrow(this.result(request, data, 'image'))
  }

  private async editImage(request: MediaRequest, context: AdapterContext): Promise<AdapterResult> {
    if (!this.supports('image.edit', request.model)) throw new MediaError('CAPABILITY_UNSUPPORTED', 'This OpenAI model cannot edit source images', { provider: this.id })
    validateImageRequest(request)
    const key = this.key(request)
    const sources = [request.inputImage, ...(request.referenceImages ?? [])].filter((value): value is string => Boolean(value))
    if (sources.length === 0) throw new MediaError('INPUT', 'OpenAI image edit requires inputImage or referenceImages', { provider: this.id })
    if (sources.length > 16) throw new MediaError('INPUT', 'OpenAI GPT Image editing supports at most 16 source images', { provider: this.id })
    if (/^dall-e-2$/i.test(request.model) && sources.length !== 1) throw new MediaError('INPUT', 'DALL-E 2 editing requires exactly one input image', { provider: this.id })
    if (/^dall-e-2$/i.test(request.model)) {
          const form = new FormData()
          for (const [name, value] of Object.entries(mergeOptions(imagePayload(request), request.providerOptions))) form.set(name, typeof value === 'string' ? value : JSON.stringify(value))
          const image = await this.input.asBlob(sources[0]!, context.signal)
          form.set('image', image.blob, image.fileName)
          if (request.mask) {
            const mask = await this.input.asBlob(request.mask, context.signal)
            form.set('mask', mask.blob, mask.fileName)
          }
          const data = await this.http.json<unknown>(`${this.apiBase(request.providerOptions)}/images/edits`, { method: 'POST', headers: bearerHeaders(key), body: form, signal: context.signal, provider: this.id, secrets: [key], timeoutMs: 120_000 })
          return artifactsOrThrow(this.result(request, data, 'image'))
        }
        const images = await Promise.all(sources.map(async source => ({ image_url: await this.input.asDataUri(source, context.signal) })))
    const mask = request.mask ? { image_url: await this.input.asDataUri(request.mask, context.signal) } : undefined
    const payload = mergeOptions({ ...imagePayload(request), images, ...(mask ? { mask } : {}) }, request.providerOptions)
    const data = await this.http.json<unknown>(`${this.apiBase(request.providerOptions)}/images/edits`, {
      method: 'POST', headers: bearerHeaders(key, { 'Content-Type': 'application/json' }), body: JSON.stringify(payload), signal: context.signal,
      provider: this.id, secrets: [key], timeoutMs: 120_000,
    })
    return artifactsOrThrow(this.result(request, data, 'image'))
  }

  private apiBase(options?: Record<string, unknown>): string {
    return (typeof options?.baseUrl === 'string' ? options.baseUrl : this.baseUrl).replace(/\/+$/, '')
  }

  private async tts(request: MediaRequest, context: AdapterContext): Promise<AdapterResult> {
    const key = this.key(request)
    const text = request.text ?? request.prompt ?? ''
    if (!text.trim()) throw new MediaError('INPUT', 'OpenAI TTS requires text', { provider: this.id })
    const format = (request.responseFormat ?? 'mp3').toLowerCase()
    if (!['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'].includes(format)) throw new MediaError('INPUT', 'Unsupported OpenAI TTS response format', { provider: this.id })
    const payload = mergeOptions({
      model: request.model,
      input: text,
      voice: request.voice ?? 'alloy',
      response_format: format,
    }, request.providerOptions)
    const response = await this.http.request(`${this.apiBase(request.providerOptions)}/audio/speech`, {
      method: 'POST', headers: bearerHeaders(key, { 'Content-Type': 'application/json' }), body: JSON.stringify(payload),
      signal: context.signal, provider: this.id, secrets: [key], timeoutMs: 120_000,
    })
    if (!response.body) throw new MediaError('PROVIDER', 'OpenAI TTS returned an empty response body', { provider: this.id })
    return {
      provider: this.id, model: request.model, capability: request.capability,
      artifacts: [{ kind: 'audio', stream: response.body, mimeType: response.headers.get('content-type') ?? `audio/${format}`, fileName: `speech.${format}` }],
    }
  }

  private async stt(request: MediaRequest, context: AdapterContext): Promise<AdapterResult> {
    if (!request.inputAudio) throw new MediaError('INPUT', 'OpenAI transcription requires inputAudio', { provider: this.id })
    const key = this.key(request)
    const audio = await this.input.asBlob(request.inputAudio, context.signal)
    const form = new FormData()
    for (const [name, value] of Object.entries(payloadOptions(request.providerOptions))) {
      form.set(name, typeof value === 'string' ? value : JSON.stringify(value))
    }
    form.set('file', audio.blob, audio.fileName)
    form.set('model', request.model)
    if (request.language) form.set('language', request.language)
    if (request.responseFormat) form.set('response_format', request.responseFormat)
    const format = (request.responseFormat ?? 'json').toLowerCase()
    if (!/^whisper-1$/i.test(request.model) && format !== 'json') {
      throw new MediaError('INPUT', `${request.model} transcription supports JSON output only`, { provider: this.id })
    }
    const options = {
      method: 'POST', headers: bearerHeaders(key), body: form, signal: context.signal,
      provider: this.id, secrets: [key], timeoutMs: 120_000,
    }
    const text = ['text', 'srt', 'vtt'].includes(format)
      ? await this.http.text(`${this.apiBase(request.providerOptions)}/audio/transcriptions`, options)
      : (await this.http.json<{ text?: string }>(`${this.apiBase(request.providerOptions)}/audio/transcriptions`, options)).text
    if (!text?.trim()) throw new MediaError('PROVIDER', 'OpenAI transcription returned no text', { provider: this.id })
    return this.result(request, {}, 'text', { text })
  }
}

function imagePayload(request: MediaRequest): Record<string, unknown> {
  return {
    model: request.model,
    prompt: requirePrompt(request),
    n: request.count ?? 1,
    ...(request.resolution ? { size: request.resolution } : {}),
    ...(request.background ? { background: request.background } : {}),
    ...(request.outputFormat ? { output_format: request.outputFormat } : {}),
    ...(request.quality ? { quality: request.quality } : {}),
    ...(request.compression !== undefined ? { output_compression: request.compression } : {}),
  }
}

function validateImageRequest(request: MediaRequest): void {
  const count = request.count ?? 1
  if (!Number.isInteger(count) || count < 1 || count > 10 || (/^dall-e-3$/i.test(request.model) && count !== 1)) {
    throw new MediaError('INPUT', `${request.model} does not support image count ${count}`, { provider: request.provider })
  }
  if (request.aspectRatio) throw new MediaError('INPUT', 'OpenAI images require resolution rather than aspectRatio', { provider: request.provider })
  if (/^dall-e/i.test(request.model) && (request.background || request.outputFormat || request.compression !== undefined)) {
    throw new MediaError('CAPABILITY_UNSUPPORTED', 'DALL-E does not support GPT Image background/output controls', { provider: request.provider })
  }
  if (request.outputFormat && !['png', 'jpeg', 'webp'].includes(request.outputFormat.toLowerCase())) {
    throw new MediaError('INPUT', 'OpenAI image outputFormat must be png, jpeg, or webp', { provider: request.provider })
  }
  if (request.compression !== undefined && (!Number.isInteger(request.compression) || request.compression < 0 || request.compression > 100)) {
    throw new MediaError('INPUT', 'OpenAI output compression must be an integer from 0 to 100', { provider: request.provider })
  }
  if (request.compression !== undefined && (!request.outputFormat || !['jpeg', 'webp'].includes(request.outputFormat.toLowerCase()))) {
    throw new MediaError('INPUT', 'OpenAI output compression requires explicit JPEG or WebP outputFormat', { provider: request.provider })
  }
  if (request.background === 'transparent' && request.outputFormat && !['png', 'webp'].includes(request.outputFormat.toLowerCase())) {
    throw new MediaError('INPUT', 'Transparent OpenAI images require PNG or WebP output', { provider: request.provider })
  }
  if (request.background && !['transparent', 'opaque', 'auto'].includes(request.background)) throw new MediaError('INPUT', 'OpenAI background must be transparent, opaque, or auto', { provider: request.provider })
    const qualities = /^dall-e-3$/i.test(request.model) ? ['standard', 'hd'] : /^dall-e-2$/i.test(request.model) ? ['standard'] : ['low', 'medium', 'high', 'auto']
    if (request.quality && !qualities.includes(request.quality)) throw new MediaError('INPUT', 'Unsupported quality for this OpenAI image model', { provider: request.provider })
    const customSize = /^(\d+)x(\d+)$/i.exec(request.resolution ?? '')
    if (request.resolution && request.resolution !== 'auto') {
      const sizes = /^dall-e-2$/i.test(request.model) ? ['256x256', '512x512', '1024x1024'] : /^dall-e-3$/i.test(request.model) ? ['1024x1024', '1792x1024', '1024x1792'] : ['1024x1024', '1536x1024', '1024x1536']
      if (/^gpt-image-2(?:-|$)/i.test(request.model) ? !customSize : !sizes.includes(request.resolution)) throw new MediaError('INPUT', 'Use supported explicit pixel dimensions, not 1K/2K/4K labels, for OpenAI images', { provider: request.provider })
    }
  if (/^gpt-image-2(?:-|$)/i.test(request.model) && customSize) {
    const width = Number(customSize[1])
    const height = Number(customSize[2])
    if (width <= 0 || height <= 0 || width % 16 || height % 16 || width / height < 1 / 3 || width / height > 3 || Math.max(width, height) > 3_840 || width * height < 655_360 || width * height > 8_294_400) {
      throw new MediaError('INPUT', 'GPT Image 2 custom size must use multiples of 16, ratio 1:3–3:1, maximum side 3840px, and 655360–8294400 total pixels', { provider: request.provider })
    }
  }
}
