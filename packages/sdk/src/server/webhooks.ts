import { UnitfieldError } from "../errors.js";

/** The headers Unitfield sends with every webhook delivery. */
export const WebhookHeaders = Object.freeze({
  signature: "x-unitfield-signature",
  delivery: "x-unitfield-delivery",
  event: "x-unitfield-event",
} as const);

export type WebhookVerificationReason =
  | "missing_signature"
  | "malformed_signature"
  | "timestamp_out_of_tolerance"
  | "signature_mismatch"
  | "replayed"
  | "payload_too_large";

/**
 * A delivery that must not be trusted. Answer it with a 4xx and do not process it. `reason` says why; do not leak it to the sender.
 * (A missing or empty `secret` is a configuration error and throws a `TypeError` instead.)
 */
export class WebhookVerificationError extends UnitfieldError {
  override readonly name: string = "WebhookVerificationError";
  readonly reason: WebhookVerificationReason;
  constructor(reason: WebhookVerificationReason, message: string) {
    super(message, { code: `webhook_${reason}` });
    this.reason = reason;
  }
}

/** The JSON envelope of every delivery (event catalog version 1). */
export type WebhookEvent<TData = unknown> = {
  /** The delivery's event id. Stable across retries: use it to make processing idempotent. */
  id: string;
  /** For example `listing.updated`. The catalog is at `GET /api/platform/v1/webhook-events`. */
  type: string;
  /** ISO 8601 time the event was created. */
  created: string;
  data: TData;
};

/**
 * Remembers signatures already accepted. `claim` must be atomic: it resolves `true` when `key` was new (and records
 * it for `ttlMs`) and `false` when it was already there. Back it with Redis (`SET key 1 NX PX ttl`) or similar when
 * more than one process receives webhooks; the default in-memory store only protects a single process.
 */
export interface ReplayStore {
  claim(key: string, ttlMs: number): boolean | Promise<boolean>;
}

export function createMemoryReplayStore(options: { maxEntries?: number; now?: () => number } = {}): ReplayStore {
  const maxEntries = options.maxEntries ?? 10_000;
  const now = options.now ?? Date.now;
  const seen = new Map<string, number>();
  return {
    claim(key, ttlMs) {
      const current = now();
      // Insertion order is expiry order while the ttl is constant, so expired keys are always at the front.
      for (const [stored, expiresAt] of seen) {
        if (expiresAt > current) break;
        seen.delete(stored);
      }
      if (seen.has(key)) return false;
      // At capacity the oldest entry makes room. That weakens replay protection past `maxEntries` signatures per window.
      while (seen.size >= maxEntries) seen.delete(seen.keys().next().value as string);
      seen.set(key, current + ttlMs);
      return true;
    },
  };
}

export type WebhookHeaderBag = Headers | Readonly<Record<string, string | readonly string[] | undefined>>;

export type VerifyWebhookOptions = {
  /** The request body exactly as received. Parsing and re-serializing it changes the bytes and breaks the signature. */
  payload: string | Uint8Array | ArrayBuffer;
  /** The request headers (a `Headers`, or Node's `req.headers`). Used for `X-Unitfield-Signature` and `X-Unitfield-Delivery`. */
  headers?: WebhookHeaderBag;
  /** Alternative to `headers`: the `X-Unitfield-Signature` value. */
  signature?: string | null;
  /** The endpoint's signing secret. Pass the old and the new one while rotating. */
  secret: string | readonly string[];
  /** How far the signed timestamp may be from now, in either direction. Default 300 seconds. */
  toleranceSeconds?: number;
  /** Largest accepted body. Default 1 MiB. */
  maxPayloadBytes?: number;
  /** Rejects a signature seen before. Without one, only the timestamp window protects against replay. */
  replayStore?: ReplayStore;
  /** Current time, for tests. */
  now?: number | Date;
};

export type VerifiedWebhook = {
  /** Unix seconds the delivery was signed. */
  timestamp: number;
  /** `X-Unitfield-Delivery`: the event id, stable across retries. */
  deliveryId?: string;
  /** `X-Unitfield-Event`. */
  eventType?: string;
};

const DEFAULT_TOLERANCE_SECONDS = 300;
const DEFAULT_MAX_PAYLOAD_BYTES = 1024 * 1024;

/**
 * Verifies `X-Unitfield-Signature: t=<unix>,v1=<hex>` (HMAC-SHA-256 over `<t>.<raw body>`), the timestamp window and,
 * with a `replayStore`, that this exact signature has not been accepted before. Comparison is constant-time (Web Crypto
 * `verify`), and several `v1` values and several secrets are honored so secrets can rotate without dropping deliveries.
 * Throws {@link WebhookVerificationError}; resolves only for a delivery that is authentic, fresh and not a replay.
 *
 * Replays are caught by signature, not by delivery id: Unitfield's own retries re-sign with a new timestamp, so a
 * legitimate retry passes while a captured request re-sent by an attacker does not. Make your handler idempotent on
 * `deliveryId` as well.
 */
export async function verifyWebhookSignature(options: VerifyWebhookOptions): Promise<VerifiedWebhook> {
  const secrets = normalizeSecrets(options.secret);
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new TypeError("toleranceSeconds must be a positive number.");

  const body = toBytes(options.payload);
  if (body.byteLength > (options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES)) {
    throw new WebhookVerificationError("payload_too_large", "The webhook payload is too large.");
  }

  const header = options.signature ?? readHeader(options.headers, WebhookHeaders.signature);
  if (!header || !header.trim()) throw new WebhookVerificationError("missing_signature", "The webhook has no signature header.");
  const { timestamp, signatures } = parseSignatureHeader(header);

  const nowSeconds = Math.floor((options.now === undefined ? Date.now() : Number(options.now)) / 1000);
  if (Math.abs(nowSeconds - timestamp) > tolerance) {
    throw new WebhookVerificationError("timestamp_out_of_tolerance", "The webhook timestamp is outside the accepted window.");
  }

  const signed = concat(new TextEncoder().encode(`${timestamp}.`), body);
  let matched: string | undefined;
  for (const secret of secrets) {
    const key = await importKey(secret);
    for (const signature of signatures) {
      // Every candidate is checked: no early exit on a hit that would reveal which one matched.
      const ok = await subtle().verify("HMAC", key, hexToBytes(signature) as BufferSource, signed as BufferSource);
      if (ok && matched === undefined) matched = signature;
    }
  }
  if (matched === undefined) throw new WebhookVerificationError("signature_mismatch", "The webhook signature does not match.");

  if (options.replayStore) {
    const fresh = await options.replayStore.claim(`unitfield-webhook:${matched}`, tolerance * 2 * 1000);
    if (!fresh) throw new WebhookVerificationError("replayed", "This webhook was already received.");
  }

  return {
    timestamp,
    deliveryId: readHeader(options.headers, WebhookHeaders.delivery),
    eventType: readHeader(options.headers, WebhookHeaders.event),
  };
}

/** Verifies the delivery, then parses its JSON envelope. Nothing is parsed from a delivery that fails verification. */
export async function constructWebhookEvent<TData = unknown>(
  options: VerifyWebhookOptions,
): Promise<{ event: WebhookEvent<TData>; delivery: VerifiedWebhook }> {
  const delivery = await verifyWebhookSignature(options);
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof options.payload === "string" ? options.payload : new TextDecoder().decode(toBytes(options.payload)));
  } catch (error) {
    throw new UnitfieldError("The webhook payload is not valid JSON.", { code: "webhook_invalid_payload", cause: error });
  }
  const event = parsed as Partial<WebhookEvent<TData>> | null;
  if (!event || typeof event !== "object" || typeof event.id !== "string" || typeof event.type !== "string") {
    throw new UnitfieldError("The webhook payload is not a Unitfield event envelope.", { code: "webhook_invalid_payload" });
  }
  return { event: event as WebhookEvent<TData>, delivery };
}

export type WebhookVerifierOptions = Pick<VerifyWebhookOptions, "secret" | "toleranceSeconds" | "maxPayloadBytes"> & {
  /** Defaults to an in-memory store. Pass `false` to disable replay tracking, or a shared store for multiple processes. */
  replayStore?: ReplayStore | false;
};

export type WebhookVerifier = {
  verify(payload: VerifyWebhookOptions["payload"], headers: WebhookHeaderBag): Promise<VerifiedWebhook>;
  constructEvent<TData = unknown>(payload: VerifyWebhookOptions["payload"], headers: WebhookHeaderBag): Promise<{ event: WebhookEvent<TData>; delivery: VerifiedWebhook }>;
};

/** A verifier bound to one endpoint's secret(s), with replay tracking on by default. Create it once per process. */
export function createWebhookVerifier(options: WebhookVerifierOptions): WebhookVerifier {
  normalizeSecrets(options.secret);
  const replayStore = options.replayStore === false ? undefined : (options.replayStore ?? createMemoryReplayStore());
  const base = { secret: options.secret, toleranceSeconds: options.toleranceSeconds, maxPayloadBytes: options.maxPayloadBytes, replayStore };
  return {
    verify: (payload, headers) => verifyWebhookSignature({ ...base, payload, headers }),
    constructEvent: (payload, headers) => constructWebhookEvent({ ...base, payload, headers }),
  };
}

function normalizeSecrets(secret: string | readonly string[]): string[] {
  const list = typeof secret === "string" ? [secret] : [...secret];
  if (list.length === 0 || list.some((item) => typeof item !== "string" || !item)) {
    throw new TypeError("secret must be a non-empty string, or a non-empty list of non-empty strings.");
  }
  return list;
}

function parseSignatureHeader(header: string): { timestamp: number; signatures: string[] } {
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator < 1) throw new WebhookVerificationError("malformed_signature", "The webhook signature header is malformed.");
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t") {
      if (timestamp !== undefined || !/^\d{1,12}$/.test(value)) {
        throw new WebhookVerificationError("malformed_signature", "The webhook signature timestamp is malformed.");
      }
      timestamp = Number(value);
    } else if (key === "v1") {
      if (/^[0-9a-fA-F]{64}$/.test(value)) signatures.push(value.toLowerCase());
    }
    // Other schemes (a future v2) are ignored so that new senders stay compatible.
  }
  if (timestamp === undefined || signatures.length === 0) {
    throw new WebhookVerificationError("malformed_signature", "The webhook signature header has no usable timestamp and v1 signature.");
  }
  return { timestamp, signatures };
}

function readHeader(headers: WebhookHeaderBag | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return Array.isArray(value) ? value[0] : (value as string | undefined);
  }
  return undefined;
}

function toBytes(payload: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof payload === "string") return new TextEncoder().encode(payload);
  return payload instanceof Uint8Array ? payload : new Uint8Array(payload);
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const joined = new Uint8Array(a.length + b.length);
  joined.set(a, 0);
  joined.set(b, a.length);
  return joined;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index++) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function subtle(): SubtleCrypto {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new TypeError("Web Crypto (crypto.subtle) is not available in this runtime.");
  return api;
}

function importKey(secret: string): Promise<CryptoKey> {
  return subtle().importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
}
