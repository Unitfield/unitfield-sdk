import { ApiClient, bearerTransport, type BearerClientOptions } from "./client.js";
import type { components } from "./generated/apps.js";
import { pathSegment, validateHttpUrl } from "./internal/url.js";
import { paginateNumbered, type IterateOptions, type PagedList } from "./pagination.js";
import { requireIdempotencyKey, type IdempotentMutationOptions, type RequestOptions } from "./transport.js";

type Schemas = components["schemas"];

/** The organization an installed app runs for. */
export type Organization = Schemas["AppOrganizationContextDto"];
export type AppsListing = Schemas["PublishedListingCardDto"];
export type AppsListingDetail = Schemas["PublishedListingDetailDto"];
export type AppsListingPage = Schemas["PublishedListingPageDto"];
export type PaymentReadiness = Schemas["AppPaymentReadinessDto"];
export type PaymentStatus = Schemas["AppPaymentStatusDto"];
export type ScreeningCheckoutSession = Schemas["AppScreeningCheckoutSessionDto"];
export type LeaseCheckoutSession = Schemas["AppLeaseCheckoutSessionDto"];
export type AppActionSubmit = Schemas["PlatformAppActionSubmitDto"];
export type AppActionWork = Schemas["PlatformAppActionWorkDto"];
export type AppActionInput = Schemas["PlatformAvailabilityActionInput"];
export type AppActionResult = Schemas["PlatformAvailabilityActionResult"];

/** Rental-application helpers of the apps runtime. The OTP and draft-token flow predates customer accounts and is replaced by `ApplicantClient`. */
export type AppsSendApplicationOtpInput = Schemas["AppSendApplicationOtpDto"];
export type AppsSendApplicationOtpResponse = Schemas["AppSendApplicationOtpResponseDto"];
export type AppsVerifyApplicationOtpInput = Schemas["AppVerifyApplicationOtpDto"];
export type AppsVerifyApplicationOtpResponse = Schemas["AppVerifyApplicationOtpResponseDto"];
export type AppsApplicationDraft = Schemas["AppDraftSnapshotDto"];
export type AppsSaveApplicationStepInput = Schemas["AppSaveApplicationStepDto"];
export type AppsSaveApplicationStepResponse = Schemas["AppDraftStepSaveResponseDto"];
export type AppsUploadDraftAttachmentInput = Schemas["AppUploadDraftAttachmentDto"];
export type AppsDraftAttachmentSummary = Schemas["AppDraftAttachmentSummaryDto"];
export type AppsSubmitApplicationInput = Schemas["AppSubmitApplicationDto"];
export type AppsSubmitApplicationResponse = Schemas["AppSubmitApplicationResponseDto"];

export type PaymentMethod = "card" | "ach";
export type CreateScreeningCheckoutSessionInput = { returnUrl: string; method?: PaymentMethod };
export type CreateLeaseCheckoutSessionInput = { amountCents: number; returnUrl: string; method?: PaymentMethod };

export type AppsListingFilters = {
  beds?: number;
  baths?: number;
  rentMin?: number;
  rentMax?: number;
  availableFrom?: string | Date;
  search?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
};

export type AppsClientOptions = BearerClientOptions;

const BASE = "/api/apps/v1";

/**
 * The installed-app runtime (`/api/apps/v1`). The token comes from the app installation: use
 * `createClientCredentialsTokenProvider` from `@unitfield/sdk/server` on a trusted server. Authority comes from the
 * token and the installation's current grant, never from request bodies.
 */
export class AppsClient extends ApiClient {
  constructor(options: AppsClientOptions = {}) {
    super(bearerTransport(options));
  }

  async getOrganization(options: RequestOptions = {}): Promise<Organization> {
    return this.http.request<Organization>({ ...options, path: `${BASE}/organization` });
  }

  /** One page of published listings (`page` and `pageSize` numbering). */
  async listListings(filters: AppsListingFilters = {}, options: RequestOptions = {}): Promise<AppsListingPage> {
    // Query names are the API's own (PascalCase); the contract test checks them against the OpenAPI snapshot.
    return this.http.request<AppsListingPage>({
      ...options,
      path: `${BASE}/listings/units`,
      query: {
        Beds: filters.beds,
        Baths: filters.baths,
        RentMin: filters.rentMin,
        RentMax: filters.rentMax,
        AvailableFrom: filters.availableFrom,
        Search: filters.search,
        Page: filters.page,
        PageSize: filters.pageSize,
        Sort: filters.sort,
      },
    });
  }

  /** Every listing matching the filters, page by page. `filters.page` is where the walk starts. */
  iterateListings(
    filters: AppsListingFilters = {},
    options: RequestOptions & IterateOptions = {},
  ): PagedList<AppsListing, AppsListingPage> {
    const { maxItems, maxPages, ...request } = options;
    return paginateNumbered<AppsListing, AppsListingPage>((page) => this.listListings({ ...filters, page }, request), {
      maxItems,
      maxPages,
      firstPage: filters.page ?? 1,
    });
  }

  async getListing(listingPublicId: string, options: RequestOptions = {}): Promise<AppsListingDetail> {
    return this.http.request<AppsListingDetail>({ ...options, path: `${BASE}/listings/units/${pathSegment(listingPublicId, "listingPublicId")}` });
  }

  async getPaymentReadiness(options: RequestOptions = {}): Promise<PaymentReadiness> {
    return this.http.request<PaymentReadiness>({ ...options, path: `${BASE}/payments/readiness` });
  }

  async getPaymentStatus(paymentPublicId: string, options: RequestOptions = {}): Promise<PaymentStatus> {
    return this.http.request<PaymentStatus>({ ...options, path: `${BASE}/payments/${pathSegment(paymentPublicId, "paymentPublicId")}` });
  }

  async sendApplicationOtp(input: AppsSendApplicationOtpInput, options: RequestOptions = {}): Promise<AppsSendApplicationOtpResponse> {
    return this.http.request({ ...options, method: "POST", path: `${BASE}/rental-applications/otp/send`, body: input });
  }

  async verifyApplicationOtp(input: AppsVerifyApplicationOtpInput, options: RequestOptions = {}): Promise<AppsVerifyApplicationOtpResponse> {
    return this.http.request({ ...options, method: "POST", path: `${BASE}/rental-applications/otp/verify`, body: input });
  }

  async getApplicationDraft(draftToken: string, options: RequestOptions = {}): Promise<AppsApplicationDraft> {
    return this.http.request({ ...options, path: `${BASE}/rental-applications/drafts/${pathSegment(draftToken, "draftToken")}` });
  }

  async saveApplicationStep(draftToken: string, stepKey: string, input: AppsSaveApplicationStepInput, options: RequestOptions = {}): Promise<AppsSaveApplicationStepResponse> {
    return this.http.request({
      ...options,
      method: "PUT",
      path: `${BASE}/rental-applications/drafts/${pathSegment(draftToken, "draftToken")}/steps/${pathSegment(stepKey, "stepKey")}`,
      body: input,
    });
  }

  async uploadDraftAttachment(draftToken: string, input: AppsUploadDraftAttachmentInput, options: RequestOptions = {}): Promise<AppsDraftAttachmentSummary> {
    return this.http.request({
      ...options,
      method: "POST",
      path: `${BASE}/rental-applications/drafts/${pathSegment(draftToken, "draftToken")}/attachments`,
      body: input,
    });
  }

  /** Submitting twice must not create two applications, so the idempotency key is required. */
  async submitApplication(draftToken: string, input: AppsSubmitApplicationInput, options: IdempotentMutationOptions): Promise<AppsSubmitApplicationResponse> {
    return this.http.request({
      ...requireIdempotencyKey(options),
      method: "POST",
      path: `${BASE}/rental-applications/drafts/${pathSegment(draftToken, "draftToken")}/submit`,
      body: input,
    });
  }

  async createScreeningCheckoutSession(applicationPublicId: string, input: CreateScreeningCheckoutSessionInput, options: IdempotentMutationOptions): Promise<ScreeningCheckoutSession> {
    const body = checkoutBody(input);
    return this.http.request({
      ...requireIdempotencyKey(options),
      method: "POST",
      path: `${BASE}/rental-applications/${pathSegment(applicationPublicId, "applicationPublicId")}/screening/checkout-session`,
      body,
    });
  }

  async createLeaseCheckoutSession(leasePublicId: string, input: CreateLeaseCheckoutSessionInput, options: IdempotentMutationOptions): Promise<LeaseCheckoutSession> {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
      throw new TypeError("amountCents must be a positive safe integer.");
    }
    const body = { amountCents: input.amountCents, ...checkoutBody(input) };
    return this.http.request({
      ...requireIdempotencyKey(options),
      method: "POST",
      path: `${BASE}/leases/${pathSegment(leasePublicId, "leasePublicId")}/payments/checkout-session`,
      body,
    });
  }

  /**
   * Queues a reviewed app action (service identity only). The idempotency key lives in the body, so the SDK never
   * retries this call on its own; retrying with the same `idempotencyKey` is safe.
   */
  async enqueueAppAction(input: AppActionSubmit, options: RequestOptions = {}): Promise<AppActionWork> {
    return this.http.request({ ...options, method: "POST", path: `${BASE}/app-actions`, body: input });
  }

  /** Reading completed work needs the same current installation, client and grant. */
  async getAppAction(workId: string, options: RequestOptions = {}): Promise<AppActionWork> {
    return this.http.request({ ...options, path: `${BASE}/app-actions/${pathSegment(workId, "workId")}` });
  }
}

export function createAppsClient(options: AppsClientOptions = {}): AppsClient {
  return new AppsClient(options);
}


function checkoutBody(input: { returnUrl: string; method?: PaymentMethod }) {
  validateHttpUrl(input.returnUrl, "returnUrl");
  if (input.method !== undefined && input.method !== "card" && input.method !== "ach") {
    throw new TypeError("method must be card or ach.");
  }
  return { returnUrl: input.returnUrl, ...(input.method ? { method: input.method } : {}) };
}
