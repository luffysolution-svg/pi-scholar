import { MediaError } from '../errors.js'
import { MediaJob, mapJobState } from '../media-job.js'
import { BaseAdapter, artifactsOrThrow, dataUris, makeModel, payloadOptions, requirePrompt } from './base.js'
import type { AdapterContext, AdapterResult, Capability, JsonObject, MediaRequest, ModelDescriptor } from '../types.js'

export class DashScopeAdapter extends BaseAdapter {
  readonly displayName: string
  readonly envKey: string
  override readonly fallbackEnvKeys: readonly string[]

  constructor(readonly id: 'dashscope' | 'qwencloud', private readonly baseUrl: string, dependencies: ConstructorParameters<typeof BaseAdapter>[0]) {
    super(dependencies)
    this.displayName = id === 'dashscope' ? 'Alibaba Cloud Bailian / DashScope' : 'QwenCloud (DashScope international)'
    this.envKey = id === 'qwencloud' ? 'QWENCLOUD_API_KEY' : 'DASHSCOPE_API_KEY'
    this.fallbackEnvKeys = id === 'qwencloud' ? ['DASHSCOPE_API_KEY'] : []
  }

  models(): ModelDescriptor[] {
    const caps: Capability[] = ['image.text_to_image', 'image.image_to_image', 'image.edit', 'image.multi_reference']
    return [
      ...['qwen-image-3.0-pro', 'qwen-image-3.0', 'qwen-image-2.0-pro', 'qwen-image-2.0'].map(id => makeModel(this.id, 'alibaba', id, caps)),
      makeModel(this.id, 'alibaba', 'qwen-image-edit-plus', caps.filter(cap => cap !== 'image.text_to_image')),
      ...['qwen-image-max', 'qwen-image-plus', 'qwen-image'].map(id => makeModel(this.id, 'alibaba', id, ['image.text_to_image'])),
    ]
  }

  supports(capability: Capability, model: string): boolean {
    const id = model.replace(/-\d{4}-\d{2}-\d{2}$/, '')
    return this.models().some(entry => entry.id === id && entry.capabilities.includes(capability))
  }

  async execute(request: MediaRequest, context: AdapterContext): Promise<AdapterResult> {
    this.assertSupport(request)
    const prompt = requirePrompt(request)
    const sources = [request.inputImage, ...(request.referenceImages ?? [])].filter((value): value is string => Boolean(value))
    const modern = /^qwen-image-[23]\.0/.test(request.model)
    const count = request.count ?? 1
    const maxCount = modern || /^qwen-image-edit-plus/.test(request.model) ? 6 : 1
    if (!Number.isInteger(count) || count < 1 || count > maxCount) throw new MediaError('INPUT', `Qwen image count must be 1–${maxCount}`, { provider: this.id })
    if (sources.length > 3) throw new MediaError('INPUT', 'Qwen supports at most 3 input images', { provider: this.id })
    if (request.capability !== 'image.text_to_image' && !sources.length) throw new MediaError('INPUT', 'Qwen image editing requires inputImage or referenceImages', { provider: this.id })
    if (sources.length && !this.supports('image.image_to_image', request.model)) throw new MediaError('CAPABILITY_UNSUPPORTED', 'This Qwen model is text-to-image only', { provider: this.id })
    if (request.mask || request.background || request.quality || request.compression !== undefined || (request.outputFormat && request.outputFormat.toLowerCase() !== 'png')) {
      throw new MediaError('CAPABILITY_UNSUPPORTED', 'Qwen outputs PNG; mask/background/quality/compression controls are unsupported', { provider: this.id })
    }
    const asyncMode = request.providerOptions?.async === true
    const v3 = /^qwen-image-3\.0/.test(request.model)
    if (asyncMode && !v3 && !/^qwen-image(?:-plus)?$/.test(request.model)) throw new MediaError('CAPABILITY_UNSUPPORTED', 'Async image calls are documented only for Qwen 3.0, qwen-image and qwen-image-plus', { provider: this.id })
    const endpoint = asyncMode
      ? v3 ? '/api/v1/services/aigc/image-generation/generation' : '/api/v1/services/aigc/text2image/image-synthesis'
      : '/api/v1/services/aigc/multimodal-generation/generation'
    const images = await dataUris(this.input, sources, context.signal)
    const native = payloadOptions(request.providerOptions)
    const { input: _input, parameters: nativeParameters, ...rest } = native
    const size = qwenSize(request, modern)
    const body = {
      model: request.model,
      input: asyncMode && !v3 ? { prompt } : { messages: [{ role: 'user', content: [...images.map(image => ({ image })), { text: prompt }] }] },
      parameters: { ...rest, ...(isObject(nativeParameters) ? nativeParameters : {}), n: count, ...(size ? { size } : {}), ...(request.seed !== undefined ? { seed: request.seed } : {}) },
    }
    const key = this.key(request)
    const base = (typeof request.providerOptions?.baseUrl === 'string' ? request.providerOptions.baseUrl : this.baseUrl).replace(/\/+$/, '')
    const workspace = request.providerOptions?.workspace
    const headers = { Authorization: `Bearer ${key}`, ...(typeof workspace === 'string' ? { 'X-DashScope-WorkSpace': workspace } : {}) }
    const submitted = await this.http.json<Record<string, unknown>>(`${base}${endpoint}`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', ...(asyncMode ? { 'X-DashScope-Async': 'enable' } : {}) },
      body: JSON.stringify(body), signal: context.signal, provider: this.id, secrets: [key], timeoutMs: 180_000,
    })
    if (submitted.code) throw new MediaError('PROVIDER', String(submitted.message ?? submitted.code), { provider: this.id })
    const output = isObject(submitted.output) ? submitted.output : {}
    const taskId = typeof output.task_id === 'string' ? output.task_id : undefined
    if (!taskId) return artifactsOrThrow(this.result(request, submitted, 'image'))
    const job = new MediaJob<Record<string, unknown>>({
      id: taskId, provider: this.id, signal: context.signal, timeoutMs: 30 * 60_000, minDelayMs: 1_000, maxDelayMs: 8_000,
      onProgress: status => context.onProgress?.(`${this.id} ${taskId}: ${status.state}`),
      poll: async signal => {
        const result = await this.http.json<Record<string, unknown>>(`${base}/api/v1/tasks/${encodeURIComponent(taskId)}`, { headers, signal, provider: this.id, secrets: [key], timeoutMs: 30_000 })
        if (result.code) throw new MediaError('PROVIDER', String(result.message ?? result.code), { provider: this.id })
        const output = isObject(result.output) ? result.output : {}
        const state = mapJobState(output.task_status)
        return { state, ...(state === 'succeeded' ? { result } : {}), ...(typeof output.message === 'string' ? { message: output.message } : {}) }
      },
    })
    return artifactsOrThrow(this.result(request, await job.wait(), 'image', { jobId: taskId }))
  }
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function qwenSize(request: MediaRequest, modern: boolean): string | undefined {
  const ratios: Record<string, string> = { '1:1': '1328*1328', '16:9': '1664*928', '9:16': '928*1664', '4:3': '1472*1104', '3:4': '1104*1472' }
  if (request.aspectRatio && !ratios[request.aspectRatio]) throw new MediaError('INPUT', 'Use explicit width x height for this Qwen aspect ratio', { provider: request.provider })
  let size = request.resolution?.replace(/x/i, '*') ?? (request.aspectRatio ? ratios[request.aspectRatio] : undefined)
  if (!size) return undefined
  if (/^[12]k$/i.test(size)) {
    if (request.aspectRatio && request.aspectRatio !== '1:1') throw new MediaError('INPUT', 'Combine Qwen aspect ratio and resolution using explicit dimensions', { provider: request.provider })
    size = size.toLowerCase() === '1k' ? '1024*1024' : '2048*2048'
  }
  const match = /^(\d+)\*(\d+)$/.exec(size)
  const width = Number(match?.[1]), height = Number(match?.[2])
  if (!match || width * height < 512 ** 2 || width * height > 2048 ** 2 || width / height < 1 / 8 || width / height > 8) throw new MediaError('INPUT', 'Qwen size must be width*height, 512²–2048² pixels, ratio 1:8–8:1; 4K is unsupported', { provider: request.provider })
  if (!modern && request.capability === 'image.text_to_image' && !Object.values(ratios).includes(size)) throw new MediaError('INPUT', 'Legacy Qwen generation requires a documented preset size', { provider: request.provider })
  return size
}
