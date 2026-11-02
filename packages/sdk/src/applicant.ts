/**
 * Applicant API (`/api/customer/v1/applications`). The shapes are the generated ones (`src/generated/customer.ts`,
 * from the `v1` OpenAPI document), exported under stable names. Responses are narrowed with `Wire`: the documents
 * describe every number as `number | string`, but the API only ever sends JSON numbers.
 *
 * Needs a customer token with `applications:read` and `applications:write`. The customer account is the only
 * capability: no request or response carries a draft token.
 */
import { ApiClient, bearerTransport, type BearerClientOptions } from "./client.js";
import type { components } from "./generated/customer.js";
import { pathSegment } from "./internal/url.js";
import type { Wire } from "./internal/openapi-types.js";
import { requireIdempotencyKey, type IdempotentMutationOptions, type RequestOptions } from "./transport.js";

type Schemas = components["schemas"];

const BASE = "/api/customer/v1/applications";

export type ApplicationStage = Schemas["RentalApplicationStage"];
export type ApplicationScreeningStatus = Schemas["RentalApplicationScreeningStatus"];
export type ApplicationDraftStatus = Schemas["RentalApplicationDraftStatus"];

export type ApplicantLegalDocument = Schemas["RentalApplicationLegalDocument"];

/** The currently published documents the applicant must acknowledge, and the certification text signed on submit. */
export type ApplicantLegal = Schemas["PublicRentalApplicationLegalResponse"];

/** Privacy acknowledgment and electronic-records consent. The documents must be exactly the ones `legal()` returns. */
export type ApplicantConsentInput = Schemas["CustomerApplicationConsentRequest"];

export type ApplicantConsentState = Schemas["CustomerApplicationConsentState"];

/** One saved step; `payloadJson` is the step's JSON, serialized. */
export type ApplicationStep = Schemas["PublicDraftStepPayloadResponse"];

export type ApplicationAttachment = Schemas["PublicDraftAttachmentResponse"];

export type ApplicationQuestion = Wire<Schemas["PropertyFormTemplateQuestionDto"]>;

/** A draft: the applicant's work in progress. `isResumed` is true when `createDraft` returned the draft already in progress for this unit. */
export type ApplicationDraft = Wire<Schemas["CustomerApplicationDraftResponse"]>;

/**
 * One row of the account's own applications: an open draft (`kind` is `draft`, `id` is the draft id) or a submitted
 * application (`kind` is `application`, `id` is the application id). `state` is the draft status for a draft, the
 * application stage for an application.
 */
export type ApplicationListItem = Wire<Schemas["CustomerApplicationListItem"]>;

export type ApplicationValidationError = Schemas["RentalApplicationValidationError"];

export type SaveStepResult = Wire<Schemas["PublicDraftStepSaveResponse"]>;

export type UploadSessionInput = Wire<Schemas["PublicCreateDraftAttachmentUploadSessionRequest"]>;

/** Where to send the file: send the bytes to `url` with `method` and `headers`, then call `completeUpload`. */
export type UploadSession = Schemas["PublicDraftAttachmentUploadSessionResponse"];

export type CompleteUploadInput = Wire<Schemas["PublicCompleteDraftAttachmentUploadRequest"]>;

export type SubmitApplicationInput = Schemas["PublicSubmitApplicationRequest"];

export type SubmitApplicationResult = Schemas["PublicSubmitApplicationResponse"];

export type ApplicationContinuation = Schemas["ApplicantContinuation"];

/** `applicationUrl` is where the applicant continues with the screening provider. */
export type ApplicationScreening = Wire<Schemas["PublicScreeningDto"]>;

export type ApplicationStatus = Wire<Schemas["CustomerApplicationStatusResponse"]>;

/** Hand-off to the hosted signing page; the applicant continues there. */
export type SigningSession = Schemas["NativeApplicantSigningSession"];

/** The one-time proof that continues the applicant into Unitfield Resident. `receiptOnly` defaults to false. */
export type ResidentHandoffInput = Omit<Schemas["MintApplicantResidentProofRequest"], "receiptOnly"> & { receiptOnly?: boolean };

export type ResidentHandoff = Schemas["MintApplicantResidentProofResponse"];

export type ApplicantClientOptions = BearerClientOptions;

/** The signed-in applicant's own applications. Authenticate with a customer token: pass `session.tokenProvider`. */
export class ApplicantClient extends ApiClient {
  constructor(options: ApplicantClientOptions = {}) {
    super(bearerTransport(options));
  }

  /** The published legal documents to acknowledge before the application can be submitted. */
  async legal(options: RequestOptions = {}): Promise<ApplicantLegal> {
    return this.http.request({ ...options, path: `${BASE}/legal` });
  }

  /** The account's open drafts and submitted applications. */
  async list(options: RequestOptions = {}): Promise<{ items: ApplicationListItem[] }> {
    return this.http.request({ ...options, path: BASE });
  }

  /** Starts an application for a unit (`unitPublicKey` is the key in the storefront's `/apply/{unitPublicKey}`), or returns the open draft for it. */
  async createDraft(unitPublicKey: string, options: RequestOptions = {}): Promise<ApplicationDraft> {
    if (typeof unitPublicKey !== "string" || !unitPublicKey.trim()) throw new TypeError("unitPublicKey must be a non-empty string.");
    return this.http.request({ ...options, method: "POST", path: `${BASE}/drafts`, body: { unitPublicKey: unitPublicKey.trim() } });
  }

  async getDraft(draftId: string, options: RequestOptions = {}): Promise<ApplicationDraft> {
    return this.http.request({ ...options, path: `${BASE}/drafts/${pathSegment(draftId, "draftId")}` });
  }

  /** Withdraws an open draft. A submitted application cannot be deleted. */
  async deleteDraft(draftId: string, options: RequestOptions = {}): Promise<{ deleted: boolean }> {
    return this.http.request({ ...options, method: "DELETE", path: `${BASE}/drafts/${pathSegment(draftId, "draftId")}` });
  }

  /** Saves one step (`applicant`, `employment`, …) as JSON. Validation problems come back in `errors`, not as an exception. */
  async saveStep(draftId: string, stepKey: string, payload: unknown, options: RequestOptions = {}): Promise<SaveStepResult> {
    return this.http.request({
      ...options,
      method: "PUT",
      path: `${BASE}/drafts/${pathSegment(draftId, "draftId")}/steps/${pathSegment(stepKey, "stepKey")}`,
      body: { payload },
    });
  }

  /** Saves the household step (occupants, pets, vehicles). */
  async saveHousehold(draftId: string, payload: unknown, options: RequestOptions = {}): Promise<SaveStepResult> {
    return this.http.request({ ...options, method: "PUT", path: `${BASE}/drafts/${pathSegment(draftId, "draftId")}/household`, body: { payload } });
  }

  async recordConsent(draftId: string, consent: ApplicantConsentInput, options: RequestOptions = {}): Promise<ApplicantConsentState> {
    return this.http.request({ ...options, method: "PUT", path: `${BASE}/drafts/${pathSegment(draftId, "draftId")}/consent`, body: consent });
  }

  async createUploadSession(draftId: string, input: UploadSessionInput, options: RequestOptions = {}): Promise<UploadSession> {
    return this.http.request({ ...options, method: "POST", path: `${BASE}/drafts/${pathSegment(draftId, "draftId")}/attachments/upload-session`, body: input });
  }

  async completeUpload(draftId: string, input: CompleteUploadInput, options: RequestOptions = {}): Promise<ApplicationAttachment> {
    return this.http.request({ ...options, method: "POST", path: `${BASE}/drafts/${pathSegment(draftId, "draftId")}/attachments/complete`, body: input });
  }

  /** Submitting twice must not create two applications, so the idempotency key is required (the API answers 400 without it). */
  async submit(draftId: string, input: SubmitApplicationInput, options: IdempotentMutationOptions): Promise<SubmitApplicationResult> {
    return this.http.request({
      ...requireIdempotencyKey(options),
      method: "POST",
      path: `${BASE}/drafts/${pathSegment(draftId, "draftId")}/submit`,
      body: input,
    });
  }

  /** Status, agreement, signing and resident continuation of a submitted application. */
  async status(applicationId: string, options: RequestOptions = {}): Promise<ApplicationStatus> {
    return this.http.request({ ...options, path: `${BASE}/${pathSegment(applicationId, "applicationId")}/status` });
  }

  /** The screening handoff: where to continue with the screening provider and what it costs the applicant. `screening` is null when there is none. */
  async screening(applicationId: string, options: RequestOptions = {}): Promise<{ screening: ApplicationScreening | null }> {
    return this.http.request({ ...options, path: `${BASE}/${pathSegment(applicationId, "applicationId")}/screening` });
  }

  /** Opens the embedded signing session for the applicant's agreement. Redirect the applicant to `signUrl`. */
  async openSigningSession(applicationId: string, options: RequestOptions = {}): Promise<SigningSession> {
    return this.http.request({ ...options, method: "POST", path: `${BASE}/${pathSegment(applicationId, "applicationId")}/signing-session` });
  }

  /** Mints the one-time proof that continues the applicant into Unitfield Resident. */
  async residentHandoff(applicationId: string, input: ResidentHandoffInput, options: RequestOptions = {}): Promise<ResidentHandoff> {
    return this.http.request({ ...options, method: "POST", path: `${BASE}/${pathSegment(applicationId, "applicationId")}/resident-handoff`, body: { ...input, receiptOnly: input.receiptOnly ?? false } });
  }
}

export function createApplicantClient(options: ApplicantClientOptions = {}): ApplicantClient {
  return new ApplicantClient(options);
}
