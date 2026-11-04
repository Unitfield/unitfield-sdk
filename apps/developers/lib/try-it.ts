import { getPublicApi } from "./public-api/load";
import { STOREFRONT_TEXT } from "./public-api/surfaces";
import { referenceUrl } from "./source";

// "Try it out" on the home page: five Storefront operations, each with a request and an example response.
//
// The site is static, so nothing is sent from the page. The published OpenAPI documents carry no `example` values, so the example
// responses are written here, and every one is checked against the schema it claims to be: a field the schema does not have, or a
// required field that is missing, stops the build. The request is checked the same way (its query parameters and body fields), and
// the SDK call must be the method the operation is documented with. An example cannot drift from the API without the build saying so.

const API_ROOT = "https://api.unitfield.com";
const KEY = "pk_test_…";

type Json = Record<string, any>;

export interface TryItOperation {
  id: string;
  method: string;
  /** The short path on the list: `/listings/{id}`. */
  label: string;
  name: string;
  description: string;
  href: string;
  status: string;
  curl: string;
  sdk: string;
  response: unknown;
}

// ---- example data: obviously fake, low entropy. Ids are the placeholders the webhook guide uses (`lst_sample`). -------------

const card = {
  listingPublicId: "lst_sample",
  unitPublicId: "unt_sample",
  unitPublicKey: "cedar-court-2b",
  propertyPublicId: "prp_sample",
  title: "Cedar Court 2B",
  propertyName: "Cedar Court",
  unitName: "2B",
  bedrooms: 2,
  bathrooms: 1,
  areaSqft: 880,
  rent: 1850,
  currency: "USD",
  rentPeriod: "monthly",
  availableFrom: "2026-12-01",
  acceptsApplications: true,
  applyUrl: "https://example-rentals.unitfield.app/apply/cedar-court-2b",
  city: "Austin",
  state: "TX",
  coverImageUrl: "https://example.com/photos/cedar-court-2b.jpg",
  latitude: 30.2672,
  longitude: -97.7431,
};

const secondCard = {
  ...card,
  listingPublicId: "lst_sample_2",
  unitPublicId: "unt_sample_2",
  unitPublicKey: "pier-street-5",
  title: "Pier Street 5",
  propertyName: "Pier Street",
  unitName: "5",
  bathrooms: 2,
  areaSqft: 960,
  rent: 2140,
  applyUrl: "https://example-rentals.unitfield.app/apply/pier-street-5",
  coverImageUrl: "https://example.com/photos/pier-street-5.jpg",
};

const siteExample = {
  siteId: "site_sample",
  status: "published",
  revision: 12,
  themeId: "theme_sample",
  themeVersion: "1.0.0",
  settings: {},
  navigation: { header: [{ label: "Homes", pageId: null, url: "/homes" }], footer: [] },
  pages: [{ id: "page_sample", kind: "page", slug: "index", title: "Home" }],
  brand: { name: "Example Rentals", slug: "example-rentals", logoUrl: null, primaryColor: "#2f6fed", themeMode: "light", brandHeaderBackground: false },
  contact: { email: "hello@example.com", phone: "555-0100" },
  hostedUrls: {
    applyBaseUrl: "https://example-rentals.unitfield.app/apply",
    signInUrl: "https://example-rentals.unitfield.app/sign-in",
    accountUrl: "https://example-rentals.unitfield.app/account",
  },
  primaryHost: "example-rentals.unitfield.app",
  isPreview: false,
  turnstileSiteKey: null,
};

const photos = (alt: string) => [{ url: "https://example.com/photos/cedar-court-2b.jpg", alt, isCover: true }];

const listingExample = {
  card: { ...card, publishedAt: "2026-11-02T17:00:00Z" },
  description: "A bright two-bedroom on the second floor, with a balcony and laundry in the unit.",
  address1: "12 Cedar Court",
  postalCode: "78701",
  country: "US",
  photos: photos("Living room"),
  amenities: ["Balcony", "In-unit laundry", "Dishwasher"],
  virtualTourUrl: null,
  property: {
    propertyPublicId: "prp_sample",
    name: "Cedar Court",
    headline: "Quiet block, close to everything",
    description: null,
    address1: "12 Cedar Court",
    city: "Austin",
    state: "TX",
    postalCode: "78701",
    country: "US",
    latitude: 30.2672,
    longitude: -97.7431,
    photos: photos("Front of the building"),
  },
};

const listingsExample = { items: [card, secondCard], nextCursor: "cursor_sample" };

const inquiryBody = {
  kind: "contact",
  name: "Pat Renter",
  email: "pat@example.com",
  listingPublicId: "lst_sample",
  message: "Is it still available?",
  turnstileToken: "token_sample",
};

const tourWindowsExample = {
  zoneId: "America/Chicago",
  days: [
    { date: "2026-11-05", weekday: "thu", windows: ["morning", "afternoon"] },
    { date: "2026-11-06", weekday: "fri", windows: ["morning", "afternoon", "evening"] },
  ],
  windows: {
    morning: { start: "09:00", end: "12:00" },
    afternoon: { start: "13:00", end: "17:00" },
    evening: { start: "17:00", end: "19:00" },
  },
  maxPicks: 5,
};

// ---- the schema check ---------------------------------------------------------------------------------------------------------

function resolve(document: Json, schema: Json | undefined): Json | undefined {
  let node = schema;
  for (let guard = 0; node && guard < 10; guard++) {
    if (node.$ref) node = document.components.schemas[String(node.$ref).split("/").pop()!];
    else if (Array.isArray(node.oneOf)) node = node.oneOf.find((option: Json) => option.type !== "null");
    else break;
  }
  return node;
}

function problems(document: Json, schema: Json | undefined, value: unknown, path: string, { requireAll }: { requireAll: boolean }): string[] {
  const node = resolve(document, schema);
  if (!node || value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => problems(document, node.items, item, `${path}[${index}]`, { requireAll }));
  if (typeof value !== "object") return [];
  const record = value as Json;
  const found: string[] = [];
  if (node.properties) {
    for (const key of Object.keys(record)) if (!(key in node.properties)) found.push(`${path}.${key} is not a field of the schema`);
    if (requireAll) for (const key of node.required ?? []) if (!(key in record)) found.push(`${path}.${key} is required by the schema and missing`);
    for (const [key, child] of Object.entries(record)) found.push(...problems(document, node.properties[key], child, `${path}.${key}`, { requireAll }));
  } else if (node.additionalProperties && typeof node.additionalProperties === "object") {
    for (const [key, child] of Object.entries(record)) found.push(...problems(document, node.additionalProperties, child, `${path}.${key}`, { requireAll }));
  }
  return found;
}

// ---- the operations -----------------------------------------------------------------------------------------------------------

interface Spec {
  operationId: string;
  query?: Record<string, string | number>;
  pathParameters?: Record<string, string>;
  body?: Json;
  /** The SDK statement after the client is created. */
  sdk: string;
  response: unknown;
  status: string;
}

const SPECS: Spec[] = [
  { operationId: "Storefront_GetSite", sdk: "const site = await storefront.site.get();", response: siteExample, status: "200 OK" },
  {
    operationId: "Storefront_ListListings",
    query: { bedroomsMin: 2, sort: "rent", limit: 2 },
    sdk: 'const { items, nextCursor } = await storefront.listings.list({\n  bedroomsMin: 2,\n  sort: "rent",\n  limit: 2,\n});',
    response: listingsExample,
    status: "200 OK",
  },
  {
    operationId: "Storefront_GetListing",
    pathParameters: { listingPublicId: "lst_sample" },
    sdk: 'const listing = await storefront.listings.get("lst_sample");',
    response: listingExample,
    status: "200 OK",
  },
  {
    operationId: "Storefront_CreateInquiry",
    body: inquiryBody,
    sdk: `await storefront.inquiries.create({\n  kind: "contact",\n  name: "Pat Renter",\n  email: "pat@example.com",\n  listingPublicId: "lst_sample",\n  message: "Is it still available?",\n  turnstileToken, // from the widget\n});`,
    response: { status: "accepted" },
    status: "202 Accepted",
  },
  {
    operationId: "Storefront_GetTourWindows",
    query: { listingPublicId: "lst_sample" },
    sdk: 'const offer = await storefront.tours.windows({ listingPublicId: "lst_sample" });',
    response: tourWindowsExample,
    status: "200 OK",
  },
];

function slugOf(operationId: string): string {
  return operationId.replace(/^Storefront_/, "").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function build(): TryItOperation[] {
  const document = getPublicApi().documents.storefront as Json | undefined;
  if (!document) throw new Error("The storefront document is not published.");

  return SPECS.map((spec) => {
    let found: { path: string; method: string; operation: Json } | undefined;
    for (const [path, item] of Object.entries<Json>(document.paths)) {
      for (const method of ["get", "post"]) if (item[method]?.operationId === spec.operationId) found = { path, method, operation: item[method] };
    }
    if (!found) throw new Error(`Try it out: ${spec.operationId} is not in the published Storefront API.`);
    const { path, method, operation } = found;
    const text = STOREFRONT_TEXT[spec.operationId];
    if (!text) throw new Error(`Try it out: no description for ${spec.operationId}.`);

    const errors: string[] = [];
    const declared = new Set<string>((operation.parameters ?? []).map((parameter: Json) => String(parameter.name)));
    for (const name of [...Object.keys(spec.query ?? {}), ...Object.keys(spec.pathParameters ?? {})]) {
      if (!declared.has(name)) errors.push(`parameter ${name} is not declared`);
    }
    const responseCode = spec.status.slice(0, 3);
    const responseSchema = operation.responses?.[responseCode]?.content?.["application/json"]?.schema;
    errors.push(...problems(document, responseSchema, spec.response, "response", { requireAll: true }));
    if (spec.body) errors.push(...problems(document, operation.requestBody?.content?.["application/json"]?.schema, spec.body, "body", { requireAll: false }));
    if (!spec.sdk.includes(text.sdk)) errors.push(`the SDK call does not use ${text.sdk}`);
    if (errors.length > 0) throw new Error(`Try it out: the example for ${spec.operationId} does not match the API.\n  ${errors.join("\n  ")}`);

    let filled = path;
    for (const [name, value] of Object.entries(spec.pathParameters ?? {})) filled = filled.replace(`{${name}}`, value);
    const query = spec.query ? `?${new URLSearchParams(Object.entries(spec.query).map(([key, value]) => [key, String(value)])).toString()}` : "";
    const url = `${API_ROOT}${filled}${query}`;

    const lines = [`curl ${method === "post" ? "-X POST " : ""}"${url}" \\`, `  -H "X-Unitfield-Key: ${KEY}"`];
    if (spec.body) {
      lines[1] += " \\";
      lines.push(`  -H "Content-Type: application/json" \\`);
      const body = Object.entries(spec.body)
        .map(([key, value]) => `"${key}": ${JSON.stringify(value)}`)
        .join(",\n    ");
      lines.push(`  -d '{\n    ${body}\n  }'`);
    }

    return {
      id: slugOf(spec.operationId),
      method: method.toUpperCase(),
      label: path.replace("/api/storefront/v1", "").replace(/\{[^}]+\}/, "{id}"),
      name: text.summary,
      description: text.description,
      href: referenceUrl("storefront", path, method),
      status: spec.status,
      curl: lines.join("\n"),
      sdk: `const storefront = createStorefrontClient({ publishableKey: "${KEY}" });\n${spec.sdk}`,
      response: spec.response,
    };
  });
}

let cache: TryItOperation[] | undefined;

/** The operations of the home page's "Try it out", in the order of the list. */
export function getTryItOperations(): TryItOperation[] {
  return (cache ??= build());
}
