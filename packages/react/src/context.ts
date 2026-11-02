"use client";

import type { CustomerSession, StorefrontClient } from "@unitfield/sdk";
import { createContext, useContext } from "react";

export type UnitfieldContextValue = {
  /** The storefront client every hook reads with. */
  client: StorefrontClient;
  /** Present when the provider was given `auth` or `session`; `null` otherwise. */
  session: CustomerSession | null;
  /** How the browser is sent to the issuer. Defaults to `window.location.assign`. */
  navigate: (url: string) => void;
};

export const UnitfieldContext = createContext<UnitfieldContextValue | null>(null);

/**
 * The storefront client and the customer session of the nearest `UnitfieldProvider`. Use it for calls the hooks do not
 * wrap, such as `client.inquiries.create(...)` or `client.properties.list()`.
 */
export function useUnitfield(): UnitfieldContextValue {
  const value = useContext(UnitfieldContext);
  if (!value) throw new Error("Unitfield hooks must be used inside <UnitfieldProvider>.");
  return value;
}
