import { base64UrlDecode } from "./encoding.js";

/**
 * Reads the payload of a JWT WITHOUT verifying its signature. Only use it on tokens that arrived straight from the
 * token endpoint over TLS (OIDC Core 3.1.3.7 permits that), or to read claims for display. Never to authorize anything:
 * the API verifies access tokens itself.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) throw new TypeError("Not a JWT.");
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
  } catch {
    throw new TypeError("JWT payload is not valid JSON.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("JWT payload is not an object.");
  return value as Record<string, unknown>;
}
