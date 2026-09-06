import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { MediaError } from './errors.js'
import type { HttpClient, HttpRequestOptions } from './http.js'

export async function assertPublicHttpUrl(value: string | URL, signal?: AbortSignal): Promise<URL> {
  signal?.throwIfAborted()
  const url = value instanceof URL ? value : new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) throw new MediaError('DOWNLOAD', `Unsupported remote URL protocol: ${url.protocol}`)
  if (url.username || url.password) throw new MediaError('DOWNLOAD', 'Remote URLs with embedded credentials are not allowed')
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === 'metadata.google.internal') {
    throw new MediaError('DOWNLOAD', `Private remote host is not allowed: ${host}`)
  }
  if (isIP(host)) {
    assertPublicAddress(host)
    return url
  }
  if (process.env.PI_SCHOLAR_MEDIA_TEST_MODE === '1' && host.endsWith('.test')) return url
  let addresses: Array<{ address: string }>
  try {
    addresses = await raceAbort(lookup(host, { all: true, verbatim: true }), signal)
  } catch (error) {
    throw new MediaError('DOWNLOAD', `Cannot resolve remote host: ${host}`, { cause: error })
  }
  if (!addresses.length) throw new MediaError('DOWNLOAD', `Remote host resolved to no addresses: ${host}`)
  for (const { address } of addresses) assertPublicAddress(address)
  return url
}

export async function requestPublic(
  http: HttpClient,
  value: string | URL,
  options: HttpRequestOptions = {},
  maxRedirects = 5,
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 30_000
  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutController.signal]) : timeoutController.signal
  try {
    let url = await assertPublicHttpUrl(value, signal)
    const initialOrigin = url.origin
    for (let redirects = 0; ; redirects += 1) {
      const headers = url.origin === initialOrigin ? options.headers : stripSensitiveHeaders(options.headers)
      const response = await http.request(url.toString(), { ...options, signal, headers, redirect: 'manual', acceptRedirect: true })
      if (response.status < 300 || response.status >= 400) return response
      if (redirects >= maxRedirects) {
        await response.body?.cancel().catch(() => undefined)
        throw new MediaError('DOWNLOAD', `Too many redirects while fetching ${url.origin}`)
      }
      const location = response.headers.get('location')
      await response.body?.cancel().catch(() => undefined)
      if (!location) throw new MediaError('DOWNLOAD', `Redirect from ${url.origin} had no Location header`)
      url = await assertPublicHttpUrl(new URL(location, url), signal)
    }
  } catch (error) {
    if (options.signal?.aborted) throw new MediaError('ABORTED', 'Remote request aborted', { cause: error })
    if (timeoutController.signal.aborted) throw new MediaError('TIMEOUT', `Remote URL validation/request timed out after ${timeoutMs}ms`, { cause: error })
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function raceAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

function stripSensitiveHeaders(input: HeadersInit | undefined): Headers {
  const headers = new Headers(input)
  for (const name of ['authorization', 'proxy-authorization', 'x-api-key', 'x-goog-api-key', 'cookie']) headers.delete(name)
  return headers
}

function assertPublicAddress(address: string): void {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '')
  const version = isIP(normalized)
  if (version === 4) {
    const [a = 0, b = 0, c = 0] = normalized.split('.').map(Number)
    const blocked = a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0 && c === 113)
    if (blocked) throw new MediaError('DOWNLOAD', `Private or reserved remote address is not allowed: ${normalized}`)
    return
  }
  if (version === 6) {
    const blocked = normalized === '::' || normalized === '::1' || /^f[cd]/.test(normalized) ||
      /^fe[89ab]/.test(normalized) || /^ff/.test(normalized) || /^2001:db8:/.test(normalized) || /^::ffff:/.test(normalized)
    if (blocked) throw new MediaError('DOWNLOAD', `Private or reserved remote address is not allowed: ${normalized}`)
  }
}
