import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import * as Type from 'typebox/type'
import { truncate } from '../tools.js'
import { loadMediaConfig, type MediaConfig } from './config.js'
import { asMediaError } from './errors.js'
import { CapabilityRouter } from './router.js'
import { imageService } from './services.js'
import type { Capability, JsonObject, MediaRequest, ModelDescriptor } from './types.js'

const imageCapabilities = ['image.text_to_image', 'image.image_to_image', 'image.edit', 'image.multi_reference'] as const
const warning = 'Scientific images must be labeled illustrations, not fabricated measurement plots or experimental evidence. Reference images are transmitted to the selected provider; generation/editing may be billed.'
const providerModel = {
  provider: Type.String({ minLength: 1 }),
  model: Type.Optional(Type.String({ minLength: 1, description: 'Exact model pin; otherwise use configured defaultModels, then newest known candidate.' })),
}
const imageOutput = {
  resolution: Type.Optional(Type.String()), aspectRatio: Type.Optional(Type.String()), seed: Type.Optional(Type.Integer()),
  background: Type.Optional(Type.Union([Type.Literal('auto'), Type.Literal('opaque'), Type.Literal('transparent')])),
  outputFormat: Type.Optional(Type.String()), quality: Type.Optional(Type.String()),
  compression: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
  providerOptions: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: 'Native generation settings only; credentials and endpoints belong in pi-scholar config.' })),
}
// Do not return raw provider responses, signed URLs, errors, or unbounded details.
export function mediaToolResult(text: string, config: MediaConfig) {
  const secrets: string[] = []
  const collect = (value: unknown, field = ''): void => {
    if (typeof value === 'string' && /key|token|secret|authorization|credential|header/i.test(field)) secrets.push(value)
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) collect(item, `${field}.${key}`)
  }
  collect(config.providerOptions)
  collect(config.customProviders)
  let safe = text
  for (const secret of secrets.sort((a, b) => b.length - a.length)) if (secret) safe = safe.split(secret).join('[redacted]')
  safe = safe.replace(/https?:\/\/[^\s]+/gi, '[remote URL omitted]')
  const bounded = truncate(safe)
  return { content: [{ type: 'text' as const, text: bounded.text }], details: { truncated: bounded.truncated } }
}
export function selectImageModel(config: MediaConfig, provider: string, capability: Capability, models: ModelDescriptor[], explicit?: string): string {
  const pin = explicit?.trim() || config.defaultModels?.[provider]?.[capability]
  if (pin) return pin
  // Adapter catalogs are curated newest-first. Never infer capability from arbitrary catalog names.
  const candidate = models.find(m => m.provider === provider && m.capabilities.includes(capability) && m.availability !== 'unavailable' && !/^<.*>$/.test(m.id))
  if (!candidate) throw new Error('No known image candidate; configure an explicit model pin')
  return candidate.id
}
type ToolUpdate = ((result: { content: Array<{ type: 'text'; text: string }>; details?: unknown }) => void) | undefined
const progress = (onUpdate: ToolUpdate, text: string): void => onUpdate?.({ content: [{ type: 'text', text }] })

async function executeRequest(request: Omit<MediaRequest, 'model'> & { model?: string }, signal: AbortSignal | undefined, onUpdate: ToolUpdate, ctx: ExtensionContext) {
  const config = await loadMediaConfig(ctx.cwd, ctx.isProjectTrusted())
  try {
    const router = new CapabilityRouter({ cwd: ctx.cwd, config })
    const pinned = request.model?.trim() || config.defaultModels?.[request.provider]?.[request.capability]
    if (!pinned) progress(onUpdate, `Reading the ${request.provider} model catalog; no generation is submitted during discovery…`)
    const candidates = pinned
      ? router.list(request.provider, request.capability)
      : await router.discover(request.provider, request.capability, { ...(signal ? { signal } : {}), probe: false })
    const model = selectImageModel(config, request.provider, request.capability, candidates, request.model)
    const requestedCount = request.count ?? 1
    const nativeGeminiBatch = (request.provider === 'gemini' || request.provider === 'vertex') && /^gemini-/i.test(model) && requestedCount > 1
    const runs = nativeGeminiBatch ? requestedCount : 1
    const saved: string[] = []
    const warnings: string[] = []
    for (let index = 0; index < runs; index += 1) {
      signal?.throwIfAborted()
      progress(onUpdate, `Generating image${runs > 1 ? ` ${index + 1}/${runs}` : ''} with ${request.provider}/${model}…`)
      try {
        const result = await router.execute({ ...request, model, count: nativeGeminiBatch ? 1 : request.count }, { ...(signal ? { signal } : {}) })
        saved.push(...result.artifacts.map(artifact => `Saved ${artifact.kind}: ${artifact.path}`))
        warnings.push(...result.warnings)
      } catch (error) {
        if (!saved.length) throw error
        const failure = asMediaError(error, request.provider)
        return {
          ...mediaToolResult([`${request.provider}/${model} · ${request.capability}`, ...saved, `Partial batch: ${saved.length}/${requestedCount} image(s) saved; stopped after [${failure.code}] ${failure.message}. The failed submission was not retried.`, warning].join('\n'), config),
          isError: true,
        }
      }
    }
    return mediaToolResult([`${request.provider}/${model} · ${request.capability}`, ...saved, ...(warnings.length ? [`Warnings: ${warnings.join('; ')}`] : []), warning].join('\n'), config)
  } catch (error) {
    const failure = asMediaError(error, request.provider)
    const status = failure.status ? ` HTTP ${failure.status}.` : ''
    return {
      ...mediaToolResult(`Image request failed [${failure.code}].${status} ${failure.message}\nCheck credentials, model/capability, endpoint and input files. A submitted request may still be billed; inspect provider history before retrying.`, config),
      isError: true,
    }
  }
}
export function registerMediaTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'pi_scholar_image_models', label: 'Scholar Image Models',
    description: 'Retrieve image models from configured read-only provider catalogs where supported, with curated fallbacks and configured pins. No image generation probe is sent; catalog visibility does not prove inference access.',
    parameters: Type.Object({ provider: Type.Optional(Type.String()), capability: Type.Optional(Type.Union(imageCapabilities.map(c => Type.Literal(c)))), refresh: Type.Optional(Type.Boolean({ description: 'Query read-only provider model catalogs where available; defaults to true. No generation probe is sent.' })) }),
    async execute(_id, params, signal, onUpdate, ctx) {
      const config = await loadMediaConfig(ctx.cwd, ctx.isProjectTrusted())
      const router = new CapabilityRouter({ cwd: ctx.cwd, config })
      progress(onUpdate as ToolUpdate, params.refresh === false ? 'Reading curated local image candidates…' : 'Reading configured provider model catalogs; no generation is submitted…')
      const listed = params.refresh === false
        ? router.list(params.provider, params.capability)
        : await router.discover(params.provider, params.capability, { ...(signal ? { signal } : {}), probe: false })
      const models = listed.filter(m => m.capabilities.some(c => c.startsWith('image.')))
      const lines = models.map(m => `${m.provider}/${m.id} [configured=${m.configured}; access=${m.availability}; source=${m.source}${m.isDefault ? '; default=newest' : ''}] ${m.capabilities.filter(c => c.startsWith('image.')).join(', ')}${m.notes ? ` · ${m.notes}` : ''}`)
      for (const [provider, pins] of Object.entries(config.defaultModels ?? {})) if (!params.provider || params.provider === provider) for (const [capability, model] of Object.entries(pins)) if (!params.capability || params.capability === capability) lines.push(`Configured default: ${provider}/${model} [${capability}]`)
      return mediaToolResult(lines.join('\n') || 'No matching known image models.', config)
    },
  })
  pi.registerTool({
    name: 'pi_scholar_image_generate', label: 'Scholar Generate Image',
    description: `Generate illustrations from text and optional image references. ${warning}`, promptSnippet: warning,
    parameters: Type.Object({ ...providerModel, prompt: Type.String({ minLength: 1 }), inputImage: Type.Optional(Type.String()), referenceImages: Type.Optional(Type.Array(Type.String(), { maxItems: 16 })), count: Type.Optional(Type.Integer({ minimum: 1, maximum: 16 })), ...imageOutput }),
    async execute(_id, params, signal, onUpdate, ctx) {
      const count = (params.referenceImages?.length ?? 0) + (params.inputImage ? 1 : 0)
      const capability: Capability = count > 1 ? 'image.multi_reference' : count ? 'image.image_to_image' : 'image.text_to_image'
      return executeRequest({ ...params, capability, providerOptions: params.providerOptions as JsonObject | undefined }, signal, onUpdate as ToolUpdate, ctx)
    },
  })
  pi.registerTool({
    name: 'pi_scholar_image_edit', label: 'Scholar Edit Image',
    description: `Edit an illustration with optional references and mask. ${warning}`, promptSnippet: warning,
    parameters: Type.Object({ ...providerModel, prompt: Type.String({ minLength: 1 }), inputImage: Type.String({ minLength: 1 }), referenceImages: Type.Optional(Type.Array(Type.String(), { maxItems: 16 })), mask: Type.Optional(Type.String()), count: Type.Optional(Type.Integer({ minimum: 1, maximum: 16 })), ...imageOutput }),
    async execute(_id, params, signal, onUpdate, ctx) {
      return executeRequest({ ...params, capability: params.referenceImages?.length ? 'image.multi_reference' : 'image.edit', providerOptions: params.providerOptions as JsonObject | undefined }, signal, onUpdate as ToolUpdate, ctx)
    },
  })
  pi.registerTool({
    name: 'pi_scholar_image_service', label: 'Scholar Image Service',
    description: 'Check an authenticated read-only official catalog (no charged generation probes), or report whether balance lookup is supported. Catalog access does not prove generation access.',
    parameters: Type.Object({ provider: Type.String({ minLength: 1 }), action: Type.Union([Type.Literal('test_connection'), Type.Literal('balance')]) }),
    async execute(_id, params, signal, _update, ctx) {
      const config = await loadMediaConfig(ctx.cwd, ctx.isProjectTrusted())
      return mediaToolResult(JSON.stringify(await imageService(config, params.provider, params.action, signal)), config)
    },
  })
}
