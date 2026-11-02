import { createCustomerAuth, type CustomerAuth } from "@unitfield/sdk";
import { createAuthorizationRequestCookie, createCookieTokenStore, type AuthorizationRequestCookie } from "@unitfield/sdk/server";
import { cookies } from "next/headers";
import { authConfig, siteUrl } from "./config";

// The customer's tokens live in an httpOnly cookie that only the server can read, sealed (AES-256-GCM) with
// UNITFIELD_SESSION_SECRET. The browser never sees an access or refresh token.

const secure = process.env.NODE_ENV === "production";
// `__Host-` cookies must be Secure, which `next dev` on http://localhost is not, so development uses plain names.
const names = secure ? { tokens: "__Host-uf_sdk", flow: "__Host-uf_sdk_auth" } : { tokens: "uf_sdk", flow: "uf_sdk_auth" };

export function signInEnabled(): boolean {
  return authConfig() !== null;
}

/** The SDK's OIDC authorization code + PKCE helper for this site's public client. */
export function customerAuth(): CustomerAuth {
  const config = authConfig();
  if (!config) throw new Error("Sign-in is not configured: set UNITFIELD_CLIENT_ID and UNITFIELD_SESSION_SECRET.");
  return createCustomerAuth({
    clientId: config.clientId,
    redirectUri: `${siteUrl()}/auth/callback`,
    scopes: ["openid", "email", "offline_access"],
    ...(config.issuer ? { issuer: config.issuer } : {}),
  });
}

export async function tokenStore() {
  const config = authConfig();
  if (!config) throw new Error("Sign-in is not configured.");
  return createCookieTokenStore(await cookies(), { secret: config.sessionSecret, name: names.tokens, secure });
}

export async function signInRequestCookie(): Promise<AuthorizationRequestCookie> {
  const config = authConfig();
  if (!config) throw new Error("Sign-in is not configured.");
  return createAuthorizationRequestCookie(await cookies(), { secret: config.sessionSecret, name: names.flow, secure });
}

export type SignedInCustomer = { id: string; email: string | null };

/**
 * Who is signed in, from the ID token the callback stored. This does not call the API and does not refresh anything:
 * refreshing rotates the refresh token, and Next cannot write cookies while a page renders, so do it in a route handler
 * or a Server Action.
 */
export async function currentCustomer(): Promise<SignedInCustomer | null> {
  if (!signInEnabled()) return null;
  const tokens = await (await tokenStore()).get();
  const claims = tokens?.claims;
  return claims ? { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null } : null;
}
