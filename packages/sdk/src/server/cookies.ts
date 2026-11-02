import { base64UrlDecode, base64UrlEncode } from "../auth/encoding.js";
import { decodeJwtPayload } from "../auth/jwt.js";
import type { AuthorizationRequest } from "../auth/customer-auth.js";
import type { IdTokenClaims, TokenSet, TokenStore } from "../auth/tokens.js";
import { UnitfieldError } from "../errors.js";

/** The cookie operations the stores need. Next.js `cookies()` already has this shape; adapt other frameworks to it. */
export type CookieJar = {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options: CookieAttributes): void;
  delete(name: string): void;
};

export type CookieAttributes = {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax" | "strict";
  path: "/";
  maxAge: number;
};

export type SealedCookieOptions = {
  /** At least 32 characters of secret material (an environment secret). Rotating it signs everyone out. */
  secret: string;
  /** Default `__Host-uf_sdk` (tokens) or `__Host-uf_sdk_auth` (in-flight sign-in). `__Host-` cookies require `secure` and no Domain. */
  name?: string;
  /** Lifetime of the cookie. Defaults: 30 days for tokens (the refresh token's life), 10 minutes for a sign-in. */
  maxAgeSeconds?: number;
  /** Default true. Browsers accept `Secure` cookies on `http://localhost`. */
  secure?: boolean;
  sameSite?: "lax" | "strict";
};

export type TokenCookieOptions = SealedCookieOptions & {
  /** Keep the ID token (needed for `id_token_hint` at sign-out). Default true; drop it when cookie size is tight. */
  includeIdToken?: boolean;
};

const MAX_COOKIE_VALUE = 3800;
const TOKEN_COOKIE = "__Host-uf_sdk";
const AUTH_COOKIE = "__Host-uf_sdk_auth";

/**
 * Keeps a customer's tokens in an httpOnly, sealed (AES-256-GCM) cookie so the browser never sees them: the server
 * flow of the SDK. Use it as the `store` of a `CustomerSession` on the server.
 */
export function createCookieTokenStore(jar: CookieJar, options: TokenCookieOptions): TokenStore {
  const sealer = createSealer(options, TOKEN_COOKIE, 30 * 24 * 60 * 60);
  const includeIdToken = options.includeIdToken !== false;
  return {
    async get() {
      const raw = jar.get(sealer.name)?.value;
      if (!raw) return null;
      const stored = await sealer.unseal<StoredTokens>(raw);
      return stored && isStoredTokens(stored) ? hydrate(stored) : null;
    },
    async set(tokens) {
      const stored: StoredTokens = {
        a: tokens.accessToken,
        e: tokens.expiresAt,
        s: tokens.scope,
        ...(tokens.refreshToken ? { r: tokens.refreshToken } : {}),
        ...(includeIdToken && tokens.idToken ? { i: tokens.idToken } : {}),
      };
      jar.set(sealer.name, await sealer.seal(stored), sealer.attributes);
    },
    clear() {
      jar.delete(sealer.name);
    },
  };
}

export type AuthorizationRequestCookie = {
  save(request: AuthorizationRequest): Promise<void>;
  /** Reads and removes the in-flight sign-in. `null` when absent, tampered with, or for a different `state`. */
  take(state: string): Promise<AuthorizationRequest | null>;
};

/** Holds the `AuthorizationRequest` (PKCE verifier included) between the redirect out and the callback, sealed in an httpOnly cookie. */
export function createAuthorizationRequestCookie(jar: CookieJar, options: SealedCookieOptions): AuthorizationRequestCookie {
  const sealer = createSealer(options, AUTH_COOKIE, 10 * 60);
  return {
    async save(request) {
      jar.set(sealer.name, await sealer.seal(request), sealer.attributes);
    },
    async take(state) {
      const raw = jar.get(sealer.name)?.value;
      jar.delete(sealer.name);
      if (!raw) return null;
      const request = await sealer.unseal<AuthorizationRequest>(raw);
      return request && request.state === state && typeof request.codeVerifier === "string" && typeof request.nonce === "string" ? request : null;
    },
  };
}

type StoredTokens = { a: string; e: number; s: string[]; r?: string; i?: string };

function isStoredTokens(value: StoredTokens): boolean {
  return typeof value.a === "string" && typeof value.e === "number" && Array.isArray(value.s);
}

function hydrate(stored: StoredTokens): TokenSet {
  let claims: IdTokenClaims | undefined;
  if (stored.i) {
    try {
      claims = decodeJwtPayload(stored.i) as IdTokenClaims;
    } catch {
      claims = undefined;
    }
  }
  return { accessToken: stored.a, tokenType: "Bearer", expiresAt: stored.e, refreshToken: stored.r, idToken: stored.i, scope: stored.s, claims };
}

function createSealer(options: SealedCookieOptions, defaultName: string, defaultMaxAge: number) {
  if (typeof options?.secret !== "string" || options.secret.length < 32) {
    throw new TypeError("secret must be at least 32 characters.");
  }
  const name = options.name ?? defaultName;
  const secure = options.secure ?? true;
  if (name.startsWith("__Host-") && !secure) throw new TypeError("A __Host- cookie must be Secure; use a different name for insecure local development.");
  const attributes: CookieAttributes = { httpOnly: true, secure, sameSite: options.sameSite ?? "lax", path: "/", maxAge: options.maxAgeSeconds ?? defaultMaxAge };
  let keyPromise: Promise<CryptoKey> | undefined;
  const key = () =>
    (keyPromise ??= crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(options.secret))
      .then((digest) => crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"])));
  // The cookie name is authenticated data: a value sealed for one cookie cannot be replayed into another.
  const additionalData = new TextEncoder().encode(name);

  return {
    name,
    attributes,
    async seal(value: unknown): Promise<string> {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const cipher = new Uint8Array(
        await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData }, await key(), new TextEncoder().encode(JSON.stringify(value))),
      );
      const sealed = `v1.${base64UrlEncode(iv)}.${base64UrlEncode(cipher)}`;
      if (sealed.length > MAX_COOKIE_VALUE) {
        throw new UnitfieldError("The sealed cookie would exceed the browser cookie size limit; drop the ID token or request fewer scopes.", { code: "cookie_too_large" });
      }
      return sealed;
    },
    async unseal<T>(sealed: string): Promise<T | null> {
      const [version, iv, cipher] = sealed.split(".");
      if (version !== "v1" || !iv || !cipher) return null;
      try {
        const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64UrlDecode(iv) as BufferSource, additionalData }, await key(), base64UrlDecode(cipher) as BufferSource);
        return JSON.parse(new TextDecoder().decode(plain)) as T;
      } catch {
        return null;
      }
    },
  };
}
