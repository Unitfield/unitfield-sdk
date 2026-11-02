"use client";

import { CustomerAuthError, saveAuthorizationRequest, takeAuthorizationRequestFor, type SignInOptions, type StorageLike, type TokenSet } from "@unitfield/sdk";
import { useCallback, useState } from "react";
import { useUnitfield } from "./context.js";

export type UseSignInOptions = {
  /** Where the in-flight sign-in (PKCE verifier included) waits for the callback. Defaults to `sessionStorage`. */
  storage?: StorageLike;
};

export type SignInStatus = "idle" | "redirecting" | "completing" | "error";

export type UseSignIn = {
  status: SignInStatus;
  /** The failure of the latest `signIn` or `completeSignIn`. Cleared when the next one starts. */
  error: Error | null;
  /**
   * Starts OIDC authorization code + PKCE: builds the request, keeps it in `storage` under its `state` and sends the
   * browser to the issuer. Rejects (and sets `error`) when the request cannot be built.
   */
  signIn: (options?: SignInOptions) => Promise<void>;
  /**
   * Call on the page registered as the redirect URI. Verifies the callback, redeems the code, stores the tokens and
   * resolves with them; every `useCustomer` then updates. `callback` defaults to `window.location.href`.
   */
  completeSignIn: (callback?: string | URL) => Promise<TokenSet>;
};

const NOT_CONFIGURED = "Sign-in is not configured: pass `auth` or `session` to <UnitfieldProvider>.";

/** The two halves of browser sign-in. Pair it with `useCustomer` for the result. */
export function useSignIn(options: UseSignInOptions = {}): UseSignIn {
  const { session, navigate } = useUnitfield();
  const { storage } = options;
  const [status, setStatus] = useState<SignInStatus>("idle");
  const [error, setError] = useState<Error | null>(null);

  const fail = useCallback((cause: unknown): never => {
    const failure = cause instanceof Error ? cause : new Error(String(cause));
    setError(failure);
    setStatus("error");
    throw failure;
  }, []);

  const signIn = useCallback(
    async (signInOptions?: SignInOptions) => {
      setError(null);
      if (!session) return fail(new Error(NOT_CONFIGURED));
      setStatus("redirecting");
      try {
        const request = await session.auth.createAuthorizationRequest(signInOptions);
        saveAuthorizationRequest(request, storage);
        navigate(request.url);
      } catch (cause) {
        return fail(cause);
      }
    },
    [session, storage, navigate, fail],
  );

  const completeSignIn = useCallback(
    async (callback: string | URL = window.location.href) => {
      setError(null);
      if (!session) return fail(new Error(NOT_CONFIGURED));
      setStatus("completing");
      try {
        const request = takeAuthorizationRequestFor(callback, storage);
        if (!request) throw new CustomerAuthError("There is no sign-in in progress for this callback. Start again.", "state_mismatch");
        const tokens = await session.completeSignIn(callback, request);
        setStatus("idle");
        return tokens;
      } catch (cause) {
        return fail(cause);
      }
    },
    [session, storage, fail],
  );

  return { status, error, signIn, completeSignIn };
}
