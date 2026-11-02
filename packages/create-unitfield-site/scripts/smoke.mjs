#!/usr/bin/env node
// Scaffold smoke test: generates the starter into a temp directory, installs it with this repository's own packed
// @unitfield/sdk and @unitfield/react, builds it, and runs it against a mock Unitfield API and a mock sign-in issuer.
//
//   pnpm build && node packages/create-unitfield-site/scripts/smoke.mjs [--keep] [--port 4790]
//
// What it proves: the packages install and typecheck inside a real Next.js app; `next build` needs no environment and
// no network; the pages render real listing data; API reads are cached and a verified webhook drops them; the
// OIDC authorization code + PKCE sign-in works end to end (verifier, state, nonce, sealed cookies, revocation at
// sign-out). Nothing talks to a real Unitfield host.
import { execFileSync, spawn } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const packageDirectory = resolve(import.meta.dirname, "..");
const repository = resolve(packageDirectory, "..", "..");
const args = process.argv.slice(2);
const keep = args.includes("--keep");
const portFlag = args.indexOf("--port");

const KEY = "pk_test_SmokeTestKey0123456789";
const CLIENT_ID = "cust_sdk_smoke";
const SESSION_SECRET = "smoke-test-session-secret-0123456789-abcdef";
const WEBHOOK_SECRET = "whsec_smoke_secret";

let failures = 0;
function check(condition, label, detail) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.error(`  FAIL ${label}${detail === undefined ? "" : `\n         ${String(detail).slice(0, 600)}`}`);
  }
}

function step(label) {
  console.log(`\n== ${label}`);
}

function run(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, { stdio: "inherit", ...options });
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

const b64url = (value) => Buffer.from(value).toString("base64url");
const jwt = (claims) => `${b64url(JSON.stringify({ alg: "none" }))}.${b64url(JSON.stringify(claims))}.sig`;

// --- Mock Unitfield API and issuer -----------------------------------------------------------------------------------

function listing(n, overrides = {}) {
  return {
    listingPublicId: `clst_smoke_${n}`,
    unitPublicId: `cunit_smoke_${n}`,
    unitPublicKey: `UNITKEY${n}`,
    propertyPublicId: "cprop_smoke",
    title: `Smoke Test Home ${n}`,
    propertyName: "Maple Court",
    unitName: `Unit ${n}`,
    bedrooms: n,
    bathrooms: 1.5,
    areaSqft: 900 + n * 100,
    rent: 1500 + n * 100,
    currency: "USD",
    rentPeriod: "Monthly",
    availableFrom: "2026-11-02",
    acceptsApplications: n !== 2,
    applyUrl: n !== 2 ? `https://homes.example.test/apply/UNITKEY${n}` : null,
    city: "Austin",
    state: "TX",
    coverImageUrl: `https://images.example.test/${n}.jpg`,
    latitude: null,
    longitude: null,
    ...overrides,
  };
}

function startMock() {
  const state = {
    origin: "",
    hits: { site: 0, listings: 0, listing: 0, token: 0, revoke: 0 },
    listingQueries: [],
    revoked: [],
    // Filled in by the test once it has seen the authorization request.
    authorization: null,
    tokenRequests: [],
  };
  const listings = [listing(1), listing(2), listing(3)];
  const send = (res, status, body, headers = {}) => {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(text);
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", state.origin || "http://127.0.0.1");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");

    if (url.pathname === "/.well-known/openid-configuration") {
      return send(res, 200, {
        issuer: state.origin,
        authorization_endpoint: `${state.origin}/oauth2/auth`,
        token_endpoint: `${state.origin}/oauth2/token`,
        revocation_endpoint: `${state.origin}/oauth2/revoke`,
        end_session_endpoint: `${state.origin}/oauth2/sessions/logout`,
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url.pathname === "/oauth2/token" && req.method === "POST") {
      state.hits.token++;
      const form = new URLSearchParams(body);
      state.tokenRequests.push(Object.fromEntries(form));
      const auth = state.authorization;
      const verifierMatches = auth && createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url") === auth.challenge;
      if (!auth || form.get("grant_type") !== "authorization_code" || !verifierMatches || form.get("client_id") !== CLIENT_ID || form.has("client_secret") || form.get("redirect_uri") !== auth.redirectUri) {
        return send(res, 400, { error: "invalid_grant", error_description: "The mock issuer refused the code exchange." });
      }
      const now = Math.floor(Date.now() / 1000);
      return send(res, 200, {
        access_token: "smoke-access-token",
        token_type: "bearer",
        expires_in: 600,
        refresh_token: "smoke-refresh-token",
        scope: "openid email offline_access",
        id_token: jwt({ iss: state.origin, aud: CLIENT_ID, sub: "cus_smoke", iat: now, exp: now + 600, nonce: auth.nonce, email: "pat@example.test", email_verified: true }),
      });
    }
    if (url.pathname === "/oauth2/revoke" && req.method === "POST") {
      state.hits.revoke++;
      state.revoked.push(new URLSearchParams(body).get("token"));
      return send(res, 200, "");
    }

    if (!url.pathname.startsWith("/api/storefront/v1/")) return send(res, 404, { code: "not_found" });
    if (req.headers["x-unitfield-key"] !== KEY) return send(res, 401, { code: "storefront.key_invalid" });
    const cache = { "cache-control": "public, max-age=60, stale-while-revalidate=300" };
    const path = url.pathname.slice("/api/storefront/v1".length);
    if (path === "/site") {
      state.hits.site++;
      return send(res, 200, {
        siteId: "site_smoke", status: "published", revision: 1, themeId: "listing", themeVersion: "1.0.0", settings: {}, navigation: { header: [], footer: [] }, pages: [],
        brand: { name: "Maple Rentals", slug: "maple", logoUrl: null, primaryColor: "#2e6b4e", themeMode: "auto", brandHeaderBackground: false },
        contact: { email: "hello@maple.example.test", phone: "+1 (555) 010-0100" },
        hostedUrls: { applyBaseUrl: "https://homes.example.test/apply", signInUrl: "https://homes.example.test/sign-in", accountUrl: "https://homes.example.test/account" },
        primaryHost: "homes.example.test", isPreview: false,
      }, cache);
    }
    if (path === "/listings") {
      state.hits.listings++;
      state.listingQueries.push(Object.fromEntries(url.searchParams));
      return send(res, 200, { items: listings, nextCursor: null }, cache);
    }
    const match = /^\/listings\/([^/]+)$/.exec(path);
    if (match) {
      state.hits.listing++;
      const found = listings.find((item) => item.listingPublicId === decodeURIComponent(match[1]));
      if (!found) return send(res, 404, { code: "storefront.not_found" });
      return send(res, 200, {
        card: { ...found, publishedAt: "2026-10-25T11:43:51Z" },
        description: "A bright corner home with a smoke-test description.",
        address1: "1 Maple Street", postalCode: "78701", country: "US",
        photos: [{ url: "https://images.example.test/1.jpg", alt: "Living room", isCover: true }],
        amenities: ["Laundry in unit"], virtualTourUrl: null,
        property: { propertyPublicId: "cprop_smoke", name: "Maple Court", headline: null, description: null, address1: "1 Maple Street", city: "Austin", state: "TX", postalCode: "78701", country: "US", latitude: null, longitude: null, photos: [] },
      }, cache);
    }
    return send(res, 404, { code: "storefront.not_found" });
  });

  return new Promise((resolveMock) => {
    server.listen(0, "127.0.0.1", () => {
      state.origin = `http://127.0.0.1:${server.address().port}`;
      resolveMock({ state, close: () => new Promise((done) => server.close(done)) });
    });
  });
}

// --- Cookies ----------------------------------------------------------------------------------------------------------

/** A minimal cookie jar: it keeps `name=value` from Set-Cookie headers and sends them back, like a browser on one site. */
class Jar {
  #cookies = new Map();
  absorb(response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1);
      if (/;\s*max-age=0/i.test(line) || /;\s*expires=Thu, 01 Jan 1970/i.test(line) || value === "") this.#cookies.delete(name);
      else this.#cookies.set(name, value);
    }
  }
  header() {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
  get names() {
    return [...this.#cookies.keys()];
  }
}

async function main() {
  if (!existsSync(join(packageDirectory, "dist", "cli.js"))) throw new Error("Build first: pnpm build");
  const workspace = await mkdtemp(join(tmpdir(), "unitfield-smoke-"));
  const site = join(workspace, "site");
  let server;
  let mock;
  try {
    step("Pack the local packages");
    const tarballs = join(workspace, "tarballs");
    await mkdir(tarballs);
    for (const name of ["sdk", "react"]) run("pnpm", ["pack", "--pack-destination", tarballs], { cwd: join(repository, "packages", name), stdio: "pipe" });
    const archives = await readdir(tarballs);
    const sdkArchive = archives.find((file) => file.startsWith("unitfield-sdk-"));
    const reactArchive = archives.find((file) => file.startsWith("unitfield-react-"));
    check(Boolean(sdkArchive && reactArchive), "both tarballs were packed", archives.join(", "));

    step("Scaffold the starter");
    run(process.execPath, [join(packageDirectory, "dist", "cli.js"), site, "--no-install", "--yes", "--key", KEY]);
    const manifestPath = join(site, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.dependencies["@unitfield/sdk"] = `file:${join(tarballs, sdkArchive)}`;
    manifest.dependencies["@unitfield/react"] = `file:${join(tarballs, reactArchive)}`;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    check(existsSync(join(site, ".env.local")) && existsSync(join(site, ".gitignore")), ".env.local and .gitignore exist");

    step("Install with the packed packages (npm)");
    run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: site });

    step("Typecheck and build with no environment and no network");
    // The scaffolded .env.local is not part of this: build with only what a CI image has.
    await rm(join(site, ".env.local"));
    const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("UNITFIELD_") && name !== "TURNSTILE_SITE_KEY"));
    run("npx", ["tsc", "--noEmit"], { cwd: site, env: cleanEnv });
    run("npx", ["next", "build"], { cwd: site, env: { ...cleanEnv, NEXT_TELEMETRY_DISABLED: "1" } });
    check(existsSync(join(site, ".next", "BUILD_ID")), "next build finished");

    step("Start the starter against the mock API");
    mock = await startMock();
    const port = portFlag >= 0 ? Number(args[portFlag + 1]) : await freePort();
    const base = `http://127.0.0.1:${port}`;
    const siteUrl = `http://localhost:${port}`;
    server = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], {
      cwd: site,
      env: {
        ...cleanEnv,
        NEXT_TELEMETRY_DISABLED: "1",
        UNITFIELD_PUBLISHABLE_KEY: KEY,
        UNITFIELD_API_URL: mock.state.origin,
        UNITFIELD_SITE_URL: siteUrl,
        UNITFIELD_CLIENT_ID: CLIENT_ID,
        UNITFIELD_SESSION_SECRET: SESSION_SECRET,
        UNITFIELD_ID_URL: mock.state.origin,
        UNITFIELD_WEBHOOK_SECRET: WEBHOOK_SECRET,
        // Cloudflare's published always-passes test site key: the page renders the widget container.
        TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let serverLog = "";
    server.stdout.on("data", (chunk) => (serverLog += chunk));
    server.stderr.on("data", (chunk) => (serverLog += chunk));
    const deadline = Date.now() + 90_000;
    for (;;) {
      if (server.exitCode !== null) throw new Error(`next start exited early:\n${serverLog}`);
      try {
        if ((await fetch(`${base}/api/unitfield/webhook`, { method: "GET" })).status > 0) break;
      } catch {
        /* not listening yet */
      }
      if (Date.now() > deadline) throw new Error(`next start did not come up:\n${serverLog}`);
      await new Promise((done) => setTimeout(done, 500));
    }

    const get = (path, init = {}) => fetch(`${base}${path}`, { redirect: "manual", ...init });
    const text = async (response) => response.text();

    step("Pages render the API's data");
    let response = await get("/");
    let html = await text(response);
    check(response.status === 200, "GET / is 200", response.status);
    check(html.includes("Maple Rentals"), "home shows the brand name");
    check(html.includes("Smoke Test Home 1") && html.includes("Smoke Test Home 3"), "home lists the homes");
    check(html.includes("$1,600/mo"), "rent is formatted");
    check(html.includes('href="https://homes.example.test/apply/UNITKEY1"'), "Apply links to the hosted apply URL");
    check(!html.includes("https://homes.example.test/apply/null"), "a closed listing has no apply link");
    check(html.includes('href="https://homes.example.test/account"'), "the account link points at the hosted account");
    check(html.includes('href="/auth/sign-in"'), "Sign in is offered");
    check(html.includes("Skip to content") && html.includes('<html lang="en"'), "skip link and lang are there");
    check(html.includes("--brand:#2e6b4e"), "the brand color reaches the page", html.slice(0, 400));

    response = await get("/listings?bedrooms=2&sort=rent&city=Austin&bogus=1");
    html = await text(response);
    check(response.status === 200 && html.includes("Smoke Test Home 2"), "GET /listings is 200");
    const lastQuery = mock.state.listingQueries.at(-1);
    check(lastQuery?.bedroomsMin === "2" && lastQuery?.sort === "rent" && lastQuery?.city === "Austin" && lastQuery?.limit === "12", "the search becomes API filters", JSON.stringify(lastQuery));
    check(lastQuery !== undefined && !("bogus" in lastQuery), "unknown parameters are not passed on");

    response = await get("/listings/clst_smoke_1");
    html = await text(response);
    check(response.status === 200 && html.includes("A bright corner home"), "a listing page renders");
    check(html.includes("Apply for this home") && html.includes("Laundry in unit"), "detail has Apply and amenities");
    check(html.includes("Request a tour") && html.includes('type="email"'), "the inquiry form is there");
    response = await get("/listings/clst_smoke_2");
    html = await text(response);
    check(html.includes("not taking applications"), "a closed listing says so instead of linking");
    response = await get("/listings/does-not-exist");
    check(response.status === 404, "an unknown listing is a 404", response.status);
    response = await get("/contact");
    check(response.status === 200 && (await text(response)).includes("hello@maple.example.test"), "the contact page shows the contact email");

    step("API reads are cached, and a verified webhook drops them");
    const url = "/listings?city=Cached";
    await get(url);
    const before = mock.state.hits.listings;
    await get(url);
    await get(url);
    check(mock.state.hits.listings === before, "repeat reads of the same listings URL are served from Next's cache", `${mock.state.hits.listings - before} extra API call(s)`);

    const deliver = (body, { secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000), signature } = {}) => {
      const sig = signature ?? createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
      return get("/api/unitfield/webhook", { method: "POST", body, headers: { "content-type": "application/json", "x-unitfield-signature": `t=${timestamp},v1=${sig}`, "x-unitfield-delivery": "evt_1", "x-unitfield-event": "listing.updated" } });
    };
    const payload = JSON.stringify({ id: "evt_1", type: "listing.updated", created: new Date().toISOString(), data: { listingPublicId: "clst_smoke_1" } });
    response = await deliver(payload, { signature: "0".repeat(64) });
    check(response.status === 400, "a wrong signature is refused", response.status);
    response = await deliver(payload, { secret: "someone-elses-secret" });
    check(response.status === 400, "a signature from another secret is refused", response.status);
    response = await deliver(payload, { timestamp: Math.floor(Date.now() / 1000) - 3600 });
    check(response.status === 400, "a stale timestamp is refused", response.status);
    const staleHits = mock.state.hits.listings;
    await get(url);
    check(mock.state.hits.listings === staleHits, "refused deliveries did not touch the cache");

    const timestamp = Math.floor(Date.now() / 1000);
    response = await deliver(payload, { timestamp });
    check(response.status === 200 && (await response.json()).received === true, "a verified listing.updated is accepted", response.status);
    response = await deliver(payload, { timestamp });
    check(response.status === 400, "the same delivery replayed is refused", response.status);
    await get(url);
    check(mock.state.hits.listings === staleHits + 1, "the next read after the webhook goes to the API again");
    const other = JSON.stringify({ id: "evt_2", type: "webhook.test", created: new Date().toISOString(), data: {} });
    response = await deliver(other, { timestamp });
    check(response.status === 200, "an unrelated event is acknowledged");

    step("Customer sign-in: authorization code + PKCE end to end");
    const jar = new Jar();
    response = await get("/auth/sign-in");
    jar.absorb(response);
    const location = new URL(response.headers.get("location") ?? "http://invalid");
    check(response.status === 307 && location.origin + location.pathname === `${mock.state.origin}/oauth2/auth`, "sign-in redirects to the issuer", `${response.status} ${location}`);
    const params = location.searchParams;
    check(params.get("client_id") === CLIENT_ID && params.get("response_type") === "code", "it asks for a code for the site's client");
    check(params.get("redirect_uri") === `${siteUrl}/auth/callback`, "the redirect URI is built from UNITFIELD_SITE_URL");
    check(params.get("code_challenge_method") === "S256" && Boolean(params.get("code_challenge")) && !params.has("code_verifier"), "PKCE S256: a challenge, never the verifier");
    check(params.get("scope") === "openid email offline_access", "scopes", params.get("scope"));
    check(jar.names.includes("__Host-uf_sdk_auth"), "the in-flight request is kept in a __Host- cookie", jar.names.join(","));
    const flowCookie = response.headers.getSetCookie().find((line) => line.startsWith("__Host-uf_sdk_auth="));
    check(/HttpOnly/i.test(flowCookie ?? "") && /Secure/i.test(flowCookie ?? "") && /SameSite=lax/i.test(flowCookie ?? "") && !/Domain=/i.test(flowCookie ?? ""), "that cookie is HttpOnly, Secure, SameSite=Lax and has no Domain", flowCookie);
    check(!(flowCookie ?? "").includes(params.get("state") ?? "\0"), "its value is sealed (the state is not readable in it)");
    mock.state.authorization = { challenge: params.get("code_challenge"), nonce: params.get("nonce"), redirectUri: params.get("redirect_uri") };

    // A callback with a state this browser did not start is refused.
    response = await get(`/auth/callback?code=abc&state=forged`, { headers: { cookie: jar.header() } });
    check(response.status === 307 && (response.headers.get("location") ?? "").endsWith("/?sign-in=failed"), "a callback with the wrong state is refused");
    // That attempt consumed the in-flight cookie only if it matched; ask again to get a fresh one.
    jar.absorb(response);
    const second = new Jar();
    response = await get("/auth/sign-in");
    second.absorb(response);
    const location2 = new URL(response.headers.get("location") ?? "http://invalid");
    mock.state.authorization = { challenge: location2.searchParams.get("code_challenge"), nonce: location2.searchParams.get("nonce"), redirectUri: location2.searchParams.get("redirect_uri") };

    response = await get(`/auth/callback?code=abc&state=${encodeURIComponent(location2.searchParams.get("state"))}&iss=${encodeURIComponent(mock.state.origin)}`, { headers: { cookie: second.header() } });
    second.absorb(response);
    check(response.status === 307 && response.headers.get("location") === `${siteUrl}/`, "the callback signs in and goes home", `${response.status} ${response.headers.get("location")}`);
    const exchange = mock.state.tokenRequests.at(-1);
    check(exchange?.grant_type === "authorization_code" && exchange?.code === "abc" && Boolean(exchange?.code_verifier) && !("client_secret" in exchange), "the code was redeemed with the verifier and no client secret", JSON.stringify(exchange));
    check(second.names.includes("__Host-uf_sdk") && !second.names.includes("__Host-uf_sdk_auth"), "tokens are in their own cookie and the in-flight cookie is gone", second.names.join(","));
    const tokenCookie = (response.headers.getSetCookie().find((line) => line.startsWith("__Host-uf_sdk=")) ?? "");
    check(/HttpOnly/i.test(tokenCookie) && /Secure/i.test(tokenCookie) && !tokenCookie.includes("smoke-access-token") && !tokenCookie.includes("smoke-refresh-token"), "the token cookie is HttpOnly and sealed (no token is readable in it)");

    response = await get("/", { headers: { cookie: second.header() } });
    html = await text(response);
    check(html.includes("pat@example.test") && html.includes("Sign out") && !html.includes('href="/auth/sign-in"'), "the header shows who is signed in");
    check(!html.includes("smoke-access-token") && !html.includes("smoke-refresh-token"), "no token reaches the page");

    // The callback cannot be redeemed twice: the cookie was removed, and this jar no longer has it.
    response = await get(`/auth/callback?code=abc&state=${encodeURIComponent(location2.searchParams.get("state"))}`, { headers: { cookie: second.header() } });
    check((response.headers.get("location") ?? "").endsWith("/?sign-in=failed"), "a callback cannot be replayed");

    response = await get("/auth/sign-out", { method: "POST", headers: { cookie: second.header() } });
    second.absorb(response);
    check(response.status === 303 && response.headers.get("location") === `${siteUrl}/`, "sign-out redirects home with a 303", `${response.status}`);
    check(mock.state.revoked.includes("smoke-refresh-token"), "sign-out revoked the refresh token at the issuer", JSON.stringify(mock.state.revoked));
    check(!second.names.includes("__Host-uf_sdk"), "and cleared the token cookie");
    html = await text(await get("/", { headers: { cookie: second.header() } }));
    check(!html.includes("pat@example.test") && html.includes('href="/auth/sign-in"'), "the header is signed out again");
  } finally {
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await new Promise((done) => setTimeout(done, 500));
      if (server.exitCode === null) server.kill("SIGKILL");
    }
    if (mock) await mock.close();
    if (keep) console.log(`\nKept ${site}`);
    else await rm(workspace, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  failures++;
  console.error(error instanceof Error ? error.stack ?? error.message : error);
}
console.log(failures === 0 ? "\nScaffold smoke test passed." : `\nScaffold smoke test FAILED (${failures}).`);
process.exit(failures === 0 ? 0 : 1);
