// What the site publishes of the API, and how it is described. The operations come from the committed OpenAPI snapshots
// (packages/sdk/openapi/*.json); everything here is editorial: titles, who calls what, which operations stay out.
//
// To publish or hide something, change this file. Nothing else decides it.

export type OperationRecord = { path: string; method: string; operation: Record<string, any> };

export interface Surface {
  /** Snapshot file name and URL segment: /reference/{id}. */
  id: string;
  title: string;
  /** One or two sentences: who calls this API and how. */
  summary: string;
  /** The SDK client that wraps it, if there is one. */
  client?: string;
  /** Pick the sidebar group (a folder) of an operation. */
  group: (record: OperationRecord) => string;
  /** Group titles, in the order they appear. Groups that are not listed come last. */
  groupOrder: string[];
  /** Shown as a notice on every page of the surface. */
  notice?: string;
}

/** Operations the public site never documents. Each rule names why, so the filter report reads as a list of decisions. */
export const DENY_RULES: { reason: string; matches: (record: OperationRecord) => boolean }[] = [
  {
    reason: "customer-auth Hydra provider hooks (Unitfield's own sign-in issuer calls them)",
    matches: ({ path }) => /^\/api\/customer-auth\/v1\/hydra\//.test(path),
  },
  {
    reason: "vendor review queue and decisions (Unitfield staff only)",
    matches: ({ path, operation }) => path.startsWith("/api/platform/v1/app-reviews") || (operation.tags ?? []).includes("Platform vendor review"),
  },
  {
    reason: "vendor developer lane: own versions, review history, withdrawal and credential delivery (global vendor roles, not the public SDK surface)",
    matches: ({ path, operation }) => path.startsWith("/api/platform/v1/developer/") || (operation.tags ?? []).includes("Platform vendor apps"),
  },
  {
    reason: "extension-host routes (Unitfield's own dashboard hosts extensions through them)",
    matches: ({ path }) => path.startsWith("/api/platform/v1/extension-hosts/"),
  },
];

/** Words that must never reach a published page, in any operation, schema or description. The build fails if one does. */
export const FORBIDDEN_IN_OUTPUT = /\bhydra\b|\bkratos\b|app-reviews|extension-hosts|-dev\.unitfield\.|api-dev\.|id-dev\.|auth-dev\.|127\.0\.0\.1:47\d\d|localhost:47\d\d/i;

const first = (path: string, prefix: string) => path.slice(prefix.length).split("/").filter(Boolean)[0] ?? "";

export const SURFACES: Surface[] = [
  {
    id: "storefront",
    title: "Storefront API",
    summary: "Public reads of your site and homes, and the inquiry and tour endpoints. Send your publishable key in `X-Unitfield-Key`.",
    client: "StorefrontClient",
    groupOrder: ["Site", "Listings", "Properties", "Inquiries", "Tours"],
    group: ({ path }) => {
      const segment = first(path, "/api/storefront/v1/");
      if (segment === "listings") return "Listings";
      if (segment === "properties") return "Properties";
      if (segment === "inquiries") return "Inquiries";
      if (segment === "tours" || segment === "tour-windows") return "Tours";
      return "Site";
    },
  },
  {
    id: "customer",
    title: "Customer API",
    summary: "What a signed-in customer does: rental applications, and the resident documents they accept. Bearer customer access token.",
    client: "ApplicantClient",
    groupOrder: ["Applications", "Resident legal terms"],
    group: ({ operation }) => ((operation.tags ?? []).includes("customer-resident-legal") ? "Resident legal terms" : "Applications"),
  },
  {
    id: "resident",
    title: "Resident API",
    summary: "A resident's own leases, payments, requests and profile. Bearer token of a signed-in customer or resident.",
    client: "ResidentClient",
    groupOrder: ["Profile", "Leases", "Payments", "Requests", "Renewals", "Notifications", "Legal terms"],
    group: ({ path }) => {
      if (path.startsWith("/api/resident/v1/legal")) return "Legal terms";
      const segment = first(path, "/api/v1/resident/");
      if (segment === "leases") return "Leases";
      if (segment === "payments") return "Payments";
      if (segment === "requests") return "Requests";
      if (segment === "renewals") return "Renewals";
      if (segment === "notifications" || segment === "notification-preferences") return "Notifications";
      return "Profile";
    },
  },
  {
    id: "apps",
    title: "Installed apps API",
    summary: "What an installed app calls with its client credentials, within the scopes its installation was granted.",
    client: "AppsClient",
    groupOrder: ["Organization", "Listings", "Rental applications", "Payments", "Actions"],
    group: ({ operation }) => String((operation.tags ?? ["Apps Organization"])[0]).replace(/^Apps /, "").replace(/^Rental Applications$/, "Rental applications"),
  },
  {
    id: "platform",
    title: "App management API",
    summary: "Catalog, installations, grants and webhook subscriptions. These need a signed-in Unitfield staff user; an installed app's token cannot call them.",
    client: "PlatformClient",
    groupOrder: ["Apps and installations", "Webhook subscriptions", "Usage and reconciliation"],
    group: ({ operation }) => {
      const tag = String((operation.tags ?? [])[0] ?? "");
      if (tag === "App Webhooks") return "Webhook subscriptions";
      if (tag === "App Usage" || tag === "App Operations") return "Usage and reconciliation";
      return "Apps and installations";
    },
  },
  {
    id: "customer-auth",
    title: "Customer auth API",
    summary: "Sign-in challenges, sessions and account changes for customers.",
    groupOrder: ["Sign-in and sessions"],
    group: () => "Sign-in and sessions",
    notice:
      "First-party servers only. Unitfield's own storefront calls this API with signed service requests. Browsers and SDK sites never call it, and the SDK has no client for it. It is listed here for completeness: to sign customers in on your own site, use [customer sign-in with PKCE](/docs/customer-sign-in).",
  },
];

/** Storefront operations are described by hand: the snapshot's own text is generated from the operation ids. */
export const STOREFRONT_TEXT: Record<string, { summary: string; description: string; sdk: string }> = {
  Storefront_ResolveHost: {
    summary: "Resolve a host",
    description:
      "Finds the site that serves a host name: an organization address such as `{slug}.unitfield.app`, or a custom domain. It is the one Storefront operation that needs no key. It is limited per visitor address and cached for 30 seconds.", sdk: "storefront.hosts.resolve"
  },
  Storefront_GetSite: {
    summary: "Get the site",
    description: "Your site's brand, theme, settings, navigation and page index, its hosted URLs (apply, sign-in and account) and its contact details.", sdk: "storefront.site.get"
  },
  Storefront_GetPage: { summary: "Get a page", description: "The published page document for a slug of the site.", sdk: "storefront.pages.get" },
  Storefront_ListListings: {
    summary: "List listings",
    description:
      "The homes you have published and that are available now or soon. Filter by bedrooms, bathrooms, rent, availability date, property or city; sort by newest, rent or availability. Pages are cursor based, with at most 50 items. Every item has an `applyUrl`, or `null` when applications are closed.", sdk: "storefront.listings.list"
  },
  Storefront_GetListing: {
    summary: "Get a listing",
    description: "One listing in full: description, address, photos, amenities, availability and a summary of its property. Use the `listingPublicId` that every list item carries.", sdk: "storefront.listings.get"
  },
  Storefront_ListProperties: { summary: "List properties", description: "Property cards with their public gallery and address. Pages are cursor based.", sdk: "storefront.properties.list" },
  Storefront_GetProperty: { summary: "Get a property", description: "One property with its headline, description, public gallery, address and its listings.", sdk: "storefront.properties.get" },
  Storefront_CreateInquiry: {
    summary: "Send an inquiry",
    description:
      "Sends a contact or tour inquiry. Staff see it as a prospect in People and are notified. The API answers `202` for every accepted request, including one whose Turnstile check failed: nothing is created then, and the response does not say so. Limited to 5 per hour for each key and address, and 100 per day for each key.", sdk: "storefront.inquiries.create"
  },
  Storefront_GetTourWindows: { summary: "List tour windows", description: "The days and times a visitor can pick from when asking for a tour, for the organization or for one listing.", sdk: "storefront.tours.windows" },
  Storefront_ViewTour: { summary: "View a tour", description: "Reads one tour behind its private token. An unknown, expired, revoked or foreign token is one uniform `404`. Limited per visitor address.", sdk: "storefront.tours.view" },
  Storefront_AnswerTour: { summary: "Answer a tour", description: "Records a visitor's answer to a tour: accept a proposed time, say they are coming or cannot make it, pick a time or cancel. It works behind the tour's private token. An unknown, expired, revoked or foreign token is one uniform `404`. Limited per visitor address.", sdk: "storefront.tours.answer" },
  Storefront_TourIcs: { summary: "Download a tour calendar file", description: "The tour as an iCalendar file (`text/calendar`), behind its private token. Limited per visitor address.", sdk: "storefront.tours.icsUrl" },
};
