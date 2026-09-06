export type MediaErrorCode =
  | 'ABORTED'
  | 'AUTH'
  | 'CAPABILITY_UNSUPPORTED'
  | 'CONFIG'
  | 'DOWNLOAD'
  | 'HTTP'
  | 'INPUT'
  | 'PROVIDER'
  | 'RATE_LIMITED'
  | 'TIMEOUT'

const SECRET_PATTERN = /(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/=-]{8,}|(?:api[_-]?key|token)["'\s:=]+[A-Za-z0-9._~+/=-]{8,})/gi

export function redactSecrets(value: string, secrets: readonly string[] = []): string {
  let output = value
  for (const secret of secrets) {
    if (secret.length >= 4) output = output.split(secret).join('[REDACTED]')
  }
  return output.replace(SECRET_PATTERN, match => {
    const prefix = match.match(/^(Bearer\s+|(?:api[_-]?key|token)["'\s:=]+)/i)?.[0] ?? ''
    return `${prefix}[REDACTED]`
  })
}

export class MediaError extends Error {
  readonly code: MediaErrorCode
  readonly provider?: string
  readonly status?: number
  readonly retryAfterMs?: number
  override readonly cause?: unknown

  constructor(
    code: MediaErrorCode,
    message: string,
    options: {
      provider?: string
      status?: number
      retryAfterMs?: number
      cause?: unknown
      secrets?: readonly string[]
    } = {},
  ) {
    super(redactSecrets(message, options.secrets))
    this.name = 'MediaError'
    this.code = code
    if (options.provider !== undefined) this.provider = options.provider
    if (options.status !== undefined) this.status = options.status
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs
    if (options.cause !== undefined) this.cause = options.cause
  }
}

export function asMediaError(error: unknown, provider?: string): MediaError {
  if (error instanceof MediaError) return error
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new MediaError('ABORTED', 'Media request aborted', { provider, cause: error })
  }
  const message = error instanceof Error ? error.message : String(error)
  return new MediaError('PROVIDER', message, { provider, cause: error })
}
