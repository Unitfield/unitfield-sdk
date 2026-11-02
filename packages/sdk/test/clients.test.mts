import assert from "node:assert/strict";
import test from "node:test";
import {
  PermissionError,
  createApplicantClient,
  createAppsClient,
  createPlatformClient,
  createResidentClient,
  platformAvailabilityAction,
  platformResidentMaintenanceAction,
} from "../dist/index.js";
import { instantRetry, problem, recorder } from "./helpers.mts";

const baseUrl = "https://api.unitfield.test";
const org = "e7a9d8c0-11c4-49b6-a1c2-559ed024db36";
const installation = "app_0123456789abcdef0123456789abcdef";

// ---- apps runtime ---------------------------------------------------------------------------------------------

test("apps: listing filters map to the API's query names", async () => {
  const { calls, fetch } = recorder();
  const client = createAppsClient({ baseUrl, accessToken: "t", fetch });
  await client.listListings({ beds: 2, availableFrom: "2026-09-01", page: 2, pageSize: 10, rentMin: undefined });
  const query = calls[0].url.searchParams;
  assert.deepEqual(Object.fromEntries(query), { Beds: "2", AvailableFrom: "2026-09-01", Page: "2", PageSize: "10" });
  assert.equal(calls[0].url.pathname, "/api/apps/v1/listings/units");
});

test("apps: iterateListings walks page numbers until total is reached", async () => {
  const pages = [
    { items: [{ listingPublicId: "a" }, { listingPublicId: "b" }], page: 1, pageSize: 2, total: 5 },
    { items: [{ listingPublicId: "c" }, { listingPublicId: "d" }], page: 2, pageSize: 2, total: "5" },
    { items: [{ listingPublicId: "e" }], page: 3, pageSize: 2, total: 5 },
  ];
  const { calls, fetch } = recorder((call) => Response.json(pages[Number(call.url.searchParams.get("Page")) - 1]));
  const client = createAppsClient({ baseUrl, accessToken: "t", fetch });
  const all = await client.iterateListings({ pageSize: 2, search: "oak" }).toArray();
  assert.deepEqual(all.map((l) => l.listingPublicId), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(calls.map((c) => c.url.searchParams.get("Page")), ["1", "2", "3"]);
  assert.ok(calls.every((c) => c.url.searchParams.get("Search") === "oak"));

  calls.length = 0;
  assert.deepEqual((await client.iterateListings({ pageSize: 2, page: 2 }).toArray()).map((l) => l.listingPublicId), ["c", "d", "e"], "starts at filters.page");
  assert.equal(calls[0].url.searchParams.get("Page"), "2");

  const empty = recorder(() => Response.json({ items: [], page: 1, pageSize: 2, total: 99 }));
  assert.deepEqual(await createAppsClient({ baseUrl, accessToken: "t", fetch: empty.fetch }).iterateListings().toArray(), []);
  assert.equal(empty.calls.length, 1, "an empty page ends the walk even if total claims more");
});

test("apps: mutations that move money or create records require a caller-chosen idempotency key", async () => {
  const { calls, fetch } = recorder();
  const client = createAppsClient({ baseUrl, accessToken: "t", fetch });
  const submit = { certifiedApplication: true, typedSignature: "Ada", rentalApplicationTermsDocumentId: "d", rentalApplicationTermsVersion: "1", rentalApplicationTermsContentSha256: "s", certificationTextSha256: "s" };
  const checkout = { returnUrl: "https://shop.test/return" };
  await assert.rejects(client.submitApplication("draft-1", submit, undefined as never), /idempotencyKey is required/);
  await assert.rejects(client.submitApplication("draft-1", submit, {} as never), /idempotencyKey is required/);
  await assert.rejects(client.submitApplication("draft-1", submit, { idempotencyKey: " " }), /must not be empty/);
  await assert.rejects(client.createScreeningCheckoutSession("app-1", checkout, undefined as never), /idempotencyKey is required/);
  await assert.rejects(client.createLeaseCheckoutSession("lease-1", { ...checkout, amountCents: 100 }, undefined as never), /idempotencyKey is required/);
  assert.equal(calls.length, 0);

  await client.createScreeningCheckoutSession("capp/application-1", { ...checkout, method: "card" }, { idempotencyKey: "checkout-123" });
  assert.equal(calls[0].url.pathname, "/api/apps/v1/rental-applications/capp%2Fapplication-1/screening/checkout-session");
  assert.equal(calls[0].headers.get("Idempotency-Key"), "checkout-123");
  assert.deepEqual(calls[0].body, { returnUrl: "https://shop.test/return", method: "card" });
});

test("apps: checkout inputs are validated before the request", async () => {
  const client = createAppsClient({ baseUrl, accessToken: "t", fetch: recorder().fetch });
  const options = { idempotencyKey: "k" };
  await assert.rejects(client.createScreeningCheckoutSession("a", { returnUrl: "javascript:alert(1)" }, options), /HTTP or HTTPS/);
  await assert.rejects(client.createScreeningCheckoutSession("a", { returnUrl: "https://x.test", method: "wire" as never }, options), /card or ach/);
  for (const amountCents of [0, -5, 1.5, Number.NaN, 2 ** 60]) await assert.rejects(client.createLeaseCheckoutSession("l", { amountCents, returnUrl: "https://x.test" }, options), /positive safe integer/, String(amountCents));
  await assert.rejects(client.getListing(".."), /relative path/);
  await assert.rejects(client.getPaymentStatus(" "), /non-empty/);
});

test("apps: app actions keep authority out of the body, add no headers, and are never retried by the SDK", async () => {
  const { retry } = instantRetry();
  const { calls, fetch } = recorder(() => problem(503, { code: "Platform.Unavailable" }));
  const client = createAppsClient({ baseUrl, accessToken: "installation-token", fetch, retry });
  const input = { extensionKey: "availability", resourcePublicId: "corg_abcdefghijklmnopqrstuvwx", input: { listingPublicId: "clst_abcdefghijklmnopqrstuvwx", startDate: "2026-11-01" }, idempotencyKey: "once" };
  await assert.rejects(client.enqueueAppAction(input), { status: 503 });
  assert.equal(calls.length, 1, "the key is in the body, so there is no header to make a retry safe");
  assert.deepEqual(calls[0].body, input);
  assert.equal(calls[0].headers.get("x-tenant-id"), null);
  assert.equal(calls[0].headers.get("idempotency-key"), null);
  await assert.rejects(client.getAppAction("action/1"), { status: 503 });
  assert.equal(calls.at(-1)!.url.pathname, "/api/apps/v1/app-actions/action%2F1");
  assert.equal(calls.length, 4, "but a GET is retried");
});

test("manifest authoring constants are exported and closed", () => {
  assert.equal(platformAvailabilityAction.actionType, "rental.availability.check.v1");
  assert.deepEqual([...platformAvailabilityAction.requiredScopes], ["listings:read", "availability:read"]);
  assert.equal(JSON.parse(platformAvailabilityAction.inputSchema).additionalProperties, false);
  assert.equal(JSON.parse(platformAvailabilityAction.outputSchema).additionalProperties, false);
  assert.equal(platformResidentMaintenanceAction.actionType, "resident.maintenance.request.create.v1");
  assert.deepEqual([...platformResidentMaintenanceAction.requiredScopes], ["resident-requests:create"]);
  assert.throws(() => { (platformAvailabilityAction as { actionType: string }).actionType = "x"; }, TypeError);
});

// ---- resident ------------------------------------------------------------------------------------------------------

test("resident: calls are bearer-only; the organization comes from the token, never a header", async () => {
  const { calls, fetch } = recorder();
  const client = createResidentClient({ baseUrl, accessToken: "customer-token", fetch });
  await client.context({ leaseId: "clea_1" });
  await client.leases.statement("clea_1", { from: "2026-01-01", to: new Date("2026-02-01T00:00:00Z") });
  await client.notifications.list({ isRead: false, page: 2 });
  for (const call of calls) {
    assert.equal(call.headers.get("authorization"), "Bearer customer-token");
    assert.equal(call.headers.get("x-tenant-id"), null);
    assert.equal(call.init.cache, "no-store");
  }
  assert.equal(calls[0].url.search, "?leaseId=clea_1");
  assert.equal(calls[1].url.search, "?from=2026-01-01&to=2026-02-01");
  assert.equal(calls[2].url.search, "?isRead=false&page=2");
});

test("resident: payments and AutoPay setup require an idempotency key; other keys are optional", async () => {
  const { calls, fetch } = recorder();
  const client = createResidentClient({ baseUrl, accessToken: "t", fetch });
  const payment = { amount: 10, paymentMethod: "card", successUrl: "https://x.test/ok", cancelUrl: "https://x.test/no" } as never;
  await assert.rejects(client.payments.create("clea_1", payment, undefined as never), /idempotencyKey is required/);
  await assert.rejects(client.payments.create("clea_1", payment, { idempotencyKey: true as never }), /idempotencyKey is required/, "an auto-generated key would defeat a manual retry");
  await assert.rejects(client.autopay.setup("clea_1", {} as never, {} as never), /idempotencyKey is required/);
  assert.equal(calls.length, 0);
  await client.payments.create("clea_1", payment, { idempotencyKey: "pay-1" });
  await client.requests.create({ leaseId: "clea_1", subject: "Leak", description: "Sink" } as never);
  await client.requests.create({ leaseId: "clea_1", subject: "Leak", description: "Sink" } as never, { idempotencyKey: true });
  assert.equal(calls[0].headers.get("Idempotency-Key"), "pay-1");
  assert.equal(calls[1].headers.get("Idempotency-Key"), null);
  assert.match(calls[2].headers.get("Idempotency-Key") ?? "", /^[0-9a-f-]{36}$/);
});

test("resident: action routes encode ids, including the colon verbs, and 204s resolve to undefined", async () => {
  const { calls, fetch } = recorder(() => new Response(null, { status: 204 }));
  const client = createResidentClient({ baseUrl, accessToken: "t", fetch });
  assert.equal(await client.requests.reopen("creq/1"), undefined);
  await client.requests.askAnotherTime("creq_2");
  await client.requests.sendMessage("creq_2", { note: "hello" });
  await client.autopay.revoke("clea 1");
  await client.notifications.markRead("n/1");
  await client.updateProfile({ firstName: "Ada" } as never);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url.pathname}`), [
    "POST /api/v1/resident/requests/creq%2F1:reopen",
    "POST /api/v1/resident/requests/creq_2:ask-another-time",
    "POST /api/v1/resident/requests/creq_2/messages",
    "POST /api/v1/resident/leases/clea%201/autopay/revoke",
    "PATCH /api/v1/resident/notifications/n%2F1/read",
    "PATCH /api/v1/resident/profile",
  ]);
});

test("resident: a customer principal refused by a not-yet-migrated write path is a typed PermissionError", async () => {
  const { fetch } = recorder(() => problem(403, { code: "customer_account_not_supported", detail: "Not available for customer accounts yet." }));
  const client = createResidentClient({ baseUrl, accessToken: "t", fetch, retry: false });
  await assert.rejects(client.requests.addNote("creq_1", { note: "x" }), (error: unknown) => error instanceof PermissionError && error.code === "customer_account_not_supported");
});

// ---- applicant ---------------------------------------------------------------------------------------------------

test("applicant: drafts are addressed by id, steps wrap the payload, ids are encoded", async () => {
  const { calls, fetch } = recorder(() => Response.json({ deleted: true }));
  const client = createApplicantClient({ baseUrl, accessToken: "customer-token", fetch });
  await client.createDraft(" unit-4b ");
  await client.saveStep("draft/1", "employment", { employer: "Acme" });
  await client.saveHousehold("draft/1", { occupants: 2 });
  await client.getDraft("draft/1");
  assert.deepEqual(await client.deleteDraft("draft/1"), { deleted: true });
  await client.list();
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url.pathname}`), [
    "POST /api/customer/v1/applications/drafts",
    "PUT /api/customer/v1/applications/drafts/draft%2F1/steps/employment",
    "PUT /api/customer/v1/applications/drafts/draft%2F1/household",
    "GET /api/customer/v1/applications/drafts/draft%2F1",
    "DELETE /api/customer/v1/applications/drafts/draft%2F1",
    "GET /api/customer/v1/applications",
  ]);
  assert.deepEqual(calls[0].body, { unitPublicKey: "unit-4b" });
  assert.deepEqual(calls[1].body, { payload: { employer: "Acme" } });
  assert.deepEqual(calls[2].body, { payload: { occupants: 2 } });
  for (const call of calls) assert.equal(call.headers.get("authorization"), "Bearer customer-token");
  await assert.rejects(client.createDraft(" "), /unitPublicKey/);
});

test("applicant: submit requires a caller-chosen idempotency key, as the API answers 400 without one", async () => {
  const { calls, fetch } = recorder();
  const client = createApplicantClient({ baseUrl, accessToken: "t", fetch });
  const submit = { certifiedApplication: true, typedSignature: "Ada", rentalApplicationTermsDocumentId: "d", rentalApplicationTermsVersion: "1", rentalApplicationTermsContentSha256: "s", certificationTextSha256: "s" };
  await assert.rejects(client.submit("draft_1", submit, undefined as never), /idempotencyKey is required/);
  await assert.rejects(client.submit("draft_1", submit, { idempotencyKey: true as never }), /idempotencyKey is required/);
  await client.submit("draft_1", submit, { idempotencyKey: "submit-1" });
  assert.equal(calls[0].url.pathname, "/api/customer/v1/applications/drafts/draft_1/submit");
  assert.equal(calls[0].headers.get("Idempotency-Key"), "submit-1");
});

test("applicant: status, screening handoff and signing routes", async () => {
  const { calls, fetch } = recorder();
  const client = createApplicantClient({ baseUrl, accessToken: "t", fetch });
  await client.status("app_1");
  await client.screening("app_1");
  await client.openSigningSession("app_1");
  await client.recordConsent("draft_1", { acknowledgedApplicantPrivacy: true, consentedToElectronicRecords: true, applicantPrivacyDocumentId: "d", applicantPrivacyVersion: "1", applicantPrivacyContentSha256: "s", electronicRecordsDocumentId: "d", electronicRecordsVersion: "1", electronicRecordsContentSha256: "s" });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url.pathname}`), [
    "GET /api/customer/v1/applications/app_1/status",
    "GET /api/customer/v1/applications/app_1/screening",
    "POST /api/customer/v1/applications/app_1/signing-session",
    "PUT /api/customer/v1/applications/drafts/draft_1/consent",
  ]);
});

// ---- platform management -----------------------------------------------------------------------------------------

test("platform: business context is explicit, validated, and overrides any caller-supplied tenant header", async () => {
  const { calls, fetch } = recorder();
  const client = createPlatformClient({ baseUrl, accessToken: "staff-token", fetch });
  const consent = { appVersionId: "v1", manifestHash: "immutable-hash", approvedScopes: ["listings:read"] };
  await client.installApp(org, consent, { headers: { "X-Tenant-Id": "untrusted-override" } });
  await client.changeAppGrant(org, installation, { ...consent, expectedGeneration: 2 });
  await client.disableApp(org, installation, 3);
  await client.exportPrivateAppCredential(org, installation, 3);
  await client.listAppExtensions(org, installation, { target: "business.panel", contextType: "business", resourcePublicId: "corg_1" });
  for (const call of calls) {
    assert.equal(call.headers.get("x-tenant-id"), org);
    assert.equal(call.headers.get("authorization"), "Bearer staff-token");
  }
  assert.deepEqual(calls[0].body, consent);
  assert.equal(calls[1].method, "PUT");
  assert.equal(calls[1].url.pathname, `/api/platform/v1/app-installations/${installation}/grant`);
  assert.deepEqual(calls[2].body, { expectedGeneration: 3, uninstall: false });
  assert.deepEqual(calls[3].body, { expectedGeneration: 3 });
  assert.equal(calls[3].init.cache, "no-store");
  assert.equal(calls[4].url.search, "?target=business.panel&contextType=business&resourcePublicId=corg_1");

  for (const bad of ["", "invalid-business", "e7a9d8c0-11c4-49b6-a1c2-559ed024db3"]) {
    await assert.rejects(client.listAppInstallations(bad), /organizationId must be a UUID/, bad);
    await assert.rejects(client.webhooks.list(bad, installation), /organizationId must be a UUID/, bad);
  }
});

test("platform: vendor routes are tenantless, installation ids are the public ids, and webhook queries carry limit", async () => {
  const { calls, fetch } = recorder();
  const client = createPlatformClient({ baseUrl, accessToken: "developer-token", fetch });
  await client.listOwnVendorVersions();
  await client.decideVendorVersion("v/1", { manifestHash: "h", expectedRevision: 2, decision: "Suspended", reason: "evidence changed" } as never);
  await client.webhooks.deliveries(org, "app_x/y", "wh_1", { limit: 25 });
  assert.equal(calls[0].headers.get("x-tenant-id"), null);
  assert.equal(calls[1].headers.get("x-tenant-id"), null);
  assert.equal(calls[1].url.pathname, "/api/platform/v1/app-reviews/v%2F1/decision");
  assert.deepEqual(calls[1].body, { manifestHash: "h", expectedRevision: 2, decision: "Suspended", reason: "evidence changed" });
  assert.equal(calls[2].url.pathname, "/api/platform/v1/app-installations/app_x%2Fy/webhooks/wh_1/deliveries");
  assert.equal(calls[2].url.search, "?limit=25");
});
