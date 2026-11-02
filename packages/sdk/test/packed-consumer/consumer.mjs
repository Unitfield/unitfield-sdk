import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  PagedList,
  UnitfieldError,
  createApplicantClient,
  createAppsClient,
  createCodeChallenge,
  createCustomerAuth,
  createCustomerSession,
  createPlatformClient,
  createResidentClient,
  createStorefrontClient,
  platformAvailabilityAction,
} from "@unitfield/sdk";
import { WebhookVerificationError, createClientCredentialsTokenProvider, createWebhookVerifier, verifyWebhookSignature } from "@unitfield/sdk/server";

for (const factory of [createAppsClient, createResidentClient, createApplicantClient, createPlatformClient, createStorefrontClient, createCustomerAuth, createCustomerSession]) {
  assert.equal(typeof factory, "function");
}
assert.equal(typeof createClientCredentialsTokenProvider, "function");
assert.ok(new UnitfieldError("x") instanceof Error);

const publishableKey = `pk_test_${"a".repeat(32)}`;
const storefront = createStorefrontClient({
  publishableKey,
  baseUrl: "https://api.unitfield.test",
  fetch: async (input, init) => {
    assert.equal(new URL(String(input)).pathname, "/api/storefront/v1/listings");
    assert.equal(new Headers(init.headers).get("x-unitfield-key"), publishableKey);
    assert.equal(init.credentials, "omit");
    return Response.json({ items: [{ listingPublicId: "clst_1" }], nextCursor: null });
  },
});
const iterator = storefront.listings.iterate();
assert.ok(iterator instanceof PagedList);
assert.deepEqual((await iterator.toArray()).map((listing) => listing.listingPublicId), ["clst_1"]);

const apps = createAppsClient({
  baseUrl: "https://api.unitfield.test",
  accessToken: "access-token",
  fetch: async () => Response.json({ id: "corg_1" }),
});
assert.deepEqual(await apps.getOrganization(), { id: "corg_1" });

// RFC 7636 appendix B.
assert.equal(await createCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");

// Webhook signing, computed independently of the package.
const secret = "whsec_packed";
const payload = JSON.stringify({ id: "evt_1", type: "listing.updated", created: new Date().toISOString(), data: {} });
const timestamp = Math.floor(Date.now() / 1000);
const signature = `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex")}`;
assert.equal((await verifyWebhookSignature({ payload, signature, secret })).timestamp, timestamp);
const verifier = createWebhookVerifier({ secret });
const headers = new Headers({ "x-unitfield-signature": signature });
assert.equal((await verifier.constructEvent(payload, headers)).event.type, "listing.updated");
await assert.rejects(verifier.verify(payload, headers), (error) => error instanceof WebhookVerificationError && error.reason === "replayed");

assert.equal(platformAvailabilityAction.actionType, "rental.availability.check.v1");
assert.equal(JSON.parse(platformAvailabilityAction.inputSchema).additionalProperties, false);
