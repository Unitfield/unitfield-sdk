import assert from "node:assert/strict";
import test from "node:test";
import { AuthenticationError, NotFoundError, RateLimitError, UnitfieldError, createStorefrontClient } from "../dist/index.js";
import { instantRetry, problem, recorder } from "./helpers.mts";

const baseUrl = "https://api.unitfield.test";
const publishableKey = `pk_test_${"a".repeat(32)}`;
const listing = (id: string) => ({ listingPublicId: id, title: id });

test("the publishable key is validated and its mode exposed", () => {
  assert.equal(createStorefrontClient({ baseUrl, publishableKey }).mode, "test");
  assert.equal(createStorefrontClient({ baseUrl, publishableKey: `pk_live_${"B".repeat(32)}` }).mode, "live");
  for (const bad of ["", "sk_live_abc", "pk_prod_abc", "pk_live_", "pk_live_has space", undefined]) {
    assert.throws(() => createStorefrontClient({ baseUrl, publishableKey: bad as string }), /publishableKey/, String(bad));
  }
  assert.throws(() => createStorefrontClient({ baseUrl, publishableKey, previewToken: " " }), /previewToken/);
  assert.equal(createStorefrontClient({ publishableKey }).baseUrl, "https://api.unitfield.com", "defaults to the production API");
});

test("every read sends the key to /api/storefront/v1, omits cookies and stays cacheable", async () => {
  const { calls, fetch } = recorder();
  const client = createStorefrontClient({ baseUrl, publishableKey, fetch, fetchOptions: { next: { revalidate: 60 } } });
  await client.site.get();
  await client.pages.get("about");
  await client.listings.list();
  await client.listings.get("clst_abc");
  await client.properties.list();
  await client.properties.get("cprop_abc");
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url.pathname}`), [
    "GET /api/storefront/v1/site",
    "GET /api/storefront/v1/pages/about",
    "GET /api/storefront/v1/listings",
    "GET /api/storefront/v1/listings/clst_abc",
    "GET /api/storefront/v1/properties",
    "GET /api/storefront/v1/properties/cprop_abc",
  ]);
  for (const call of calls) {
    assert.equal(call.headers.get("x-unitfield-key"), publishableKey);
    assert.equal(call.headers.get("authorization"), null);
    assert.equal(call.headers.get("x-unitfield-preview"), null);
    assert.equal(call.init.credentials, "omit");
    assert.equal(call.init.cache, undefined, "public reads must be left to the HTTP cache");
    assert.deepEqual((call.init as { next?: unknown }).next, { revalidate: 60 }, "framework fetch options pass through");
  }
});

test("the site read carries the Turnstile site key of the site's own widget, and null or nothing when it has none", async () => {
  const answers = [{ siteId: "site_1", turnstileSiteKey: "0x4AAAAAAABkMYinukE8nzYS" }, { siteId: "site_1", turnstileSiteKey: null }, { siteId: "site_1" }];
  const { fetch } = recorder(() => Response.json(answers.shift()));
  const client = createStorefrontClient({ baseUrl, publishableKey, fetch });
  assert.equal((await client.site.get()).turnstileSiteKey, "0x4AAAAAAABkMYinukE8nzYS", "render the widget with this key");
  assert.equal((await client.site.get()).turnstileSiteKey, null, "a site without a widget");
  assert.equal((await client.site.get()).turnstileSiteKey, undefined, "an older API does not send it");
});

const resolution = {
  status: "active", kind: "organization", host: "acme.unitfield.app", role: "primary", siteId: "site_1", organizationId: "org_1", slug: "acme",
  publishableKey, storefrontClientId: "sfc_0123456789abcdef", primaryHost: "acme.unitfield.app", redirectTo: null, revision: 7, hosts: ["acme.unitfield.app"],
};

test("host resolution is anonymous: it never sends the key or any default credential header", async () => {
  const { calls, fetch } = recorder(() => Response.json(resolution));
  const client = createStorefrontClient({ baseUrl, publishableKey, fetch, headers: { authorization: "Bearer leaked", "x-unitfield-key": "leaked" } });
  const resolved = await client.hosts.resolve("  Acme.Unitfield.App ");
  assert.equal(resolved.primaryHost, "acme.unitfield.app");
  assert.equal(calls[0].url.pathname, "/api/storefront/v1/hosts/acme.unitfield.app");
  assert.equal(calls[0].headers.get("x-unitfield-key"), null);
  assert.equal(calls[0].headers.get("authorization"), null);
  for (const bad of ["", "a/b", "a b", "a@b", "a?b", "a#b"]) await assert.rejects(client.hosts.resolve(bad), /bare hostname/, bad);
});

test("host resolution hands back the storefront client id the API returns, and tolerates its absence", async () => {
  const bodies: unknown[] = [resolution, (({ storefrontClientId: _omitted, ...rest }) => rest)(resolution), { ...resolution, storefrontClientId: null }];
  const { fetch } = recorder((_call, index) => Response.json(bodies[index]));
  const client = createStorefrontClient({ baseUrl, publishableKey, fetch });
  assert.equal((await client.hosts.resolve("acme.unitfield.app")).storefrontClientId, "sfc_0123456789abcdef");
  assert.equal((await client.hosts.resolve("acme.unitfield.app")).storefrontClientId, undefined);
  assert.equal((await client.hosts.resolve("acme.unitfield.app")).storefrontClientId, null);
});

test("listing filters serialize exactly: undefined skipped, dates as YYYY-MM-DD, limit bounded", async () => {
  const { calls, fetch } = recorder();
  const client = createStorefrontClient({ baseUrl, publishableKey, fetch });
  await client.listings.list({
    bedroomsMin: 2, bedroomsMax: 3, bathroomsMin: 1.5, rentMin: 1000, rentMax: 2500, city: "Austin", propertyId: "cprop_abc", unitPublicKey: "unit-4b",
    availableBy: new Date("2026-09-01T23:30:00Z"), sort: "rent_desc", cursor: "c1", limit: 50,
  });
  await client.listings.list({ city: undefined, availableBy: "2026-10-01" });
  const first = calls[0].url.searchParams;
  assert.deepEqual(Object.fromEntries(first), {
    bedroomsMin: "2", bedroomsMax: "3", bathroomsMin: "1.5", rentMin: "1000", rentMax: "2500", city: "Austin", propertyId: "cprop_abc", unitPublicKey: "unit-4b",
    availableBy: "2026-09-01", sort: "rent_desc", cursor: "c1", limit: "50",
  });
  assert.equal(calls[1].url.search, "?availableBy=2026-10-01");
  for (const limit of [0, 51, 1.5, Number.NaN]) await assert.rejects(client.listings.list({ limit }), /limit/, String(limit));
  await assert.rejects(client.properties.list({ limit: 99 }), /limit/);
  await assert.rejects(client.listings.list({ rentMin: Number.POSITIVE_INFINITY }), /finite/);
  await assert.rejects(client.listings.list({ availableBy: new Date("nope") }), /valid date/);
  assert.equal(calls.length, 2);
});

test("unitPublicKey narrows listings to one unit, on every page of an iteration", async () => {
  const { calls, fetch } = recorder((call) => Response.json(call.url.searchParams.has("cursor") ? { items: [], nextCursor: null } : { items: [listing("a")], nextCursor: "p2" }));
  const client = createStorefrontClient({ baseUrl, publishableKey, fetch });
  await client.listings.list({ unitPublicKey: "unit-4b" });
  assert.equal(calls[0].url.search, "?unitPublicKey=unit-4b");
  await client.listings.list({ unitPublicKey: "a b&c" });
  assert.equal(calls[1].url.search, "?unitPublicKey=a+b%26c", "the key is encoded, never concatenated");
  await client.listings.list({ unitPublicKey: undefined });
  assert.equal(calls[2].url.search, "");
  calls.length = 0;
  assert.deepEqual((await client.listings.iterate({ unitPublicKey: "unit-4b", limit: 1 }).toArray()).map((item) => item.listingPublicId), ["a"]);
  assert.deepEqual(calls.map((call) => call.url.searchParams.get("unitPublicKey")), ["unit-4b", "unit-4b"]);
});

test("path segments cannot traverse", async () => {
  const client = createStorefrontClient({ baseUrl, publishableKey, fetch: recorder().fetch });
  for (const bad of ["", "  ", ".", ".."]) {
    await assert.rejects(client.listings.get(bad), TypeError, bad);
    await assert.rejects(client.pages.get(bad), TypeError, bad);
  }
});

test("preview tokens reach only the site and pages, and those reads bypass every cache", async () => {
  const { calls, fetch } = recorder();
  const client = createStorefrontClient({ baseUrl, publishableKey, fetch, previewToken: "preview-1" });
  await client.site.get();
  await client.pages.get("home");
  await client.listings.list();
  await client.site.get({ previewToken: "override" });
  assert.equal(calls[0].headers.get("x-unitfield-preview"), "preview-1");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[1].headers.get("x-unitfield-preview"), "preview-1");
  assert.equal(calls[1].init.cache, "no-store");
  assert.equal(calls[2].headers.get("x-unitfield-preview"), null);
  assert.equal(calls[2].init.cache, undefined);
  assert.equal(calls[3].headers.get("x-unitfield-preview"), "override");
  assert.equal(calls[0].headers.get("x-unitfield-key"), publishableKey, "a preview token only works together with the site's key");

  const plain = createStorefrontClient({ baseUrl, publishableKey, fetch });
  const previewing = plain.withPreview("later");
  await previewing.site.get();
  await plain.site.get();
  assert.equal(calls[4].headers.get("x-unitfield-preview"), "later");
  assert.equal(calls[5].headers.get("x-unitfield-preview"), null);
  assert.equal(previewing.publishableKey, publishableKey);
});

test("iterate follows nextCursor lazily, re-iterates, and honors maxItems and maxPages", async () => {
  const pages: Record<string, { items: unknown[]; nextCursor: string | null }> = {
    "": { items: [listing("a"), listing("b")], nextCursor: "p2" },
    p2: { items: [listing("c"), listing("d")], nextCursor: "p3" },
    p3: { items: [listing("e")], nextCursor: null },
  };
  const { calls, fetch } = recorder((call) => Response.json(pages[call.url.searchParams.get("cursor") ?? ""]));
  const client = createStorefrontClient({ baseUrl, publishableKey, fetch });

  const list = client.listings.iterate({ city: "Austin", limit: 2 });
  assert.equal(calls.length, 0, "nothing is requested until iteration starts");
  assert.deepEqual((await list.toArray()).map((item) => item.listingPublicId), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(calls.map((c) => c.url.searchParams.get("cursor")), [null, "p2", "p3"]);
  assert.ok(calls.every((c) => c.url.searchParams.get("city") === "Austin" && c.url.searchParams.get("limit") === "2"));

  assert.equal((await list.toArray()).length, 5, "a list can be iterated again");

  calls.length = 0;
  const firstTwo: string[] = [];
  for await (const item of client.listings.iterate({}, { maxItems: 3 })) firstTwo.push(item.listingPublicId);
  assert.deepEqual(firstTwo, ["a", "b", "c"]);
  assert.equal(calls.length, 2, "stops fetching once maxItems is reached");

  calls.length = 0;
  const seenPages: number[] = [];
  for await (const page of client.listings.iterate({}, { maxPages: 1 }).pages()) seenPages.push(page.items.length);
  assert.deepEqual(seenPages, [2]);
  assert.equal(calls.length, 1);

  calls.length = 0;
  assert.equal((await client.listings.iterate({ cursor: "p3" }).toArray()).length, 1, "query.cursor starts mid-way");
  assert.throws(() => client.listings.iterate({}, { maxItems: 0 }), /positive integer/);
});

test("a repeating cursor fails loudly instead of looping", async () => {
  const { fetch } = recorder(() => Response.json({ items: [listing("a")], nextCursor: "same" }));
  const client = createStorefrontClient({ baseUrl, publishableKey, fetch });
  await assert.rejects(client.listings.iterate().toArray(), (error: unknown) => error instanceof UnitfieldError && error.code === "pagination_cursor_loop");
});

test("property lists paginate the same way", async () => {
  const { calls, fetch } = recorder((call) => Response.json(call.url.searchParams.has("cursor") ? { items: [{ propertyPublicId: "p2" }], nextCursor: null } : { items: [{ propertyPublicId: "p1" }], nextCursor: "n" }));
  const client = createStorefrontClient({ baseUrl, publishableKey, fetch });
  assert.deepEqual((await client.properties.iterate({ limit: 1 }).toArray()).map((p) => p.propertyPublicId), ["p1", "p2"]);
  assert.equal(calls[0].url.searchParams.get("limit"), "1");
  assert.equal(calls[1].url.searchParams.get("cursor"), "n");
});

test("inquiries post the documented body and resolve with the 202 answer", async () => {
  const { calls, fetch } = recorder(() => Response.json({ status: "accepted" }, { status: 202 }));
  const client = createStorefrontClient({ baseUrl, publishableKey, fetch });
  const result = await client.inquiries.create({
    kind: "tour", name: "Ada", email: "ada@example.test", phone: "555", message: "Hello", listingPublicId: "clst_abc",
    preferredTimes: [new Date("2026-09-01T15:00:00Z"), "2026-09-02T16:00:00Z"], turnstileToken: "turnstile-token",
  });
  assert.deepEqual(result, { status: "accepted" });
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url.pathname, "/api/storefront/v1/inquiries");
  assert.equal(calls[0].headers.get("x-unitfield-key"), publishableKey);
  assert.equal(calls[0].headers.get("content-type"), "application/json");
  assert.deepEqual(calls[0].body, {
    kind: "tour", name: "Ada", email: "ada@example.test", phone: "555", message: "Hello", listingPublicId: "clst_abc",
    preferredTimes: ["2026-09-01T15:00:00.000Z", "2026-09-02T16:00:00.000Z"], turnstileToken: "turnstile-token",
  });
  await client.inquiries.create({ kind: "contact", name: "Ada", email: "ada@example.test", turnstileToken: "t" }, { idempotencyKey: true });
  assert.ok(calls[1].headers.get("Idempotency-Key"));
});

test("inquiry input is validated before anything is sent", async () => {
  const { calls, fetch } = recorder();
  const client = createStorefrontClient({ baseUrl, publishableKey, fetch });
  const valid = { kind: "contact" as const, name: "Ada", email: "ada@example.test", turnstileToken: "t" };
  await assert.rejects(client.inquiries.create({ ...valid, kind: "other" as never }), /kind/);
  await assert.rejects(client.inquiries.create({ ...valid, name: " " }), /name/);
  await assert.rejects(client.inquiries.create({ ...valid, email: "not-an-email" }), /email/);
  await assert.rejects(client.inquiries.create({ ...valid, turnstileToken: "" }), /turnstileToken/);
  await assert.rejects(client.inquiries.create({ ...valid, preferredTimes: ["garbage"] }), /preferredTimes/);
  await assert.rejects(client.inquiries.create({ ...valid, preferredTimes: Array.from({ length: 6 }, () => "2026-09-01T10:00:00Z") }), /at most 5/);
  assert.equal(calls.length, 0);
});

test("an inquiry rate limit is typed and not retried (no idempotency key was chosen)", async () => {
  const { retry } = instantRetry();
  const { calls, fetch } = recorder(() => problem(429, { code: "RateLimited" }, { "retry-after": "3600" }));
  const client = createStorefrontClient({ baseUrl, publishableKey, fetch, retry });
  await assert.rejects(client.inquiries.create({ kind: "contact", name: "Ada", email: "ada@example.test", turnstileToken: "t" }), (error: unknown) => error instanceof RateLimitError && error.retryAfterSeconds === 3600);
  assert.equal(calls.length, 1);
});

test("a revoked key or a wrong origin is an AuthenticationError", async () => {
  const { fetch } = recorder(() => problem(401, { code: "Storefront.KeyRejected", detail: "Origin not allowed." }));
  const client = createStorefrontClient({ baseUrl, publishableKey, fetch, retry: false });
  await assert.rejects(client.site.get(), (error: unknown) => error instanceof AuthenticationError && error.code === "Storefront.KeyRejected");
});

const picks = [
  { date: "2026-11-04", window: "afternoon" as const },
  { date: "2026-11-05", window: "morning" as const },
];

test("a tour request sends picks and the visitor's time zone, and still accepts the legacy times", async () => {
  const { calls, fetch } = recorder(() => Response.json({ status: "accepted" }, { status: 202 }));
  const client = createStorefrontClient({ baseUrl, publishableKey, fetch });
  await client.inquiries.create({ kind: "tour", name: "Ada", email: "ada@example.test", listingPublicId: "clst_abc", picks, timeZone: " America/Phoenix ", preferredTimes: ["2026-11-04T21:00:00Z"], turnstileToken: "t" });
  assert.deepEqual(calls[0].body, {
    kind: "tour", name: "Ada", email: "ada@example.test", listingPublicId: "clst_abc",
    picks, timeZone: "America/Phoenix", preferredTimes: ["2026-11-04T21:00:00.000Z"], turnstileToken: "t",
  });
  await client.inquiries.create({ kind: "tour", name: "Ada", email: "ada@example.test", preferredTimes: ["2026-11-04T21:00:00Z"], turnstileToken: "t" });
  assert.equal("picks" in (calls[1].body as object), false, "a legacy request carries no picks");
  assert.equal("timeZone" in (calls[1].body as object), false);
});

test("tour picks are validated before anything is sent", async () => {
  const { calls, fetch } = recorder();
  const client = createStorefrontClient({ baseUrl, publishableKey, fetch });
  const valid = { kind: "tour" as const, name: "Ada", email: "ada@example.test", turnstileToken: "t" };
  await assert.rejects(client.inquiries.create({ ...valid, picks: [] }), /picks/);
  await assert.rejects(client.inquiries.create({ ...valid, picks: Array.from({ length: 6 }, () => picks[0]) }), /picks/);
  await assert.rejects(client.inquiries.create({ ...valid, picks: [{ date: "11/04/2026", window: "morning" }] }), /YYYY-MM-DD/);
  await assert.rejects(client.inquiries.create({ ...valid, picks: [{ date: "2026-13-45", window: "morning" }] }), /YYYY-MM-DD/);
  await assert.rejects(client.inquiries.create({ ...valid, picks: [{ date: "2026-11-04", window: "night" as never }] }), /window/);
  await assert.rejects(client.inquiries.create({ ...valid, picks, timeZone: " " }), /timeZone/);
  await assert.rejects(client.inquiries.create({ ...valid, picks, timeZone: "x".repeat(65) }), /timeZone/);
  assert.equal(calls.length, 0);
});

const offer = {
  zoneId: "America/Los_Angeles",
  days: [{ date: "2026-11-04", weekday: "wed", windows: ["morning", "afternoon"] }],
  windows: { morning: { start: "09:00", end: "12:00" }, afternoon: { start: "12:00", end: "17:00" } },
  maxPicks: 5,
};

test("tours.windows reads the offer with the key, scoped to a listing, and stays cacheable", async () => {
  const { calls, fetch } = recorder(() => Response.json(offer));
  const client = createStorefrontClient({ baseUrl, publishableKey, fetch, fetchOptions: { next: { revalidate: 60 } } });
  assert.deepEqual(await client.tours.windows({ listingPublicId: "clst_abc" }), offer);
  await client.tours.windows();
  await client.tours.windows({ listingPublicId: " " });
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].url.pathname, "/api/storefront/v1/tour-windows");
  assert.equal(calls[0].url.search, "?listingPublicId=clst_abc");
  assert.equal(calls[1].url.search, "");
  assert.equal(calls[2].url.search, "", "a blank listing id is not sent");
  assert.equal(calls[0].headers.get("x-unitfield-key"), publishableKey);
  assert.equal(calls[0].init.cache, undefined, "public reads must be left to the HTTP cache");
  assert.deepEqual((calls[0].init as { next?: unknown }).next, { revalidate: 60 });
});

test("a 404 from tours.windows is a NotFoundError, so a caller can fall back on an API without tours", async () => {
  const { fetch } = recorder(() => problem(404, { code: "storefront.not_found" }));
  const client = createStorefrontClient({ baseUrl, publishableKey, fetch, retry: false });
  await assert.rejects(client.tours.windows(), NotFoundError);
});

const view = { status: "scheduled", orgName: "Alderwood Rentals", homeName: "Juniper Heights 104", address: "3045 Juniper St", date: "2026-11-04", start: "14:30", end: "15:00", hostFirstName: "James", picks: [], canAnswerReminder: false, canChange: true, canCancel: true };

test("tours.view posts the token, never caches the private answer and is not retried", async () => {
  const { retry } = instantRetry();
  const { calls, fetch } = recorder(() => Response.json(view));
  const client = createStorefrontClient({ baseUrl, publishableKey, fetch, retry, fetchOptions: { next: { revalidate: 60 } } });
  assert.deepEqual(await client.tours.view("  tok_ABC-123_xyz  "), view);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url.pathname, "/api/storefront/v1/tours/view");
  assert.deepEqual(calls[0].body, { token: "tok_ABC-123_xyz" });
  assert.equal(calls[0].headers.get("x-unitfield-key"), publishableKey);
  assert.equal(calls[0].init.cache, "no-store", "a token answer is private, whatever the client's defaults are");
  for (const bad of ["", "  ", "a b", undefined, 42]) await assert.rejects(client.tours.view(bad as never), /token/, String(bad));
  assert.equal(calls.length, 1);

  const failing = recorder(() => problem(503, { code: "unavailable" }));
  await assert.rejects(createStorefrontClient({ baseUrl, publishableKey, fetch: failing.fetch, retry }).tours.view("tok"));
  assert.equal(failing.calls.length, 1, "a POST without an idempotency key is never retried");
});

test("an unknown tour link is one uniform NotFoundError, and the view rate limit is typed", async () => {
  const gone = createStorefrontClient({ baseUrl, publishableKey, fetch: recorder(() => problem(404, { code: "tours.link_invalid" })).fetch, retry: false });
  await assert.rejects(gone.tours.view("tok"), (error: unknown) => error instanceof NotFoundError && error.code === "tours.link_invalid");
  await assert.rejects(gone.tours.answer({ token: "tok", action: "coming" }), NotFoundError);
  const limited = createStorefrontClient({ baseUrl, publishableKey, fetch: recorder(() => problem(429, { code: "RateLimited" }, { "retry-after": "600" })).fetch, retry: false });
  await assert.rejects(limited.tours.view("tok"), (error: unknown) => error instanceof RateLimitError && error.retryAfterSeconds === 600);
});

test("tours.answer posts one action; picks go with pick only", async () => {
  const { calls, fetch } = recorder(() => Response.json(view));
  const client = createStorefrontClient({ baseUrl, publishableKey, fetch });
  for (const action of ["accept_proposal", "coming", "cant_make_it", "cancel"] as const) await client.tours.answer({ token: "tok", action });
  await client.tours.answer({ token: "tok", action: "pick", picks, message: " Evenings are best " }, { idempotencyKey: "once" });
  assert.deepEqual(calls.map((call) => (call.body as { action: string }).action), ["accept_proposal", "coming", "cant_make_it", "cancel", "pick"]);
  assert.equal(calls[0].url.pathname, "/api/storefront/v1/tours/answer");
  assert.deepEqual(calls[0].body, { token: "tok", action: "accept_proposal" });
  assert.deepEqual(calls[4].body, { token: "tok", action: "pick", picks, message: "Evenings are best" });
  assert.equal(calls[4].headers.get("Idempotency-Key"), "once");
  for (const call of calls) assert.equal(call.init.cache, "no-store");

  const before = calls.length;
  await assert.rejects(client.tours.answer({ token: "tok", action: "dance" as never }), /action/);
  await assert.rejects(client.tours.answer({ token: "tok", action: "pick" }), /picks are required/);
  await assert.rejects(client.tours.answer({ token: "tok", action: "pick", picks: [] }), /picks/);
  await assert.rejects(client.tours.answer({ token: "tok", action: "cancel", picks }), /only accepted/);
  await assert.rejects(client.tours.answer({ token: "", action: "cancel" }), /token/);
  assert.equal(calls.length, before, "nothing is sent for invalid input");
});

test("tours.icsUrl builds the calendar address on the API origin, encoded", () => {
  const client = createStorefrontClient({ baseUrl: "https://api.unitfield.test/gateway", publishableKey });
  assert.equal(client.tours.icsUrl("tok_ABC-123"), "https://api.unitfield.test/gateway/api/storefront/v1/tours/ics?token=tok_ABC-123");
  assert.equal(client.tours.icsUrl("a+b/c="), "https://api.unitfield.test/gateway/api/storefront/v1/tours/ics?token=a%2Bb%2Fc%3D");
  assert.throws(() => client.tours.icsUrl(" "), /token/);
});
