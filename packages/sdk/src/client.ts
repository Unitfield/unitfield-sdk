import {
  Transport,
  type AccessTokenProvider,
  type FetchExtras,
  type FetchLike,
  type HttpMethod,
  type RequestOptions,
  type RetryOptions,
} from "./transport.js";
import type { QueryInput } from "./internal/url.js";

/** The production API. Pass `baseUrl` for the sandbox or a local API. */
export const UNITFIELD_API_URL = "https://api.unitfield.com";

export type ClientOptions = {
  /** API origin. Defaults to {@link UNITFIELD_API_URL}. */
  baseUrl?: string | URL;
  fetch?: FetchLike;
  /** Sent on every request. Credentials and the idempotency key set by the SDK always win. */
  headers?: HeadersInit;
  /** Per-attempt timeout in milliseconds. Default 30000; `0` disables. */
  timeoutMs?: number;
  /** `false` disables retries. See `RetryOptions` and the retry rules on `Transport`. */
  retry?: RetryOptions | false;
  /** Extra `fetch` init for every request (`credentials` defaults to `"omit"`). */
  fetchOptions?: FetchExtras;
};

export type BearerClientOptions = ClientOptions & {
  accessToken?: string;
  /** Called per request; it should cache. Called again with `forceRefresh` after a 401. */
  tokenProvider?: AccessTokenProvider;
};

export type ApiRequestOptions = RequestOptions & {
  method?: HttpMethod;
  body?: unknown;
  query?: QueryInput;
  idempotencyKey?: string | true;
};

/**
 * Behavior shared by every client: one transport and a typed escape hatch for routes without a helper.
 * Bearer-authenticated clients are private by default: their requests use `cache: "no-store"`.
 */
export class ApiClient {
  /** Base URL without a trailing slash. */
  readonly baseUrl: string;
  protected readonly http: Transport;

  constructor(http: Transport) {
    this.http = http;
    this.baseUrl = http.baseUrl;
  }

  /** Calls any API route under the configured base URL with this client's credentials, retries and error mapping. */
  request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    return this.http.request<T>({ ...options, path });
  }
}

export function bearerTransport(options: BearerClientOptions): Transport {
  return new Transport({
    ...options,
    baseUrl: options.baseUrl ?? UNITFIELD_API_URL,
    fetchOptions: { cache: "no-store", ...options.fetchOptions },
  });
}
