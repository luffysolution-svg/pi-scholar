import { openAsBlob } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MediaError } from './errors.js'
import { HttpClient } from './http.js'
import type { ResolvedInput } from './types.js'
import { readFileBounded, readResponseBytes } from '../io.js'
import { requestPublic } from './url-policy.js'

const MAX_INPUT_BYTES = 50 * 1024 * 1024

const MIME_BY_EXTENSION: Record<string, string> = {
  '.aac': 'audio/aac', '.flac': 'audio/flac', '.gif': 'image/gif', '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg', '.m4a': 'audio/mp4', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.mpeg': 'video/mpeg', '.oga': 'audio/ogg',
  '.ogg': 'audio/ogg', '.png': 'image/png', '.wav': 'audio/wav', '.webm': 'video/webm',
  '.webp': 'image/webp',
}

export function mimeFromName(name: string, fallback = 'application/octet-stream'): string {
  const clean = name.split(/[?#]/, 1)[0] ?? name
  return MIME_BY_EXTENSION[extname(clean).toLowerCase()] ?? fallback
}

function extensionForMime(mime: string): string {
  return Object.entries(MIME_BY_EXTENSION).find(([, value]) => value === mime)?.[0] ?? '.bin'
}

function decodeDataUri(input: string): { bytes: Uint8Array; mimeType: string } {
  const match = /^data:([^;,]+)?((?:;[^,]*)*?),(.*)$/s.exec(input)
  if (!match) throw new MediaError('INPUT', 'Invalid data URI')
  const mimeType = match[1] || 'application/octet-stream'
  const metadata = match[2] ?? ''
  const payload = match[3] ?? ''
  try {
    if (Buffer.byteLength(payload) > Math.ceil(MAX_INPUT_BYTES * 4 / 3) + 16) throw new Error('oversized data URI')
    const bytes = metadata.includes(';base64')
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8')
    if (bytes.byteLength > MAX_INPUT_BYTES) throw new Error('oversized data URI')
    return { mimeType, bytes }
  } catch (error) {
    throw new MediaError('INPUT', 'Invalid data URI payload', { cause: error })
  }
}

export class InputResolver {
  constructor(private readonly http: HttpClient, private readonly cwd = process.cwd()) {}

  async resolve(input: string, signal?: AbortSignal): Promise<ResolvedInput> {
    const value = input.startsWith('@') ? input.slice(1) : input
    if (/^https?:\/\//i.test(value)) {
      const parsed = new URL(value)
      const fileName = basename(parsed.pathname) || 'remote.bin'
      return { original: input, kind: 'url', url: value, mimeType: mimeFromName(fileName), fileName }
    }
    if (value.startsWith('data:')) {
      const decoded = decodeDataUri(value)
      return {
        original: input,
        kind: 'data',
        bytes: decoded.bytes,
        mimeType: decoded.mimeType,
        fileName: `inline${extensionForMime(decoded.mimeType)}`,
      }
    }

    const path = value.startsWith('file://') ? fileURLToPath(value) : resolve(this.cwd, value)
    try {
      const info = await stat(path)
      if (!info.isFile() || info.size > MAX_INPUT_BYTES) throw new Error('not a file or exceeds 50 MB')
      signal?.throwIfAborted()
      return {
        original: input,
        kind: 'file',
        filePath: path,
        mimeType: mimeFromName(path),
        fileName: basename(path),
      }
    } catch (error) {
      if (signal?.aborted) throw new MediaError('ABORTED', 'Reading media input was aborted', { cause: error })
      throw new MediaError('INPUT', `Cannot read media input: ${path}`, { cause: error })
    }
  }

  async bytes(input: ResolvedInput, signal?: AbortSignal): Promise<Uint8Array> {
    if (input.bytes) return input.bytes
    if (input.filePath) return new Uint8Array(await readFileBounded(input.filePath, MAX_INPUT_BYTES, signal))
    if (!input.url) throw new MediaError('INPUT', `Input has no readable data: ${input.original}`)
    const timeoutController = new AbortController()
    const timer = setTimeout(() => timeoutController.abort(), 60_000)
    const combined = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal
    try {
      const response = await requestPublic(this.http, input.url, { signal: combined, timeoutMs: 60_000, retries: 1 })
      input.mimeType = response.headers.get('content-type')?.split(';', 1)[0] ?? input.mimeType
      return await readResponseBytes(response, MAX_INPUT_BYTES, combined)
    } catch (error) {
      if (signal?.aborted) throw new MediaError('ABORTED', 'Reading media input was aborted', { cause: error })
      if (timeoutController.signal.aborted) throw new MediaError('TIMEOUT', 'Reading media input timed out after 60000ms', { cause: error })
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  async asDataUri(source: string, signal?: AbortSignal): Promise<string> {
    const input = await this.resolve(source, signal)
    if (input.kind === 'url') return input.url ?? source
    const bytes = await this.bytes(input, signal)
    return `data:${input.mimeType};base64,${Buffer.from(bytes).toString('base64')}`
  }

  async asInlineData(source: string, signal?: AbortSignal): Promise<{ mimeType: string; data: string }> {
    const input = await this.resolve(source, signal)
    const bytes = await this.bytes(input, signal)
    return { mimeType: input.mimeType, data: Buffer.from(bytes).toString('base64') }
  }

  async asBlob(source: string, signal?: AbortSignal): Promise<{ blob: Blob; fileName: string; mimeType: string }> {
    const input = await this.resolve(source, signal)
    if (input.filePath) {
      return { blob: await openAsBlob(input.filePath, { type: input.mimeType }), fileName: input.fileName, mimeType: input.mimeType }
    }
    const bytes = await this.bytes(input, signal)
    return { blob: new Blob([Uint8Array.from(bytes)], { type: input.mimeType }), fileName: input.fileName, mimeType: input.mimeType }
  }
}
