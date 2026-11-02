import type { AuthorizationRequest } from "./customer-auth.js";

/** The slice of the Web Storage API used here, so tests and non-browser runtimes can supply their own. */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const PREFIX = "unitfield:auth:";

function defaultStorage(): StorageLike {
  const storage = (globalThis as { sessionStorage?: StorageLike }).sessionStorage;
  if (!storage) throw new TypeError("sessionStorage is not available; pass a storage argument.");
  return storage;
}

/** Keeps one in-flight sign-in under its `state`, so several tabs can sign in at once. Defaults to `sessionStorage`. */
export function saveAuthorizationRequest(request: AuthorizationRequest, storage: StorageLike = defaultStorage()): void {
  storage.setItem(`${PREFIX}${request.state}`, JSON.stringify(request));
}

/** Reads and removes the request saved for `state`. A request can be redeemed once. */
export function takeAuthorizationRequest(state: string, storage: StorageLike = defaultStorage()): AuthorizationRequest | null {
  const key = `${PREFIX}${state}`;
  const raw = storage.getItem(key);
  storage.removeItem(key);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<AuthorizationRequest>;
    return typeof value.state === "string" && typeof value.nonce === "string" && typeof value.codeVerifier === "string" && typeof value.redirectUri === "string"
      ? (value as AuthorizationRequest)
      : null;
  } catch {
    return null;
  }
}

/** Finds the saved request a callback URL belongs to (by its `state` parameter) and removes it. */
export function takeAuthorizationRequestFor(callback: string | URL, storage: StorageLike = defaultStorage()): AuthorizationRequest | null {
  let state: string | null;
  try {
    state = new URL(callback.toString()).searchParams.get("state");
  } catch {
    state = null;
  }
  return state ? takeAuthorizationRequest(state, storage) : null;
}
