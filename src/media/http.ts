import { readResponseBytes } from '../io.js'
import { MediaError, redactSecrets } from './errors.js'

const MAX_JSON_RESPONSE_BYTES = 128 * 1024 * 1024
const MAX_TEXT_RESPONSE_BYTES = 10 * 1024 * 1024

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface HttpRequestOptions extends RequestInit {
  timeoutMs?: number
  retries?: number
  retryUnsafe?: boolean
  acceptRedirect?: boolean
  provider?: string
  secrets?: readonly string[]
}

function retryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get('retry-after')
  if (!raw) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(raw)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined
}

function combineSignals(signal: AbortSignal | null | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal
  return { signal: combined, cleanup: () => clearTimeout(timer) }
}

async function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (ms <= 0) return
  await new Promise<void>((resolve, reject) => {
    const done = () => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    const timer = setTimeout(done, ms)
    const abort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    if (signal?.aborted) return abort()
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export class HttpClient {
  private readonly fetchImpl: FetchLike
  private readonly responseDeadlines = new WeakMap<Response, number>()

  constructor(fetchImpl?: FetchLike) {
    if (!fetchImpl && process.env.PI_SCHOLAR_MEDIA_TEST_MODE === '1') {
      this.fetchImpl = async () => {
        throw new MediaError('CONFIG', 'Real network requests are disabled in tests')
      }
    } else {
      this.fetchImpl = fetchImpl ?? globalThis.fetch.bind(globalThis)
    }
  }

  async request(url: string, options: HttpRequestOptions = {}): Promise<Response> {
    const {
      timeoutMs = 30_000,
      retries = 2,
      retryUnsafe = false,
      acceptRedirect = false,
      provider,
      secrets = [],
      ...init
    } = options
    const method = (init.method ?? 'GET').toUpperCase()
    const canRetry = retryUnsafe || method === 'GET' || method === 'HEAD'
    const deadline = Date.now() + timeoutMs
    let attempt = 0

    while (true) {
      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) throw new MediaError('TIMEOUT', `Request timed out after ${timeoutMs}ms`, { provider })
      const { signal, cleanup } = combineSignals(init.signal, remainingMs)
      try {
        const response = await this.fetchImpl(url, { ...init, signal })
        if (response.ok || (acceptRedirect && response.status >= 300 && response.status < 400)) {
          this.responseDeadlines.set(response, deadline)
          return response
        }

        const retryMs = retryAfterMs(response.headers)
        const retryable = response.status === 429 || response.status >= 500
        if (retryable && canRetry && attempt < retries) {
          attempt += 1
          await response.body?.cancel().catch(() => undefined)
          await sleep(retryMs ?? Math.min(500 * 2 ** (attempt - 1), 5_000), signal)
          continue
        }

        const body = redactSecrets(await readTextPreview(response, 2_000, signal), secrets)
        const code = response.status === 401 || response.status === 403
          ? 'AUTH'
          : response.status === 429
            ? 'RATE_LIMITED'
            : 'HTTP'
        throw new MediaError(code, `${provider ?? 'Provider'} HTTP ${response.status}${body ? `: ${body}` : ''}`, {
          provider,
          status: response.status,
          ...(retryMs === undefined ? {} : { retryAfterMs: retryMs }),
          secrets,
        })
      } catch (error) {
        if (error instanceof MediaError) throw error
        if (init.signal?.aborted) throw new MediaError('ABORTED', 'Media request aborted', { provider, cause: error })
        if (signal.aborted) throw new MediaError('TIMEOUT', `Request timed out after ${timeoutMs}ms`, { provider, cause: error })
        if (canRetry && attempt < retries) {
          attempt += 1
          try {
            await sleep(Math.min(500 * 2 ** (attempt - 1), 5_000), signal)
          } catch (sleepError) {
            if (init.signal?.aborted) throw new MediaError('ABORTED', 'Media request aborted', { provider, cause: sleepError })
            throw new MediaError('TIMEOUT', `Request timed out after ${timeoutMs}ms`, { provider, cause: sleepError })
          }
          continue
        }
        throw new MediaError('HTTP', `Network request failed: ${error instanceof Error ? error.message : String(error)}`, {
          provider,
          cause: error,
          secrets,
        })
      } finally {
        cleanup()
      }
    }
  }

  async text(url: string, options: HttpRequestOptions = {}): Promise<string> {
    const response = await this.request(url, options)
    return this.textResponse(response, options)
  }

  async textResponse(response: Response, options: HttpRequestOptions = {}): Promise<string> {
    return consumeResponse(response, signal => readBoundedText(response, MAX_TEXT_RESPONSE_BYTES, signal, options.provider), options, this.remainingBodyTime(response, options))
  }

  async json<T>(url: string, options: HttpRequestOptions = {}): Promise<T> {
    const response = await this.request(url, options)
    return this.jsonResponse<T>(response, options)
  }

  async jsonResponse<T>(response: Response, options: HttpRequestOptions = {}): Promise<T> {
    try {
      return await consumeResponse(response, async signal => JSON.parse(await readBoundedText(response, MAX_JSON_RESPONSE_BYTES, signal, options.provider)) as T, options, this.remainingBodyTime(response, options))
    } catch (error) {
      if (error instanceof MediaError) throw error
      throw new MediaError('PROVIDER', `${options.provider ?? 'Provider'} returned invalid JSON`, {
        provider: options.provider,
        cause: error,
      })
    }
  }

  private remainingBodyTime(response: Response, options: HttpRequestOptions): number {
    const fallback = options.timeoutMs ?? 30_000
    const deadline = this.responseDeadlines.get(response)
    return deadline ? Math.max(1, deadline - Date.now()) : fallback
  }
}

async function readTextPreview(response: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  try {
    while (text.length < maxBytes) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
    }
    return text.slice(0, maxBytes)
  } catch (error) {
    if (signal.aborted) throw error
    return text.slice(0, maxBytes)
  } finally {
    if (text.length >= maxBytes) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

async function readBoundedText(response: Response, maxBytes: number, signal: AbortSignal, provider?: string): Promise<string> {
  try {
    return new TextDecoder().decode(await readResponseBytes(response, maxBytes, signal))
  } catch (error) {
    if (error instanceof Error && /exceeds .* limit/i.test(error.message)) {
      throw new MediaError('PROVIDER', `${provider ?? 'Provider'} response exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MB limit`, { provider, cause: error })
    }
    throw error
  }
}

async function consumeResponse<T>(response: Response, consume: (signal: AbortSignal) => Promise<T>, options: HttpRequestOptions, timeoutMs: number): Promise<T> {
  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutController.signal]) : timeoutController.signal
  let rejectAbort: ((reason: unknown) => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
  const onAbort = () => rejectAbort?.(signal.reason ?? new DOMException('Aborted', 'AbortError'))
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) onAbort()
  try {
    return await Promise.race([consume(signal), aborted])
  } catch (error) {
    if (options.signal?.aborted) throw new MediaError('ABORTED', 'Media request aborted', { provider: options.provider, cause: error })
    if (timeoutController.signal.aborted) {
      await response.body?.cancel().catch(() => undefined)
      throw new MediaError('TIMEOUT', `Response body timed out after ${timeoutMs}ms`, { provider: options.provider, cause: error })
    }
    throw error
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}
