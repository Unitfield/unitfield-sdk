import assert from "node:assert/strict";
import test from "node:test";
import * as publicApi from "../dist/index.js";
import {
  NetworkError,
  OAuthTokenError,
  RequestTimeoutError,
  createAppsClient,
  createPlatformClient,
  isAbortError,
  memoryTokenStore,
  type AuthorizationRequest,
  type TokenSet,
} from "../dist/index.js";
import {
  createAuthorizationRequestCookie,
  createClientCredentialsTokenProvider,
  createCookieTokenStore,
  getVendorInstallationCredential,
  type CookieAttributes,
  type CookieJar,
} from "../dist/server.js";
import { jwt, problem, recorder } from "./helpers.mts";

const tokenUrl = "https://auth.unitfield.test/oauth2/token";

test("client credentials stay behind the server entry and are sent as encoded HTTP Basic", async () => {
  assert.equal("createClientCredentialsTokenProvider" in publicApi, false);
  assert.equal("getVendorInstallationCredential" in publicApi, false);
  const calls: { url: string; init: RequestInit }[] = [];
  const provider = createClientCredentialsTokenProvider({
    tokenUrl, clientId: "client:with + ü", clientSecret: "secret+with/: characters", scopes: ["listings:read", "payments:read"], audience: ["unitfield-api", "test-resource"],
    fetch: async (input, init) => { calls.push({ url: String(input), init: init! }); return Response.json({ access_token: "server-token", expires_in: 3600 }); },
  });
  assert.equal(await provider(), "server-token");
  const [call] = calls;
  assert.equal(new Headers(call.init.headers).get("authorization"), `Basic ${btoa("client%3Awith+%2B+%C3%BC:secret%2Bwith%2F%3A+characters")}`);
  const body = call.init.body as URLSearchParams;
  assert.equal(body.get("grant_type"), "client_credentials");
  assert.equal(body.get("audience"), "unitfield-api test-resource");
  assert.equal(body.get("scope"), "listings:read payments:read");
  assert.equal(body.has("client_secret"), false);
  assert.equal(body.has("client_id"), false);
  assert.equal(call.init.redirect, "error");
  assert.equal(call.init.cache, "no-store");
  assert.throws(() => createClientCredentialsTokenProvider({ tokenUrl, clientId: "id", clientSecret: "secret", audience: [] }), /audience must not be empty/);
  assert.throws(() => createClientCredentialsTokenProvider({ tokenUrl, clientId: " ", clientSecret: "secret" }), /clientId/);
  assert.throws(() => createClientCredentialsTokenProvider({ tokenUrl, clientId: "id", clientSecret: "" }), /clientSecret/);
  assert.throws(() => createClientCredentialsTokenProvider({ tokenUrl: `${tokenUrl}?x=1`, clientId: "id", clientSecret: "s" }), /query string/);
});

test("the token is cached, shared by concurrent callers, and refetched when forced or expired", async () => {
  let count = 0;
  const provider = createClientCredentialsTokenProvider({
    tokenUrl, clientId: "id", clientSecret: "secret",
    fetch: async () => { count++; await new Promise((resolve) => setTimeout(resolve, 5)); return Response.json({ access_token: `token-${count}`, expires_in: 3600 }); },
  });
  const [a, b, c] = await Promise.all([provider(), provider(), provider()]);
  assert.deepEqual([a, b, c], ["token-1", "token-1", "token-1"]);
  assert.equal(await provider(), "token-1");
  assert.equal(count, 1);
  assert.equal(await provider({ forceRefresh: true }), "token-2");
  assert.equal(count, 2);

  let short = 0;
  const shortLived = createClientCredentialsTokenProvider({ tokenUrl, clientId: "id", clientSecret: "secret", fetch: async () => Response.json({ access_token: `t${++short}`, expires_in: 20 }) });
  assert.equal(await shortLived(), "t1");
  assert.equal(await shortLived(), "t2", "a token expiring within the 30 s safety margin is never cached");
});

test("an AppsClient with the provider recovers from a revoked cached token by refetching once", async () => {
  let issued = 0;
  const provider = createClientCredentialsTokenProvider({ tokenUrl, clientId: "id", clientSecret: "secret", fetch: async () => Response.json({ access_token: `app-token-${++issued}`, expires_in: 3600 }) });
  const api = recorder((call) => (call.headers.get("authorization") === "Bearer app-token-2" ? Response.json({ id: "corg_1" }) : problem(401, { code: "token_revoked" })));
  const client = createAppsClient({ baseUrl: "https://api.unitfield.test", tokenProvider: provider, fetch: api.fetch });
  assert.deepEqual(await client.getOrganization(), { id: "corg_1" });
  assert.deepEqual(api.calls.map((c) => c.headers.get("authorization")), ["Bearer app-token-1", "Bearer app-token-2"]);
});

test("token endpoint failures are typed and never expose the client secret", async () => {
  const refused = createClientCredentialsTokenProvider({ tokenUrl, clientId: "client-id", clientSecret: "client-secret", fetch: async () => Response.json({ error: "invalid_client", error_description: "Invalid client credentials" }, { status: 401 }) });
  await assert.rejects(refused(), (error: unknown) => {
    assert.ok(error instanceof OAuthTokenError);
    assert.equal(error.status, 401);
    assert.equal(error.oauthError, "invalid_client");
    assert.equal(error.code, "invalid_client");
    assert.equal(error.description, "Invalid client credentials");
    assert.equal(error.message.includes("client-secret"), false);
    return true;
  });
  const noToken = createClientCredentialsTokenProvider({ tokenUrl, clientId: "id", clientSecret: "s", fetch: async () => Response.json({ expires_in: 5 }) });
  await assert.rejects(noToken(), /no access token/);
  const html = createClientCredentialsTokenProvider({ tokenUrl, clientId: "id", clientSecret: "s", fetch: async () => new Response("<html>", { status: 502 }) });
  await assert.rejects(html(), (error: unknown) => error instanceof OAuthTokenError && error.oauthError === "server_error" && error.status === 502);
  const offline = createClientCredentialsTokenProvider({ tokenUrl, clientId: "id", clientSecret: "s", fetch: async () => { throw new TypeError("offline"); } });
  await assert.rejects(offline(), (error: unknown) => error instanceof NetworkError && error.code === "token_network_error");
});

test("aborts and timeouts of the token request are not wrapped", async () => {
  const abort = new DOMException("cancelled", "AbortError");
  const throwing = createClientCredentialsTokenProvider({ tokenUrl, clientId: "id", clientSecret: "s", fetch: async () => { throw abort; } });
  await assert.rejects(throwing(), (error: unknown) => error === abort);
  const controller = new AbortController();
  controller.abort(new Error("caller cancelled"));
  await assert.rejects(createClientCredentialsTokenProvider({ tokenUrl, clientId: "id", clientSecret: "s", fetch: async () => Response.json({}) })({ signal: controller.signal }), /caller cancelled/);
  const hanging = createClientCredentialsTokenProvider({
    tokenUrl, clientId: "id", clientSecret: "s", timeoutMs: 10,
    fetch: (async (_input: unknown, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)))) as typeof fetch,
  });
  await assert.rejects(hanging(), (error: unknown) => error instanceof RequestTimeoutError && !isAbortError(error));
});

test("publisher credential delivery is explicit, server-only, uncached, abortable and never retried", async () => {
  let count = 0;
  const api = recorder((call) => {
    count++;
    assert.equal(call.url.pathname, "/api/platform/v1/developer/installations/app_0123456789abcdef0123456789abcdef/credentials");
    assert.equal(call.method, "POST");
    assert.equal(call.init.cache, "no-store");
    assert.equal(call.init.credentials, "omit");
    assert.equal(call.init.redirect, "error");
    assert.deepEqual(call.body, { expectedGeneration: 7 });
    return problem(503, { code: "Platform.Vendors.Unavailable" });
  });
  const client = createPlatformClient({ baseUrl: "https://api.unitfield.test", accessToken: "publisher-token", fetch: api.fetch, retry: { maxRetries: 5, sleep: async () => undefined } });
  const installationId = "app_0123456789abcdef0123456789abcdef";
  await assert.rejects(getVendorInstallationCredential(client, installationId, 7), (error: unknown) => (error as { status?: number }).status === 503);
  assert.equal(count, 1, "never retried, whatever the client's retry policy says");
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(getVendorInstallationCredential(client, installationId, 7, { signal: abort.signal }), { name: "AbortError" });
  assert.equal(count, 1);
  await assert.rejects(getVendorInstallationCredential(client, " ", 7), /installationId/);
  await assert.rejects(getVendorInstallationCredential(client, installationId, 0), /positive safe integer/);
  await assert.rejects(getVendorInstallationCredential(client, installationId, 1.5), /positive safe integer/);
});

// ---- httpOnly cookie stores ------------------------------------------------------------------------------------

function cookieJar() {
  const values = new Map<string, string>();
  const attributes = new Map<string, CookieAttributes>();
  const jar: CookieJar = {
    get: (name) => (values.has(name) ? { value: values.get(name)! } : undefined),
    set: (name, value, options) => { values.set(name, value); attributes.set(name, options); },
    delete: (name) => { values.delete(name); },
  };
  return { jar, values, attributes };
}

const secret = "s".repeat(40);
const tokens = (extra: Partial<TokenSet> = {}): TokenSet => {
  const idToken = jwt({ iss: "https://id.unitfield.test", sub: "cus_abc", aud: "c", exp: 4_000_000_000 });
  return { accessToken: jwt({ sub: "cus_abc", org: "o" }), tokenType: "Bearer", expiresAt: 1_900_000_000_000, refreshToken: "refresh-token", idToken, scope: ["openid", "offline_access"], ...extra };
};

test("tokens round-trip through a sealed httpOnly cookie that exposes none of them", async () => {
  const { jar, values, attributes } = cookieJar();
  const store = createCookieTokenStore(jar, { secret });
  assert.equal(await store.get(), null);
  const original = tokens();
  await store.set(original);
  const sealed = values.get("__Host-uf_sdk")!;
  assert.match(sealed, /^v1\.[\w-]+\.[\w-]+$/);
  for (const secretValue of [original.accessToken, original.refreshToken!, "cus_abc"]) assert.equal(sealed.includes(secretValue), false, "the cookie is encrypted, not merely encoded");
  assert.deepEqual(attributes.get("__Host-uf_sdk"), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 30 * 24 * 60 * 60 });
  const restored = (await store.get())!;
  assert.equal(restored.accessToken, original.accessToken);
  assert.equal(restored.refreshToken, "refresh-token");
  assert.equal(restored.expiresAt, original.expiresAt);
  assert.equal(restored.idToken, original.idToken);
  assert.equal(restored.claims?.sub, "cus_abc");
  assert.deepEqual(restored.scope, original.scope);
  await store.clear();
  assert.equal(await store.get(), null);

  const small = createCookieTokenStore(jar, { secret, includeIdToken: false });
  await small.set(original);
  assert.equal((await small.get())?.idToken, undefined);
});

test("a cookie sealed for one purpose, with another secret, or tampered with, is rejected", async () => {
  const { jar, values } = cookieJar();
  const store = createCookieTokenStore(jar, { secret });
  await store.set(tokens());
  const sealed = values.get("__Host-uf_sdk")!;

  const wrongSecret = createCookieTokenStore(jar, { secret: "x".repeat(40) });
  assert.equal(await wrongSecret.get(), null);

  const tampered = `${sealed.slice(0, -4)}AAAA`;
  values.set("__Host-uf_sdk", tampered);
  assert.equal(await store.get(), null);
  values.set("__Host-uf_sdk", "v2.a.b");
  assert.equal(await store.get(), null);
  values.set("__Host-uf_sdk", "garbage");
  assert.equal(await store.get(), null);

  // Moving the sealed value to another cookie name fails: the name is authenticated data.
  const other = cookieJar();
  const moved = createCookieTokenStore(other.jar, { secret, name: "__Host-uf_other" });
  other.values.set("__Host-uf_other", sealed);
  assert.equal(await moved.get(), null);
});

test("cookie options are validated and oversized cookies fail clearly", async () => {
  const { jar } = cookieJar();
  assert.throws(() => createCookieTokenStore(jar, { secret: "short" }), /32 characters/);
  assert.throws(() => createCookieTokenStore(jar, { secret, secure: false }), /__Host-/);
  const dev = cookieJar();
  const insecure = createCookieTokenStore(dev.jar, { secret, secure: false, name: "uf_dev_sdk", maxAgeSeconds: 60, sameSite: "strict" });
  await insecure.set(tokens());
  assert.deepEqual(dev.attributes.get("uf_dev_sdk"), { httpOnly: true, secure: false, sameSite: "strict", path: "/", maxAge: 60 });
  const store = createCookieTokenStore(jar, { secret });
  await assert.rejects(store.set(tokens({ accessToken: "a".repeat(5000) })), (error: unknown) => (error as { code?: string }).code === "cookie_too_large");
});

test("a cookie-backed session on the server keeps refreshing and a sign-in survives the redirect in a sealed cookie", async () => {
  const { jar, values } = cookieJar();
  const request: AuthorizationRequest = { url: "https://id.test/auth", state: "st-1", nonce: "n-1", codeVerifier: "v".repeat(43), redirectUri: "https://shop.example.test/callback", scopes: ["openid"], createdAt: 1 };
  const cookie = createAuthorizationRequestCookie(jar, { secret });
  await cookie.save(request);
  assert.equal(values.get("__Host-uf_sdk_auth")!.includes("v".repeat(43)), false, "the PKCE verifier is never readable in the browser");
  assert.equal(await cookie.take("other-state"), null, "a callback for another state does not get this request");
  assert.equal(values.has("__Host-uf_sdk_auth"), false, "taking removes the cookie even on a mismatch: a sign-in attempt is single use");
  await cookie.save(request);
  assert.deepEqual(await cookie.take("st-1"), request);
  assert.equal(await cookie.take("st-1"), null);

  // The generic store contract holds for the memory store too (same TokenStore interface).
  const memory = memoryTokenStore();
  await memory.set(tokens());
  assert.ok(await memory.get());
  await memory.clear();
  assert.equal(await memory.get(), null);
});
