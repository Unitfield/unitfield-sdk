import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { UnitfieldError } from "../dist/index.js";
import {
  WebhookVerificationError,
  constructWebhookEvent,
  createMemoryReplayStore,
  createWebhookVerifier,
  verifyWebhookSignature,
  type ReplayStore,
} from "../dist/server.js";

const secret = "whsec_test_secret";
const nowMs = Date.UTC(2026, 10, 1, 12, 0, 0);
const nowSeconds = nowMs / 1000;
const body = JSON.stringify({ id: "evt_1", type: "listing.updated", created: "2026-11-01T12:00:00.0000000Z", data: { listingPublicId: "clst_abc", note: "café ✓" } });

// Computed with node:crypto, independently of the SDK: this is the sender's side of the contract
// (apps send `X-Unitfield-Signature: t=<unix>,v1=<hex(hmac_sha256(secret, "<t>.<raw body>"))>`).
const sign = (payload: string, key = secret, timestamp = nowSeconds) => createHmac("sha256", key).update(`${timestamp}.${payload}`).digest("hex");
const header = (payload = body, key = secret, timestamp = nowSeconds) => `t=${timestamp},v1=${sign(payload, key, timestamp)}`;

async function reason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof WebhookVerificationError, `expected WebhookVerificationError, got ${String(error)}`);
    return error.reason;
  }
  assert.fail("expected the webhook to be rejected");
}

const verify = (overrides: Record<string, unknown> = {}) => verifyWebhookSignature({ payload: body, signature: header(), secret, now: nowMs, ...overrides } as Parameters<typeof verifyWebhookSignature>[0]);

test("§14.16 webhook signatures are verified by the SDK helper and the replay window is enforced", async () => {
  // Authentic and fresh.
  const verified = await verify({ headers: new Headers({ "x-unitfield-delivery": "evt_1", "x-unitfield-event": "listing.updated" }) });
  assert.deepEqual(verified, { timestamp: nowSeconds, deliveryId: "evt_1", eventType: "listing.updated" });

  // Forgeries: wrong secret, tampered body, tampered timestamp.
  assert.equal(await reason(verify({ secret: "another-secret" })), "signature_mismatch");
  assert.equal(await reason(verify({ payload: body.replace("clst_abc", "clst_xyz") })), "signature_mismatch");
  assert.equal(await reason(verify({ signature: `t=${nowSeconds + 1},v1=${sign(body)}` })), "signature_mismatch");
  assert.equal(await reason(verify({ signature: `t=${nowSeconds},v1=${"0".repeat(64)}` })), "signature_mismatch");

  // The replay window: the signed timestamp must be within 300 seconds of now, in both directions.
  const at = (offset: number) => verify({ signature: header(body, secret, nowSeconds + offset) });
  assert.equal((await at(-300)).timestamp, nowSeconds - 300, "exactly at the edge is accepted");
  assert.equal((await at(300)).timestamp, nowSeconds + 300);
  assert.equal(await reason(at(-301)), "timestamp_out_of_tolerance");
  assert.equal(await reason(at(301)), "timestamp_out_of_tolerance");
  assert.equal(await reason(verify({ signature: header(body, secret, nowSeconds - 86_400) })), "timestamp_out_of_tolerance", "a day-old capture is dead");
  assert.equal((await verify({ toleranceSeconds: 600, signature: header(body, secret, nowSeconds - 600) })).timestamp, nowSeconds - 600);
  assert.equal(await reason(verify({ toleranceSeconds: 10, signature: header(body, secret, nowSeconds - 11) })), "timestamp_out_of_tolerance");

  // Inside the window an exact replay is still refused when a replay store is configured.
  const replayStore = createMemoryReplayStore({ now: () => nowMs });
  await verify({ replayStore });
  assert.equal(await reason(verify({ replayStore })), "replayed", "the same signed request cannot be accepted twice");
  // A legitimate retry is re-signed with a new timestamp, so it is a different signature and passes.
  assert.equal((await verify({ replayStore, signature: header(body, secret, nowSeconds + 60), now: nowMs + 60_000 })).timestamp, nowSeconds + 60);
  // Without a store, only the window protects: documented behavior.
  await verify();
  await verify();
});

test("malformed and missing signatures are rejected before any cryptography", async () => {
  assert.equal(await reason(verify({ signature: undefined })), "missing_signature");
  assert.equal(await reason(verify({ signature: null })), "missing_signature");
  assert.equal(await reason(verify({ signature: "   " })), "missing_signature");
  assert.equal(await reason(verify({ signature: `v1=${sign(body)}` })), "malformed_signature", "no timestamp");
  assert.equal(await reason(verify({ signature: `t=${nowSeconds}` })), "malformed_signature", "no v1");
  assert.equal(await reason(verify({ signature: `t=${nowSeconds},v1=not-hex` })), "malformed_signature");
  assert.equal(await reason(verify({ signature: `t=${nowSeconds},v1=${sign(body).slice(0, 62)}` })), "malformed_signature", "wrong length");
  assert.equal(await reason(verify({ signature: `t=abc,v1=${sign(body)}` })), "malformed_signature");
  assert.equal(await reason(verify({ signature: `t=-5,v1=${sign(body)}` })), "malformed_signature");
  assert.equal(await reason(verify({ signature: `t=${nowSeconds},t=${nowSeconds},v1=${sign(body)}` })), "malformed_signature", "two timestamps");
  assert.equal(await reason(verify({ signature: `garbage,v1=${sign(body)}` })), "malformed_signature");
  assert.equal(await reason(verify({ signature: "sha256=" + sign(body) })), "malformed_signature", "the weaker legacy header scheme is not accepted");
  assert.equal(await reason(verify({ payload: "x".repeat(2048), maxPayloadBytes: 1024 })), "payload_too_large");
  assert.equal(await reason(verify({ payload: new Uint8Array(1024 * 1024 + 1) })), "payload_too_large");
});

test("secret rotation: any configured secret and any v1 value may match; unknown schemes are ignored", async () => {
  const rotated = "whsec_new";
  const signedWithNew = header(body, rotated);
  assert.equal(await reason(verify({ signature: signedWithNew })), "signature_mismatch");
  assert.ok(await verify({ signature: signedWithNew, secret: [secret, rotated] }));
  assert.ok(await verify({ secret: [rotated, secret] }));
  assert.ok(await verify({ signature: `t=${nowSeconds},v1=${sign(body, "dropped")},v1=${sign(body)}` }), "several v1 entries: one good one is enough");
  assert.ok(await verify({ signature: `t=${nowSeconds}, v2=whatever ,v1=${sign(body).toUpperCase()}` }), "future schemes ignored, hex case and spaces tolerated");
  assert.equal(await reason(verify({ signature: `t=${nowSeconds},v1=${sign(body, "dropped")},v1=${sign(body, "other")}` })), "signature_mismatch");
  for (const bad of ["", [], [""], undefined, null]) {
    await assert.rejects(verify({ secret: bad }), TypeError, `secret ${JSON.stringify(bad)} is a configuration error`);
  }
  await assert.rejects(verify({ toleranceSeconds: 0 }), /toleranceSeconds/);
});

test("payload and header forms: string, bytes, Headers, Node header objects", async () => {
  const bytes = new TextEncoder().encode(body);
  assert.ok(await verify({ payload: bytes }));
  assert.ok(await verify({ payload: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
  assert.ok(await verify({ payload: bytes, signature: undefined, headers: { "X-Unitfield-Signature": header() } }), "case-insensitive Node-style headers");
  assert.ok(await verify({ signature: undefined, headers: new Headers({ "X-UNITFIELD-SIGNATURE": header() }) }));
  const node = await verify({ signature: undefined, headers: { "x-unitfield-signature": [header(), "ignored"], "x-unitfield-delivery": ["evt_1"], "x-unitfield-event": "listing.updated" } });
  assert.equal(node.deliveryId, "evt_1");
  assert.equal(await reason(verify({ signature: undefined, headers: {} })), "missing_signature");
  // Re-serialized JSON is a different byte string and must fail: the raw body is what was signed.
  assert.equal(await reason(verify({ payload: JSON.stringify(JSON.parse(body), null, 2) })), "signature_mismatch");
});

test("constructWebhookEvent parses the envelope only after verification", async () => {
  const { event, delivery } = await constructWebhookEvent<{ listingPublicId: string }>({ payload: body, signature: header(), secret, now: nowMs });
  assert.equal(event.id, "evt_1");
  assert.equal(event.type, "listing.updated");
  assert.equal(event.data.listingPublicId, "clst_abc");
  assert.equal(delivery.timestamp, nowSeconds);

  // Invalid JSON with a bad signature is a verification failure, never a parse error: nothing unauthenticated is parsed.
  assert.equal(await reason(constructWebhookEvent({ payload: "{not json", signature: header(), secret, now: nowMs })), "signature_mismatch");
  const junk = "{not json";
  await assert.rejects(constructWebhookEvent({ payload: junk, signature: header(junk), secret, now: nowMs }), (error: unknown) => error instanceof UnitfieldError && error.code === "webhook_invalid_payload");
  const notEnvelope = JSON.stringify({ hello: "world" });
  await assert.rejects(constructWebhookEvent({ payload: notEnvelope, signature: header(notEnvelope), secret, now: nowMs }), (error: unknown) => error instanceof UnitfieldError && error.code === "webhook_invalid_payload");
});

test("createWebhookVerifier tracks replays by default, and the store is pluggable", async () => {
  const verifier = createWebhookVerifier({ secret });
  const fresh = Math.floor(Date.now() / 1000);
  const headers = new Headers({ "x-unitfield-signature": header(body, secret, fresh), "x-unitfield-delivery": "evt_1" });
  assert.equal((await verifier.verify(body, headers)).deliveryId, "evt_1");
  assert.equal(await reason(verifier.verify(body, headers)), "replayed");
  const second = await verifier.constructEvent(body, new Headers({ "x-unitfield-signature": header(body, secret, fresh + 1) }));
  assert.equal(second.event.type, "listing.updated");

  const off = createWebhookVerifier({ secret, replayStore: false });
  await off.verify(body, headers);
  await off.verify(body, headers);

  const claimed: [string, number][] = [];
  const shared: ReplayStore = { claim: async (key, ttl) => { claimed.push([key, ttl]); return claimed.filter(([k]) => k === key).length === 1; } };
  const custom = createWebhookVerifier({ secret, replayStore: shared, toleranceSeconds: 120 });
  await custom.verify(body, headers);
  assert.equal(await reason(custom.verify(body, headers)), "replayed");
  assert.equal(claimed[0][1], 240_000, "a signature is remembered for twice the tolerance: long enough to outlive its window");
  assert.throws(() => createWebhookVerifier({ secret: "" }), TypeError);
});

test("the in-memory replay store expires entries and stays bounded", () => {
  let time = 0;
  const store = createMemoryReplayStore({ maxEntries: 3, now: () => time });
  assert.equal(store.claim("a", 1000), true);
  assert.equal(store.claim("a", 1000), false);
  time = 1000;
  assert.equal(store.claim("a", 1000), true, "expired entries are forgotten");
  assert.equal(store.claim("b", 1000), true);
  assert.equal(store.claim("c", 1000), true);
  assert.equal(store.claim("d", 1000), true, "at capacity the oldest entry makes room");
  assert.equal(store.claim("a", 1000), true, "a was evicted");
  assert.equal(store.claim("d", 1000), false);
});
