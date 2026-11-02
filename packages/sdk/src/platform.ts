import { ApiClient, bearerTransport, type BearerClientOptions } from "./client.js";
import type { components } from "./generated/platform.js";
import { pathSegment } from "./internal/url.js";
import type { RequestOptions, Transport } from "./transport.js";

type Schemas = components["schemas"];

export type AppManifest = Schemas["PlatformAppManifest"];
export type ExtensionManifest = Schemas["PlatformExtensionManifest"];
export type NativePanelDocument = Schemas["PlatformNativePanelDocument"];
export type AppVersion = Schemas["PlatformAppVersionDto"];
export type AppInstallation = Schemas["PlatformAppInstallationDto"];
export type InstallAppInput = Schemas["InstallAppBody"];
export type ChangeAppGrantInput = Schemas["ChangeAppGrantBody"];
export type InstallationCredential = Schemas["PlatformInstallationCredential"];
export type MountedExtension = Schemas["PlatformMountedExtension"];
export type StaffExtensionHost = Schemas["PlatformStaffExtensionHostDto"];
export type StaffActionSubmit = Schemas["PlatformStaffActionSubmit"];
export type AvailabilityActionResult = Schemas["PlatformAvailabilityActionResult"];
export type VendorDecision = Schemas["VendorDecisionBody"];
export type VendorWithdrawal = Schemas["VendorWithdrawalBody"];
export type VendorReviewAudit = Schemas["PlatformVendorReviewAuditDto"];
export type InstallationUsage = Schemas["AppInstallationUsageDto"];
export type ReconciliationReport = Schemas["AppOperationsReconciliationReportDto"];
export type WebhookEventCatalogItem = Schemas["WebhookEventCatalogItemDto"];
export type WebhookDeliveryPolicy = Schemas["WebhookDeliveryPolicyDto"];
export type WebhookSubscription = Schemas["WebhookSubscriptionSummaryDto"];
export type CreateWebhookInput = Schemas["CreateWebhookSubscriptionDto"];
/** Returned once, on creation: `signingSecret` cannot be read again. */
export type CreatedWebhook = Schemas["WebhookSubscriptionCreatedDto"];
export type UpdateWebhookInput = Schemas["UpdateWebhookSubscriptionDto"];
export type RotatedWebhookSecret = Schemas["WebhookSecretRotatedDto"];
export type WebhookDelivery = Schemas["WebhookDeliverySummaryDto"];
export type WebhookDeadLetterItem = Schemas["WebhookDeadLetterItemDto"];
export type WebhookReplayQueued = Schemas["WebhookReplayQueuedDto"];
export type WebhookTestDelivery = Schemas["WebhookTestDeliveryDto"];

export type ExtensionContext = {
  target: "business.panel" | "business.action" | "application.panel" | "application.action" | "resident.action";
  contextType: string;
  resourcePublicId: string;
};

export type PlatformClientOptions = BearerClientOptions;

const BASE = "/api/platform/v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * App and installation management (`/api/platform/v1`). These routes need a real Unitfield staff session (a human
 * user token); installed-app tokens cannot call them. Business routes take the organization id explicitly and send it
 * as `X-Tenant-Id`; vendor routes are tenantless and need a fresh verified MFA session.
 *
 * Installation ids are the public ids (`app_…`) the API returns.
 */
export class PlatformClient extends ApiClient {
  readonly webhooks: PlatformWebhooks;

  constructor(options: PlatformClientOptions = {}) {
    super(bearerTransport(options));
    this.webhooks = new PlatformWebhooks(this.http);
  }

  // Catalog and publication

  async listAppCatalog(organizationId: string, options?: RequestOptions): Promise<AppVersion[]> {
    return this.http.request({ ...tenant(organizationId, options), path: `${BASE}/app-catalog` });
  }

  /** Global Developer publication; independent review is separate and Pending versions cannot be installed. */
  async publishAppVersion(manifest: AppManifest, options: RequestOptions = {}): Promise<AppVersion> {
    return this.http.request({ ...options, method: "POST", path: `${BASE}/app-catalog/versions`, body: manifest });
  }

  /** `manifest.appKey` is a private slug; the server returns the canonical key and immutable hash. */
  async publishPrivateAppVersion(organizationId: string, manifest: AppManifest, options?: RequestOptions): Promise<AppVersion> {
    return this.http.request({ ...tenant(organizationId, options), method: "POST", path: `${BASE}/app-catalog/private/versions`, body: manifest });
  }

  // Vendor review (tenantless)

  async listOwnVendorVersions(options: RequestOptions = {}): Promise<AppVersion[]> {
    return this.http.request({ ...options, path: `${BASE}/developer/versions` });
  }

  async listVendorReviewQueue(options: RequestOptions = {}): Promise<AppVersion[]> {
    return this.http.request({ ...options, path: `${BASE}/app-reviews` });
  }

  async listReviewedVendorVersions(options: RequestOptions = {}): Promise<AppVersion[]> {
    return this.http.request({ ...options, path: `${BASE}/app-reviews/versions` });
  }

  async decideVendorVersion(appVersionId: string, input: VendorDecision, options: RequestOptions = {}): Promise<AppVersion> {
    return this.http.request({ ...options, method: "POST", path: `${BASE}/app-reviews/${pathSegment(appVersionId, "appVersionId")}/decision`, body: input });
  }

  async withdrawVendorVersion(appVersionId: string, input: VendorWithdrawal, options: RequestOptions = {}): Promise<AppVersion> {
    return this.http.request({ ...options, method: "POST", path: `${BASE}/developer/versions/${pathSegment(appVersionId, "appVersionId")}/withdraw`, body: input });
  }

  async getVendorReviewAudit(appVersionId: string, options: RequestOptions = {}): Promise<VendorReviewAudit[]> {
    return this.http.request({ ...options, path: `${BASE}/developer/versions/${pathSegment(appVersionId, "appVersionId")}/audit` });
  }

  // Installations (the install and grant steps preserve the exact manifest hash and approved scopes)

  async listAppInstallations(organizationId: string, options?: RequestOptions): Promise<AppInstallation[]> {
    return this.http.request({ ...tenant(organizationId, options), path: `${BASE}/app-installations` });
  }

  async installApp(organizationId: string, input: InstallAppInput, options?: RequestOptions): Promise<AppInstallation> {
    return this.http.request({ ...tenant(organizationId, options), method: "POST", path: `${BASE}/app-installations`, body: input });
  }

  /** Changes use `expectedGeneration`; these endpoints take no idempotency header. */
  async changeAppGrant(organizationId: string, installationId: string, input: ChangeAppGrantInput, options?: RequestOptions): Promise<AppInstallation> {
    return this.http.request({ ...tenant(organizationId, options), method: "PUT", path: `${BASE}/app-installations/${pathSegment(installationId, "installationId")}/grant`, body: input });
  }

  async disableApp(organizationId: string, installationId: string, expectedGeneration: number, uninstall = false, options?: RequestOptions): Promise<AppInstallation> {
    return this.http.request({
      ...tenant(organizationId, options),
      method: "POST",
      path: `${BASE}/app-installations/${pathSegment(installationId, "installationId")}/disable`,
      body: { expectedGeneration, uninstall },
    });
  }

  async reconcileApp(organizationId: string, installationId: string, options?: RequestOptions): Promise<AppInstallation> {
    return this.http.request({ ...tenant(organizationId, options), method: "POST", path: `${BASE}/app-installations/${pathSegment(installationId, "installationId")}/reconcile` });
  }

  /** One-time private-app credential export. Needs fresh verified MFA and both publisher and installer authority. Never call it automatically. */
  async exportPrivateAppCredential(organizationId: string, installationId: string, expectedGeneration: number, options?: RequestOptions): Promise<InstallationCredential> {
    return this.http.request({
      ...tenant(organizationId, options),
      method: "POST",
      path: `${BASE}/app-installations/${pathSegment(installationId, "installationId")}/credentials/export`,
      body: { expectedGeneration },
    });
  }

  async listAppExtensions(organizationId: string, installationId: string, context: ExtensionContext, options?: RequestOptions): Promise<MountedExtension[]> {
    return this.http.request({
      ...tenant(organizationId, options),
      path: `${BASE}/app-installations/${pathSegment(installationId, "installationId")}/extensions`,
      query: { ...context },
    });
  }

  async getInstallationUsage(organizationId: string, installationId: string, options?: RequestOptions): Promise<InstallationUsage> {
    return this.http.request({ ...tenant(organizationId, options), path: `${BASE}/app-installations/${pathSegment(installationId, "installationId")}/usage` });
  }

  async getReconciliationReport(organizationId: string, options?: RequestOptions): Promise<ReconciliationReport> {
    return this.http.request({ ...tenant(organizationId, options), path: `${BASE}/app-installations/reconciliation` });
  }

  // Native staff extension hosts

  async getBusinessExtensionActions(organizationId: string, options?: RequestOptions): Promise<StaffExtensionHost> {
    return this.http.request({ ...tenant(organizationId, options), path: `${BASE}/extension-hosts/business-actions` });
  }

  async getApplicationExtensions(organizationId: string, applicationId: string, options?: RequestOptions): Promise<StaffExtensionHost> {
    return this.http.request({ ...tenant(organizationId, options), path: `${BASE}/extension-hosts/applications/${pathSegment(applicationId, "applicationId")}` });
  }

  async executeBusinessExtensionAction(organizationId: string, installationId: string, extensionKey: string, input: StaffActionSubmit, options?: RequestOptions): Promise<AvailabilityActionResult> {
    return this.http.request({
      ...tenant(organizationId, options),
      method: "POST",
      path: `${BASE}/extension-hosts/business/actions/${pathSegment(installationId, "installationId")}/${pathSegment(extensionKey, "extensionKey")}`,
      body: input,
    });
  }

  async executeApplicationExtensionAction(organizationId: string, applicationId: string, installationId: string, extensionKey: string, input: StaffActionSubmit, options?: RequestOptions): Promise<AvailabilityActionResult> {
    return this.http.request({
      ...tenant(organizationId, options),
      method: "POST",
      path: `${BASE}/extension-hosts/applications/${pathSegment(applicationId, "applicationId")}/actions/${pathSegment(installationId, "installationId")}/${pathSegment(extensionKey, "extensionKey")}`,
      body: input,
    });
  }
}

export function createPlatformClient(options: PlatformClientOptions = {}): PlatformClient {
  return new PlatformClient(options);
}

/** Webhook subscriptions of one installed app. Verify deliveries with `verifyWebhook` from `@unitfield/sdk/server`. */
class PlatformWebhooks {
  readonly #http: Transport;
  constructor(http: Transport) {
    this.#http = http;
  }

  /** The event names an installation may subscribe to. */
  async catalog(organizationId: string, options?: RequestOptions): Promise<WebhookEventCatalogItem[]> {
    return this.#http.request({ ...tenant(organizationId, options), path: `${BASE}/webhook-events` });
  }

  /** Retry, timeout and auto-disable policy. Read it instead of hard-coding it. */
  async policy(organizationId: string, options?: RequestOptions): Promise<WebhookDeliveryPolicy> {
    return this.#http.request({ ...tenant(organizationId, options), path: `${BASE}/webhook-policy` });
  }

  async list(organizationId: string, installationId: string, options?: RequestOptions): Promise<WebhookSubscription[]> {
    return this.#http.request({ ...tenant(organizationId, options), path: this.#path(installationId) });
  }

  /** The response carries the signing secret once. Store it immediately. */
  async create(organizationId: string, installationId: string, input: CreateWebhookInput, options?: RequestOptions): Promise<CreatedWebhook> {
    return this.#http.request({ ...tenant(organizationId, options), method: "POST", path: this.#path(installationId), body: input });
  }

  async get(organizationId: string, installationId: string, webhookPublicId: string, options?: RequestOptions): Promise<WebhookSubscription> {
    return this.#http.request({ ...tenant(organizationId, options), path: this.#path(installationId, webhookPublicId) });
  }

  async update(organizationId: string, installationId: string, webhookPublicId: string, input: UpdateWebhookInput, options?: RequestOptions): Promise<WebhookSubscription> {
    return this.#http.request({ ...tenant(organizationId, options), method: "PUT", path: this.#path(installationId, webhookPublicId), body: input });
  }

  async delete(organizationId: string, installationId: string, webhookPublicId: string, options?: RequestOptions): Promise<void> {
    return this.#http.request({ ...tenant(organizationId, options), method: "DELETE", path: this.#path(installationId, webhookPublicId), response: "none" });
  }

  /** Issues a new signing secret, shown once. The old one stops working. */
  async rotateSecret(organizationId: string, installationId: string, webhookPublicId: string, options?: RequestOptions): Promise<RotatedWebhookSecret> {
    return this.#http.request({ ...tenant(organizationId, options), method: "POST", path: `${this.#path(installationId, webhookPublicId)}/rotate-secret` });
  }

  /** Sends a `webhook.test` delivery. */
  async test(organizationId: string, installationId: string, webhookPublicId: string, options?: RequestOptions): Promise<WebhookTestDelivery> {
    return this.#http.request({ ...tenant(organizationId, options), method: "POST", path: `${this.#path(installationId, webhookPublicId)}/test` });
  }

  async deliveries(organizationId: string, installationId: string, webhookPublicId: string, query: { limit?: number } = {}, options?: RequestOptions): Promise<WebhookDelivery[]> {
    return this.#http.request({ ...tenant(organizationId, options), path: `${this.#path(installationId, webhookPublicId)}/deliveries`, query });
  }

  async deadLetter(organizationId: string, installationId: string, webhookPublicId: string, query: { limit?: number } = {}, options?: RequestOptions): Promise<WebhookDeadLetterItem[]> {
    return this.#http.request({ ...tenant(organizationId, options), path: `${this.#path(installationId, webhookPublicId)}/dead-letter`, query });
  }

  /** Requeues a failed delivery. Deliveries denied by policy (a revoked grant) cannot be replayed. */
  async replay(organizationId: string, installationId: string, webhookPublicId: string, deliveryId: string, options?: RequestOptions): Promise<WebhookReplayQueued> {
    return this.#http.request({
      ...tenant(organizationId, options),
      method: "POST",
      path: `${this.#path(installationId, webhookPublicId)}/deliveries/${pathSegment(deliveryId, "deliveryId")}/replay`,
    });
  }

  #path(installationId: string, webhookPublicId?: string): string {
    const base = `${BASE}/app-installations/${pathSegment(installationId, "installationId")}/webhooks`;
    return webhookPublicId === undefined ? base : `${base}/${pathSegment(webhookPublicId, "webhookPublicId")}`;
  }
}

/** Business context is always explicit: the SDK sets `X-Tenant-Id` itself and overrides any header the caller passed. */
function tenant(organizationId: string, options: RequestOptions = {}): RequestOptions {
  if (typeof organizationId !== "string" || !UUID.test(organizationId)) throw new TypeError("organizationId must be a UUID.");
  const headers = new Headers(options.headers);
  headers.set("X-Tenant-Id", organizationId);
  return { ...options, headers };
}
