// Everything is read from the environment when a request arrives (never at build time), so one build can run anywhere.

const PRODUCTION_API = "https://api.unitfield.com";

export function apiUrl(): string {
  return process.env.UNITFIELD_API_URL?.trim() || PRODUCTION_API;
}

export function publishableKey(): string {
  const key = process.env.UNITFIELD_PUBLISHABLE_KEY?.trim();
  if (!key) throw new Error("UNITFIELD_PUBLISHABLE_KEY is not set. Copy your site's publishable key from Website > Developers into .env.local.");
  return key;
}

/** The origin this site is served from, without a trailing slash. Redirect URIs are built from it, never from request headers. */
export function siteUrl(): string {
  return (process.env.UNITFIELD_SITE_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
}

export type AuthConfig = { clientId: string; sessionSecret: string; issuer: string | undefined };

/** The sign-in settings, or `null` when sign-in is not set up. */
export function authConfig(): AuthConfig | null {
  const clientId = process.env.UNITFIELD_CLIENT_ID?.trim();
  const sessionSecret = process.env.UNITFIELD_SESSION_SECRET?.trim();
  if (!clientId || !sessionSecret) return null;
  if (sessionSecret.length < 32) throw new Error("UNITFIELD_SESSION_SECRET must be at least 32 characters.");
  return { clientId, sessionSecret, issuer: process.env.UNITFIELD_ID_URL?.trim() || undefined };
}

export function turnstileSiteKey(): string | null {
  return process.env.TURNSTILE_SITE_KEY?.trim() || null;
}
