// What the npm registry knows about a package, read from the public registry API (no login, no npm CLI).
const REGISTRY = "https://registry.npmjs.org";

/**
 * `{ exists, hasVersion }` for `name@version`.
 *
 * Only a 404 means "this package does not exist". Anything else that is not a 200 (a rate limit, an outage, a proxy page) throws,
 * so a registry hiccup can never be mistaken for "nothing to publish yet" and silently skip a release.
 */
export async function registryState(name, version, fetchImpl = fetch) {
  const url = `${REGISTRY}/${name.replace("/", "%2f")}`;
  const response = await fetchImpl(url, { headers: { accept: "application/vnd.npm.install-v1+json" } });
  if (response.status === 404) return { exists: false, hasVersion: false };
  if (!response.ok) throw new Error(`The npm registry answered ${response.status} for ${name}; cannot tell whether ${version} is published.`);
  const document = await response.json();
  return { exists: true, hasVersion: Boolean(document?.versions && Object.hasOwn(document.versions, version)) };
}
