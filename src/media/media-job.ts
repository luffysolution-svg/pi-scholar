import { MediaError } from './errors.js'
import type { JobStatus, MediaJobOptions } from './types.js'

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    const timer = setTimeout(done, ms)
    const onAbort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export class MediaJob<T> {
  constructor(private readonly options: MediaJobOptions<T>) {}

  async wait(): Promise<T> {
    const {
      timeoutMs = 20 * 60_000,
      minDelayMs = 1_000,
      maxDelayMs = 10_000,
      provider,
    } = this.options
    const timeoutController = new AbortController()
    const timer = setTimeout(() => timeoutController.abort(new DOMException('Job timed out', 'TimeoutError')), timeoutMs)
    const signal = this.options.signal
      ? AbortSignal.any([this.options.signal, timeoutController.signal])
      : timeoutController.signal
    let delay = minDelayMs

    try {
      while (true) {
        const status = await raceAbort(this.options.poll(signal), signal)
        signal.throwIfAborted()
        this.options.onProgress?.(status)
        if (status.state === 'succeeded') {
          if (status.result === undefined) throw new MediaError('PROVIDER', `${provider} job completed without a result`, { provider })
          return status.result
        }
        if (status.state === 'failed' || status.state === 'cancelled') {
          throw new MediaError('PROVIDER', status.message ?? `${provider} job ${status.state}`, { provider })
        }
        const sleepFor = status.retryAfterMs ?? delay
        await wait(sleepFor, signal)
        delay = Math.min(maxDelayMs, Math.round(delay * 1.7))
      }
    } catch (error) {
      if (this.options.signal?.aborted) {
        await this.cancelBestEffort()
        throw new MediaError('ABORTED', `${provider} job ${this.options.id} aborted`, { provider, cause: error })
      }
      if (timeoutController.signal.aborted) {
        await this.cancelBestEffort()
        throw new MediaError('TIMEOUT', `${provider} job ${this.options.id} timed out after ${timeoutMs}ms`, { provider, cause: error })
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  private async cancelBestEffort(): Promise<void> {
    if (!this.options.cancel) return
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5_000)
    try {
      await raceAbort(this.options.cancel(controller.signal), controller.signal)
    } catch {
      // Cancellation is advisory; preserve the original abort/timeout error.
    } finally {
      clearTimeout(timer)
    }
  }
}

function raceAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export function mapJobState(raw: unknown): JobStatus<never>['state'] {
  const value = String(raw ?? '').toLowerCase().replace(/[\s-]+/g, '_')
  if (['completed', 'complete', 'succeeded', 'success', 'done', 'ready'].includes(value)) return 'succeeded'
  if (['failed', 'failure', 'error'].includes(value)) return 'failed'
  if (['cancelled', 'canceled'].includes(value)) return 'cancelled'
  if (['queued', 'pending', 'submitted', 'created'].includes(value)) return 'queued'
  return 'running'
}
