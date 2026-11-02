import { NetworkError, RequestTimeoutError, UnitfieldError } from "../errors.js";
import { abortReason, attemptSignal, isAbortError, throwIfAborted } from "../internal/abort.js";
import { validateHttpUrl } from "../internal/url.js";
import type { FetchLike } from "../transport.js";
import { CustomerAuthError, OAuthTokenError, RefreshTokenRevokedError } from "./errors.js";
import { randomToken } from "./encoding.js";
import { decodeJwtPayload } from "./jwt.js";
import { createCodeChallenge, createCodeVerifier, createNonce, createState } from "./pkce.js";
import type { IdTokenClaims, TokenSet } from "./tokens.js";

/** Customer-realm Hydra. One issuer serves every organization; the client id decides which org you sign in to. */
export const UNITFIELD_ID_URL = "https://id.unitfield.app";

/** The scopes customer Hydra knows (spec section 3.3.5). Request only what the site needs; the site key's client must allow them. */
export const CustomerScopes = Object.freeze({
  openid: "openid",
  email: "email",
  offlineAccess: "offline_access",
  residentRead: "resident:read",
  residentPay: "resident:pay",
  residentRequests: "resident:requests",
  applicationsRead: "applications:read",
  applicationsWrite: "applications:write",
} as const);

const DEFAULT_SCOPES = ["openid", "email", "offline_access"] as const;
const DEFAULT_TIMEOUT_MS = 15_000;

export type CustomerAuthEndpoints = {
  authorization: string;
  token: string;
  revocation?: string;
  endSession?: string;
};

export type CustomerAuthOptions = {
  /** The public OAuth client of your site key (shown next to the key in Website › Developer). */
  clientId: string;
  /** One of the redirect URIs registered for the site key, exactly. `https`, or `http` on localhost. */
  redirectUri: string | URL;
  /** One of the registered post-logout URIs. */
  postLogoutRedirectUri?: string | URL;
  /** Defaults to {@link UNITFIELD_ID_URL}. */
  issuer?: string | URL;
  /** Defaults to `openid email offline_access`. `openid` is always required. */
  scopes?: readonly string[];
  fetch?: FetchLike;
  /** Skips OIDC discovery. For tests and for issuers whose discovery document is unreachable. */
  endpoints?: CustomerAuthEndpoints;
  /** Tolerated clock difference when checking ID token times. Default 60. */
  clockSkewSeconds?: number;
  timeoutMs?: number;
};

export type SignInOptions = {
  scopes?: readonly string[];
  /** Pre-fills the email on the hosted sign-in page. */
  loginHint?: string;
  /** `login` forces the sign-in screen even with a live org session. */
  prompt?: "login" | "none";
  signal?: AbortSignal;
};

/**
 * Everything the callback needs, JSON-serializable. Persist it between the redirect out and the callback:
 * `sessionStorage` in a SPA (see `saveAuthorizationRequest`), a sealed httpOnly cookie in a server flow.
 */
export type AuthorizationRequest = {
  /** Send the browser here. */
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  scopes: string[];
  /** Milliseconds since the epoch. */
  createdAt: number;
};

export type SignOutOptions = {
  /** Overrides the client's `postLogoutRedirectUri`. */
  postLogoutRedirectUri?: string | URL;
  state?: string;
  signal?: AbortSignal;
};

export type SignOutResult = {
  /** Navigate the browser here to end the customer session at the issuer. `null` when the issuer has no end-session endpoint. */
  logoutUrl: string | null;
  /** Whether the refresh token was revoked at the issuer. Sign-out proceeds either way. */
  revoked: boolean;
};

type Metadata = CustomerAuthEndpoints & { issuer: string };

/**
 * OIDC authorization code flow with PKCE (S256) for a public customer-realm client.
 *
 * The helpers are stateless: `createAuthorizationRequest` returns what you must keep, `handleCallback` consumes it.
 * ID tokens are validated for issuer, audience, expiry and nonce but not for signature: they come straight from the
 * token endpoint over TLS, which OIDC Core permits. The API verifies access tokens itself.
 */
export class CustomerAuth {
  readonly clientId: string;
  readonly issuer: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly #postLogoutRedirectUri?: string;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;
  readonly #skewSeconds: number;
  #metadata?: Promise<Metadata>;

  constructor(options: CustomerAuthOptions) {
    if (typeof options?.clientId !== "string" || !options.clientId.trim()) throw new TypeError("clientId must not be empty.");
    this.clientId = options.clientId.trim();
    this.issuer = trimSlashes(validateHttpUrl(options.issuer ?? UNITFIELD_ID_URL, "issuer", { allowQuery: false }).toString());
    this.redirectUri = validateRedirectUri(options.redirectUri, "redirectUri");
    this.#postLogoutRedirectUri = options.postLogoutRedirectUri === undefined ? undefined : validateRedirectUri(options.postLogoutRedirectUri, "postLogoutRedirectUri");
    this.scopes = normalizeScopes(options.scopes ?? DEFAULT_SCOPES);
    const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
    if (!fetchImpl) throw new TypeError("fetch is not available; provide options.fetch.");
    this.#fetch = fetchImpl;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#skewSeconds = options.clockSkewSeconds ?? 60;
    if (options.endpoints) {
      const { authorization, token, revocation, endSession } = options.endpoints;
      this.#metadata = Promise.resolve({
        issuer: this.issuer,
        authorization: validateHttpUrl(authorization, "endpoints.authorization").toString(),
        token: validateHttpUrl(token, "endpoints.token").toString(),
        revocation: revocation ? validateHttpUrl(revocation, "endpoints.revocation").toString() : undefined,
        endSession: endSession ? validateHttpUrl(endSession, "endpoints.endSession").toString() : undefined,
      });
    }
  }

  /** Builds the authorization URL and the PKCE/state/nonce secrets for one sign-in attempt. */
  async createAuthorizationRequest(options: SignInOptions = {}): Promise<AuthorizationRequest> {
    const scopes = options.scopes ? normalizeScopes(options.scopes) : [...this.scopes];
    const metadata = await this.#getMetadata(options.signal);
    const codeVerifier = createCodeVerifier();
    const state = createState();
    const nonce = createNonce();

    const url = new URL(metadata.authorization);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", this.redirectUri);
    url.searchParams.set("scope", scopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("code_challenge", await createCodeChallenge(codeVerifier));
    url.searchParams.set("code_challenge_method", "S256");
    if (options.loginHint) url.searchParams.set("login_hint", options.loginHint);
    if (options.prompt) url.searchParams.set("prompt", options.prompt);

    return { url: url.toString(), state, nonce, codeVerifier, redirectUri: this.redirectUri, scopes, createdAt: Date.now() };
  }

  /**
   * Finishes sign-in: checks the callback (error, `state`, `iss`), redeems the code with the PKCE verifier, and
   * validates the ID token. `callback` is the full callback URL (or its query string).
   */
  async handleCallback(callback: string | URL | URLSearchParams, request: AuthorizationRequest, options: { signal?: AbortSignal } = {}): Promise<TokenSet> {
    const params = callbackParams(callback);
    const error = params.get("error");
    if (error) {
      throw new CustomerAuthError(params.get("error_description") ?? `The sign-in was not completed (${error}).`, "authorization_denied", {
        oauthError: error,
        description: params.get("error_description") ?? undefined,
      });
    }
    if (params.get("state") !== request.state) {
      throw new CustomerAuthError("The sign-in response does not match the request that started it.", "state_mismatch");
    }
    const iss = params.get("iss");
    if (iss !== null && trimSlashes(iss) !== this.issuer) {
      throw new CustomerAuthError("The sign-in response came from a different issuer.", "issuer_mismatch");
    }
    const code = params.get("code");
    if (!code) throw new CustomerAuthError("The sign-in response carried no authorization code.", "missing_code");

    const metadata = await this.#getMetadata(options.signal);
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: request.redirectUri,
      client_id: this.clientId,
      code_verifier: request.codeVerifier,
    });
    const payload = await this.#postForm(metadata.token, body, options.signal);
    return this.#tokenSetFrom(payload, { nonce: request.nonce, requireIdToken: request.scopes.includes("openid") });
  }

  /**
   * Redeems the refresh token. Hydra rotates it on every use and revokes the whole family when an old one comes
   * back (spec section 14.7), so a rejected refresh surfaces as {@link RefreshTokenRevokedError}: sign in again.
   * Other failures (network, 5xx, `invalid_client`) leave your tokens untouched and may be retried.
   */
  async refresh(tokens: Pick<TokenSet, "refreshToken" | "idToken" | "scope">, options: { signal?: AbortSignal } = {}): Promise<TokenSet> {
    if (!tokens.refreshToken) {
      throw new CustomerAuthError("There is no refresh token; request the offline_access scope when signing in.", "no_refresh_token");
    }
    const metadata = await this.#getMetadata(options.signal);
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refreshToken, client_id: this.clientId });
    const payload = await this.#postForm(metadata.token, body, options.signal);
    const next = this.#tokenSetFrom(payload, { requireIdToken: false });
    return {
      ...next,
      refreshToken: next.refreshToken ?? tokens.refreshToken,
      idToken: next.idToken ?? tokens.idToken,
      scope: next.scope.length ? next.scope : tokens.scope,
    };
  }

  /**
   * Revokes the refresh token (RFC 7009) and builds the RP-initiated logout URL. The caller clears its own stores
   * and navigates to `logoutUrl`; the issuer then ends the customer session and revokes that org's customer tokens.
   */
  async signOut(tokens: Pick<TokenSet, "idToken" | "refreshToken"> = {}, options: SignOutOptions = {}): Promise<SignOutResult> {
    const metadata = await this.#getMetadata(options.signal);
    let revoked = false;
    if (metadata.revocation && tokens.refreshToken) {
      try {
        await this.#postForm(
          metadata.revocation,
          new URLSearchParams({ token: tokens.refreshToken, token_type_hint: "refresh_token", client_id: this.clientId }),
          options.signal,
          { expectJson: false },
        );
        revoked = true;
      } catch (error) {
        if (isAbortError(error, options.signal)) throw error;
      }
    }
    let logoutUrl: string | null = null;
    if (metadata.endSession) {
      const url = new URL(metadata.endSession);
      if (tokens.idToken) url.searchParams.set("id_token_hint", tokens.idToken);
      const postLogout = options.postLogoutRedirectUri === undefined ? this.#postLogoutRedirectUri : validateRedirectUri(options.postLogoutRedirectUri, "postLogoutRedirectUri");
      if (postLogout) {
        url.searchParams.set("post_logout_redirect_uri", postLogout);
        url.searchParams.set("state", options.state ?? randomToken(16));
      }
      logoutUrl = url.toString();
    }
    return { logoutUrl, revoked };
  }

  #getMetadata(signal?: AbortSignal): Promise<Metadata> {
    throwIfAborted(signal);
    if (!this.#metadata) {
      const discovery = this.#discover();
      this.#metadata = discovery;
      // A failed discovery must not be cached: the next call tries again.
      discovery.catch(() => {
        if (this.#metadata === discovery) this.#metadata = undefined;
      });
    }
    return this.#metadata;
  }

  async #discover(): Promise<Metadata> {
    const url = `${this.issuer}/.well-known/openid-configuration`;
    const timer = attemptSignal(undefined, this.#timeoutMs);
    try {
      const response = await this.#fetch(url, { headers: { accept: "application/json" }, credentials: "omit", signal: timer.signal });
      if (!response.ok) throw new CustomerAuthError(`OIDC discovery failed with HTTP ${response.status}.`, "discovery_failed");
      const document = (await response.json()) as Record<string, unknown>;
      if (typeof document.issuer !== "string" || trimSlashes(document.issuer) !== this.issuer) {
        throw new CustomerAuthError("The discovery document belongs to a different issuer.", "issuer_mismatch");
      }
      const methods = document.code_challenge_methods_supported;
      if (Array.isArray(methods) && !methods.includes("S256")) {
        throw new CustomerAuthError("The issuer does not support PKCE S256.", "discovery_failed");
      }
      return {
        issuer: this.issuer,
        authorization: requireEndpoint(document, "authorization_endpoint"),
        token: requireEndpoint(document, "token_endpoint"),
        revocation: optionalEndpoint(document, "revocation_endpoint"),
        endSession: optionalEndpoint(document, "end_session_endpoint"),
      };
    } catch (error) {
      if (error instanceof UnitfieldError) throw error;
      if (timer.timedOut()) throw new CustomerAuthError("OIDC discovery timed out.", "discovery_failed", { cause: new RequestTimeoutError(this.#timeoutMs) });
      throw new CustomerAuthError("OIDC discovery failed.", "discovery_failed", { cause: error });
    } finally {
      timer.dispose();
    }
  }

  async #postForm(url: string, body: URLSearchParams, signal: AbortSignal | undefined, options: { expectJson?: boolean } = {}): Promise<Record<string, unknown>> {
    throwIfAborted(signal);
    const timer = attemptSignal(signal, this.#timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.#fetch(url, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
          body,
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          signal: timer.signal,
        });
      } catch (error) {
        if (timer.timedOut()) throw new RequestTimeoutError(this.#timeoutMs);
        if (isAbortError(error, signal)) throw signal?.aborted ? abortReason(signal) : error;
        throw new NetworkError("Unitfield sign-in request failed before receiving a response.", { cause: error });
      }
      const text = await response.text().catch(() => "");
      if (!response.ok) throw oauthErrorFrom(response.status, text, body.get("grant_type"));
      if (options.expectJson === false) return {};
      try {
        const parsed: unknown = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
      } catch {
        /* falls through */
      }
      throw new CustomerAuthError("The token endpoint returned an unreadable response.", "invalid_token_response");
    } finally {
      timer.dispose();
    }
  }

  #tokenSetFrom(payload: Record<string, unknown>, expectations: { nonce?: string; requireIdToken: boolean }): TokenSet {
    const accessToken = payload.access_token;
    if (typeof accessToken !== "string" || !accessToken.trim()) {
      throw new CustomerAuthError("The token endpoint returned no access token.", "invalid_token_response");
    }
    if (typeof payload.token_type === "string" && payload.token_type.toLowerCase() !== "bearer") {
      throw new CustomerAuthError("The token endpoint returned an unsupported token type.", "invalid_token_response");
    }
    const expiresIn = Number(payload.expires_in);
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new CustomerAuthError("The token endpoint returned no usable expiry.", "invalid_token_response");
    }
    const idToken = typeof payload.id_token === "string" && payload.id_token ? payload.id_token : undefined;
    if (!idToken && expectations.requireIdToken) {
      throw new CustomerAuthError("The token endpoint returned no ID token for an openid request.", "invalid_id_token");
    }
    return {
      accessToken: accessToken.trim(),
      tokenType: "Bearer",
      expiresAt: Date.now() + expiresIn * 1000,
      refreshToken: typeof payload.refresh_token === "string" && payload.refresh_token ? payload.refresh_token : undefined,
      idToken,
      scope: typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [],
      claims: idToken ? this.#validateIdToken(idToken, expectations.nonce) : undefined,
    };
  }

  #validateIdToken(idToken: string, expectedNonce: string | undefined): IdTokenClaims {
    let claims: Record<string, unknown>;
    try {
      claims = decodeJwtPayload(idToken);
    } catch (error) {
      throw new CustomerAuthError("The ID token is not a valid JWT.", "invalid_id_token", { cause: error });
    }
    const invalid = (reason: string) => new CustomerAuthError(`The ID token is invalid: ${reason}.`, "invalid_id_token");
    if (typeof claims.iss !== "string" || trimSlashes(claims.iss) !== this.issuer) throw new CustomerAuthError("The ID token was issued by a different issuer.", "issuer_mismatch");
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(this.clientId)) throw invalid("it is not for this client");
    if (typeof claims.sub !== "string" || !claims.sub) throw invalid("it has no subject");
    if (typeof claims.exp !== "number" || claims.exp + this.#skewSeconds < Date.now() / 1000) throw invalid("it has expired");
    if (typeof claims.iat === "number" && claims.iat - this.#skewSeconds > Date.now() / 1000) throw invalid("it was issued in the future");
    if (expectedNonce !== undefined && claims.nonce !== expectedNonce) {
      throw new CustomerAuthError("The ID token nonce does not match the sign-in request.", "nonce_mismatch");
    }
    return claims as IdTokenClaims;
  }
}

export function createCustomerAuth(options: CustomerAuthOptions): CustomerAuth {
  return new CustomerAuth(options);
}

function oauthErrorFrom(status: number, text: string, grantType: string | null): UnitfieldError {
  let body: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    /* non-JSON error body */
  }
  const oauthError = typeof body?.error === "string" ? body.error : "server_error";
  const description = typeof body?.error_description === "string" ? body.error_description : undefined;
  if (grantType === "refresh_token" && oauthError === "invalid_grant") return new RefreshTokenRevokedError({ status, description });
  return new OAuthTokenError(description ?? `The token endpoint refused the request (${oauthError}).`, { oauthError, status, description });
}

function callbackParams(callback: string | URL | URLSearchParams): URLSearchParams {
  if (callback instanceof URLSearchParams) return callback;
  const text = callback.toString();
  try {
    return new URL(text).searchParams;
  } catch {
    return new URLSearchParams(text.startsWith("?") ? text.slice(1) : text);
  }
}

function trimSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeScopes(scopes: readonly string[]): string[] {
  const unique = [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))];
  if (!unique.includes("openid")) throw new TypeError('scopes must include "openid".');
  if (unique.some((scope) => /\s/.test(scope))) throw new TypeError("a scope must not contain whitespace.");
  return unique;
}

function validateRedirectUri(value: string | URL, name: string): string {
  const url = validateHttpUrl(value, name);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !local) throw new TypeError(`${name} must use https (http is only allowed on localhost).`);
  if (url.hash) throw new TypeError(`${name} must not contain a fragment.`);
  // Sent verbatim: the issuer compares redirect URIs as exact strings, so normalizing here could break the match.
  return value.toString().trim();
}

function requireEndpoint(document: Record<string, unknown>, key: string): string {
  const value = optionalEndpoint(document, key);
  if (!value) throw new CustomerAuthError(`The discovery document has no ${key}.`, "discovery_failed");
  return value;
}

function optionalEndpoint(document: Record<string, unknown>, key: string): string | undefined {
  const value = document[key];
  if (typeof value !== "string" || !value) return undefined;
  try {
    return validateHttpUrl(value, key).toString();
  } catch (error) {
    throw new CustomerAuthError(`The discovery document's ${key} is not a valid URL.`, "discovery_failed", { cause: error });
  }
}
