import { UnitfieldError, type UnitfieldErrorOptions } from "../errors.js";

export type CustomerAuthErrorCode =
  | "authorization_denied"
  | "state_mismatch"
  | "missing_code"
  | "issuer_mismatch"
  | "invalid_id_token"
  | "nonce_mismatch"
  | "invalid_token_response"
  | "discovery_failed"
  | "no_refresh_token"
  | "not_signed_in";

/** Something in the sign-in ceremony itself is wrong: a denied authorization, a state or nonce mismatch, an invalid ID token. */
export class CustomerAuthError extends UnitfieldError {
  override readonly name: string = "CustomerAuthError";
  declare readonly code: CustomerAuthErrorCode | (string & {});
  /** The OAuth `error` the issuer sent back, when there was one. */
  readonly oauthError?: string;
  readonly description?: string;

  constructor(
    message: string,
    code: CustomerAuthErrorCode,
    options: UnitfieldErrorOptions & { oauthError?: string; description?: string } = {},
  ) {
    super(message, { code, cause: options.cause });
    this.oauthError = options.oauthError;
    this.description = options.description;
  }
}

/** There are no tokens: nobody has signed in, or the session was cleared. Start a sign-in. */
export class NotSignedInError extends CustomerAuthError {
  override readonly name: string = "NotSignedInError";
  constructor() {
    super("Not signed in.", "not_signed_in");
  }
}

/** The token endpoint refused a request (RFC 6749 section 5.2). `oauthError` is the standard error code. */
export class OAuthTokenError extends UnitfieldError {
  override readonly name: string = "OAuthTokenError";
  readonly oauthError: string;
  readonly description?: string;
  readonly status: number;

  constructor(message: string, init: { oauthError: string; status: number; description?: string; code?: string }) {
    super(message, { code: init.code ?? init.oauthError });
    this.oauthError = init.oauthError;
    this.status = init.status;
    this.description = init.description;
  }
}

/**
 * The refresh token is no longer valid: it was already used (reuse detection revokes the whole token family), the
 * session was signed out, or it expired. The session has already cleared its tokens; sign in again.
 */
export class RefreshTokenRevokedError extends OAuthTokenError {
  override readonly name: string = "RefreshTokenRevokedError";
  constructor(init: { status: number; description?: string }) {
    super("The refresh token is no longer valid. Sign in again.", { oauthError: "invalid_grant", status: init.status, description: init.description, code: "refresh_token_revoked" });
  }
}
