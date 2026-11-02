import { NetworkError, RequestTimeoutError } from "../errors.js";
import { abortReason, attemptSignal, isAbortError, throwIfAborted } from "../internal/abort.js";
import { validateHttpUrl } from "../internal/url.js";
import { CustomerAuthError, OAuthTokenError } from "../auth/errors.js";
import type { AccessTokenContext, AccessTokenProvider, FetchLike } from "../transport.js";

export type ClientCredentialsTokenProviderOptions = {
  tokenUrl: string | URL;
  clientId: string;
  clientSecret: string;
  scopes?: string | readonly string[];
  /** Resource audience requested from Unitfield Auth. Defaults to `unitfield-api`. */
  audience?: string | readonly string[];
  fetch?: FetchLike;
  timeoutMs?: number;
};

/**
 * OAuth client-credentials grant for an installed app, with caching and single-flight. Server only: the client secret
 * must never reach a browser. Pass the result as `tokenProvider` to `AppsClient`.
 *
 * Uses `client_secret_basic` (each credential form-encoded before HTTP Basic, RFC 6749 section 2.3.1) and refuses
 * redirects so the secret cannot be forwarded elsewhere. A `forceRefresh` request (after a 401) bypasses the cache.
 */
export function createClientCredentialsTokenProvider(options: ClientCredentialsTokenProviderOptions): AccessTokenProvider {
  const tokenUrl = validateHttpUrl(options.tokenUrl, "tokenUrl", { allowQuery: false });
  if (!options.clientId.trim()) throw new TypeError("clientId must not be empty.");
  if (!options.clientSecret.trim()) throw new TypeError("clientSecret must not be empty.");
  const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) throw new TypeError("fetch is not available; provide options.fetch.");

  const scope = typeof options.scopes === "string" ? options.scopes.trim() : options.scopes?.join(" ").trim();
  const audience =
    options.audience === undefined ? "unitfield-api" : typeof options.audience === "string" ? options.audience.trim() : options.audience.join(" ").trim();
  if (!audience) throw new TypeError("audience must not be empty.");
  const timeoutMs = options.timeoutMs ?? 15_000;

  // Percent-encoded output is ASCII, so btoa is safe for Unicode credentials too.
  const formEncode = (value: string) => new URLSearchParams({ value }).toString().slice(6);
  const authorization = `Basic ${btoa(`${formEncode(options.clientId)}:${formEncode(options.clientSecret)}`)}`;

  let cached: { token: string; expiresAt: number } | undefined;
  let pending: Promise<string> | undefined;

  async function fetchToken(signal: AbortSignal | undefined): Promise<string> {
    const body = new URLSearchParams({ grant_type: "client_credentials", audience });
    if (scope) body.set("scope", scope);
    const timer = attemptSignal(signal, timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetchImpl(tokenUrl, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", authorization },
          body,
          signal: timer.signal,
          redirect: "error",
          cache: "no-store",
        });
      } catch (error) {
        if (timer.timedOut()) throw new RequestTimeoutError(timeoutMs);
        if (isAbortError(error, signal)) throw signal?.aborted ? abortReason(signal) : error;
        throw new NetworkError("Unitfield token request failed.", { code: "token_network_error", cause: error });
      }

      const text = await response.text().catch(() => "");
      let payload: Record<string, unknown> | undefined;
      try {
        const parsed: unknown = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
      } catch {
        /* handled below */
      }
      if (!response.ok) {
        const oauthError = typeof payload?.error === "string" ? payload.error : "server_error";
        const description = typeof payload?.error_description === "string" ? payload.error_description : undefined;
        throw new OAuthTokenError(description ?? `The token endpoint refused the request (${oauthError}).`, { oauthError, status: response.status, description });
      }
      const token = payload?.access_token;
      if (typeof token !== "string" || !token.trim()) {
        throw new CustomerAuthError("Unitfield Auth returned no access token.", "invalid_token_response");
      }
      const expiresIn = Number(payload?.expires_in);
      if (Number.isFinite(expiresIn) && expiresIn > 0) {
        cached = { token: token.trim(), expiresAt: Date.now() + Math.max(0, expiresIn * 1000 - 30_000) };
      }
      return token.trim();
    } finally {
      timer.dispose();
    }
  }

  return async (context: AccessTokenContext = {}) => {
    throwIfAborted(context.signal);
    if (!context.forceRefresh && cached && cached.expiresAt > Date.now()) return cached.token;
    if (context.forceRefresh) cached = undefined;
    if (pending) return pending;
    const current = fetchToken(context.signal);
    pending = current;
    try {
      return await current;
    } finally {
      if (pending === current) pending = undefined;
    }
  };
}
