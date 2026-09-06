import { vertexApiOrigin } from './adapters/google.js'
import type { MediaConfig } from './config.js'

export type ImageServiceAction = 'test_connection' | 'balance'
export interface ImageServiceResult {
  provider: string
  action: ImageServiceAction
  status: 'ok' | 'unsupported' | 'not_configured' | 'failed'
  message: string
  httpStatus?: number
}
export type VertexAuthFactory = (keyFilename?: string) => Promise<{ getRequestHeaders(url: string): Promise<Headers> }>

// Read-only authenticated catalog routes already used by these built-in adapters.
const catalogs: Record<string, { base: string; header: string }> = {
  openai: { base: 'https://api.openai.com/v1', header: 'Authorization' },
  xai: { base: 'https://api.x.ai/v1', header: 'Authorization' },
  gemini: { base: 'https://generativelanguage.googleapis.com/v1beta', header: 'x-goog-api-key' },
}
export async function imageService(
  config: MediaConfig,
  provider: string,
  action: ImageServiceAction,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
  vertexAuthFactory: VertexAuthFactory = defaultVertexAuth,
): Promise<ImageServiceResult> {
  const result = (status: ImageServiceResult['status'], message: string, httpStatus?: number): ImageServiceResult => ({ provider, action, status, message, ...(httpStatus !== undefined ? { httpStatus } : {}) })
  if (action === 'balance') return result('unsupported', 'No verified balance API is implemented. Check the provider billing console; no balance request was sent.')
  if (provider === 'vertex') return testVertexConnection(config, signal, fetcher, vertexAuthFactory)
  const catalog = catalogs[provider]
  const options = config.providerOptions?.[provider]
  const custom = config.customProviders.find(entry => entry.id === provider)
  if (!catalog && !custom) return result('unsupported', 'No verified non-generating connection check for this provider. No request was sent.')
  if (catalog && options?.baseUrl && String(options.baseUrl).replace(/\/$/, '') !== catalog.base) {
    return result('unsupported', 'No verified non-generating connection check for this overridden endpoint. No request was sent.')
  }
  const key = options?.apiKey ?? custom?.apiKey
  if (custom?.auth !== 'none' && (typeof key !== 'string' || !key.trim())) return result('not_configured', 'Configure a provider API key or its credential environment fallback.')
  if (!custom && (typeof key !== 'string' || !key.trim())) return result('not_configured', 'Configure a provider API key or its credential environment fallback.')
  const url = custom ? `${custom.baseUrl.replace(/\/+$/, '')}/models` : `${catalog!.base}/models`
  const headers: Record<string, string> = custom
    ? { ...(custom.headers ?? {}), ...(custom.auth === 'none' ? {} : custom.auth === 'x-api-key' ? { 'x-api-key': String(key) } : { Authorization: `Bearer ${String(key)}` }) }
    : { [catalog!.header]: catalog!.header === 'Authorization' ? `Bearer ${String(key)}` : String(key) }
  try {
    const response = await fetcher(url, {
      method: 'GET', redirect: 'error',
      headers,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    })
    await response.body?.cancel()
    return response.ok
      ? result('ok', 'Read-only model catalog request succeeded. This does not verify image-model access, quota, or balance. No generation was requested.', response.status)
      : result('failed', 'Catalog request failed. Check credentials, permissions, and provider status.', response.status)
  } catch {
    return result('failed', signal?.aborted ? 'Connection check cancelled.' : 'Connection check failed or timed out. No generation was requested.')
  }
}

async function defaultVertexAuth(keyFilename?: string): Promise<{ getRequestHeaders(url: string): Promise<Headers> }> {
  const { GoogleAuth } = await import('google-auth-library')
  return new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    ...(keyFilename ? { keyFilename } : {}),
  })
}

async function testVertexConnection(
  config: MediaConfig,
  signal: AbortSignal | undefined,
  fetcher: typeof fetch,
  authFactory: VertexAuthFactory,
): Promise<ImageServiceResult> {
  const options = config.providerOptions?.vertex
  const keyFilename = typeof options?.credentialsFile === 'string' ? options.credentialsFile : undefined
  const location = typeof options?.location === 'string' ? options.location : 'us-central1'
  let origin: string
  try {
    origin = vertexApiOrigin(location)
  } catch {
    return { provider: 'vertex', action: 'test_connection', status: 'failed', message: 'Invalid Vertex location; no request was sent.' }
  }
  const url = `${origin}/v1beta1/publishers/google/models?pageSize=1`
  try {
    const auth = await authFactory(keyFilename)
    const authHeaders = await auth.getRequestHeaders(url)
    const response = await fetcher(url, {
      method: 'GET', redirect: 'error', headers: authHeaders,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    })
    await response.body?.cancel()
    return response.ok
      ? { provider: 'vertex', action: 'test_connection', status: 'ok', message: 'Vertex ADC authenticated against the read-only Model Garden catalog. This does not verify image inference quota. No generation was requested.', httpStatus: response.status }
      : { provider: 'vertex', action: 'test_connection', status: 'failed', message: 'Vertex Model Garden catalog request failed. Check credentials, IAM, location, and provider status.', httpStatus: response.status }
  } catch {
    return { provider: 'vertex', action: 'test_connection', status: 'failed', message: signal?.aborted ? 'Connection check cancelled.' : 'Vertex ADC connection check failed or timed out. No generation was requested.' }
  }
}
