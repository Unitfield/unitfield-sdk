/**
 * `@unitfield/sdk`: the browser-safe core. Nothing here needs a secret; confidential helpers live in `@unitfield/sdk/server`.
 */

// Shared plumbing
export { UNITFIELD_API_URL, ApiClient, type ApiRequestOptions, type BearerClientOptions, type ClientOptions } from "./client.js";
export {
  generateIdempotencyKey,
  type AccessTokenContext,
  type AccessTokenProvider,
  type FetchExtras,
  type FetchLike,
  type HttpMethod,
  type IdempotentMutationOptions,
  type MutationOptions,
  type RequestOptions,
  type RetryOptions,
} from "./transport.js";
export {
  PagedList,
  paginateCursor,
  paginateNumbered,
  type CursorPage,
  type IterateOptions,
  type NumberedPage,
} from "./pagination.js";
export { isAbortError } from "./internal/abort.js";
export { validateHttpUrl } from "./internal/url.js";

// Errors
export {
  AuthenticationError,
  ConflictError,
  InvalidResponseError,
  NetworkError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  RequestTimeoutError,
  ServerError,
  UnitfieldApiError,
  UnitfieldError,
  ValidationError,
  isUnitfieldError,
  type RateLimitInfo,
  type UnitfieldApiErrorInit,
  type UnitfieldErrorOptions,
} from "./errors.js";

// Storefront (publishable key)
export { StorefrontClient, createStorefrontClient, type PreviewOptions, type StorefrontClientOptions, type StorefrontIterateOptions } from "./storefront/client.js";
export type * from "./storefront/types.js";

// Customer sign-in (OIDC authorization code + PKCE)
export {
  CustomerAuth,
  CustomerScopes,
  UNITFIELD_ID_URL,
  createCustomerAuth,
  type AuthorizationRequest,
  type CustomerAuthEndpoints,
  type CustomerAuthOptions,
  type SignInOptions,
  type SignOutOptions,
  type SignOutResult,
} from "./auth/customer-auth.js";
export { CustomerSession, createCustomerSession, type CustomerSessionOptions, type RefreshLock, type TokenListener } from "./auth/session.js";
export { CustomerAuthError, NotSignedInError, OAuthTokenError, RefreshTokenRevokedError, type CustomerAuthErrorCode } from "./auth/errors.js";
export { isExpiring, memoryTokenStore, type IdTokenClaims, type TokenSet, type TokenStore } from "./auth/tokens.js";
export { saveAuthorizationRequest, takeAuthorizationRequest, takeAuthorizationRequestFor, type StorageLike } from "./auth/request-store.js";
export { createCodeChallenge, createCodeVerifier, createNonce, createState } from "./auth/pkce.js";
export { decodeJwtPayload } from "./auth/jwt.js";

// Signed-in customers
export { ResidentClient, createResidentClient, type ResidentClientOptions } from "./resident.js";
export type * from "./resident.js";
export { ApplicantClient, createApplicantClient, type ApplicantClientOptions } from "./applicant.js";
export type * from "./applicant.js";

// Installed apps and app management
export { AppsClient, createAppsClient, type AppsClientOptions } from "./apps.js";
export type * from "./apps.js";
export { PlatformClient, createPlatformClient, type PlatformClientOptions } from "./platform.js";
export type * from "./platform.js";

// Contract types generated from the API's OpenAPI documents (`pnpm gen:api`)
export type { components as AppsComponents, operations as AppsOperations, paths as AppsPaths } from "./generated/apps.js";
export type { components as CustomerComponents, operations as CustomerOperations, paths as CustomerPaths } from "./generated/customer.js";
export type { components as CustomerAuthComponents, operations as CustomerAuthOperations, paths as CustomerAuthPaths } from "./generated/customer-auth.js";
export type { components as PlatformComponents, operations as PlatformOperations, paths as PlatformPaths } from "./generated/platform.js";
export type { components as ResidentComponents, operations as ResidentOperations, paths as ResidentPaths } from "./generated/resident.js";
export type { components as StorefrontComponents, operations as StorefrontOperations, paths as StorefrontPaths } from "./generated/storefront.js";

// Platform manifest constants kept for authoring app versions
export {
  platformAvailabilityAction,
  platformResidentMaintenanceAction,
} from "./manifest-actions.js";
