/** Rate-limit headers exactly as the API sent them. */
export type RateLimitInfo = {
  limit?: string;
  remaining?: string;
  reset?: string;
};

export type UnitfieldErrorOptions = {
  code?: string;
  cause?: unknown;
};

/** Base class of every error the SDK throws on purpose. Aborts are never wrapped: they surface as the native `AbortError`. */
export class UnitfieldError extends Error {
  override readonly name: string = "UnitfieldError";
  /** Stable machine-readable code. For API failures this is the API's own problem code. */
  readonly code: string;

  constructor(message: string, options: UnitfieldErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = options.code ?? "unitfield_error";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isUnitfieldError(error: unknown): error is UnitfieldError {
  return error instanceof UnitfieldError;
}

export type UnitfieldApiErrorInit = UnitfieldErrorOptions & {
  status: number;
  method?: string;
  /** Origin and path only: query strings can carry tokens and are never kept. */
  url?: string;
  detail?: string;
  title?: string;
  traceId?: string;
  requestId?: string;
  correlationId?: string;
  supportCode?: string;
  /** Seconds, from `Retry-After` (seconds or HTTP date) or the problem body. */
  retryAfterSeconds?: number;
  rateLimit?: RateLimitInfo;
  /** Field name to messages, for 400 and 422 validation problems. */
  errors?: Record<string, string[]>;
  meta?: Record<string, unknown>;
};

/** The API answered with a non-2xx status. Subclasses narrow by status so callers can `instanceof` instead of comparing numbers. */
export class UnitfieldApiError extends UnitfieldError {
  override readonly name: string = "UnitfieldApiError";
  readonly status: number;
  readonly method?: string;
  readonly url?: string;
  readonly detail?: string;
  readonly title?: string;
  readonly traceId?: string;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly supportCode?: string;
  readonly retryAfterSeconds?: number;
  readonly rateLimit?: RateLimitInfo;
  readonly errors?: Record<string, string[]>;
  readonly meta?: Record<string, unknown>;

  constructor(message: string, init: UnitfieldApiErrorInit) {
    super(message, { code: init.code ?? "http_error", cause: init.cause });
    this.status = init.status;
    this.method = init.method;
    this.url = init.url;
    this.detail = init.detail;
    this.title = init.title;
    this.traceId = init.traceId;
    this.requestId = init.requestId;
    this.correlationId = init.correlationId;
    this.supportCode = init.supportCode;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.rateLimit = init.rateLimit;
    this.errors = init.errors;
    this.meta = init.meta;
  }
}

/** 401: missing, expired, revoked or origin-mismatched credentials (including a publishable key used from the wrong origin). */
export class AuthenticationError extends UnitfieldApiError {
  override readonly name: string = "AuthenticationError";
}
/** 403: authenticated, but not allowed. */
export class PermissionError extends UnitfieldApiError {
  override readonly name: string = "PermissionError";
}
export class NotFoundError extends UnitfieldApiError {
  override readonly name: string = "NotFoundError";
}
/** 409: a business rule or an optimistic-concurrency check refused the change. */
export class ConflictError extends UnitfieldApiError {
  override readonly name: string = "ConflictError";
}
/** 400 and 422. `errors` maps field names to messages when the API provided them. */
export class ValidationError extends UnitfieldApiError {
  override readonly name: string = "ValidationError";
}
/** 429. `retryAfterSeconds` tells how long to wait. */
export class RateLimitError extends UnitfieldApiError {
  override readonly name: string = "RateLimitError";
}
/** 5xx. */
export class ServerError extends UnitfieldApiError {
  override readonly name: string = "ServerError";
}

/** The request never produced an HTTP response (DNS, TLS, connection reset, CORS rejection in a browser). */
export class NetworkError extends UnitfieldError {
  override readonly name: string = "NetworkError";
  constructor(message = "Unitfield request failed before receiving a response.", options: UnitfieldErrorOptions = {}) {
    super(message, { code: options.code ?? "network_error", cause: options.cause });
  }
}

/** The per-attempt `timeoutMs` elapsed. This is not a caller abort. */
export class RequestTimeoutError extends UnitfieldError {
  override readonly name: string = "RequestTimeoutError";
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`Unitfield request timed out after ${timeoutMs} ms.`, { code: "request_timeout" });
    this.timeoutMs = timeoutMs;
  }
}

/** A 2xx response whose body was not the JSON the contract promises. */
export class InvalidResponseError extends UnitfieldError {
  override readonly name: string = "InvalidResponseError";
  readonly status: number;
  constructor(message: string, status: number, options: UnitfieldErrorOptions = {}) {
    super(message, { code: options.code ?? "invalid_response", cause: options.cause });
    this.status = status;
  }
}

export function apiErrorClassFor(status: number): typeof UnitfieldApiError {
  if (status === 400 || status === 422) return ValidationError;
  if (status === 401) return AuthenticationError;
  if (status === 403) return PermissionError;
  if (status === 404) return NotFoundError;
  if (status === 409) return ConflictError;
  if (status === 429) return RateLimitError;
  if (status >= 500) return ServerError;
  return UnitfieldApiError;
}

/** Builds the typed error for a non-2xx response. Reads the body, so it may only be called once per response. */
export async function apiErrorFromResponse(
  response: Response,
  context: { method?: string; url?: URL | string } = {},
): Promise<UnitfieldApiError> {
  const text = await response.text().catch(() => "");
  const body = parseJsonRecord(text);
  const headers = response.headers;

  const traceId = header(headers, "x-trace-id") ?? str(body, "traceId", "TraceId");
  const correlationId = header(headers, "x-correlation-id") ?? str(body, "correlationId", "CorrelationId");
  const requestId = header(headers, "x-request-id") ?? correlationId ?? str(body, "requestId", "RequestId");
  const supportCode = header(headers, "x-support-code") ?? str(body, "supportCode", "SupportCode");
  const title = str(body, "title");
  const detail = str(body, "detail", "message", "error_description", "Message");
  const code = str(body, "code", "error", "Error") ?? "http_error";
  const rateLimit = readRateLimit(headers);
  const retryAfterSeconds =
    parseRetryAfter(header(headers, "retry-after")) ?? parseRetryAfter(scalar(body, "retryAfter", "retryAfterSeconds", "RetryAfterSeconds"));

  const Ctor = apiErrorClassFor(response.status);
  return new Ctor(detail ?? title ?? `Unitfield request failed with HTTP ${response.status}.`, {
    status: response.status,
    code,
    method: context.method,
    url: context.url === undefined ? undefined : redactUrl(context.url),
    detail,
    title,
    traceId,
    requestId,
    correlationId,
    supportCode,
    retryAfterSeconds,
    rateLimit,
    errors: readFieldErrors(body),
    meta: isRecord(body?.meta) ? body.meta : isRecord(body?.Meta) ? body.Meta : undefined,
  });
}

/** Seconds to wait from a `Retry-After` value: delta-seconds or an HTTP date. */
export function parseRetryAfter(value: string | undefined, now: number = Date.now()): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - now) / 1000));
}

export function redactUrl(url: URL | string): string {
  try {
    const parsed = new URL(url.toString());
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonRecord(text: string): Record<string, unknown> | undefined {
  if (!text.trim()) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function str(record: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

function scalar(record: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function header(headers: Headers, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = headers.get(name);
    if (value) return value;
  }
  return undefined;
}

function readRateLimit(headers: Headers): RateLimitInfo | undefined {
  const limit = header(headers, "x-ratelimit-limit", "ratelimit-limit");
  const remaining = header(headers, "x-ratelimit-remaining", "ratelimit-remaining");
  const reset = header(headers, "x-ratelimit-reset", "ratelimit-reset");
  return limit === undefined && remaining === undefined && reset === undefined ? undefined : { limit, remaining, reset };
}

function readFieldErrors(record: Record<string, unknown> | undefined): Record<string, string[]> | undefined {
  if (!isRecord(record?.errors)) return undefined;
  const errors = Object.fromEntries(
    Object.entries(record.errors).filter(([, value]) => Array.isArray(value) && value.every((item) => typeof item === "string")),
  ) as Record<string, string[]>;
  return Object.keys(errors).length ? errors : undefined;
}
