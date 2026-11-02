export type IdTokenClaims = {
  iss: string;
  /** The customer account public id (`cus_…`). */
  sub: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean;
  [claim: string]: unknown;
};

export type TokenSet = {
  accessToken: string;
  tokenType: "Bearer";
  /** Milliseconds since the epoch. */
  expiresAt: number;
  /** Present when `offline_access` was granted. Rotates on every refresh. */
  refreshToken?: string;
  idToken?: string;
  scope: string[];
  /** Claims of `idToken`, decoded from the token endpoint response (not signature-verified). */
  claims?: IdTokenClaims;
};

type MaybePromise<T> = T | Promise<T>;

/** Where a {@link CustomerSession} keeps tokens. `memoryTokenStore` is built in; `@unitfield/sdk/server` has an httpOnly cookie store. */
export interface TokenStore {
  get(): MaybePromise<TokenSet | null>;
  set(tokens: TokenSet): MaybePromise<void>;
  clear(): MaybePromise<void>;
}

/** Tokens live only as long as the page or process. The right default for browsers: nothing for XSS to find on disk. */
export function memoryTokenStore(initial?: TokenSet): TokenStore {
  let current: TokenSet | null = initial ?? null;
  return {
    get: () => current,
    set(tokens) {
      current = tokens;
    },
    clear() {
      current = null;
    },
  };
}

/** True when the access token is expired or will be within `skewMs`. */
export function isExpiring(tokens: Pick<TokenSet, "expiresAt">, skewMs = 30_000, now = Date.now()): boolean {
  return tokens.expiresAt - skewMs <= now;
}
