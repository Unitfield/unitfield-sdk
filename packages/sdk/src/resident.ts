import { ApiClient, bearerTransport, type BearerClientOptions } from "./client.js";
import type { components } from "./generated/resident.js";
import { requireIdempotencyKey, type IdempotentMutationOptions, type MutationOptions, type RequestOptions, type Transport } from "./transport.js";
import { pathSegment } from "./internal/url.js";

type Schemas = components["schemas"];

export type ResidentContext = Schemas["ResidentAppContextDto"];
export type ResidentLeaseSummary = Schemas["ResidentLeaseSummaryDto"];
export type ResidentLease = Schemas["ResidentLeaseDetailDto"];
export type ResidentLeaseBalance = Schemas["ResidentLeaseBalanceDto"];
export type ResidentLeaseStatement = Schemas["ResidentLeaseStatementDto"];
export type ResidentDocument = Schemas["ResidentDocumentDto"];
export type ResidentFileDownload = Schemas["ResidentFileDownloadDto"];
export type ResidentPayment = Schemas["ResidentPaymentDto"];
export type ResidentPaymentOverview = Schemas["ResidentPaymentOverviewDto"];
export type ResidentPaymentReceipt = Schemas["ResidentPaymentReceiptDto"];
export type ResidentPaymentCreateInput = Schemas["ResidentPaymentCreateRequest"];
export type ResidentPaymentCreated = Schemas["ResidentPaymentCreateResponse"];
export type ResidentAutoPayPreviewInput = Schemas["ResidentAutoPayAuthorizationPreviewRequest"];
export type ResidentAutoPayPreview = Schemas["ResidentAutoPayAuthorizationPreviewDto"];
export type ResidentAutoPaySetupInput = Schemas["ResidentAutoPaySetupRequest"];
export type ResidentAutoPaySetup = Schemas["ResidentAutoPaySetupResponse"];
export type ResidentAutoPayCompleteInput = Schemas["ResidentAutoPayCompleteRequest"];
export type ResidentAutoPay = Schemas["ResidentAutoPaySummaryDto"];
export type ResidentRequest = Schemas["ResidentRequestDto"];
export type ResidentRequestCreateInput = Schemas["ResidentRequestCreateRequest"];
export type ResidentRequestNoteInput = Schemas["ResidentRequestNoteRequest"];
export type ResidentRequestFilesInput = Schemas["ResidentRequestFilesRequest"];
export type ResidentRequestFileUploadSessionInput = Schemas["ResidentRequestFileUploadSessionRequest"];
export type ResidentRequestFileUploadSession = Schemas["ResidentRequestFileUploadSessionDto"];
export type ResidentRequestFileUploadCompletionInput = Schemas["ResidentRequestFileUploadCompletionRequest"];
export type ResidentRequestAttachment = Schemas["TaskAttachmentDto"];
export type ResidentRenewalSummary = Schemas["ResidentRenewalSummaryDto"];
export type ResidentRenewal = Schemas["RenewalCaseDetailDto"];
export type ResidentRenewalAcceptInput = Schemas["ResidentRenewalAcceptRequest"];
export type ResidentRenewalDecision = Schemas["RenewalCaseDecisionResultDto"];
export type ResidentProfilePatch = Schemas["ResidentProfilePatchRequest"];
export type ResidentNotificationPreference = Schemas["ResidentNotificationPreferenceDto"];
export type ResidentNotificationPreferencesPatch = Schemas["ResidentNotificationPreferencesPatchRequest"];
export type ResidentNotifications = Schemas["ResidentInAppNotificationsResponse"];
export type ResidentLegalReadiness = Schemas["ResidentLegalReadinessResponse"];
export type ResidentExtensionActions = Schemas["PlatformResidentActionHost"];
export type ResidentExtensionActionInput = Schemas["PlatformResidentActionSubmit"];
export type ResidentExtensionActionResult = Schemas["PlatformResidentActionResult"];

export type ResidentClientOptions = BearerClientOptions;

const BASE = "/api/v1/resident";

/**
 * The signed-in resident's own data (`/api/v1/resident`). Authenticate with a customer-realm token: pass
 * `session.tokenProvider` from a `CustomerSession`. The organization comes from the token's `org` claim; there is
 * nothing to select and no header to forge. A person only ever sees leases they have an active link to.
 *
 * Write paths for customer principals are being finished server-side; until then they answer 403
 * `customer_account_not_supported` (a `PermissionError`).
 */
export class ResidentClient extends ApiClient {
  readonly leases: ResidentLeases;
  readonly payments: ResidentPayments;
  readonly autopay: ResidentAutoPayResource;
  readonly requests: ResidentRequests;
  readonly renewals: ResidentRenewals;
  readonly notifications: ResidentNotificationsResource;
  readonly extensionActions: ResidentExtensionActionsResource;

  constructor(options: ResidentClientOptions = {}) {
    super(bearerTransport(options));
    this.leases = new ResidentLeases(this.http);
    this.payments = new ResidentPayments(this.http);
    this.autopay = new ResidentAutoPayResource(this.http);
    this.requests = new ResidentRequests(this.http);
    this.renewals = new ResidentRenewals(this.http);
    this.notifications = new ResidentNotificationsResource(this.http);
    this.extensionActions = new ResidentExtensionActionsResource(this.http);
  }

  /** Who is signed in and which homes they can see. `leaseId` selects the active lease. */
  async context(query: { leaseId?: string } = {}, options: RequestOptions = {}): Promise<ResidentContext> {
    return this.http.request<ResidentContext>({ ...options, path: `${BASE}/context`, query });
  }

  async getProfile(options: RequestOptions = {}): Promise<unknown> {
    return this.http.request<unknown>({ ...options, path: `${BASE}/profile` });
  }

  async updateProfile(patch: ResidentProfilePatch, options: RequestOptions = {}): Promise<void> {
    return this.http.request<void>({ ...options, method: "PATCH", path: `${BASE}/profile`, body: patch, response: "none" });
  }

  async getNotificationPreferences(options: RequestOptions = {}): Promise<ResidentNotificationPreference[]> {
    return this.http.request({ ...options, path: `${BASE}/notification-preferences` });
  }

  async updateNotificationPreferences(patch: ResidentNotificationPreferencesPatch, options: RequestOptions = {}): Promise<ResidentNotificationPreference[]> {
    return this.http.request({ ...options, method: "PATCH", path: `${BASE}/notification-preferences`, body: patch });
  }

  /** Legal documents the portal must show before first use. */
  async legal(options: RequestOptions = {}): Promise<ResidentLegalReadiness> {
    return this.http.request({ ...options, path: "/api/resident/v1/legal" });
  }
}

export function createResidentClient(options: ResidentClientOptions = {}): ResidentClient {
  return new ResidentClient(options);
}

class Resource {
  protected readonly http: Transport;
  constructor(http: Transport) {
    this.http = http;
  }
}

class ResidentLeases extends Resource {
  async list(options: RequestOptions = {}): Promise<ResidentLeaseSummary[]> {
    return this.http.request({ ...options, path: `${BASE}/leases` });
  }
  async get(leaseId: string, options: RequestOptions = {}): Promise<ResidentLease> {
    return this.http.request({ ...options, path: `${BASE}/leases/${pathSegment(leaseId, "leaseId")}` });
  }
  async balance(leaseId: string, options: RequestOptions = {}): Promise<ResidentLeaseBalance> {
    return this.http.request({ ...options, path: `${BASE}/leases/${pathSegment(leaseId, "leaseId")}/balance` });
  }
  /** Charges and payments between `from` and `to` (dates, inclusive). */
  async statement(leaseId: string, range: { from?: string | Date; to?: string | Date } = {}, options: RequestOptions = {}): Promise<ResidentLeaseStatement> {
    return this.http.request({ ...options, path: `${BASE}/leases/${pathSegment(leaseId, "leaseId")}/statement`, query: range });
  }
  async documents(leaseId: string, options: RequestOptions = {}): Promise<ResidentDocument[]> {
    return this.http.request({ ...options, path: `${BASE}/leases/${pathSegment(leaseId, "leaseId")}/documents` });
  }
  /** A short-lived download link for one lease document. */
  async downloadDocument(leaseId: string, fileId: string, options: RequestOptions = {}): Promise<ResidentFileDownload> {
    return this.http.request({
      ...options,
      path: `${BASE}/leases/${pathSegment(leaseId, "leaseId")}/documents/${pathSegment(fileId, "fileId")}/download`,
    });
  }
}

class ResidentPayments extends Resource {
  async list(options: RequestOptions = {}): Promise<ResidentPayment[]> {
    return this.http.request({ ...options, path: `${BASE}/payments` });
  }
  async overview(options: RequestOptions = {}): Promise<ResidentPaymentOverview> {
    return this.http.request({ ...options, path: `${BASE}/payments/overview` });
  }
  async get(paymentId: string, options: RequestOptions = {}): Promise<ResidentPayment> {
    return this.http.request({ ...options, path: `${BASE}/payments/${pathSegment(paymentId, "paymentId")}` });
  }
  async receipt(paymentId: string, options: RequestOptions = {}): Promise<ResidentPaymentReceipt> {
    return this.http.request({ ...options, path: `${BASE}/payments/${pathSegment(paymentId, "paymentId")}/receipt` });
  }
  /** Moves money, so the idempotency key is required: reuse it when you retry the same payment. */
  async create(leaseId: string, input: ResidentPaymentCreateInput, options: IdempotentMutationOptions): Promise<ResidentPaymentCreated> {
    return this.http.request({
      ...requireIdempotencyKey(options),
      method: "POST",
      path: `${BASE}/leases/${pathSegment(leaseId, "leaseId")}/payments`,
      body: input,
    });
  }
}

class ResidentAutoPayResource extends Resource {
  async preview(leaseId: string, input: ResidentAutoPayPreviewInput, options: RequestOptions = {}): Promise<ResidentAutoPayPreview> {
    return this.http.request({ ...options, method: "POST", path: `${BASE}/leases/${pathSegment(leaseId, "leaseId")}/autopay/authorization-preview`, body: input });
  }
  /** Starts AutoPay. Needs a recent step-up; the idempotency key is required. */
  async setup(leaseId: string, input: ResidentAutoPaySetupInput, options: IdempotentMutationOptions): Promise<ResidentAutoPaySetup> {
    return this.http.request({ ...requireIdempotencyKey(options), method: "POST", path: `${BASE}/leases/${pathSegment(leaseId, "leaseId")}/autopay/setup`, body: input });
  }
  async complete(leaseId: string, input: ResidentAutoPayCompleteInput, options: RequestOptions = {}): Promise<ResidentAutoPay> {
    return this.http.request({ ...options, method: "POST", path: `${BASE}/leases/${pathSegment(leaseId, "leaseId")}/autopay/complete`, body: input });
  }
  async revoke(leaseId: string, options: RequestOptions = {}): Promise<void> {
    return this.http.request({ ...options, method: "POST", path: `${BASE}/leases/${pathSegment(leaseId, "leaseId")}/autopay/revoke`, response: "none" });
  }
}

class ResidentRequests extends Resource {
  async list(options: RequestOptions = {}): Promise<ResidentRequest[]> {
    return this.http.request({ ...options, path: `${BASE}/requests` });
  }
  async get(requestId: string, options: RequestOptions = {}): Promise<ResidentRequest> {
    return this.http.request({ ...options, path: `${BASE}/requests/${pathSegment(requestId, "requestId")}` });
  }
  /** Opens a request. Resolves to the new request's id. Pass `idempotencyKey: true` to make a double submit harmless. */
  async create(input: ResidentRequestCreateInput, options: MutationOptions = {}): Promise<string> {
    return this.http.request({ ...options, method: "POST", path: `${BASE}/requests`, body: input });
  }
  async sendMessage(requestId: string, input: ResidentRequestNoteInput, options: RequestOptions = {}): Promise<void> {
    return this.http.request({ ...options, method: "POST", path: `${BASE}/requests/${pathSegment(requestId, "requestId")}/messages`, body: input, response: "none" });
  }
  async addNote(requestId: string, input: ResidentRequestNoteInput, options: RequestOptions = {}): Promise<void> {
    return this.http.request({ ...options, method: "POST", path: `${BASE}/requests/${pathSegment(requestId, "requestId")}/notes`, body: input, response: "none" });
  }
  async reopen(requestId: string, options: RequestOptions = {}): Promise<void> {
    return this.http.request({ ...options, method: "POST", path: `${BASE}/requests/${pathSegment(requestId, "requestId")}:reopen`, response: "none" });
  }
  async askAnotherTime(requestId: string, options: RequestOptions = {}): Promise<void> {
    return this.http.request({ ...options, method: "POST", path: `${BASE}/requests/${pathSegment(requestId, "requestId")}:ask-another-time`, response: "none" });
  }
  async attachFiles(requestId: string, input: ResidentRequestFilesInput, options: RequestOptions = {}): Promise<ResidentRequestAttachment[]> {
    return this.http.request({ ...options, method: "POST", path: `${BASE}/requests/${pathSegment(requestId, "requestId")}/files`, body: input });
  }
  /** Step one of a direct upload: ask where to PUT the bytes. */
  async createUploadSession(requestId: string, input: ResidentRequestFileUploadSessionInput, options: RequestOptions = {}): Promise<ResidentRequestFileUploadSession> {
    return this.http.request({ ...options, method: "POST", path: `${BASE}/requests/${pathSegment(requestId, "requestId")}/files/upload-sessions`, body: input });
  }
  /** Step three: tell the API the upload finished. */
  async completeUpload(requestId: string, sessionId: string, input: ResidentRequestFileUploadCompletionInput, options: RequestOptions = {}): Promise<ResidentRequestAttachment> {
    return this.http.request({
      ...options,
      method: "POST",
      path: `${BASE}/requests/${pathSegment(requestId, "requestId")}/files/upload-sessions/${pathSegment(sessionId, "sessionId")}/complete`,
      body: input,
    });
  }
  async downloadFile(requestId: string, fileId: string, options: RequestOptions = {}): Promise<ResidentFileDownload> {
    return this.http.request({ ...options, path: `${BASE}/requests/${pathSegment(requestId, "requestId")}/files/${pathSegment(fileId, "fileId")}/download` });
  }
}

class ResidentRenewals extends Resource {
  async list(options: RequestOptions = {}): Promise<ResidentRenewalSummary[]> {
    return this.http.request({ ...options, path: `${BASE}/renewals` });
  }
  async get(caseId: string, options: RequestOptions = {}): Promise<ResidentRenewal> {
    return this.http.request({ ...options, path: `${BASE}/renewals/${pathSegment(caseId, "caseId")}` });
  }
  async accept(caseId: string, input: ResidentRenewalAcceptInput, options: MutationOptions = {}): Promise<ResidentRenewalDecision> {
    return this.http.request({ ...options, method: "POST", path: `${BASE}/renewals/${pathSegment(caseId, "caseId")}/accept`, body: input });
  }
  async decline(caseId: string, options: RequestOptions = {}): Promise<ResidentRenewalDecision> {
    return this.http.request({ ...options, method: "POST", path: `${BASE}/renewals/${pathSegment(caseId, "caseId")}/decline` });
  }
}

class ResidentNotificationsResource extends Resource {
  async list(query: { isRead?: boolean; page?: number; pageSize?: number } = {}, options: RequestOptions = {}): Promise<ResidentNotifications> {
    return this.http.request({ ...options, path: `${BASE}/notifications`, query });
  }
  async markRead(notificationId: string, options: RequestOptions = {}): Promise<void> {
    return this.http.request({ ...options, method: "PATCH", path: `${BASE}/notifications/${pathSegment(notificationId, "notificationId")}/read`, response: "none" });
  }
  /** Resolves to the number of notifications marked read. */
  async markAllRead(options: RequestOptions = {}): Promise<number | string> {
    return this.http.request({ ...options, method: "PATCH", path: `${BASE}/notifications/read-all` });
  }
}

class ResidentExtensionActionsResource extends Resource {
  async list(leaseId: string, options: RequestOptions = {}): Promise<ResidentExtensionActions> {
    return this.http.request({ ...options, path: `${BASE}/leases/${pathSegment(leaseId, "leaseId")}/extension-actions` });
  }
  /** Runs an installed app's resident action. The body's `clientIntentId` makes the operation idempotent; the SDK adds no header. */
  async execute(leaseId: string, installationId: string, extensionKey: string, input: ResidentExtensionActionInput, options: RequestOptions = {}): Promise<ResidentExtensionActionResult> {
    return this.http.request({
      ...options,
      method: "POST",
      path: `${BASE}/leases/${pathSegment(leaseId, "leaseId")}/extension-actions/${pathSegment(installationId, "installationId")}/${pathSegment(extensionKey, "extensionKey")}`,
      body: input,
    });
  }
}

