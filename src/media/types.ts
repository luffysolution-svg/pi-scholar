export const CAPABILITIES = [
  'image.text_to_image',
  'image.image_to_image',
  'image.edit',
  'image.multi_reference',
  'video.text_to_video',
  'video.image_to_video',
  'video.first_last_frame',
  'video.reference',
  'video.edit',
  'video.extend',
  'video.native_audio',
  'audio.generate',
  'speech.tts',
  'speech.stt',
] as const

export type Capability = (typeof CAPABILITIES)[number]
export type ProviderId =

  | 'fal'
  | 'dashscope'
  | 'qwencloud'
  | 'openai'
  | 'gemini'
  | 'vertex'
  | 'xai'
  | 'atlas'
  | string

export type MediaKind = 'image' | 'video' | 'audio' | 'text'
export type InputSource = string
export type JsonObject = Record<string, unknown>

export interface MediaRequest {
  capability: Capability
  provider: ProviderId
  model: string
  prompt?: string
  inputImage?: InputSource
  endImage?: InputSource
  referenceImages?: InputSource[]
  referenceVideos?: InputSource[]
  referenceAudios?: InputSource[]
  referenceAudioVoices?: string[]
  inputVideo?: InputSource
  inputAudio?: InputSource
  mask?: InputSource
  duration?: number
  resolution?: string
  aspectRatio?: string
  seed?: number
  count?: number
  generateAudio?: boolean
  background?: 'auto' | 'opaque' | 'transparent'
  outputFormat?: string
  quality?: string
  compression?: number
  operation?: string
  text?: string
  voice?: string
  language?: string
  responseFormat?: string
  providerOptions?: JsonObject
}

export interface ResolvedInput {
  original: string
  kind: 'url' | 'data' | 'file'
  mimeType: string
  fileName: string
  bytes?: Uint8Array
  filePath?: string
  url?: string
}

export interface RemoteArtifact {
  kind: MediaKind
  url?: string
  base64?: string
  data?: Uint8Array
  chunks?: readonly Uint8Array[]
  stream?: ReadableStream<Uint8Array>
  mimeType?: string
  fileName?: string
  headers?: Record<string, string>
  headerOrigin?: string
}

export interface NormalizedArtifact {
  kind: MediaKind
  path: string
  mimeType?: string
  bytes?: number
}

export interface AdapterResult {
  provider: string
  model: string
  capability: Capability
  jobId?: string
  artifacts: RemoteArtifact[]
  text?: string
  warnings?: string[]
}

export interface NormalizedResult {
  provider: string
  model: string
  capability: Capability
  jobId?: string
  artifacts: NormalizedArtifact[]
  text?: string
  warnings: string[]
}

export interface JobStatus<T> {
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  result?: T
  message?: string
  retryAfterMs?: number
}

export interface MediaJobOptions<T> {
  id: string
  provider: string
  poll: (signal: AbortSignal) => Promise<JobStatus<T>>
  cancel?: (signal: AbortSignal) => Promise<void>
  timeoutMs?: number
  minDelayMs?: number
  maxDelayMs?: number
  signal?: AbortSignal
  onProgress?: (status: JobStatus<T>) => void
}

export type ModelAvailability = 'available' | 'unavailable' | 'unknown'
export type ModelSource = 'discovered' | 'built-in'

export interface ModelDescriptor {
  provider: string
  vendor: string
  id: string
  capabilities: Capability[]
  notes?: string
  availability?: ModelAvailability
  source?: ModelSource
  isDefault?: boolean
}

export interface AdapterContext {
  signal?: AbortSignal
  onProgress?: (message: string) => void
}

export interface ModelDiscoveryContext extends AdapterContext {
  providerOptions?: JsonObject
}

export interface ProviderAdapter {
  readonly id: string
  readonly displayName: string
  readonly envKey?: string
  readonly fallbackEnvKeys?: readonly string[]
  models(): ModelDescriptor[]
  discoverModels?(context: ModelDiscoveryContext): Promise<ModelDescriptor[]>
  probeModel?(model: ModelDescriptor, capability: Capability, context: ModelDiscoveryContext): Promise<boolean | undefined>
  supports(capability: Capability, model: string): boolean
  execute(request: MediaRequest, context: AdapterContext): Promise<AdapterResult>
}
