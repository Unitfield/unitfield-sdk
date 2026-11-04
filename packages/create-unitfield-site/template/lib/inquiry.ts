import type { InquiryMode } from "@/components/inquiry-form";
import { turnstileSiteKey } from "./config";

/**
 * How the inquiry form gets the anti-bot token the API requires. The site key comes from the API with the site
 * (`site.turnstileSiteKey`): it belongs to the Turnstile widget Unitfield made for your site, whose allowed hostnames are your
 * domains and whose secret only the API holds, so it is the one key whose tokens the API accepts. `TURNSTILE_SITE_KEY` is read
 * only when the API sends no key (an API older than this feature).
 */
export function inquiryMode(site: { turnstileSiteKey?: string | null }): InquiryMode {
  const siteKey = site.turnstileSiteKey?.trim() || turnstileSiteKey();
  if (siteKey) return { kind: "widget", siteKey };
  return process.env.NODE_ENV === "production" ? { kind: "off" } : { kind: "development" };
}
