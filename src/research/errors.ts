export type ResearchErrorCode =
  | "AUTH_REQUIRED" | "AUTH_INVALID" | "ENTITLEMENT_REQUIRED" | "RATE_LIMITED"
  | "BUDGET_EXCEEDED" | "NOT_FOUND" | "UNSUPPORTED_CAPABILITY"
  | "CONTRACT_UNVERIFIED" | "SCHEMA_MISMATCH" | "CONFLICT" | "SOURCE_UNAVAILABLE"
  | "AMBIGUOUS_SUBMISSION";

const SECRET_KEY = /(authorization|api[-_]?key|token|password|cookie|secret|signature|access[_-]?token|insttoken|e[-_]?mail)/i;

/** Recursively remove credentials and signed URLs from diagnostics and persisted data. */
export function redactSecrets<T>(value: T): T {
  if (typeof value === "string") {
    try {
      const url = new URL(value);
      for (const key of [...url.searchParams.keys()]) if (SECRET_KEY.test(key) || /^(key|token|sig|expires)$/i.test(key)) url.searchParams.set(key, "[REDACTED]");
      if (url.username || url.password) { url.username = ""; url.password = ""; }
      return url.toString() as T;
    } catch {
      return value.replace(/(Bearer\s+|(?:api[-_]?key|token|password|secret|cookie)\s*[=:]\s*)[^\s,;&]+/gi, "$1[REDACTED]") as T;
    }
  }
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item)) as T;
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) output[key] = SECRET_KEY.test(key) ? "[REDACTED]" : redactSecrets(item);
    return output as T;
  }
  return value;
}

export class ResearchError extends Error {
  constructor(
    public readonly code: ResearchErrorCode,
    message: string,
    public readonly provider?: string,
    public readonly status?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ResearchError";
  }
  toJSON(): Record<string, unknown> {
    return redactSecrets({ name: this.name, code: this.code, message: this.message, provider: this.provider, status: this.status, details: this.details });
  }
}

export function mapHttpError(status: number, provider: string, body?: unknown): ResearchError {
  const code: ResearchErrorCode = status === 401 ? "AUTH_INVALID" : status === 403 ? "ENTITLEMENT_REQUIRED" : status === 404 ? "NOT_FOUND" : status === 429 ? "RATE_LIMITED" : status >= 500 ? "SOURCE_UNAVAILABLE" : "SCHEMA_MISMATCH";
  return new ResearchError(code, `${provider} returned HTTP ${status}`, provider, status, redactSecrets(body));
}
