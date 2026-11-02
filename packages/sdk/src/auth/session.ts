import { isAbortError, abortReason, throwIfAborted } from "../internal/abort.js";
import type { AccessTokenContext, AccessTokenProvider } from "../transport.js";
import { CustomerAuthError, NotSignedInError, RefreshTokenRevokedError } from "./errors.js";
import type { AuthorizationRequest, CustomerAuth, SignOutOptions, SignOutResult } from "./customer-auth.js";
import { isExpiring, memoryTokenStore, type TokenSet, type TokenStore } from "./tokens.js";

/** Runs `task` while holding a lock named `name`, across tabs where the runtime can. */
export type RefreshLock = <T>(name: string, task: () => Promise<T>) => Promise<T>;

export type CustomerSessionOptions = {
  auth: CustomerAuth;
  /** Defaults to {@link memoryTokenStore}. */
  store?: TokenStore;
  /** Refresh this many seconds before the access token expires. Default 30. */
  refreshSkewSeconds?: number;
  /**
   * Serializes refreshes. Hydra rotates refresh tokens with no grace window, so two tabs refreshing with the same
   * token would trip reuse detection and end the session. Defaults to the Web Locks API where it exists; pass `false`
   * for none (a single process is already safe: refreshes inside one session are single-flight).
   */
  lock?: RefreshLock | false;
};

export type TokenListener = (tokens: TokenSet | null) => void;

function webLocks(): RefreshLock | undefined {
  const locks = (globalThis as { navigator?: { locks?: { request: (name: string, callback: () => Promise<unknown>) => Promise<unknown> } } }).navigator?.locks;
  return locks ? ((name, task) => locks.request(name, task) as Promise<never>) : undefined;
}

/**
 * Holds a customer's tokens and keeps the access token fresh. Pass `session.tokenProvider` to a resident or
 * applicant client and every request carries a valid bearer.
 *
 * Failure semantics: when the issuer rejects the refresh token (reuse detection, sign-out elsewhere, expiry) the
 * session clears its store and rejects with {@link RefreshTokenRevokedError}; a transient failure leaves tokens alone.
 */
export class CustomerSession {
  readonly auth: CustomerAuth;
  readonly #store: TokenStore;
  readonly #skewMs: number;
  readonly #lock: RefreshLock | undefined;
  readonly #listeners = new Set<TokenListener>();
  #refreshing: Promise<TokenSet> | undefined;

  /** Pass to a client's `tokenProvider` option. */
  readonly tokenProvider: AccessTokenProvider = (context) => this.getAccessToken(context);

  constructor(options: CustomerSessionOptions) {
    this.auth = options.auth;
    this.#store = options.store ?? memoryTokenStore();
    this.#skewMs = (options.refreshSkewSeconds ?? 30) * 1000;
    this.#lock = options.lock === false ? undefined : (options.lock ?? webLocks());
  }

  getTokens(): Promise<TokenSet | null> {
    return Promise.resolve(this.#store.get());
  }

  /** Stores tokens obtained elsewhere (for example from a server callback). */
  async setTokens(tokens: TokenSet): Promise<void> {
    await this.#store.set(tokens);
    this.#notify(tokens);
  }

  /** `auth.handleCallback` plus storing the result. Returns the tokens. */
  async completeSignIn(callback: string | URL | URLSearchParams, request: AuthorizationRequest, options: { signal?: AbortSignal } = {}): Promise<TokenSet> {
    const tokens = await this.auth.handleCallback(callback, request, options);
    await this.setTokens(tokens);
    return tokens;
  }

  /** A valid access token, refreshing first when it is (about to be) expired or `forceRefresh` is set. */
  async getAccessToken(context: AccessTokenContext = {}): Promise<string> {
    throwIfAborted(context.signal);
    const tokens = await this.#store.get();
    if (!tokens) throw new NotSignedInError();
    if (!context.forceRefresh && !isExpiring(tokens, this.#skewMs)) return tokens.accessToken;
    return (await this.#waitFor(this.#refresh(tokens), context.signal)).accessToken;
  }

  /** Revokes at the issuer, clears the store, and returns the end-session URL to navigate to. */
  async signOut(options: SignOutOptions = {}): Promise<SignOutResult> {
    const tokens = await this.#store.get();
    let result: SignOutResult = { logoutUrl: null, revoked: false };
    try {
      result = await this.auth.signOut(tokens ?? {}, options);
    } finally {
      await this.#store.clear();
      this.#notify(null);
    }
    return result;
  }

  subscribe(listener: TokenListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Single-flight: concurrent callers share one refresh, so one token is never redeemed twice. */
  #refresh(stale: TokenSet): Promise<TokenSet> {
    if (!this.#refreshing) {
      const run = () => this.#refreshOnce(stale);
      const guarded = this.#lock ? this.#lock(`unitfield:refresh:${this.auth.clientId}`, run) : run();
      const current = guarded.finally(() => {
        if (this.#refreshing === current) this.#refreshing = undefined;
      });
      this.#refreshing = current;
    }
    return this.#refreshing;
  }

  async #refreshOnce(stale: TokenSet): Promise<TokenSet> {
    // Another tab may have refreshed while this one waited for the lock: use its result instead of reusing a spent token.
    const current = await this.#store.get();
    if (!current) throw new NotSignedInError();
    if (current.accessToken !== stale.accessToken && !isExpiring(current, this.#skewMs)) return current;
    if (!current.refreshToken) {
      throw new CustomerAuthError("The access token expired and there is no refresh token. Sign in again.", "no_refresh_token");
    }
    let next: TokenSet;
    try {
      next = await this.auth.refresh(current);
    } catch (error) {
      if (error instanceof RefreshTokenRevokedError) {
        await this.#store.clear();
        this.#notify(null);
      }
      throw error;
    }
    await this.#store.set(next);
    this.#notify(next);
    return next;
  }

  /** The caller may stop waiting; the shared refresh itself must not be cancelled by one caller. */
  #waitFor<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
    if (!signal) return promise;
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(abortReason(signal));
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(resolve, (error: unknown) => reject(isAbortError(error, signal) ? abortReason(signal) : error)).finally(() => signal.removeEventListener("abort", onAbort));
    });
  }

  #notify(tokens: TokenSet | null): void {
    for (const listener of this.#listeners) {
      try {
        listener(tokens);
      } catch {
        /* a failing listener must not break the session */
      }
    }
  }
}

export function createCustomerSession(options: CustomerSessionOptions): CustomerSession {
  return new CustomerSession(options);
}
