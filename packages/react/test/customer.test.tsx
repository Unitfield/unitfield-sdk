import { act, renderHook, waitFor } from "@testing-library/react";
import { createCustomerAuth, createCustomerSession, memoryTokenStore, type CustomerAuth, type StorageLike, type TokenSet } from "@unitfield/sdk";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UnitfieldProvider, useCustomer, useSignIn } from "../src/index.js";
import { API, KEY, fixtureApi, jwt } from "./fixtures.js";

const ISSUER = "https://id.example.test";
const CLIENT_ID = "cust_sdk_test";
const REDIRECT = "https://homes.example.test/auth/callback";
const ENDPOINTS = { authorization: `${ISSUER}/oauth2/auth`, token: `${ISSUER}/oauth2/token`, revocation: `${ISSUER}/oauth2/revoke`, endSession: `${ISSUER}/oauth2/sessions/logout` };

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value), removeItem: (key) => void data.delete(key) };
}

function tokens(overrides: Partial<TokenSet> = {}): TokenSet {
  const claims = { iss: ISSUER, sub: "cus_abc", aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 600, email: "pat@example.test", email_verified: true };
  return { accessToken: "access-1", tokenType: "Bearer", expiresAt: Date.now() + 600_000, refreshToken: "refresh-1", idToken: jwt(claims), scope: ["openid", "email"], claims, ...overrides };
}

type TokenCall = { url: string; body: URLSearchParams };

/** A token endpoint that answers the code exchange with an ID token carrying the request's nonce. */
function issuer(getNonce: () => string, calls: TokenCall[] = []) {
  const fetch = (async (input: URL | string | Request, init: RequestInit = {}) => {
    const url = String(input);
    const body = new URLSearchParams(String(init.body ?? ""));
    calls.push({ url, body });
    if (url === ENDPOINTS.token && body.get("grant_type") === "authorization_code") {
      const claims = { iss: ISSUER, sub: "cus_abc", aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 600, nonce: getNonce(), email: "pat@example.test", email_verified: true };
      return Response.json({ access_token: "access-2", token_type: "bearer", expires_in: 600, refresh_token: "refresh-2", id_token: jwt(claims), scope: "openid email offline_access" });
    }
    return new Response(null, { status: 200 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

function providerFor(options: { auth?: CustomerAuth; store?: ReturnType<typeof memoryTokenStore>; navigate?: (url: string) => void }) {
  const api = fixtureApi();
  const session = options.auth ? createCustomerSession({ auth: options.auth, store: options.store ?? memoryTokenStore(), lock: false }) : undefined;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <UnitfieldProvider client={api.client} {...(session ? { session } : {})} {...(options.navigate ? { navigate: options.navigate } : {})}>
      {children}
    </UnitfieldProvider>
  );
  return { api, session, wrapper };
}

function authWith(fetch: typeof globalThis.fetch): CustomerAuth {
  return createCustomerAuth({ clientId: CLIENT_ID, redirectUri: REDIRECT, issuer: ISSUER, endpoints: ENDPOINTS, fetch });
}

describe("useCustomer", () => {
  it("is signed out, without any request, when the provider has no sign-in configured", () => {
    const { wrapper, api } = providerFor({});
    const { result } = renderHook(() => useCustomer(), { wrapper });
    expect(result.current).toMatchObject({ status: "signed-out", isSignedIn: false, customer: null, session: null });
    expect(api.calls).toHaveLength(0);
  });

  it("reads the stored tokens after mount and exposes the customer from the ID token", async () => {
    const store = memoryTokenStore(tokens());
    const { wrapper } = providerFor({ auth: authWith(issuer(() => "n").fetch), store });
    const { result } = renderHook(() => useCustomer(), { wrapper });
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("signed-in"));
    expect(result.current.customer).toEqual({ id: "cus_abc", email: "pat@example.test", emailVerified: true });
    expect(result.current.isSignedIn).toBe(true);
  });

  it("is signed out when the store is empty", async () => {
    const { wrapper } = providerFor({ auth: authWith(issuer(() => "n").fetch) });
    const { result } = renderHook(() => useCustomer(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("signed-out"));
    expect(result.current.customer).toBeNull();
  });

  it("follows the session: signs in when tokens arrive and out on sign-out", async () => {
    const calls: TokenCall[] = [];
    const { wrapper, session } = providerFor({ auth: authWith(issuer(() => "n", calls).fetch) });
    const { result } = renderHook(() => useCustomer(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("signed-out"));

    await act(async () => {
      await session!.setTokens(tokens());
    });
    expect(result.current.status).toBe("signed-in");

    let signOut: Awaited<ReturnType<typeof result.current.signOut>> | undefined;
    await act(async () => {
      signOut = await result.current.signOut();
    });
    expect(result.current.status).toBe("signed-out");
    expect(signOut?.logoutUrl).toContain(ENDPOINTS.endSession);
    expect(signOut?.revoked).toBe(true);
    expect(calls.some((call) => call.url === ENDPOINTS.revocation && call.body.get("token") === "refresh-1")).toBe(true);
  });

  it("rejects signOut when sign-in is not configured", async () => {
    const { wrapper } = providerFor({});
    const { result } = renderHook(() => useCustomer(), { wrapper });
    await expect(result.current.signOut()).rejects.toThrow(/not configured/);
  });

  it("renders as loading on the server so the first client render matches", () => {
    const { wrapper: Wrapper } = providerFor({ auth: authWith(issuer(() => "n").fetch), store: memoryTokenStore(tokens()) });
    function Page() {
      return <p>{useCustomer().status}</p>;
    }
    expect(renderToString(<Wrapper><Page /></Wrapper>)).toContain(">loading<");
  });
});

describe("useSignIn", () => {
  it("builds a PKCE request, keeps it by state and sends the browser to the issuer", async () => {
    const navigations: string[] = [];
    const storage = memoryStorage();
    const { wrapper } = providerFor({ auth: authWith(issuer(() => "n").fetch), navigate: (url) => navigations.push(url) });
    const { result } = renderHook(() => useSignIn({ storage }), { wrapper });

    await act(async () => {
      await result.current.signIn({ loginHint: "pat@example.test" });
    });

    expect(result.current.status).toBe("redirecting");
    const target = new URL(navigations[0]!);
    expect(`${target.origin}${target.pathname}`).toBe(ENDPOINTS.authorization);
    expect(target.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(target.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(target.searchParams.get("code_challenge_method")).toBe("S256");
    expect(target.searchParams.get("login_hint")).toBe("pat@example.test");
    const state = target.searchParams.get("state")!;
    expect([...storage.data.keys()]).toEqual([`unitfield:auth:${state}`]);
    // The verifier stays in storage; only its challenge is in the URL.
    expect(navigations[0]).not.toContain(JSON.parse(storage.data.get(`unitfield:auth:${state}`)!).codeVerifier);
  });

  it("completes the callback: redeems the code with the verifier and updates useCustomer", async () => {
    const storage = memoryStorage();
    const navigations: string[] = [];
    const calls: TokenCall[] = [];
    let nonce = "";
    const { wrapper } = providerFor({ auth: authWith(issuer(() => nonce, calls).fetch), navigate: (url) => navigations.push(url) });
    const { result } = renderHook(() => ({ signIn: useSignIn({ storage }), customer: useCustomer() }), { wrapper });
    await waitFor(() => expect(result.current.customer.status).toBe("signed-out"));

    await act(async () => {
      await result.current.signIn.signIn();
    });
    const target = new URL(navigations[0]!);
    nonce = target.searchParams.get("nonce")!;
    const state = target.searchParams.get("state")!;
    const verifier = JSON.parse(storage.data.get(`unitfield:auth:${state}`)!).codeVerifier as string;

    let signedIn: TokenSet | undefined;
    await act(async () => {
      signedIn = await result.current.signIn.completeSignIn(`${REDIRECT}?code=abc&state=${state}&iss=${encodeURIComponent(ISSUER)}`);
    });

    expect(signedIn?.accessToken).toBe("access-2");
    expect(result.current.signIn.status).toBe("idle");
    expect(result.current.customer.status).toBe("signed-in");
    expect(result.current.customer.customer?.email).toBe("pat@example.test");
    const exchange = calls.find((call) => call.body.get("grant_type") === "authorization_code")!;
    expect(exchange.body.get("code")).toBe("abc");
    expect(exchange.body.get("code_verifier")).toBe(verifier);
    expect(exchange.body.get("client_id")).toBe(CLIENT_ID);
    expect(exchange.body.has("client_secret")).toBe(false);
    // The saved request can be redeemed once.
    expect(storage.data.size).toBe(0);
  });

  it("fails a callback it did not start, and one with the wrong state", async () => {
    const storage = memoryStorage();
    const { wrapper } = providerFor({ auth: authWith(issuer(() => "n").fetch), navigate: () => {} });
    const { result } = renderHook(() => useSignIn({ storage }), { wrapper });

    let failure: unknown;
    await act(async () => {
      failure = await result.current.completeSignIn(`${REDIRECT}?code=abc&state=unknown`).catch((error: unknown) => error);
    });
    expect(failure).toMatchObject({ name: "CustomerAuthError", code: "state_mismatch" });
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe(failure);
  });

  it("reports an issuer denial from the callback", async () => {
    const storage = memoryStorage();
    const navigations: string[] = [];
    const { wrapper } = providerFor({ auth: authWith(issuer(() => "n").fetch), navigate: (url) => navigations.push(url) });
    const { result } = renderHook(() => useSignIn({ storage }), { wrapper });
    await act(async () => {
      await result.current.signIn();
    });
    const state = new URL(navigations[0]!).searchParams.get("state")!;
    let failure: unknown;
    await act(async () => {
      failure = await result.current.completeSignIn(`${REDIRECT}?error=access_denied&state=${state}`).catch((error: unknown) => error);
    });
    expect(failure).toMatchObject({ code: "authorization_denied", oauthError: "access_denied" });
  });

  it("rejects, with a clear message, when sign-in is not configured", async () => {
    const { wrapper } = providerFor({});
    const { result } = renderHook(() => useSignIn(), { wrapper });
    await act(async () => {
      await expect(result.current.signIn()).rejects.toThrow(/not configured/);
    });
    expect(result.current.status).toBe("error");
  });

  it("can be configured with inline `auth` options", async () => {
    const navigations: string[] = [];
    const wrapper = ({ children }: { children: ReactNode }) => (
      <UnitfieldProvider publishableKey={KEY} apiUrl={API} auth={{ clientId: CLIENT_ID, redirectUri: REDIRECT, issuer: ISSUER, endpoints: ENDPOINTS }} navigate={(url) => navigations.push(url)}>
        {children}
      </UnitfieldProvider>
    );
    const { result, rerender } = renderHook(() => useSignIn({ storage: memoryStorage() }), { wrapper });
    await act(async () => {
      await result.current.signIn({ scopes: ["openid", "email"] });
    });
    expect(new URL(navigations[0]!).searchParams.get("scope")).toBe("openid email");
    rerender();
  });
});
