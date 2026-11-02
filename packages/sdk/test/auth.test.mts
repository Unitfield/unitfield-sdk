import assert from "node:assert/strict";
import test from "node:test";
import {
  CustomerAuth,
  CustomerAuthError,
  CustomerSession,
  NetworkError,
  NotSignedInError,
  OAuthTokenError,
  RefreshTokenRevokedError,
  createCodeChallenge,
  createCodeVerifier,
  createCustomerAuth,
  createNonce,
  createResidentClient,
  createState,
  decodeJwtPayload,
  isExpiring,
  memoryTokenStore,
  saveAuthorizationRequest,
  takeAuthorizationRequest,
  takeAuthorizationRequestFor,
  type AuthorizationRequest,
  type TokenSet,
} from "../dist/index.js";
import { jwt, recorder } from "./helpers.mts";

const issuer = "https://id.unitfield.test";
const clientId = "sdk_client_1";
const redirectUri = "https://shop.example.test/callback";

const discoveryDocument = (extra: Record<string, unknown> = {}) => ({
  issuer,
  authorization_endpoint: `${issuer}/oauth2/auth`,
  token_endpoint: `${issuer}/oauth2/token`,
  revocation_endpoint: `${issuer}/oauth2/revoke`,
  end_session_endpoint: `${issuer}/oauth2/sessions/logout`,
  code_challenge_methods_supported: ["S256"],
  ...extra,
});

function idToken(request: Pick<AuthorizationRequest, "nonce"> | null, claims: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return jwt({ iss: issuer, aud: [clientId], sub: "cus_abcdefghijklmnopqrstuvwx", email: "ada@example.test", email_verified: true, iat: now, exp: now + 600, ...(request ? { nonce: request.nonce } : {}), ...claims });
}

type Handlers = { discovery?: () => Response; token?: (body: URLSearchParams, calls: number) => Response; revoke?: (body: URLSearchParams) => Response };
function fakeIssuer(handlers: Handlers = {}) {
  let tokenCalls = 0;
  const recording = recorder((call) => {
    switch (call.url.pathname) {
      case "/.well-known/openid-configuration":
        return handlers.discovery ? handlers.discovery() : Response.json(discoveryDocument());
      case "/oauth2/token":
        return handlers.token ? handlers.token(new URLSearchParams(String(call.init.body)), ++tokenCalls) : Response.json({}, { status: 500 });
      case "/oauth2/revoke":
        return handlers.revoke ? handlers.revoke(new URLSearchParams(String(call.init.body))) : new Response(null, { status: 200 });
      default:
        return new Response("not found", { status: 404 });
    }
  });
  return { ...recording, tokenCalls: () => tokenCalls };
}

function auth(fetch: typeof globalThis.fetch, extra: Partial<ConstructorParameters<typeof CustomerAuth>[0]> = {}) {
  return createCustomerAuth({ issuer, clientId, redirectUri, fetch, ...extra });
}

const tokenBody = (request: AuthorizationRequest | null, extra: Record<string, unknown> = {}) => ({
  access_token: "access-1", token_type: "bearer", expires_in: 600, refresh_token: "refresh-1", scope: "openid email offline_access", id_token: idToken(request), ...extra,
});

test("PKCE: the RFC 7636 appendix B vector, and verifier/state/nonce strength", async () => {
  assert.equal(await createCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  const verifier = createCodeVerifier();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(verifier, createCodeVerifier());
  assert.match(await createCodeChallenge(verifier), /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(createState(), createState());
  assert.notEqual(createNonce(), createNonce());
  await assert.rejects(createCodeChallenge("short"), /43 to 128/);
  await assert.rejects(createCodeChallenge("x".repeat(129)), /43 to 128/);
});

test("the authorization request carries state, nonce and an S256 challenge, and returns every secret the callback needs", async () => {
  const { calls, fetch } = fakeIssuer();
  const flow = auth(fetch, { scopes: ["openid", "email", "offline_access", "resident:read"] });
  const request = await flow.createAuthorizationRequest({ loginHint: "ada@example.test", prompt: "login" });
  const url = new URL(request.url);
  assert.equal(`${url.origin}${url.pathname}`, `${issuer}/oauth2/auth`);
  const params = Object.fromEntries(url.searchParams);
  assert.deepEqual(params, {
    response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: "openid email offline_access resident:read",
    state: request.state, nonce: request.nonce, code_challenge: await createCodeChallenge(request.codeVerifier), code_challenge_method: "S256",
    login_hint: "ada@example.test", prompt: "login",
  });
  assert.equal(request.redirectUri, redirectUri);
  assert.deepEqual(request.scopes, ["openid", "email", "offline_access", "resident:read"]);
  assert.ok(Math.abs(request.createdAt - Date.now()) < 5000);
  assert.ok(!("client_secret" in params));
  // JSON-serializable: it is persisted between redirects.
  assert.deepEqual(JSON.parse(JSON.stringify(request)), request);

  const second = await flow.createAuthorizationRequest({ scopes: ["openid"] });
  assert.notEqual(second.state, request.state);
  assert.notEqual(second.codeVerifier, request.codeVerifier);
  assert.equal(new URL(second.url).searchParams.get("scope"), "openid");
  assert.equal(calls.filter((c) => c.url.pathname.endsWith("openid-configuration")).length, 1, "discovery is cached");
  await assert.rejects(flow.createAuthorizationRequest({ scopes: ["email"] }), /openid/);
});

test("discovery failures are not cached, and a foreign or PKCE-less issuer is refused", async () => {
  let up = false;
  const flaky = fakeIssuer({ discovery: () => (up ? Response.json(discoveryDocument()) : new Response("down", { status: 503 })) });
  const flow = auth(flaky.fetch);
  await assert.rejects(flow.createAuthorizationRequest(), (error: unknown) => error instanceof CustomerAuthError && error.code === "discovery_failed");
  up = true;
  assert.ok((await flow.createAuthorizationRequest()).url);

  await assert.rejects(auth(fakeIssuer({ discovery: () => Response.json(discoveryDocument({ issuer: "https://evil.test" })) }).fetch).createAuthorizationRequest(), (error: unknown) => error instanceof CustomerAuthError && error.code === "issuer_mismatch");
  await assert.rejects(auth(fakeIssuer({ discovery: () => Response.json(discoveryDocument({ code_challenge_methods_supported: ["plain"] })) }).fetch).createAuthorizationRequest(), /PKCE S256/);
  await assert.rejects(auth(fakeIssuer({ discovery: () => Response.json({ issuer }) }).fetch).createAuthorizationRequest(), /authorization_endpoint/);
  await assert.rejects(auth((async () => { throw new TypeError("offline"); }) as typeof fetch).createAuthorizationRequest(), (error: unknown) => error instanceof CustomerAuthError && error.code === "discovery_failed");
  assert.equal(auth(fakeIssuer({ discovery: () => Response.json(discoveryDocument({ issuer: `${issuer}/` })) }).fetch).issuer, issuer);
  assert.ok((await auth(fakeIssuer({ discovery: () => Response.json(discoveryDocument({ issuer: `${issuer}/` })) }).fetch).createAuthorizationRequest()).url, "a trailing slash on the issuer is not a mismatch");
});

test("configured endpoints skip discovery; options are validated", async () => {
  const { calls, fetch } = recorder();
  const flow = auth(fetch, { endpoints: { authorization: "https://login.test/auth", token: "https://login.test/token" } });
  const request = await flow.createAuthorizationRequest();
  assert.ok(request.url.startsWith("https://login.test/auth?"));
  assert.equal(calls.length, 0);

  assert.throws(() => createCustomerAuth({ clientId: " ", redirectUri }), /clientId/);
  assert.throws(() => createCustomerAuth({ clientId, redirectUri: "http://shop.example.test/cb" }), /https/);
  assert.throws(() => createCustomerAuth({ clientId, redirectUri: "https://shop.example.test/cb#frag" }), /fragment/);
  assert.throws(() => createCustomerAuth({ clientId, redirectUri: "not a url" }), /absolute HTTP/);
  assert.throws(() => createCustomerAuth({ clientId, redirectUri, postLogoutRedirectUri: "http://x.test/" }), /https/);
  assert.equal(createCustomerAuth({ clientId, redirectUri: "http://localhost:3000/auth/callback" }).redirectUri, "http://localhost:3000/auth/callback");
  assert.equal(createCustomerAuth({ clientId, redirectUri: "http://127.0.0.1:3000/cb" }).redirectUri, "http://127.0.0.1:3000/cb");
  assert.equal(createCustomerAuth({ clientId, redirectUri: "https://shop.example.test" }).redirectUri, "https://shop.example.test", "redirect URIs are sent verbatim");
  assert.equal(createCustomerAuth({ clientId, redirectUri }).issuer, "https://id.unitfield.app", "defaults to the customer issuer");
  assert.deepEqual([...createCustomerAuth({ clientId, redirectUri }).scopes], ["openid", "email", "offline_access"]);
});

test("the callback is redeemed with the PKCE verifier and no client secret, and yields a validated token set", async () => {
  let request!: AuthorizationRequest;
  const { calls, fetch } = fakeIssuer({ token: () => Response.json(tokenBody(request)) });
  const flow = auth(fetch);
  request = await flow.createAuthorizationRequest();
  const before = Date.now();
  const tokens = await flow.handleCallback(`${redirectUri}?code=the-code&state=${request.state}`, request);

  const tokenCall = calls.find((c) => c.url.pathname === "/oauth2/token")!;
  assert.equal(tokenCall.method, "POST");
  assert.equal(tokenCall.headers.get("content-type"), "application/x-www-form-urlencoded");
  assert.equal(tokenCall.headers.get("authorization"), null);
  assert.equal(tokenCall.init.credentials, "omit");
  assert.equal(tokenCall.init.cache, "no-store");
  assert.equal(tokenCall.init.redirect, "error");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(String(tokenCall.init.body))), {
    grant_type: "authorization_code", code: "the-code", redirect_uri: redirectUri, client_id: clientId, code_verifier: request.codeVerifier,
  });
  assert.equal(tokens.accessToken, "access-1");
  assert.equal(tokens.tokenType, "Bearer");
  assert.equal(tokens.refreshToken, "refresh-1");
  assert.deepEqual(tokens.scope, ["openid", "email", "offline_access"]);
  assert.ok(tokens.expiresAt >= before + 599_000 && tokens.expiresAt <= Date.now() + 600_000);
  assert.equal(tokens.claims?.sub, "cus_abcdefghijklmnopqrstuvwx");
  assert.equal(tokens.claims?.email, "ada@example.test");
  assert.equal(decodeJwtPayload(tokens.idToken!).nonce, request.nonce);

  // The same inputs in other shapes.
  assert.ok(await flow.handleCallback(new URLSearchParams({ code: "c", state: request.state }), request));
  assert.ok(await flow.handleCallback(new URL(`${redirectUri}?code=c&state=${request.state}&iss=${encodeURIComponent(`${issuer}/`)}`), request));
  assert.ok(await flow.handleCallback(`?code=c&state=${request.state}`, request));
});

test("callback problems stop before any token request", async () => {
  const { calls, fetch } = fakeIssuer({ token: () => Response.json(tokenBody(null)) });
  const flow = auth(fetch);
  const request = await flow.createAuthorizationRequest();
  const expectCode = (code: string) => (error: unknown) => error instanceof CustomerAuthError && error.code === code;

  await assert.rejects(flow.handleCallback(`${redirectUri}?error=access_denied&error_description=No+thanks&state=${request.state}`, request), (error: unknown) => {
    assert.ok(error instanceof CustomerAuthError);
    assert.equal(error.code, "authorization_denied");
    assert.equal(error.oauthError, "access_denied");
    assert.equal(error.message, "No thanks");
    return true;
  });
  await assert.rejects(flow.handleCallback(`${redirectUri}?code=c&state=other`, request), expectCode("state_mismatch"));
  await assert.rejects(flow.handleCallback(`${redirectUri}?code=c`, request), expectCode("state_mismatch"));
  await assert.rejects(flow.handleCallback(`${redirectUri}?code=c&state=${request.state}&iss=https%3A%2F%2Fevil.test`, request), expectCode("issuer_mismatch"));
  await assert.rejects(flow.handleCallback(`${redirectUri}?state=${request.state}`, request), expectCode("missing_code"));
  assert.equal(calls.filter((c) => c.url.pathname === "/oauth2/token").length, 0);
});

test("ID token and token-response validation", async () => {
  async function exchange(body: (request: AuthorizationRequest) => Record<string, unknown> | Response) {
    let request!: AuthorizationRequest;
    const { fetch } = fakeIssuer({ token: () => { const value = body(request); return value instanceof Response ? value : Response.json(value); } });
    const flow = auth(fetch);
    request = await flow.createAuthorizationRequest();
    return flow.handleCallback(`${redirectUri}?code=c&state=${request.state}`, request);
  }
  const expectCode = (code: string) => (error: unknown) => error instanceof CustomerAuthError && error.code === code;
  const past = Math.floor(Date.now() / 1000) - 3600;

  await assert.rejects(exchange((r) => tokenBody(r, { id_token: idToken(r, { nonce: "forged" }) })), expectCode("nonce_mismatch"));
  await assert.rejects(exchange((r) => tokenBody(r, { id_token: idToken(r, { aud: "someone-else" }) })), expectCode("invalid_id_token"));
  await assert.rejects(exchange((r) => tokenBody(r, { id_token: idToken(r, { aud: ["a", "b"] }) })), expectCode("invalid_id_token"));
  await assert.rejects(exchange((r) => tokenBody(r, { id_token: idToken(r, { iss: "https://evil.test" }) })), expectCode("issuer_mismatch"));
  await assert.rejects(exchange((r) => tokenBody(r, { id_token: idToken(r, { exp: past }) })), expectCode("invalid_id_token"));
  await assert.rejects(exchange((r) => tokenBody(r, { id_token: idToken(r, { iat: Math.floor(Date.now() / 1000) + 3600 }) })), expectCode("invalid_id_token"));
  await assert.rejects(exchange((r) => tokenBody(r, { id_token: idToken(r, { sub: "" }) })), expectCode("invalid_id_token"));
  await assert.rejects(exchange((r) => tokenBody(r, { id_token: "not.a-jwt" })), expectCode("invalid_id_token"));
  await assert.rejects(exchange((r) => tokenBody(r, { id_token: undefined })), expectCode("invalid_id_token"));
  await assert.rejects(exchange((r) => tokenBody(r, { access_token: "" })), expectCode("invalid_token_response"));
  await assert.rejects(exchange((r) => tokenBody(r, { token_type: "mac" })), expectCode("invalid_token_response"));
  await assert.rejects(exchange((r) => tokenBody(r, { expires_in: undefined })), expectCode("invalid_token_response"));
  await assert.rejects(exchange(() => new Response("<html>", { status: 200 })), expectCode("invalid_token_response"));
  // A sent-in-the-past exp inside the clock-skew allowance is fine.
  assert.ok(await exchange((r) => tokenBody(r, { id_token: idToken(r, { exp: Math.floor(Date.now() / 1000) - 30 }) })));
});

test("token endpoint refusals are typed with the OAuth error", async () => {
  const { fetch } = fakeIssuer({ token: () => Response.json({ error: "invalid_grant", error_description: "The authorization code has expired." }, { status: 400 }) });
  const flow = auth(fetch);
  const request = await flow.createAuthorizationRequest();
  await assert.rejects(flow.handleCallback(`${redirectUri}?code=c&state=${request.state}`, request), (error: unknown) => {
    assert.ok(error instanceof OAuthTokenError);
    assert.ok(!(error instanceof RefreshTokenRevokedError), "an expired code is not a revoked refresh token");
    assert.equal(error.oauthError, "invalid_grant");
    assert.equal(error.status, 400);
    assert.equal(error.message, "The authorization code has expired.");
    return true;
  });
});

const signedIn = (extra: Partial<TokenSet> = {}): TokenSet => ({
  accessToken: "access-1", tokenType: "Bearer", expiresAt: Date.now() + 600_000, refreshToken: "refresh-1", idToken: idToken(null), scope: ["openid", "email", "offline_access"], ...extra,
});

test("refresh rotates the refresh token and keeps what the response omits", async () => {
  const { calls, fetch } = fakeIssuer({ token: () => Response.json({ access_token: "access-2", token_type: "bearer", expires_in: 600, refresh_token: "refresh-2" }) });
  const flow = auth(fetch);
  const current = signedIn();
  const next = await flow.refresh(current);
  assert.equal(next.accessToken, "access-2");
  assert.equal(next.refreshToken, "refresh-2");
  assert.equal(next.idToken, current.idToken, "no new ID token: the old one is kept for id_token_hint");
  assert.deepEqual(next.scope, current.scope);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(String(calls.at(-1)!.init.body))), { grant_type: "refresh_token", refresh_token: "refresh-1", client_id: clientId });

  const keeps = auth(fakeIssuer({ token: () => Response.json({ access_token: "a", token_type: "bearer", expires_in: 60 }) }).fetch);
  assert.equal((await keeps.refresh(current)).refreshToken, "refresh-1");

  await assert.rejects(flow.refresh({ scope: [] }), (error: unknown) => error instanceof CustomerAuthError && error.code === "no_refresh_token");
});

test("reuse detection: a rejected refresh token is RefreshTokenRevokedError; other failures are not", async () => {
  const revoked = auth(fakeIssuer({ token: () => Response.json({ error: "invalid_grant", error_description: "Token reuse detected." }, { status: 400 }) }).fetch);
  await assert.rejects(revoked.refresh(signedIn()), (error: unknown) => {
    assert.ok(error instanceof RefreshTokenRevokedError);
    assert.equal(error.code, "refresh_token_revoked");
    assert.equal(error.oauthError, "invalid_grant");
    assert.equal(error.description, "Token reuse detected.");
    assert.ok(error instanceof OAuthTokenError);
    return true;
  });
  const badClient = auth(fakeIssuer({ token: () => Response.json({ error: "invalid_client" }, { status: 401 }) }).fetch);
  await assert.rejects(badClient.refresh(signedIn()), (error: unknown) => error instanceof OAuthTokenError && !(error instanceof RefreshTokenRevokedError) && error.oauthError === "invalid_client");
  const down = auth(fakeIssuer({ token: () => new Response("bad gateway", { status: 502 }) }).fetch);
  await assert.rejects(down.refresh(signedIn()), (error: unknown) => error instanceof OAuthTokenError && error.oauthError === "server_error" && error.status === 502);
  const offline = auth((async (input: unknown, init: unknown) => {
    if (String(input).includes("openid-configuration")) return Response.json(discoveryDocument());
    void init;
    throw new TypeError("offline");
  }) as typeof fetch);
  await assert.rejects(offline.refresh(signedIn()), NetworkError);
});

test("sign-out revokes the refresh token and builds the RP-initiated logout URL", async () => {
  const { calls, fetch } = fakeIssuer({ revoke: () => new Response(null, { status: 200 }) });
  const flow = auth(fetch, { postLogoutRedirectUri: "https://shop.example.test/signed-out" });
  const tokens = signedIn();
  const result = await flow.signOut(tokens, { state: "s1" });
  assert.equal(result.revoked, true);
  const logout = new URL(result.logoutUrl!);
  assert.equal(`${logout.origin}${logout.pathname}`, `${issuer}/oauth2/sessions/logout`);
  assert.equal(logout.searchParams.get("id_token_hint"), tokens.idToken);
  assert.equal(logout.searchParams.get("post_logout_redirect_uri"), "https://shop.example.test/signed-out");
  assert.equal(logout.searchParams.get("state"), "s1");
  const revoke = calls.find((c) => c.url.pathname === "/oauth2/revoke")!;
  assert.deepEqual(Object.fromEntries(new URLSearchParams(String(revoke.init.body))), { token: "refresh-1", token_type_hint: "refresh_token", client_id: clientId });

  const other = await flow.signOut(tokens, { postLogoutRedirectUri: "https://shop.example.test/elsewhere" });
  assert.equal(new URL(other.logoutUrl!).searchParams.get("post_logout_redirect_uri"), "https://shop.example.test/elsewhere");
  assert.ok(new URL(other.logoutUrl!).searchParams.get("state"), "a state is generated with a post-logout redirect");
  await assert.rejects(flow.signOut(tokens, { postLogoutRedirectUri: "http://evil.test/" }), /https/);

  const noRedirect = await auth(fetch).signOut({ idToken: tokens.idToken });
  assert.equal(noRedirect.revoked, false, "no refresh token to revoke");
  assert.equal(new URL(noRedirect.logoutUrl!).searchParams.has("post_logout_redirect_uri"), false);

  const failingRevoke = await auth(fakeIssuer({ revoke: () => new Response("nope", { status: 500 }) }).fetch).signOut(tokens);
  assert.equal(failingRevoke.revoked, false, "a failed revocation does not block sign-out");
  assert.ok(failingRevoke.logoutUrl);

  const withoutEnd = await auth(fakeIssuer({ discovery: () => Response.json(discoveryDocument({ end_session_endpoint: undefined, revocation_endpoint: undefined })) }).fetch).signOut(tokens);
  assert.deepEqual(withoutEnd, { logoutUrl: null, revoked: false });
});

test("a session serves a fresh token from its store without touching the network", async () => {
  const { calls, fetch } = fakeIssuer();
  const session = new CustomerSession({ auth: auth(fetch), lock: false });
  await assert.rejects(session.getAccessToken(), NotSignedInError);
  await assert.rejects(session.getAccessToken(), (error: unknown) => error instanceof CustomerAuthError && error.code === "not_signed_in");
  await session.setTokens(signedIn());
  assert.equal(await session.getAccessToken(), "access-1");
  assert.equal(await session.tokenProvider(), "access-1");
  assert.equal(calls.length, 0);
});

test("concurrent callers share one refresh, so a rotated token is never redeemed twice", async () => {
  const { fetch, tokenCalls } = fakeIssuer({
    token: (_body, call) => Response.json({ access_token: `access-${call + 1}`, token_type: "bearer", expires_in: 600, refresh_token: `refresh-${call + 1}` }),
  });
  const store = memoryTokenStore(signedIn({ expiresAt: Date.now() + 5_000 }));
  const session = new CustomerSession({ auth: auth(fetch), store, lock: false });
  const tokens = await Promise.all(Array.from({ length: 6 }, () => session.getAccessToken()));
  assert.equal(tokenCalls(), 1);
  assert.deepEqual(new Set(tokens), new Set(["access-2"]));
  assert.equal((await store.get())?.refreshToken, "refresh-2");
  assert.equal(await session.getAccessToken(), "access-2");
  assert.equal(tokenCalls(), 1, "the refreshed token is now fresh");

  assert.equal(await session.getAccessToken({ forceRefresh: true }), "access-3");
  assert.equal(tokenCalls(), 2);
});

test("a caller that stops waiting does not cancel the shared refresh", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { fetch, tokenCalls } = fakeIssuer({ token: () => Response.json({ access_token: "access-2", token_type: "bearer", expires_in: 600, refresh_token: "refresh-2" }) });
  const slowFetch = (async (input: unknown, init: RequestInit) => {
    if (String(input).endsWith("/oauth2/token")) await gate;
    return (fetch as (i: unknown, n: RequestInit) => Promise<Response>)(input, init);
  }) as typeof fetch;
  const session = new CustomerSession({ auth: auth(slowFetch), store: memoryTokenStore(signedIn({ expiresAt: Date.now() - 1 })), lock: false });
  const controller = new AbortController();
  const impatient = session.getAccessToken({ signal: controller.signal });
  const patient = session.getAccessToken();
  await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort(new Error("gave up"));
  await assert.rejects(impatient, /gave up/);
  release();
  assert.equal(await patient, "access-2");
  assert.equal(tokenCalls(), 1);
});

test("a revoked refresh token clears the session and tells subscribers; transient failures keep the tokens", async () => {
  const store = memoryTokenStore(signedIn({ expiresAt: Date.now() - 1 }));
  let mode: "down" | "revoked" = "down";
  const { fetch } = fakeIssuer({ token: () => (mode === "down" ? new Response("unavailable", { status: 503 }) : Response.json({ error: "invalid_grant" }, { status: 400 })) });
  const session = new CustomerSession({ auth: auth(fetch), store, lock: false });
  const events: (TokenSet | null)[] = [];
  const unsubscribe = session.subscribe((tokens) => events.push(tokens));

  await assert.rejects(session.getAccessToken(), (error: unknown) => error instanceof OAuthTokenError && error.status === 503);
  assert.ok(await store.get(), "a transient failure must not sign the customer out");
  assert.equal(events.length, 0);

  mode = "revoked";
  await assert.rejects(session.getAccessToken(), RefreshTokenRevokedError);
  assert.equal(await store.get(), null);
  assert.deepEqual(events, [null]);
  await assert.rejects(session.getAccessToken(), NotSignedInError);
  unsubscribe();
  await session.setTokens(signedIn());
  assert.equal(events.length, 1, "unsubscribed listeners hear nothing");
});

test("an expired token without a refresh token asks for a new sign-in", async () => {
  const session = new CustomerSession({ auth: auth(fakeIssuer().fetch), store: memoryTokenStore(signedIn({ expiresAt: Date.now() - 1, refreshToken: undefined })), lock: false });
  await assert.rejects(session.getAccessToken(), (error: unknown) => error instanceof CustomerAuthError && error.code === "no_refresh_token");
});

test("with a refresh lock, a token another tab already refreshed is used instead of redeeming the spent one", async () => {
  const { fetch, tokenCalls } = fakeIssuer();
  const store = memoryTokenStore(signedIn({ expiresAt: Date.now() - 1 }));
  const names: string[] = [];
  const otherTab = signedIn({ accessToken: "from-other-tab", refreshToken: "refresh-other" });
  const session = new CustomerSession({
    auth: auth(fetch),
    store,
    lock: async (name, task) => {
      names.push(name);
      await store.set(otherTab); // the other tab finishes its refresh while this one waits for the lock
      return task();
    },
  });
  assert.equal(await session.getAccessToken(), "from-other-tab");
  assert.equal(tokenCalls(), 0, "no second redemption: that would trip reuse detection");
  assert.deepEqual(names, [`unitfield:refresh:${clientId}`]);
});

test("completeSignIn stores the tokens; signOut revokes, clears and returns the logout URL", async () => {
  let request!: AuthorizationRequest;
  const { calls, fetch } = fakeIssuer({ token: () => Response.json(tokenBody(request)) });
  const flow = auth(fetch);
  const session = new CustomerSession({ auth: flow, lock: false });
  const events: (TokenSet | null)[] = [];
  session.subscribe((tokens) => events.push(tokens));
  request = await flow.createAuthorizationRequest();
  const tokens = await session.completeSignIn(`${redirectUri}?code=c&state=${request.state}`, request);
  assert.deepEqual(await session.getTokens(), tokens);
  assert.equal(events.length, 1);

  const result = await session.signOut();
  assert.equal(result.revoked, true);
  assert.ok(result.logoutUrl?.includes("id_token_hint="));
  assert.equal(await session.getTokens(), null);
  assert.equal(events.at(-1), null);
  assert.ok(calls.some((c) => c.url.pathname === "/oauth2/revoke"));

  const broken = new CustomerSession({ auth: auth((async () => { throw new TypeError("offline"); }) as typeof fetch), store: memoryTokenStore(signedIn()), lock: false });
  await assert.rejects(broken.signOut());
  assert.equal(await broken.getTokens(), null, "the local session is cleared even when the issuer cannot be reached");
});

test("session.tokenProvider makes a client survive an expired access token", async () => {
  const issuerSide = fakeIssuer({ token: () => Response.json({ access_token: "access-2", token_type: "bearer", expires_in: 600, refresh_token: "refresh-2" }) });
  const session = new CustomerSession({ auth: auth(issuerSide.fetch), store: memoryTokenStore(signedIn()), lock: false });
  const api = recorder((call) => (call.headers.get("authorization") === "Bearer access-2" ? Response.json([]) : Response.json({ code: "token_expired" }, { status: 401 })));
  const resident = createResidentClient({ baseUrl: "https://api.unitfield.test", tokenProvider: session.tokenProvider, fetch: api.fetch });
  assert.deepEqual(await resident.leases.list(), []);
  assert.deepEqual(api.calls.map((c) => c.headers.get("authorization")), ["Bearer access-1", "Bearer access-2"]);
  assert.equal(issuerSide.tokenCalls(), 1);
});

test("isExpiring applies a skew", () => {
  assert.equal(isExpiring({ expiresAt: 10_000 }, 1_000, 8_999), false);
  assert.equal(isExpiring({ expiresAt: 10_000 }, 1_000, 9_000), true);
});

test("in-flight sign-ins are kept by state, single use, and tolerate junk", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key) };
  const request: AuthorizationRequest = { url: "https://id.test/auth", state: "st-1", nonce: "n", codeVerifier: "v".repeat(43), redirectUri, scopes: ["openid"], createdAt: 1 };
  saveAuthorizationRequest(request, storage);
  saveAuthorizationRequest({ ...request, state: "st-2" }, storage);
  assert.deepEqual(takeAuthorizationRequestFor(`${redirectUri}?code=c&state=st-1`, storage), request);
  assert.equal(takeAuthorizationRequest("st-1", storage), null, "a request can be redeemed once");
  assert.equal(takeAuthorizationRequest("st-2", storage)?.state, "st-2");
  assert.equal(takeAuthorizationRequestFor(`${redirectUri}?code=c`, storage), null);
  assert.equal(takeAuthorizationRequestFor("not a url", storage), null);
  store.set("unitfield:auth:bad", "{not json");
  assert.equal(takeAuthorizationRequest("bad", storage), null);
  store.set("unitfield:auth:partial", JSON.stringify({ state: "partial" }));
  assert.equal(takeAuthorizationRequest("partial", storage), null);
  assert.throws(() => saveAuthorizationRequest(request), /sessionStorage/);
});
