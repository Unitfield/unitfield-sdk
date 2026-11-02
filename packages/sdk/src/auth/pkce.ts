import { base64UrlEncode, randomToken, sha256 } from "./encoding.js";

/** RFC 7636: a high-entropy URL-safe verifier of 43 to 128 characters. */
export function createCodeVerifier(): string {
  return randomToken(32);
}

/** `S256` challenge: base64url(SHA-256(ASCII(verifier))). The only method customer Hydra accepts (`plain` is not enabled). */
export async function createCodeChallenge(verifier: string): Promise<string> {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
    throw new TypeError("codeVerifier must be 43 to 128 unreserved characters (RFC 7636).");
  }
  return base64UrlEncode(await sha256(verifier));
}

export function createState(): string {
  return randomToken(24);
}

export function createNonce(): string {
  return randomToken(24);
}
