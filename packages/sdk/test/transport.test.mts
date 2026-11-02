import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthenticationError,
  ConflictError,
  InvalidResponseError,
  NetworkError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  RequestTimeoutError,
  ServerError,
  UnitfieldApiError,
  UnitfieldError,
  ValidationError,
  createAppsClient,
  isAbortError,
  isUnitfieldError,
} from "../dist/index.js";
import { instantRetry, problem, recorder } from "./helpers.mts";

const baseUrl = "https://api.unitfield.test";

test("requests carry the bearer token, accept JSON, omit cookies and bypass shared caches", async () => {
  const { calls, fetch } = recorder();
  const client = createAppsClient({ baseUrl, accessToken: "access-token", fetch });
  await client.request("/api/test", { method: "POST", body: { value: 1 } });
  const [call] = calls;
  assert.equal(call.url.href, `${baseUrl}/api/test`);
  assert.equal(call.headers.get("authorization"), "Bearer access-token");
  assert.equal(call.headers.get("accept"), "application/json");
  assert.equal(call.headers.get("content-type"), "application/json");
  assert.deepEqual(call.body, { value: 1 });
  assert.equal(call.init.credentials, "omit");
  assert.equal(call.init.cache, "no-store");
});

test("SDK credentials and the idempotency key win over caller-supplied headers", async () => {
  const { calls, fetch } = recorder();
  const client = createAppsClient({ baseUrl, accessToken: "real", fetch, headers: { "x-app": "demo" } });
  await client.request("/api/test", { method: "POST", idempotencyKey: "real-key", headers: { authorization: "Bearer forged", "Idempotency-Key": "forged", "x-extra": "1" } });
  assert.equal(calls[0].headers.get("authorization"), "Bearer real");
  assert.equal(calls[0].headers.get("Idempotency-Key"), "real-key");
  assert.equal(calls[0].headers.get("x-app"), "demo");
  assert.equal(calls[0].headers.get("x-extra"), "1");
});

test("base URL validation, a gateway path prefix, and path escapes", async () => {
  assert.throws(() => createAppsClient({ baseUrl: "/relative", fetch: async () => new Response() }), /absolute HTTP\(S\) URL/);
  assert.throws(() => createAppsClient({ baseUrl: "ftp://api.test" }), /HTTP or HTTPS/);
  assert.throws(() => createAppsClient({ baseUrl: "https://user:pass@api.test" }), /credentials/);
  assert.throws(() => createAppsClient({ baseUrl: "https://api.test/?x=1" }), /query string/);
  assert.throws(() => createAppsClient({ baseUrl, accessToken: " " }), /accessToken must not be empty/);
  assert.throws(() => createAppsClient({ baseUrl, accessToken: "a", tokenProvider: () => "b" }), /not both/);
  assert.throws(() => createAppsClient({ baseUrl, timeoutMs: -1 }), /timeoutMs/);
  assert.throws(() => createAppsClient({ baseUrl, retry: { maxRetries: 1.5 } }), /integer/);

  const { calls, fetch } = recorder();
  const client = createAppsClient({ baseUrl: "https://gateway.test/unitfield/", fetch });
  await client.request("/api/apps/v1/organization");
  assert.equal(calls[0].url.href, "https://gateway.test/unitfield/api/apps/v1/organization");
  const origin = createAppsClient({ baseUrl, fetch });
  for (const path of ["https://other.test/x", "no-slash", "//other.test/x", "/\\other.test/x"]) {
    await assert.rejects(origin.request(path), TypeError, path);
  }
  assert.equal(calls.length, 1);
});

test("GET retries 503 and 429 with exponential backoff, then succeeds", async () => {
  const { sleeps, retry } = instantRetry();
  const { calls, fetch } = recorder((_c, index) => (index === 0 ? problem(503, { code: "unavailable" }) : index === 1 ? problem(429, { code: "slow_down" }) : Response.json({ ok: true })));
  const client = createAppsClient({ baseUrl, accessToken: "t", fetch, retry });
  assert.deepEqual(await client.request("/api/test"), { ok: true });
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [250, 500]);
});

test("GET gives up after maxRetries and throws the last typed error", async () => {
  const { retry } = instantRetry({ maxRetries: 1 });
  const { calls, fetch } = recorder(() => problem(503, { code: "Platform.Down", detail: "later" }));
  const client = createAppsClient({ baseUrl, accessToken: "t", fetch, retry });
  await assert.rejects(client.request("/api/test"), (error: unknown) => error instanceof ServerError && error.status === 503 && error.code === "Platform.Down");
  assert.equal(calls.length, 2);
  const noRetry = createAppsClient({ baseUrl, accessToken: "t", fetch: recorder(() => problem(503, {})).fetch, retry: false });
  await assert.rejects(noRetry.request("/api/test"), ServerError);
});

test("non-GET requests are retried only with an idempotency key, and the key is reused", async () => {
  const { retry } = instantRetry();
  const plain = recorder(() => problem(503, { code: "down" }));
  const client = createAppsClient({ baseUrl, accessToken: "t", fetch: plain.fetch, retry });
  await assert.rejects(client.request("/api/test", { method: "POST", body: {} }), ServerError);
  assert.equal(plain.calls.length, 1);

  const keyed = recorder((_c, index) => (index < 2 ? problem(index === 0 ? 503 : 429, {}) : Response.json({ done: true })));
  const keyedClient = createAppsClient({ baseUrl, accessToken: "t", fetch: keyed.fetch, retry });
  assert.deepEqual(await keyedClient.request("/api/test", { method: "POST", body: {}, idempotencyKey: "stable" }), { done: true });
  assert.deepEqual(keyed.calls.map((c) => c.headers.get("Idempotency-Key")), ["stable", "stable", "stable"]);

  const generated = recorder((_c, index) => (index === 0 ? problem(503, {}) : Response.json({})));
  const generatedClient = createAppsClient({ baseUrl, accessToken: "t", fetch: generated.fetch, retry });
  await generatedClient.request("/api/test", { method: "POST", idempotencyKey: true });
  await generatedClient.request("/api/test", { method: "POST", idempotencyKey: true });
  const keys = generated.calls.map((c) => c.headers.get("Idempotency-Key"));
  assert.equal(keys[0], keys[1], "one generated key per call, reused by its retry");
  assert.notEqual(keys[1], keys[2], "a new call gets a new key");
  assert.match(keys[0] ?? "", /^[0-9a-f-]{36}$/);

  // 500 is not a transient status even for a keyed request.
  const failing = recorder(() => problem(500, {}));
  await assert.rejects(createAppsClient({ baseUrl, accessToken: "t", fetch: failing.fetch, retry }).request("/api/test", { method: "POST", idempotencyKey: "k" }), ServerError);
  assert.equal(failing.calls.length, 1);
  await assert.rejects(client.request("/api/test", { method: "POST", idempotencyKey: " " }), /idempotencyKey/);
  await assert.rejects(client.request("/api/test", { method: "POST", idempotencyKey: "x".repeat(161) }), /160/);
});

test("Retry-After is honored, and one beyond the cap is surfaced instead of waited out", async () => {
  const { sleeps, retry } = instantRetry();
  const first = recorder((_c, index) => (index === 0 ? problem(429, { code: "slow" }, { "retry-after": "3" }) : Response.json({ ok: 1 })));
  await createAppsClient({ baseUrl, accessToken: "t", fetch: first.fetch, retry }).request("/api/test");
  assert.deepEqual(sleeps, [3000]);

  const long = recorder(() => problem(429, { code: "slow" }, { "retry-after": "120", "x-ratelimit-limit": "60", "x-ratelimit-remaining": "0" }));
  await assert.rejects(createAppsClient({ baseUrl, accessToken: "t", fetch: long.fetch, retry }).request("/api/test"), (error: unknown) => {
    assert.ok(error instanceof RateLimitError);
    assert.equal(error.retryAfterSeconds, 120);
    assert.deepEqual(error.rateLimit, { limit: "60", remaining: "0", reset: undefined });
    return true;
  });
  assert.equal(long.calls.length, 1);
});

test("a stream body is never retried", async () => {
  const { retry } = instantRetry();
  const { calls, fetch } = recorder(() => problem(503, {}));
  const client = createAppsClient({ baseUrl, accessToken: "t", fetch, retry });
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("x")); controller.close(); } });
  await assert.rejects(client.request("/api/test", { method: "POST", body: stream, idempotencyKey: "k", fetchOptions: { duplex: "half" } }), ServerError);
  assert.equal(calls.length, 1);
});

test("network failures become NetworkError and are retried for GET only", async () => {
  const { retry } = instantRetry();
  let count = 0;
  const flaky = async () => {
    count++;
    if (count < 3) throw new TypeError("fetch failed");
    return Response.json({ ok: true });
  };
  const client = createAppsClient({ baseUrl, accessToken: "t", fetch: flaky as typeof fetch, retry });
  assert.deepEqual(await client.request("/api/test"), { ok: true });
  assert.equal(count, 3);

  count = -10;
  await assert.rejects(client.request("/api/test", { method: "POST", body: {} }), (error: unknown) => error instanceof NetworkError && error.cause instanceof TypeError);
  assert.equal(count, -9, "unkeyed POST: one attempt");
});

test("timeouts raise RequestTimeoutError and are retried for GET", async () => {
  const waitForAbort = (_c: unknown, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true }));
  let count = 0;
  const hanging = (async (input: unknown, init: RequestInit) => {
    count++;
    return count < 2 ? waitForAbort(input, init) : Response.json({ ok: true });
  }) as typeof fetch;
  const { retry } = instantRetry();
  const client = createAppsClient({ baseUrl, accessToken: "t", fetch: hanging, retry, timeoutMs: 15 });
  assert.deepEqual(await client.request("/api/test"), { ok: true });
  assert.equal(count, 2);

  const never = createAppsClient({ baseUrl, accessToken: "t", fetch: waitForAbort as unknown as typeof fetch, retry: false });
  await assert.rejects(never.request("/api/test", { timeoutMs: 10 }), (error: unknown) => error instanceof RequestTimeoutError && error.timeoutMs === 10 && !isAbortError(error));
});

test("caller aborts pass through untouched and stop retrying", async () => {
  const abort = new DOMException("cancelled", "AbortError");
  const throwing = createAppsClient({ baseUrl, accessToken: "t", fetch: (async () => { throw abort; }) as typeof fetch });
  await assert.rejects(throwing.request("/api/test"), (error: unknown) => error === abort);

  const controller = new AbortController();
  const reason = new Error("caller cancelled");
  controller.abort(reason);
  const { calls, fetch } = recorder();
  const client = createAppsClient({ baseUrl, accessToken: "t", fetch });
  await assert.rejects(client.request("/api/test", { signal: controller.signal }), (error: unknown) => error === reason);
  assert.equal(calls.length, 0, "an already-aborted signal never reaches the network");

  const waiting = new AbortController();
  const failing = recorder(() => problem(503, {}));
  const slow = createAppsClient({ baseUrl, accessToken: "t", fetch: failing.fetch, retry: { sleep: (_ms, signal) => new Promise((_r, reject) => { waiting.abort(new Error("stop")); reject(signal?.reason ?? new Error("stop")); }) } });
  await assert.rejects(slow.request("/api/test", { signal: waiting.signal }), /stop/);
  assert.equal(failing.calls.length, 1);
});

test("a 401 is replayed once with a forced token refresh; a static token is not replayed", async () => {
  const seen: (boolean | undefined)[] = [];
  const tokenProvider = (context?: { forceRefresh?: boolean }) => {
    seen.push(context?.forceRefresh);
    return context?.forceRefresh ? "fresh" : "stale";
  };
  const { calls, fetch } = recorder((call) => (call.headers.get("authorization") === "Bearer fresh" ? Response.json({ ok: true }) : problem(401, { code: "token_expired" })));
  const client = createAppsClient({ baseUrl, tokenProvider, fetch });
  assert.deepEqual(await client.request("/api/test", { method: "POST", body: { a: 1 } }), { ok: true });
  assert.deepEqual(seen, [false, true]);
  assert.deepEqual(calls.map((c) => c.headers.get("authorization")), ["Bearer stale", "Bearer fresh"]);

  const alwaysDenied = recorder(() => problem(401, { code: "no" }));
  const denied = createAppsClient({ baseUrl, tokenProvider: () => "x", fetch: alwaysDenied.fetch });
  await assert.rejects(denied.request("/api/test"), AuthenticationError);
  assert.equal(alwaysDenied.calls.length, 2, "one replay, never a loop");

  const staticToken = recorder(() => problem(401, {}));
  await assert.rejects(createAppsClient({ baseUrl, accessToken: "static", fetch: staticToken.fetch }).request("/api/test"), AuthenticationError);
  assert.equal(staticToken.calls.length, 1);
});

test("token provider failures are typed and an empty token is refused", async () => {
  const { calls, fetch } = recorder();
  const broken = createAppsClient({ baseUrl, tokenProvider: () => { throw new Error("vault down"); }, fetch });
  await assert.rejects(broken.request("/api/test"), (error: unknown) => error instanceof UnitfieldError && error.code === "token_error" && (error.cause as Error).message === "vault down");
  const empty = createAppsClient({ baseUrl, tokenProvider: () => "  ", fetch });
  await assert.rejects(empty.request("/api/test"), /empty token/);
  const own = new UnitfieldError("own", { code: "mine" });
  await assert.rejects(createAppsClient({ baseUrl, tokenProvider: () => { throw own; }, fetch }).request("/api/test"), (error: unknown) => error === own);
  assert.equal(calls.length, 0);
});

test("API failures map to typed errors with correlation metadata", async () => {
  const cases: [number, typeof UnitfieldApiError][] = [
    [400, ValidationError], [401, AuthenticationError], [403, PermissionError], [404, NotFoundError],
    [409, ConflictError], [422, ValidationError], [429, RateLimitError], [500, ServerError], [503, ServerError], [418, UnitfieldApiError],
  ];
  for (const [status, expected] of cases) {
    const client = createAppsClient({ baseUrl, accessToken: "t", retry: false, fetch: recorder(() => problem(status, { code: `E.${status}`, detail: `detail ${status}` })).fetch });
    await assert.rejects(client.request("/api/test?token=secret"), (error: unknown) => {
      assert.ok(error instanceof expected, `${status}`);
      assert.equal(error.constructor === UnitfieldApiError, expected === UnitfieldApiError);
      assert.ok(isUnitfieldError(error));
      assert.equal(error.status, status);
      assert.equal(error.code, `E.${status}`);
      assert.equal(error.message, `detail ${status}`);
      assert.equal(error.method, "GET");
      assert.equal(error.url, `${baseUrl}/api/test`, "the query string is never kept");
      return true;
    });
  }

  const client = createAppsClient({
    baseUrl, accessToken: "t", retry: false,
    fetch: recorder(() => problem(422, { code: "Validation", title: "Invalid", errors: { email: ["required"], bad: "not-an-array" }, supportCode: "SUP-1", meta: { field: "email" } }, { "x-trace-id": "trace-1", "x-request-id": "req-1", "x-correlation-id": "corr-1", "retry-after": "Wed, 21 Oct 2099 07:28:00 GMT" })).fetch,
  });
  await assert.rejects(client.request("/api/test"), (error: unknown) => {
    assert.ok(error instanceof ValidationError);
    assert.equal(error.message, "Invalid");
    assert.deepEqual(error.errors, { email: ["required"] });
    assert.deepEqual(error.meta, { field: "email" });
    assert.equal(error.traceId, "trace-1");
    assert.equal(error.requestId, "req-1");
    assert.equal(error.correlationId, "corr-1");
    assert.equal(error.supportCode, "SUP-1");
    assert.ok((error.retryAfterSeconds ?? 0) > 1_000_000, "HTTP-date Retry-After is converted to seconds");
    return true;
  });

  const plain = createAppsClient({ baseUrl, accessToken: "t", retry: false, fetch: (async () => new Response("<html>bad gateway</html>", { status: 502 })) as typeof fetch });
  await assert.rejects(plain.request("/api/test"), (error: unknown) => error instanceof ServerError && error.code === "http_error" && /HTTP 502/.test(error.message));
  const oauthShape = createAppsClient({ baseUrl, accessToken: "t", retry: false, fetch: recorder(() => Response.json({ error: "invalid_client", error_description: "bad secret" }, { status: 401 })).fetch });
  await assert.rejects(oauthShape.request("/api/test"), (error: unknown) => error instanceof AuthenticationError && error.code === "invalid_client" && error.message === "bad secret");
});

test("response handling: empty and 204 bodies, discarded bodies, invalid JSON", async () => {
  const empty = createAppsClient({ baseUrl, accessToken: "t", fetch: (async () => new Response(null, { status: 204 })) as typeof fetch });
  assert.equal(await empty.request("/api/test", { method: "POST" }), undefined);
  const blank = createAppsClient({ baseUrl, accessToken: "t", fetch: (async () => new Response("  ", { status: 200 })) as typeof fetch });
  assert.equal(await blank.request("/api/test"), undefined);
  const bad = createAppsClient({ baseUrl, accessToken: "t", fetch: (async () => new Response("{nope", { status: 200 })) as typeof fetch });
  await assert.rejects(bad.request("/api/test"), (error: unknown) => error instanceof InvalidResponseError && error.status === 200 && error.code === "invalid_response");
});
