/** Base64url (RFC 4648 section 5) without padding, plus the Web Crypto pieces PKCE needs. Core code never imports `node:crypto`. */

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new TypeError("Not a base64url string.");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function webCrypto(): Crypto {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle || !cryptoApi.getRandomValues) {
    throw new TypeError("Web Crypto (crypto.subtle) is not available in this runtime.");
  }
  return cryptoApi;
}

/** `byteLength` random bytes as base64url. 32 bytes gives a 43-character string: the RFC 7636 verifier minimum. */
export function randomToken(byteLength = 32): string {
  return base64UrlEncode(webCrypto().getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256(input: string | Uint8Array): Promise<Uint8Array> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return new Uint8Array(await webCrypto().subtle.digest("SHA-256", bytes as BufferSource));
}
