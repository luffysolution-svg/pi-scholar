import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { HttpClient } from './http.js'
import { MediaError } from './errors.js'
import type { MediaKind, NormalizedArtifact, RemoteArtifact } from './types.js'
import { requestPublic } from './url-policy.js'

const EXT_BY_MIME: Record<string, string> = {
  'audio/aac': '.aac', 'audio/flac': '.flac', 'audio/l16': '.pcm', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a',
  'audio/ogg': '.ogg', 'audio/pcm': '.pcm', 'audio/wav': '.wav', 'image/gif': '.gif', 'image/jpeg': '.jpg',
  'image/png': '.png', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/mpeg': '.mpeg',
  'video/quicktime': '.mov', 'video/webm': '.webm',
}

function kindFrom(value: string, fallback: MediaKind): MediaKind {
  const lower = value.toLowerCase()
  if (/\.(?:png|jpe?g|gif|webp)(?:[?#]|$)/.test(lower) || lower.startsWith('image/')) return 'image'
  if (/\.(?:mp4|mov|webm|mkv|mpeg)(?:[?#]|$)/.test(lower) || lower.startsWith('video/')) return 'video'
  if (/\.(?:mp3|wav|ogg|m4a|aac|flac)(?:[?#]|$)/.test(lower) || lower.startsWith('audio/')) return 'audio'
  return fallback
}

function looksLikeBase64(value: string): boolean {
  return value.length > 100 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value)
}

function isArtifactUrl(value: string, key: string, mimeHint?: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false
  if (/(?:^|_)(?:text|prompt|message|error|status|response|cancel|poll|task|operation|transcription)(?:_|$)/i.test(key)) return false
  if (mimeHint && /^(?:image|video|audio)\//i.test(mimeHint)) return true
  if (/\.(?:png|jpe?g|gif|webp|mp4|mov|webm|mkv|mpeg|mp3|wav|ogg|m4a|aac|flac)(?:[?#]|$)/i.test(value)) return true
  return /(?:^|_)(?:url|uri|image|video|audio|file|content)$/i.test(key)
    && !/(?:status|response|cancel|poll|task|operation|transcription)/i.test(key)
}

export function extractArtifacts(payload: unknown, fallback: MediaKind): RemoteArtifact[] {
  const found: RemoteArtifact[] = []
  const seen = new Set<string>()

  function push(artifact: RemoteArtifact): void {
    const identity = artifact.url ?? artifact.base64
    if (!identity || seen.has(identity)) return
    seen.add(identity)
    found.push(artifact)
  }

  function walk(value: unknown, key = '', mimeHint?: string): void {
    if (typeof value === 'string') {
      if (isArtifactUrl(value, key, mimeHint)) push({ kind: kindFrom(value, mimeHint ? kindFrom(mimeHint, fallback) : fallback), url: value, ...(mimeHint ? { mimeType: mimeHint } : {}) })
      else if (value.startsWith('data:')) {
        const match = /^data:([^;,]+)?;base64,(.*)$/s.exec(value)
        if (match?.[2]) push({ kind: kindFrom(match[1] ?? '', fallback), base64: match[2], ...(match[1] ? { mimeType: match[1] } : {}) })
      } else if (/(?:b64|base64|bytes|data|content)/i.test(key) && looksLikeBase64(value)) {
        push({ kind: kindFrom(mimeHint ?? '', fallback), base64: value, ...(mimeHint ? { mimeType: mimeHint } : {}) })
      }
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, key, mimeHint)
      return
    }
    if (!value || typeof value !== 'object') return
    const object = value as Record<string, unknown>
    const mime = typeof object.mime_type === 'string'
      ? object.mime_type
      : typeof object.mimeType === 'string'
        ? object.mimeType
        : typeof object.media_type === 'string'
          ? object.media_type
          : mimeHint
    for (const [childKey, child] of Object.entries(object)) walk(child, childKey, mime)
  }

  walk(payload)
  return found
}

function inferExtension(artifact: RemoteArtifact): string {
  if (artifact.fileName) {
    const extension = extname(artifact.fileName)
    if (extension) return extension
  }
  if (artifact.mimeType) {
    const baseMime = (artifact.mimeType.split(';', 1)[0] ?? artifact.mimeType).toLowerCase()
    const known = EXT_BY_MIME[baseMime]
    if (known) return known
  }
  if (artifact.url) {
    const extension = extname(new URL(artifact.url).pathname)
    if (extension && extension.length <= 8) return extension
  }
  return artifact.kind === 'image' ? '.png' : artifact.kind === 'video' ? '.mp4' : artifact.kind === 'audio' ? '.mp3' : '.txt'
}

export class ArtifactDownloader {
  constructor(
    private readonly http: HttpClient,
    private readonly outputDir = join(homedir(), '.pi', 'agent', 'media', 'outputs'),
    private readonly maxBytes = 50 * 1024 * 1024,
    private readonly timeoutMs = 120_000,
  ) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new MediaError('CONFIG', 'maxArtifactBytes must be a positive safe integer')
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new MediaError('CONFIG', 'Artifact download timeout must be positive')
  }

  async downloadAll(artifacts: readonly RemoteArtifact[], signal?: AbortSignal): Promise<NormalizedArtifact[]> {
    await mkdir(this.outputDir, { recursive: true })
    const outputs: NormalizedArtifact[] = []
    try {
      for (const artifact of artifacts) outputs.push(await this.download(artifact, signal))
      return outputs
    } catch (error) {
      await Promise.all(outputs.map(output => rm(output.path, { force: true }).catch(() => undefined)))
      throw error
    }
  }

  private async download(original: RemoteArtifact, signal?: AbortSignal): Promise<NormalizedArtifact> {
    signal?.throwIfAborted()
    const timeoutController = original.url || original.stream ? new AbortController() : undefined
    const timer = timeoutController ? setTimeout(() => timeoutController.abort(), this.timeoutMs) : undefined
    const ioSignal = timeoutController
      ? signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal
      : signal
    let artifact = original
    let finalPath: string | undefined
    let partPath: string | undefined
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      let response: Response | undefined
      if (artifact.url) {
        const url = new URL(artifact.url)
        const headers = artifact.headers && artifact.headerOrigin === url.origin ? artifact.headers : undefined
        response = await requestPublic(this.http, url, {
          signal: ioSignal, headers, timeoutMs: this.timeoutMs, retries: 2, provider: 'download',
        })
        const responseMime = response.headers.get('content-type')?.split(';', 1)[0]
        if (responseMime) artifact = { ...artifact, mimeType: responseMime }
        const contentLength = Number(response.headers.get('content-length'))
        if (Number.isFinite(contentLength) && contentLength > this.maxBytes) throw tooLarge(artifact.kind, this.maxBytes)
      }

      const extension = inferExtension(artifact)
      finalPath = join(this.outputDir, `${Date.now()}-${randomUUID().slice(0, 8)}${extension}`)
      partPath = `${finalPath}.part`
      handle = await open(partPath, 'wx')
      let bytes = 0
      if (artifact.base64) {
        const chunkChars = 1024 * 1024
        for (let offset = 0; offset < artifact.base64.length; offset += chunkChars) {
          ioSignal?.throwIfAborted()
          const chunk = Buffer.from(artifact.base64.slice(offset, offset + chunkChars), 'base64')
          assertWithinLimit(bytes + chunk.byteLength, artifact.kind, this.maxBytes)
          bytes += await writeChunk(handle, chunk)
        }
      } else if (artifact.data) {
        ioSignal?.throwIfAborted()
        assertWithinLimit(artifact.data.byteLength, artifact.kind, this.maxBytes)
        bytes = await writeChunk(handle, artifact.data)
      } else if (artifact.chunks) {
        for (const chunk of artifact.chunks) {
          ioSignal?.throwIfAborted()
          assertWithinLimit(bytes + chunk.byteLength, artifact.kind, this.maxBytes)
          bytes += await writeChunk(handle, chunk)
        }
      } else {
        const stream = artifact.stream ?? response?.body
        if (!stream) throw new MediaError('DOWNLOAD', 'Artifact has no readable media data')
        bytes = await writeStream(handle, stream, artifact.kind, this.maxBytes, ioSignal)
      }
      await handle.close()
      handle = undefined
      await rename(partPath, finalPath)
      const info = await stat(finalPath)
      return { kind: artifact.kind, path: finalPath, bytes: info.size || bytes, ...(artifact.mimeType ? { mimeType: artifact.mimeType } : {}) }
    } catch (error) {
      await handle?.close().catch(() => undefined)
      if (partPath) await rm(partPath, { force: true }).catch(() => undefined)
      if (finalPath) await rm(finalPath, { force: true }).catch(() => undefined)
      if (signal?.aborted) throw new MediaError('ABORTED', `Saving generated ${artifact.kind} was aborted`, { cause: error })
      if (timeoutController?.signal.aborted) throw new MediaError('TIMEOUT', `Downloading generated ${artifact.kind} timed out after ${this.timeoutMs}ms`, { cause: error })
      if (error instanceof MediaError) throw error
      throw new MediaError('DOWNLOAD', `Failed to save generated ${artifact.kind}`, { cause: error })
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}

function tooLarge(kind: MediaKind, maxBytes: number): MediaError {
  return new MediaError('DOWNLOAD', `Generated ${kind} exceeds maxArtifactBytes (${maxBytes})`)
}

function assertWithinLimit(bytes: number, kind: MediaKind, maxBytes: number): void {
  if (bytes > maxBytes) throw tooLarge(kind, maxBytes)
}

async function writeChunk(handle: Awaited<ReturnType<typeof open>>, chunk: Uint8Array): Promise<number> {
  let offset = 0
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset)
    if (!bytesWritten) throw new Error('File write made no progress')
    offset += bytesWritten
  }
  return offset
}

async function writeStream(
  handle: Awaited<ReturnType<typeof open>>,
  stream: ReadableStream<Uint8Array>,
  kind: MediaKind,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<number> {
  const reader = stream.getReader()
  const abort = () => { void reader.cancel(signal?.reason).catch(() => undefined) }
  signal?.addEventListener('abort', abort, { once: true })
  let bytes = 0
  try {
    while (true) {
      signal?.throwIfAborted()
      const { done, value } = await reader.read()
      signal?.throwIfAborted()
      if (done) return bytes
      if (value?.byteLength) {
        assertWithinLimit(bytes + value.byteLength, kind, maxBytes)
        bytes += await writeChunk(handle, value)
      }
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined)
    throw error
  } finally {
    signal?.removeEventListener('abort', abort)
    reader.releaseLock()
  }
}
