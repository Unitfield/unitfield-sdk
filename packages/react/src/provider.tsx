"use client";

import {
  createCustomerAuth,
  createCustomerSession,
  createStorefrontClient,
  type CustomerAuthOptions,
  type CustomerSession,
  type FetchExtras,
  type StorefrontClient,
  type TokenStore,
} from "@unitfield/sdk";
import { useMemo, type ReactNode } from "react";
import { UnitfieldContext, type UnitfieldContextValue } from "./context.js";

/** Customer sign-in for the browser: the SDK's `CustomerAuth` options, plus where tokens are kept. */
export type UnitfieldAuthOptions = CustomerAuthOptions & {
  /** Defaults to the SDK's in-memory store: tokens live as long as the page. */
  store?: TokenStore;
};

type Common = {
  children?: ReactNode;
  /**
   * Turns on `useCustomer` and `useSignIn`. Build the object once (module scope, or memoized): the provider rebuilds the
   * session whenever one of the fields below changes.
   */
  auth?: UnitfieldAuthOptions;
  /** A ready `CustomerSession`, for apps that share one session with other code. Wins over `auth`. */
  session?: CustomerSession;
  /** How the browser is sent to the issuer. Defaults to `window.location.assign`; pass your router's hard navigation if you need one. */
  navigate?: (url: string) => void;
};

export type UnitfieldProviderProps = Common &
  (
    | {
        /** `pk_live_…` or `pk_test_…`. Public by design. */
        publishableKey: string;
        /** Defaults to the SDK's production API origin. */
        apiUrl?: string;
        /** Extra `fetch` init for every read, for example a framework's `next: { revalidate }`. Keep the object stable. */
        fetchOptions?: FetchExtras;
        client?: never;
      }
    | {
        /** An existing client, when you build it yourself (SSR, tests, a shared instance). */
        client: StorefrontClient;
        publishableKey?: never;
        apiUrl?: never;
        fetchOptions?: never;
      }
  );

function browserNavigate(url: string): void {
  window.location.assign(url);
}

/**
 * Gives hooks a storefront client (and, optionally, a customer session). It renders no markup of its own, reads nothing
 * from the browser while rendering, and is safe to render on the server.
 */
export function UnitfieldProvider(props: UnitfieldProviderProps) {
  const { children, navigate, session: sessionProp, auth } = props;
  const { client: clientProp, publishableKey, apiUrl, fetchOptions } = props;

  const client = useMemo(
    () => clientProp ?? createStorefrontClient({ publishableKey: publishableKey as string, ...(apiUrl ? { baseUrl: apiUrl } : {}), ...(fetchOptions ? { fetchOptions } : {}) }),
    [clientProp, publishableKey, apiUrl, fetchOptions],
  );

  const clientId = auth?.clientId;
  const redirectUri = auth?.redirectUri?.toString();
  const postLogoutRedirectUri = auth?.postLogoutRedirectUri?.toString();
  const issuer = auth?.issuer?.toString();
  const scopes = auth?.scopes?.join(" ");
  const store = auth?.store;
  const authFetch = auth?.fetch;
  const authEndpoints = auth?.endpoints;
  const session = useMemo<CustomerSession | null>(() => {
    if (sessionProp) return sessionProp;
    if (!auth) return null;
    return createCustomerSession({ auth: createCustomerAuth(auth), ...(auth.store ? { store: auth.store } : {}) });
    // `auth` itself is read through the primitive fields listed here, so an inline object does not rebuild the session on every render.
  }, [sessionProp, clientId, redirectUri, postLogoutRedirectUri, issuer, scopes, store, authFetch, authEndpoints]);

  const value = useMemo<UnitfieldContextValue>(() => ({ client, session, navigate: navigate ?? browserNavigate }), [client, session, navigate]);
  return <UnitfieldContext.Provider value={value}>{children}</UnitfieldContext.Provider>;
}
