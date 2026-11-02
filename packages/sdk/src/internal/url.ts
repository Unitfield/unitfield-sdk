export type UrlOptions = { allowQuery?: boolean };

/** Parses an absolute http(s) URL without credentials. Throws `TypeError` (a programming error, not an API failure). */
export function validateHttpUrl(value: string | URL, name = "URL", options: UrlOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(value.toString());
  } catch {
    throw new TypeError(`${name} must be an absolute HTTP(S) URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(`${name} must use HTTP or HTTPS.`);
  }
  if (url.username || url.password) {
    throw new TypeError(`${name} must not contain user credentials.`);
  }
  if (options.allowQuery === false && (url.search || url.hash)) {
    throw new TypeError(`${name} must not contain a query string or hash.`);
  }
  return url;
}

/** One URL path segment from caller input: trimmed, percent-encoded, never `.` or `..`. */
export function pathSegment(value: string, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (trimmed === "." || trimmed === "..") {
    throw new TypeError(`${name} must not be a relative path.`);
  }
  return encodeURIComponent(trimmed);
}

export type QueryScalar = string | number | boolean | Date;
export type QueryValue = QueryScalar | null | undefined | readonly QueryScalar[];
export type QueryInput = Readonly<Record<string, QueryValue>>;

/** `undefined`, `null` and empty strings are omitted; arrays repeat the key; dates serialize as `YYYY-MM-DD`. */
export function appendQuery(target: URLSearchParams, query: QueryInput | undefined): void {
  if (!query) return;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === "" || item === undefined || item === null) continue;
      target.append(key, formatScalar(item as QueryScalar, key));
    }
  }
}

function formatScalar(value: QueryScalar, key: string): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError(`${key} must be a valid date.`);
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError(`${key} must be a finite number.`);
  }
  return String(value);
}

/**
 * Resolves an API path against the client's base URL. The path must start with `/` and stay on the base origin;
 * a path prefix on the base URL (a gateway mount point) is kept.
 */
export function resolveApiUrl(base: URL, path: string, query?: QueryInput): URL {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) {
    throw new TypeError("path must be an absolute API path beginning with '/'.");
  }
  const prefix = base.pathname.replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(`${prefix}${path}`, base.origin);
  } catch {
    throw new TypeError("path must be a valid API path.");
  }
  if (url.origin !== base.origin) {
    throw new TypeError("path must resolve to the configured base URL.");
  }
  appendQuery(url.searchParams, query);
  return url;
}
