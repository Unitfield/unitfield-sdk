// Contract tests: every call the SDK makes is checked against the API's exported OpenAPI documents (openapi/*.json,
// refreshed by `pnpm gen:api`): method, path, query names, required headers and body keys. Each document's operations
// must be wrapped by a client or listed as intentionally not wrapped, so a new API operation shows up here.
import assert from "node:assert/strict";
import test from "node:test";
import {
  createAppsClient,
  createApplicantClient,
  createPlatformClient,
  createResidentClient,
  createStorefrontClient,
} from "../dist/index.js";
import { getVendorInstallationCredential } from "../dist/server.js";
import { allOperations, findOperation, recorder, snapshot, type Call, type Document } from "./helpers.mts";

const baseUrl = "https://api.unitfield.test";
const org = "e7a9d8c0-11c4-49b6-a1c2-559ed024db36";
const installation = "app_0123456789abcdef0123456789abcdef";
const body = { items: [], page: 1, pageSize: 20, total: 0, nextCursor: null };

type Schema = { $ref?: string; type?: string; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: unknown; allOf?: Schema[]; oneOf?: Schema[] };

function resolve(doc: Document, schema: Schema | undefined): Schema | undefined {
  if (schema?.$ref) return resolve(doc, (doc.components?.schemas as Record<string, Schema>)[schema.$ref.split("/").pop()!]);
  // An optional body is documented as `oneOf: [null, Body]`: the body is the one alternative that is not null.
  const alternatives = schema?.oneOf?.filter((alternative) => alternative.type !== "null");
  if (alternatives?.length === 1) return resolve(doc, alternatives[0]);
  return schema;
}

/** Method, path, query names, required headers, idempotency header and body keys must all be in the document. */
function check(doc: Document, call: Call, label: string): string {
  const found = findOperation(doc, call.method, call.url.pathname);
  assert.ok(found, `${label}: ${call.method} ${call.url.pathname} is not an operation of the OpenAPI document`);
  const { operation, template } = found;
  const parameters = operation.parameters ?? [];
  const declared = (place: string) => parameters.filter((p) => p.in === place);

  for (const key of call.url.searchParams.keys()) {
    assert.ok(declared("query").some((p) => p.name === key), `${label}: query parameter "${key}" is not declared by ${call.method} ${template}`);
  }
  for (const p of declared("query").filter((p) => p.required)) {
    assert.ok(call.url.searchParams.has(p.name), `${label}: required query parameter "${p.name}" is missing`);
  }
  for (const p of declared("header").filter((p) => p.required)) {
    assert.ok(call.headers.has(p.name), `${label}: required header "${p.name}" is missing`);
  }
  if (call.headers.has("idempotency-key")) {
    assert.ok(declared("header").some((p) => p.name.toLowerCase() === "idempotency-key"), `${label}: ${call.method} ${template} does not declare Idempotency-Key, so the API would ignore it`);
  }
  const requestBody = operation.requestBody?.content?.["application/json"];
  if (!requestBody) {
    assert.equal(call.body, undefined, `${label}: ${call.method} ${template} takes no request body`);
  } else if (call.body !== undefined) {
    const schema = resolve(doc, requestBody.schema as Schema);
    const keys = Object.keys(call.body as object);
    for (const required of schema?.required ?? []) assert.ok(keys.includes(required), `${label}: body is missing required property "${required}"`);
    if (schema?.properties) {
      const unknown = keys.filter((key) => !(key in schema.properties!));
      if (schema.additionalProperties === false) assert.deepEqual(unknown, [], `${label}: body has properties the schema forbids`);
      assert.deepEqual(unknown, [], `${label}: body has properties the schema does not declare`);
    }
  }
  return `${call.method} ${template}`;
}

async function verifyAgainst(doc: Document, notWrapped: string[], invoke: (fetch: typeof globalThis.fetch) => Record<string, () => Promise<unknown>>) {
  const { calls, fetch } = recorder(() => Response.json(body));
  const exercised = new Set<string>();
  for (const [label, run] of Object.entries(invoke(fetch))) {
    const before = calls.length;
    await run();
    assert.ok(calls.length > before, `${label}: made no request`);
    for (const call of calls.slice(before)) exercised.add(check(doc, call, label));
  }
  const all = allOperations(doc);
  for (const entry of notWrapped) assert.ok(all.includes(entry), `notWrapped lists "${entry}", which is not in the document any more`);
  const missing = all.filter((operation) => !exercised.has(operation) && !notWrapped.includes(operation));
  assert.deepEqual(missing, [], "operations in the document that the SDK neither wraps nor lists as intentionally not wrapped");
}

test("the apps runtime client matches the apps-v1 contract operation for operation", async () => {
  await verifyAgainst(snapshot("apps")!, [], (fetch) => {
    const c = createAppsClient({ baseUrl, accessToken: "t", fetch });
    const consent = { acknowledgedApplicantPrivacy: true, consentedToElectronicRecords: true, applicantPrivacyDocumentId: "d", applicantPrivacyVersion: "1", applicantPrivacyContentSha256: "s", electronicRecordsDocumentId: "d", electronicRecordsVersion: "1", electronicRecordsContentSha256: "s" };
    return {
      getOrganization: () => c.getOrganization(),
      listListings: () => c.listListings({ beds: 2, baths: 1.5, rentMin: 1, rentMax: 2, availableFrom: new Date("2026-09-01"), search: "x", page: 2, pageSize: 10, sort: "rent" }),
      iterateListings: () => c.iterateListings({ pageSize: 10 }).toArray(),
      getListing: () => c.getListing("clst_1"),
      getPaymentReadiness: () => c.getPaymentReadiness(),
      getPaymentStatus: () => c.getPaymentStatus("cpay_1"),
      sendApplicationOtp: () => c.sendApplicationOtp({ listingPublicId: "clst_1", email: "a@b.test", ...consent }),
      verifyApplicationOtp: () => c.verifyApplicationOtp({ listingPublicId: "clst_1", email: "a@b.test", code: "123456" }),
      getApplicationDraft: () => c.getApplicationDraft("draft"),
      saveApplicationStep: () => c.saveApplicationStep("draft", "applicant", { payload: { firstName: "Ada" } }),
      uploadDraftAttachment: () => c.uploadDraftAttachment("draft", { attachmentType: "id", fileName: "a.pdf", contentType: "application/pdf", contentBase64: "JVBERi0=" }),
      submitApplication: () => c.submitApplication("draft", { certifiedApplication: true, typedSignature: "Ada", rentalApplicationTermsDocumentId: "d", rentalApplicationTermsVersion: "1", rentalApplicationTermsContentSha256: "s", certificationTextSha256: "s" }, { idempotencyKey: "k" }),
      createScreeningCheckoutSession: () => c.createScreeningCheckoutSession("capp_1", { returnUrl: "https://shop.test/r", method: "card" }, { idempotencyKey: "k" }),
      createLeaseCheckoutSession: () => c.createLeaseCheckoutSession("clea_1", { amountCents: 1000, returnUrl: "https://shop.test/r" }, { idempotencyKey: "k" }),
      enqueueAppAction: () => c.enqueueAppAction({ extensionKey: "availability", resourcePublicId: "corg_abcdefghijklmnopqrstuvwx", input: { listingPublicId: "clst_abcdefghijklmnopqrstuvwx", startDate: "2026-11-01" }, idempotencyKey: "once" }),
      getAppAction: () => c.getAppAction("20f89ba4-e6de-48fb-809a-04ee2c591c47"),
    };
  });
});

test("the resident client matches the resident contract operation for operation", async () => {
  await verifyAgainst(snapshot("resident")!, [
    "GET /api/resident/v1/legal/{purpose}/{manifestSha256}/{documentId}",
    // The API also answers POST here, an alias of the PATCH the SDK calls.
    "POST /api/v1/resident/notifications/{notificationId}/read",
  ], (fetch) => {
    const c = createResidentClient({ baseUrl, accessToken: "t", fetch });
    const key = { idempotencyKey: "k" };
    return {
      context: () => c.context({ leaseId: "clea_1" }),
      getProfile: () => c.getProfile(),
      updateProfile: () => c.updateProfile({ firstName: "Ada", lastName: "L", profileImageUrl: null, phoneNumber: null, timeZone: "UTC" }),
      getNotificationPreferences: () => c.getNotificationPreferences(),
      updateNotificationPreferences: () => c.updateNotificationPreferences({ preferences: [] }),
      legal: () => c.legal(),
      "leases.list": () => c.leases.list(),
      "leases.get": () => c.leases.get("clea_1"),
      "leases.balance": () => c.leases.balance("clea_1"),
      "leases.statement": () => c.leases.statement("clea_1", { from: "2026-01-01", to: new Date("2026-02-01") }),
      "leases.documents": () => c.leases.documents("clea_1"),
      "leases.downloadDocument": () => c.leases.downloadDocument("clea_1", "file_1"),
      "payments.list": () => c.payments.list(),
      "payments.overview": () => c.payments.overview(),
      "payments.get": () => c.payments.get("cpay_1"),
      "payments.receipt": () => c.payments.receipt("cpay_1"),
      "payments.create": () => c.payments.create("clea_1", { amount: 10, paymentMethod: "card", successUrl: "https://shop.test/ok", cancelUrl: "https://shop.test/no" } as never, key),
      "autopay.preview": () => c.autopay.preview("clea_1", { paymentMethod: "card", maxAmount: 10, dayOfMonth: 1 } as never),
      "autopay.setup": () => c.autopay.setup("clea_1", { paymentMethod: "card", maxAmount: 10, dayOfMonth: 1, typedSignature: "Ada", acceptedRecurringAuthorization: true, authorizationDocumentId: "d", authorizationVersion: "1", authorizationContentSha256: "s", authorizationTemplateSha256: "s", successUrl: "https://shop.test/ok", cancelUrl: "https://shop.test/no" } as never, key),
      "autopay.complete": () => c.autopay.complete("clea_1", { checkoutSessionId: "cs_1" }),
      "autopay.revoke": () => c.autopay.revoke("clea_1"),
      "requests.list": () => c.requests.list(),
      "requests.get": () => c.requests.get("creq_1"),
      "requests.create": () => c.requests.create({ leaseId: "clea_1", subject: "Leak", description: "Sink" } as never, { idempotencyKey: true }),
      "requests.sendMessage": () => c.requests.sendMessage("creq_1", { note: "hi" }),
      "requests.addNote": () => c.requests.addNote("creq_1", { note: "hi" }),
      "requests.reopen": () => c.requests.reopen("creq_1"),
      "requests.askAnotherTime": () => c.requests.askAnotherTime("creq_1"),
      "requests.attachFiles": () => c.requests.attachFiles("creq_1", { attachments: [] }),
      "requests.createUploadSession": () => c.requests.createUploadSession("creq_1", { fileName: "a.jpg", contentType: "image/jpeg", byteSize: 10, checksumSha256: "s" }),
      "requests.completeUpload": () => c.requests.completeUpload("creq_1", "sess_1", { actualSize: 10, checksumSha256: "s" }),
      "requests.downloadFile": () => c.requests.downloadFile("creq_1", "file_1"),
      "renewals.list": () => c.renewals.list(),
      "renewals.get": () => c.renewals.get("case_1"),
      "renewals.accept": () => c.renewals.accept("case_1", { selectedOfferId: "o1", notes: null }, { idempotencyKey: "k" }),
      "renewals.decline": () => c.renewals.decline("case_1"),
      "notifications.list": () => c.notifications.list({ isRead: false, page: 1, pageSize: 20 }),
      "notifications.markRead": () => c.notifications.markRead("n1"),
      "notifications.markAllRead": () => c.notifications.markAllRead(),
      "extensionActions.list": () => c.extensionActions.list("clea_1"),
      "extensionActions.execute": () => c.extensionActions.execute("clea_1", installation, "maintenance", { clientIntentId: "i", appVersionId: "v", expectedGrantGeneration: 1, input: { subject: "s", description: "d" } } as never),
    };
  });
});

test("the platform client matches the platform contract operation for operation", async () => {
  await verifyAgainst(snapshot("platform")!, ["GET /api/platform/v1/extension-hosts/business-panel"], (fetch) => {
    const c = createPlatformClient({ baseUrl, accessToken: "t", fetch });
    const manifest = { schemaVersion: "1", appKey: "rental-tools", version: "1.0.0", displayName: "Rental tools", runtimeMode: "service", requiredScopes: ["listings:read"], optionalScopes: [], redirectUris: [], allowedOrigins: [], extensions: [] } as never;
    const consent = { appVersionId: "v1", manifestHash: "h", approvedScopes: ["listings:read"] };
    const staff = { appVersionId: "v1", expectedGrantGeneration: 3, input: { listingPublicId: "clst_1", startDate: "2026-11-01" } } as never;
    const w = c.webhooks;
    return {
      listAppCatalog: () => c.listAppCatalog(org),
      publishAppVersion: () => c.publishAppVersion(manifest),
      publishPrivateAppVersion: () => c.publishPrivateAppVersion(org, manifest),
      listOwnVendorVersions: () => c.listOwnVendorVersions(),
      listVendorReviewQueue: () => c.listVendorReviewQueue(),
      listReviewedVendorVersions: () => c.listReviewedVendorVersions(),
      decideVendorVersion: () => c.decideVendorVersion("v1", { manifestHash: "h", expectedRevision: 2, decision: "Approved", reason: "ok" } as never),
      withdrawVendorVersion: () => c.withdrawVendorVersion("v1", { manifestHash: "h", expectedRevision: 2, reason: "r" }),
      getVendorReviewAudit: () => c.getVendorReviewAudit("v1"),
      listAppInstallations: () => c.listAppInstallations(org),
      installApp: () => c.installApp(org, consent),
      changeAppGrant: () => c.changeAppGrant(org, installation, { ...consent, expectedGeneration: 2 }),
      disableApp: () => c.disableApp(org, installation, 3, true),
      reconcileApp: () => c.reconcileApp(org, installation),
      exportPrivateAppCredential: () => c.exportPrivateAppCredential(org, installation, 3),
      listAppExtensions: () => c.listAppExtensions(org, installation, { target: "business.panel", contextType: "business", resourcePublicId: "corg_abcdefghijklmnopqrstuvwx" }),
      getInstallationUsage: () => c.getInstallationUsage(org, installation),
      getReconciliationReport: () => c.getReconciliationReport(org),
      "server.getVendorInstallationCredential": () => getVendorInstallationCredential(c, installation, 3),
      getBusinessExtensionActions: () => c.getBusinessExtensionActions(org),
      getApplicationExtensions: () => c.getApplicationExtensions(org, "app_1"),
      executeBusinessExtensionAction: () => c.executeBusinessExtensionAction(org, installation, "availability", staff),
      executeApplicationExtensionAction: () => c.executeApplicationExtensionAction(org, "app_1", installation, "availability", staff),
      "webhooks.catalog": () => w.catalog(org),
      "webhooks.policy": () => w.policy(org),
      "webhooks.list": () => w.list(org, installation),
      "webhooks.create": () => w.create(org, installation, { targetUrl: "https://hooks.test/in", events: ["listing.updated"] }),
      "webhooks.get": () => w.get(org, installation, "wh_1"),
      "webhooks.update": () => w.update(org, installation, "wh_1", { isActive: false }),
      "webhooks.delete": () => w.delete(org, installation, "wh_1"),
      "webhooks.rotateSecret": () => w.rotateSecret(org, installation, "wh_1"),
      "webhooks.test": () => w.test(org, installation, "wh_1"),
      "webhooks.deliveries": () => w.deliveries(org, installation, "wh_1", { limit: 10 }),
      "webhooks.deadLetter": () => w.deadLetter(org, installation, "wh_1", { limit: 10 }),
      "webhooks.replay": () => w.replay(org, installation, "wh_1", "dlv_1"),
    };
  });
});

test("the customer-auth endpoints are first-party server calls and have no SDK wrapper", () => {
  // /api/customer-auth/v1 is called only by org-host servers with FirstPartyServiceAuth (spec 3.3.3). The SDK ships
  // their generated types (CustomerAuthPaths) and deliberately no browser client.
  const doc = snapshot("customer-auth")!;
  assert.ok(allOperations(doc).length > 0);
});

function storefrontInvocations(fetch: typeof globalThis.fetch) {
  const c = createStorefrontClient({ baseUrl, publishableKey: `pk_test_${"a".repeat(32)}`, fetch });
  return {
    "hosts.resolve": () => c.hosts.resolve("acme.unitfield.app"),
    "site.get": () => c.site.get(),
    "pages.get": () => c.pages.get("about"),
    "listings.list": () => c.listings.list({ bedroomsMin: 1, bedroomsMax: 3, bathroomsMin: 1, rentMin: 1, rentMax: 2, availableBy: "2026-09-01", propertyId: "cprop_1", unitPublicKey: "unit-4b", city: "Austin", sort: "rent", cursor: "c", limit: 10 }),
    "listings.get": () => c.listings.get("clst_1"),
    "properties.list": () => c.properties.list({ cursor: "c", limit: 10 }),
    "properties.get": () => c.properties.get("cprop_1"),
    "inquiries.create": () =>
      c.inquiries.create({ kind: "tour", name: "Ada", email: "a@b.test", phone: "1", message: "m", listingPublicId: "clst_1", picks: [{ date: "2026-09-01", window: "morning" }], timeZone: "Europe/Istanbul", preferredTimes: ["2026-09-01T10:00:00Z"], turnstileToken: "t" }),
    "tours.windows": () => c.tours.windows({ listingPublicId: "clst_1" }),
    "tours.view": () => c.tours.view("tok_abcdefgh"),
    "tours.answer": () => c.tours.answer({ token: "tok_abcdefgh", action: "pick", picks: [{ date: "2026-11-04", window: "morning" }], message: "m" }),
  };
}

function applicantInvocations(fetch: typeof globalThis.fetch) {
  const c = createApplicantClient({ baseUrl, accessToken: "t", fetch });
  const draftId = "5d1c4a0e-1b6f-4d52-9a55-3f7f0d6a9b21";
  const consent = { acknowledgedApplicantPrivacy: true, consentedToElectronicRecords: true, applicantPrivacyDocumentId: "d", applicantPrivacyVersion: "1", applicantPrivacyContentSha256: "s", electronicRecordsDocumentId: "d", electronicRecordsVersion: "1", electronicRecordsContentSha256: "s" };
  return {
    legal: () => c.legal(),
    list: () => c.list(),
    createDraft: () => c.createDraft("unit-key"),
    getDraft: () => c.getDraft(draftId),
    deleteDraft: () => c.deleteDraft(draftId),
    saveStep: () => c.saveStep(draftId, "applicant", { firstName: "Ada" }),
    saveHousehold: () => c.saveHousehold(draftId, { occupants: [] }),
    recordConsent: () => c.recordConsent(draftId, consent),
    createUploadSession: () => c.createUploadSession(draftId, { attachmentType: "id", fileName: "a.pdf", contentType: "application/pdf", byteSizeMax: 10 }),
    completeUpload: () => c.completeUpload(draftId, { attachmentType: "id", sessionId: "s", actualSize: 10 }),
    submit: () => c.submit(draftId, { certifiedApplication: true, typedSignature: "Ada", rentalApplicationTermsDocumentId: "d", rentalApplicationTermsVersion: "1", rentalApplicationTermsContentSha256: "s", certificationTextSha256: "s" }, { idempotencyKey: "k" }),
    status: () => c.status(draftId),
    screening: () => c.screening(draftId),
    openSigningSession: () => c.openSigningSession(draftId),
  };
}

test("the storefront client matches the storefront contract operation for operation", async () => {
  // `tours.icsUrl` only builds the address of the calendar file (it needs the storefront credentials, so a server fetches it): no call to check.
  await verifyAgainst(snapshot("storefront")!, ["GET /api/storefront/v1/tours/ics"], storefrontInvocations);
});

test("the applicant client matches the customer applications contract operation for operation", async () => {
  // The customer document also carries the resident-portal legal acceptance, which only the hosted resident flow uses.
  await verifyAgainst(snapshot("customer")!, ["GET /api/customer/v1/resident-legal", "POST /api/customer/v1/resident-legal/acceptance"], applicantInvocations);
});
