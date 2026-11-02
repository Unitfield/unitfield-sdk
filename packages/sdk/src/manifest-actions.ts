/**
 * The exact action type, scopes and JSON Schemas an app manifest must declare for the two reviewed capabilities.
 * Copy them into `extensions[]` of an app manifest; versions are immutable, so these strings are part of the review.
 */
export const platformAvailabilityAction = Object.freeze({
  actionType: "rental.availability.check.v1" as const,
  requiredScopes: ["listings:read", "availability:read"] as const,
  inputSchema:
    '{"type":"object","required":["listingPublicId","startDate"],"properties":{"listingPublicId":{"type":"string"},"startDate":{"type":"string","format":"date"},"endDate":{"type":["string","null"],"format":"date"}},"additionalProperties":false}',
  outputSchema:
    '{"type":"object","required":["listingPublicId","unitPublicId","startDate","endDate","isAvailable","reasonCode"],"properties":{"listingPublicId":{"type":"string"},"unitPublicId":{"type":"string"},"startDate":{"type":"string","format":"date"},"endDate":{"type":["string","null"],"format":"date"},"isAvailable":{"type":"boolean"},"reasonCode":{"enum":[null,"unavailable","occupied_unconfirmed","reserved"]}},"additionalProperties":false}',
});

export const platformResidentMaintenanceAction = Object.freeze({
  actionType: "resident.maintenance.request.create.v1" as const,
  requiredScopes: ["resident-requests:create"] as const,
  inputSchema:
    '{"type":"object","required":["subject","description"],"properties":{"subject":{"type":"string","minLength":1,"maxLength":160},"description":{"type":"string","maxLength":8000}},"additionalProperties":false}',
  outputSchema:
    '{"type":"object","required":["requestPublicId","leasePublicId","status"],"properties":{"requestPublicId":{"type":"string","pattern":"^creq_[a-z0-9_-]{24}$"},"leasePublicId":{"type":"string","pattern":"^clea_[a-z0-9_-]{24}$"},"status":{"enum":["created","replayed"]}},"additionalProperties":false}',
});
