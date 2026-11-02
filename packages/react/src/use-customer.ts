"use client";

import type { CustomerSession, SignOutOptions, SignOutResult, TokenSet } from "@unitfield/sdk";
import { useCallback, useEffect, useState } from "react";
import { useUnitfield } from "./context.js";

/** Who is signed in, from the ID token's claims. */
export type Customer = {
  /** The customer account's public id (`cus_…`). */
  id: string;
  email: string | null;
  emailVerified: boolean;
};

export type CustomerState = {
  /**
   * `loading` until the token store has been read (always the case on the server and in the first client render, so markup
   * matches), then `signed-in` or `signed-out`. Without `auth` or `session` on the provider it is `signed-out` throughout.
   */
  status: "loading" | "signed-in" | "signed-out";
  isSignedIn: boolean;
  /** `null` when signed out, or when the stored tokens carry no ID token. */
  customer: Customer | null;
  /** Pass `session.tokenProvider` to `createResidentClient` / `createApplicantClient`. `null` without a session. */
  session: CustomerSession | null;
  /**
   * Revokes the refresh token and clears the tokens. Navigate to `logoutUrl` afterwards to end the session at the issuer
   * (the hook does not navigate for you). Rejects when no session is configured.
   */
  signOut: (options?: SignOutOptions) => Promise<SignOutResult>;
};

function customerOf(tokens: TokenSet | null): Customer | null {
  const claims = tokens?.claims;
  if (!claims) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null, emailVerified: claims.email_verified === true };
}

/**
 * The signed-in customer of the browser session configured on `UnitfieldProvider`. It re-renders when the session signs in,
 * refreshes or signs out (also in another component). Servers that keep tokens in a cookie read the cookie there instead.
 */
export function useCustomer(): CustomerState {
  const { session } = useUnitfield();
  const [loaded, setLoaded] = useState<{ session: CustomerSession; tokens: TokenSet | null } | null>(null);

  useEffect(() => {
    if (!session) return;
    let active = true;
    const apply = (tokens: TokenSet | null) => {
      if (active) setLoaded({ session, tokens });
    };
    const unsubscribe = session.subscribe(apply);
    session.getTokens().then(apply, () => apply(null));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [session]);

  const signOut = useCallback(
    (options?: SignOutOptions) => {
      if (!session) return Promise.reject(new Error("Sign-in is not configured: pass `auth` or `session` to <UnitfieldProvider>."));
      return session.signOut(options);
    },
    [session],
  );

  if (!session) return { status: "signed-out", isSignedIn: false, customer: null, session: null, signOut };
  // A value read for a previous session never answers for this one.
  if (!loaded || loaded.session !== session) return { status: "loading", isSignedIn: false, customer: null, session, signOut };
  const signedIn = loaded.tokens !== null;
  return { status: signedIn ? "signed-in" : "signed-out", isSignedIn: signedIn, customer: customerOf(loaded.tokens), session, signOut };
}
