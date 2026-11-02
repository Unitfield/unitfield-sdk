import {
  InvalidResponseError,
  NetworkError,
  RequestTimeoutError,
  UnitfieldApiError,
  UnitfieldError,
  apiErrorFromResponse,
} from "./errors.js";
import { abortReason, attemptSignal, isAbortError, sleep, throwIfAborted, type AttemptSignal } from "./internal/abort.js";
import { resolveApiUrl, validateHttpUrl, type QueryInput } from "./internal/url.js";

export type FetchLike = typeof fetch;
export type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";

export type AccessTokenContext = {
  signal?: AbortSignal;
  /** Set after the API rejected the previous token with 401: the provider should not answer from its cache. */
  forceRefresh?: boolean;
};
export type AccessTokenProvider = (context?: AccessTokenContext) => string | Promise<string>;

export type RetryOptions = {
  /** Retries after the first attempt. Default 2; `0` disables. */
  maxRetries?: number;
  /** First backoff step. Default 250 ms, doubled per retry with jitter. */
  baseDelayMs?: number;
  /** Backoff ceiling. Default 5000 ms. */
  maxDelayMs?: number;
  /** A `Retry-After` longer than this is not waited out; the error is thrown so the caller can decide. Default 30000 ms. */
  maxRetryAfterMs?: number;
  /** Replaces the timer between attempts (tests, custom schedulers). Must reject when `signal` aborts. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Replaces `Math.random` for jitter. */
  random?: () => number;
};

/** Extra `fetch` init: `cache`, `credentials`, `keepalive`, a framework's `next: { revalidate }`, and so on. */
export type FetchExtras = Omit<RequestInit, "body" | "headers" | "method" | "signal"> & Record<string, unknown>;

export type RequestOptions = {
  signal?: AbortSignal | null;
  /** Extra headers. Credentials and the idempotency key set by the SDK always win. */
  headers?: HeadersInit;
  /** Per-attempt timeout. Default 30000 ms; `0` disables. */
  timeoutMs?: number;
  retry?: RetryOptions | false;
  fetchOptions?: FetchExtras;
};
/** Mutations may carry an idempotency key. `true` generates one for this call and reuses it across the SDK's own retries. */
export type MutationOptions = RequestOptions & { idempotencyKey?: string | true };
export type IdempotentMutationOptions = RequestOptions & { idempotencyKey: string };

export type RequestSpec = {
  method?: HttpMethod;
  /** Absolute API path starting with `/`. */
  path: string;
  query?: QueryInput;
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal | null;
  idempotencyKey?: string | true;
  /** Send no credentials at all (no bearer, no publishable key) even if the client has them. */
  anonymous?: boolean;
  retry?: RetryOptions | false;
  timeoutMs?: number;
  fetchOptions?: FetchExtras;
  /** `"none"` discards the body (204/202 endpoints). Default `"json"`. */
  response?: "json" | "none";
};

export type TransportOptions = {
  baseUrl: string | URL;
  fetch?: FetchLike;
  headers?: HeadersInit;
  timeoutMs?: number;
  retry?: RetryOptions | false;
  fetchOptions?: FetchExtras;
  accessToken?: string;
  tokenProvider?: AccessTokenProvider;
  publishableKey?: string;
};

type ResolvedRetry = Required<Omit<RetryOptions, "sleep" | "random">> & Pick<RetryOptions, "sleep" | "random">;

const DEFAULT_RETRY: ResolvedRetry = {
  maxRetries: 2,
  baseDelayMs: 250,
  maxDelayMs: 5000,
  maxRetryAfterMs: 30_000,
};
const DEFAULT_TIMEOUT_MS = 30_000;
const SAFE_RETRY_STATUS = new Set([408, 429, 502, 503, 504]);
const KEYED_RETRY_STATUS = new Set([429, 503]);

export function generateIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.randomUUID) throw new TypeError("crypto.randomUUID is not available; pass an explicit idempotencyKey.");
  return cryptoApi.randomUUID();
}

/** For operations that move money or create records: the caller must choose the key, so a manual retry reuses it. */
export function requireIdempotencyKey<T extends { idempotencyKey?: string | true }>(options: T | undefined): T & { idempotencyKey: string } {
  if (!options || typeof options.idempotencyKey !== "string") throw new TypeError("idempotencyKey is required for this operation.");
  if (!options.idempotencyKey.trim()) throw new TypeError("idempotencyKey must not be empty.");
  return options as T & { idempotencyKey: string };
}

function resolveIdempotencyKey(value: string | true | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value === true) return generateIdempotencyKey();
  if (typeof value !== "string" || !value.trim()) throw new TypeError("idempotencyKey must not be empty.");
  const key = value.trim();
  if (key.length > 160) throw new TypeError("idempotencyKey must be at most 160 characters.");
  return key;
}

function resolveRetry(base: ResolvedRetry, override: RetryOptions | false | undefined): ResolvedRetry {
  if (override === false) return { ...base, maxRetries: 0 };
  return override ? { ...base, ...stripUndefined(override) } : base;
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function validateRetry(options: RetryOptions): void {
  for (const key of ["maxRetries", "baseDelayMs", "maxDelayMs", "maxRetryAfterMs"] as const) {
    const value = options[key];
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new TypeError(`retry.${key} must be a non-negative number.`);
  }
  if (options.maxRetries !== undefined && !Number.isInteger(options.maxRetries)) throw new TypeError("retry.maxRetries must be an integer.");
}

type EncodedBody = { body: BodyInit | undefined; contentType?: string; replayable: boolean };

function encodeBody(body: unknown): EncodedBody {
  if (body === undefined) return { body: undefined, replayable: true };
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) return { body, replayable: false };
  if (isBodyInit(body)) return { body, replayable: true };
  return { body: JSON.stringify(body), contentType: "application/json", replayable: true };
}

function isBodyInit(value: unknown): value is BodyInit {
  return (
    typeof value === "string" ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    (typeof Blob !== "undefined" && value instanceof Blob) ||
    (typeof FormData !== "undefined" && value instanceof FormData) ||
    (typeof URLSearchParams !== "undefined" && value instanceof URLSearchParams)
  );
}

/**
 * The one HTTP path every client uses: credentials, timeouts, retries with backoff, idempotency keys, typed errors.
 *
 * Retry rules (spec section 10): GET and HEAD are retried on network errors, timeouts, 408, 429, 502, 503 and 504.
 * Any other method is retried only when it carries an idempotency key, and then only on network errors, timeouts,
 * 429 and 503, so a retry can never repeat a side effect. A request with a stream body is never retried.
 * A 401 answered while a token provider is configured is replayed once after asking the provider for a fresh token.
 */
export class Transport {
  readonly baseUrl: string;
  readonly #base: URL;
  readonly #fetch: FetchLike;
  readonly #headers: Headers;
  readonly #timeoutMs: number;
  readonly #retry: ResolvedRetry;
  readonly #fetchOptions: FetchExtras;
  readonly #accessToken?: string;
  readonly #tokenProvider?: AccessTokenProvider;
  readonly #publishableKey?: string;

  constructor(options: TransportOptions) {
    this.#base = validateHttpUrl(options.baseUrl, "baseUrl", { allowQuery: false });
    this.baseUrl = this.#base.toString().replace(/\/+$/, "");
    if (options.accessToken !== undefined && !options.accessToken.trim()) throw new TypeError("accessToken must not be empty.");
    if (options.accessToken !== undefined && options.tokenProvider) throw new TypeError("Provide accessToken or tokenProvider, not both.");
    if (options.publishableKey !== undefined && !options.publishableKey.trim()) throw new TypeError("publishableKey must not be empty.");
    if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0)) {
      throw new TypeError("timeoutMs must be a non-negative number.");
    }
    if (options.retry) validateRetry(options.retry);

    const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
    if (!fetchImpl) throw new TypeError("fetch is not available; provide options.fetch.");
    this.#fetch = fetchImpl;
    this.#headers = new Headers(options.headers);
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#retry = resolveRetry(DEFAULT_RETRY, options.retry);
    this.#fetchOptions = { credentials: "omit", ...options.fetchOptions };
    this.#accessToken = options.accessToken?.trim();
    this.#tokenProvider = options.tokenProvider;
    this.#publishableKey = options.publishableKey?.trim();
  }

  async request<T>(spec: RequestSpec): Promise<T> {
    const caller = spec.signal ?? undefined;
    throwIfAborted(caller);
    if (spec.retry) validateRetry(spec.retry);

    const method = spec.method ?? "GET";
    const url = resolveApiUrl(this.#base, spec.path, spec.query);
    const idempotencyKey = resolveIdempotencyKey(spec.idempotencyKey);
    const retry = resolveRetry(this.#retry, spec.retry);
    const timeoutMs = spec.timeoutMs ?? this.#timeoutMs;
    const encoded = encodeBody(spec.body);
    const safe = method === "GET" || method === "HEAD";
    const retriable = encoded.replayable && (safe || idempotencyKey !== undefined);
    const statuses = safe ? SAFE_RETRY_STATUS : KEYED_RETRY_STATUS;
    const sleeper = retry.sleep ?? sleep;

    let forceRefresh = false;
    let replayedAfter401 = false;
    for (let attempt = 0; ; attempt++) {
      const headers = await this.#buildHeaders(spec, encoded.contentType, idempotencyKey, caller, forceRefresh);
      forceRefresh = false;
      const outcome = await this.#attempt<T>(url, method, headers, encoded.body, spec, caller, timeoutMs);
      if (outcome.ok) return outcome.value;

      const { error } = outcome;
      if (error instanceof UnitfieldApiError && error.status === 401 && this.#tokenProvider && !spec.anonymous && !replayedAfter401 && encoded.replayable) {
        // The token was refused, so nothing ran: replay once with a token the provider must not serve from its cache.
        replayedAfter401 = true;
        forceRefresh = true;
        attempt--;
        continue;
      }
      const transient =
        error instanceof NetworkError ||
        error instanceof RequestTimeoutError ||
        (error instanceof UnitfieldApiError && statuses.has(error.status));
      if (!retriable || !transient || attempt >= retry.maxRetries) throw error;
      const retryAfterSeconds = error instanceof UnitfieldApiError ? error.retryAfterSeconds : undefined;
      if (retryAfterSeconds !== undefined && retryAfterSeconds * 1000 > retry.maxRetryAfterMs) throw error;
      await sleeper(backoffMs(attempt, retry, retryAfterSeconds), caller);
    }
  }

  /** One HTTP attempt. Failures come back as values so the retry loop can decide; aborts and programming errors throw. */
  async #attempt<T>(
    url: URL,
    method: HttpMethod,
    headers: Headers,
    body: BodyInit | undefined,
    spec: RequestSpec,
    caller: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<{ ok: true; value: T } | { ok: false; error: UnitfieldError }> {
    const timer = attemptSignal(caller, timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.#fetch(url, { ...this.#fetchOptions, ...spec.fetchOptions, method, headers, body, signal: timer.signal });
      } catch (error) {
        return { ok: false, error: this.#classify(error, timer, caller, timeoutMs) };
      }
      if (!response.ok) {
        const error = await apiErrorFromResponse(response, { method, url });
        throwIfAborted(caller);
        return { ok: false, error };
      }
      return { ok: true, value: await this.#readSuccess<T>(response, spec, timer, caller, timeoutMs) };
    } catch (error) {
      if (error instanceof NetworkError || error instanceof RequestTimeoutError) return { ok: false, error };
      if (error instanceof InvalidResponseError) return { ok: false, error };
      throw error;
    } finally {
      timer.dispose();
    }
  }

  /** Aborts pass through untouched; anything else that failed before a response becomes a typed error. */
  #classify(error: unknown, timer: AttemptSignal, caller: AbortSignal | undefined, timeoutMs: number): UnitfieldError {
    if (timer.timedOut()) return new RequestTimeoutError(timeoutMs);
    if (isAbortError(error, caller)) throw caller?.aborted ? abortReason(caller) : error;
    if (error instanceof UnitfieldError) return error;
    return new NetworkError(undefined, { cause: error });
  }

  async #readSuccess<T>(response: Response, spec: RequestSpec, timer: AttemptSignal, caller: AbortSignal | undefined, timeoutMs: number): Promise<T> {
    if (spec.response === "none" || response.status === 204 || response.status === 205) {
      await response.body?.cancel().catch(() => undefined);
      return undefined as T;
    }
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      if (timer.timedOut()) throw new RequestTimeoutError(timeoutMs);
      if (isAbortError(error, caller)) throw caller?.aborted ? abortReason(caller) : error;
      throw new NetworkError("Unitfield response was interrupted.", { cause: error });
    }
    if (!text.trim()) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new InvalidResponseError("Unitfield returned invalid JSON.", response.status, { cause: error });
    }
  }

  async #buildHeaders(
    spec: RequestSpec,
    contentType: string | undefined,
    idempotencyKey: string | undefined,
    signal: AbortSignal | undefined,
    forceRefresh: boolean,
  ): Promise<Headers> {
    const headers = new Headers(this.#headers);
    new Headers(spec.headers).forEach((value, key) => headers.set(key, value));
    if (!headers.has("accept")) headers.set("accept", "application/json");
    if (contentType && !headers.has("content-type")) headers.set("content-type", contentType);
    if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);

    if (spec.anonymous) {
      headers.delete("authorization");
      headers.delete("x-unitfield-key");
      return headers;
    }
    if (this.#publishableKey) headers.set("X-Unitfield-Key", this.#publishableKey);
    if (this.#accessToken) {
      headers.set("authorization", `Bearer ${this.#accessToken}`);
    } else if (this.#tokenProvider) {
      headers.set("authorization", `Bearer ${await this.#acquireToken(signal, forceRefresh)}`);
    }
    return headers;
  }

  async #acquireToken(signal: AbortSignal | undefined, forceRefresh: boolean): Promise<string> {
    let token: string;
    try {
      token = await this.#tokenProvider!({ signal, forceRefresh });
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      if (error instanceof UnitfieldError) throw error;
      throw new UnitfieldError("Unitfield token acquisition failed.", { code: "token_error", cause: error });
    }
    if (typeof token !== "string" || !token.trim()) {
      throw new UnitfieldError("Unitfield token provider returned an empty token.", { code: "token_error" });
    }
    return token.trim();
  }
}

function backoffMs(attempt: number, retry: ResolvedRetry, retryAfterSeconds: number | undefined): number {
  const random = retry.random ?? Math.random;
  const ceiling = Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** attempt);
  const jittered = ceiling * (0.5 + random() * 0.5);
  return retryAfterSeconds === undefined ? jittered : Math.max(jittered, retryAfterSeconds * 1000);
}
