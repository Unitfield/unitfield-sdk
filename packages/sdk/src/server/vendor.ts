import type { InstallationCredential, PlatformClient } from "../platform.js";
import { pathSegment } from "../internal/url.js";
import type { RequestOptions } from "../transport.js";

/**
 * Explicit publisher-server delivery of an installation's credential. Use a real fresh Developer human session, never
 * an installation token. The API consumes the exact grant once: store the result directly in a private secret store and
 * never proxy it to a browser. The call is uncached, omits cookies, refuses redirects and is never retried.
 */
export async function getVendorInstallationCredential(
  client: PlatformClient,
  installationId: string,
  expectedGeneration: number,
  options: RequestOptions = {},
): Promise<InstallationCredential> {
  const id = pathSegment(installationId, "installationId");
  if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 1) throw new TypeError("expectedGeneration must be a positive safe integer.");
  return client.request<InstallationCredential>(`/api/platform/v1/developer/installations/${id}/credentials`, {
    ...options,
    method: "POST",
    body: { expectedGeneration },
    retry: false,
    fetchOptions: { ...options.fetchOptions, cache: "no-store", credentials: "omit", redirect: "error" },
  });
}
