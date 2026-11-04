import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DENY_RULES, FORBIDDEN_IN_OUTPUT, STOREFRONT_TEXT, SURFACES, type OperationRecord, type Surface } from "./surfaces";

// The committed snapshots are the single source of the API reference. `next build` runs with this app as the working directory.
const SNAPSHOT_DIR = resolve(process.cwd(), "../../packages/sdk/openapi");
const METHODS = ["get", "put", "post", "patch", "delete"] as const;
const API_ROOT = "https://api.unitfield.com";

/** An OpenAPI 3.x document. The shapes are the snapshots' own, so they stay loosely typed here. */
export type ApiDocument = Record<string, any>;

export interface FilteredOperation {
  surface: string;
  method: string;
  path: string;
  operationId: string;
  reason: string;
}

export interface PublicApi {
  documents: Record<string, ApiDocument>;
  filtered: FilteredOperation[];
  /** Published operations, for the overview and the build log. */
  operationCount: number;
}

const BOILERPLATE = /^User-scoped\/public operation\. 'X-Tenant-Id' not required\.$/;

function words(camel: string): string[] {
  return camel.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(" ");
}

/** "Platform Apps List Installations" with the id `PlatformApps_ListInstallations` reads "List installations". */
function readableSummary(summary: string | undefined, operationId: string | undefined): string | undefined {
  if (!summary || !operationId) return summary;
  const prefix = words(operationId.split("_")[0] ?? "");
  const parts = summary.split(" ");
  const sameStart = prefix.length > 0 && prefix.every((word, index) => parts[index] === word);
  if (!sameStart || parts.length <= prefix.length) return summary;
  const rest = parts.slice(prefix.length).map((word, index) => (/^[A-Z][a-z]+$/.test(word) ? (index === 0 ? word : word.toLowerCase()) : word));
  return rest.join(" ");
}

function collectRefs(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, into);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "$ref" && typeof item === "string") into.add(item);
      else collectRefs(item, into);
    }
  }
}

/**
 * The API's generator describes every integer as `["integer", "string"]` with a digits-only pattern, because the server also reads numbers
 * from strings. On a reference page that reads as noise ("integer | string", "Match ^-?(?:0|[1-9]\\d*)$"), so such a schema is shown as the number it is.
 */
function simplifyNumbers(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) simplifyNumbers(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  const schema = value as Record<string, any>;
  if (Array.isArray(schema.type) && schema.type.includes("string") && typeof schema.pattern === "string" && schema.pattern.startsWith("^-?(?:0|[1-9]")) {
    const numeric = schema.type.includes("integer") ? "integer" : "number";
    schema.type = schema.type.includes("null") ? ["null", numeric] : numeric;
    delete schema.pattern;
  }
  for (const item of Object.values(schema)) simplifyNumbers(item);
}

/** Drops every component nothing published refers to, so a filtered operation cannot survive as an orphaned schema. */
function pruneComponents(document: ApiDocument): void {
  const components = document.components;
  if (!components) return;
  const wanted = new Set<string>();
  const queue: unknown[] = [document.paths];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const refs = new Set<string>();
    collectRefs(queue.pop(), refs);
    for (const ref of refs) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      const match = /^#\/components\/([^/]+)\/(.+)$/.exec(ref);
      if (!match) continue;
      wanted.add(`${match[1]}/${match[2]}`);
      queue.push(components[match[1]!]?.[match[2]!]);
    }
  }
  for (const [kind, entries] of Object.entries<Record<string, unknown>>(components)) {
    if (kind === "securitySchemes") continue;
    for (const name of Object.keys(entries)) if (!wanted.has(`${kind}/${name}`)) delete entries[name];
    if (Object.keys(entries).length === 0) delete components[kind];
  }
}

/** The security schemes an operation (or the document) names, so the rest can go. */
function pruneSecuritySchemes(document: ApiDocument): void {
  const schemes = document.components?.securitySchemes;
  if (!schemes) return;
  const used = new Set<string>();
  const use = (requirements: unknown) => {
    if (Array.isArray(requirements)) for (const requirement of requirements) for (const name of Object.keys(requirement ?? {})) used.add(name);
  };
  use(document.security);
  for (const item of Object.values<Record<string, any>>(document.paths)) for (const method of METHODS) use(item[method]?.security);
  for (const name of Object.keys(schemes)) if (!used.has(name)) delete schemes[name];
  if (Object.keys(schemes).length === 0) delete document.components.securitySchemes;
}

function applyAuth(surface: Surface, document: ApiDocument): void {
  const schemes: Record<string, unknown> = (document.components ??= {}).securitySchemes ?? {};
  document.components.securitySchemes = schemes;

  if (surface.id === "storefront") {
    // The snapshot declares no auth for storefront operations. A publishable key is required by every one of them but the host lookup.
    document.components.securitySchemes = {
      PublishableKey: {
        type: "apiKey",
        in: "header",
        name: "X-Unitfield-Key",
        description:
          "A publishable key, `pk_live_…` or `pk_test_…`, from **Website > Developers**. It is public by design: it can read published listings, send an inquiry and start a sign-in, and nothing private. A request that carries an `Origin` header (a browser) must come from an origin allowed on the key. A missing, revoked or unknown key, or a disallowed origin, gets `401`, and all four answers look the same.",
      },
    };
    document.security = [{ PublishableKey: [] }];
    for (const item of Object.values<Record<string, any>>(document.paths)) {
      for (const method of METHODS) {
        const operation = item[method];
        if (!operation) continue;
        const anonymous = operation.operationId === "Storefront_ResolveHost";
        operation.security = anonymous ? [] : [{ PublishableKey: [] }];
        if (!anonymous && operation.responses?.["401"]) {
          operation.responses["401"].description = "The publishable key is missing, revoked or unknown, or the request's origin is not allowed on the key.";
        }
      }
    }
    return;
  }

  if (surface.id === "customer" || surface.id === "resident") {
    document.components.securitySchemes = {
      Bearer: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "A customer access token from Unitfield's customer sign-in (`https://id.unitfield.app`), obtained with the authorization code flow and PKCE. The organization comes from the token. See [Customer sign-in with PKCE](/docs/customer-sign-in).",
      },
    };
    document.security = [{ Bearer: [] }];
    return;
  }

  if (surface.id === "apps") {
    // An installed app gets its token with the client-credentials grant. Naming OAuth2 keeps the scheme, with its scopes, in the document.
    document.security = [{ OAuth2: [] }, { Bearer: [] }];
    return;
  }
}

function retag(surface: Surface, document: ApiDocument): void {
  for (const [path, item] of Object.entries<Record<string, any>>(document.paths)) {
    for (const method of METHODS) {
      const operation = item[method];
      if (!operation) continue;
      operation.tags = [surface.group({ path, method, operation })];
    }
  }
  document.tags = surface.groupOrder.map((name) => ({ name }));
}

function polish(surface: Surface, document: ApiDocument): void {
  for (const item of Object.values<Record<string, any>>(document.paths)) {
    for (const method of METHODS) {
      const operation = item[method];
      if (!operation) continue;
      const curated = surface.id === "storefront" ? STOREFRONT_TEXT[operation.operationId] : undefined;
      if (curated) {
        operation.summary = curated.summary;
        operation.description = `${curated.description}\n\nSDK: \`${curated.sdk}\`.`;
        continue;
      }
      operation.summary = readableSummary(operation.summary, operation.operationId);
      if (typeof operation.description === "string" && BOILERPLATE.test(operation.description)) delete operation.description;
    }
  }
}

function describeDocument(surface: Surface, document: ApiDocument): void {
  const sandbox = (document.servers ?? []).filter((server: { url: string }) => server.url !== API_ROOT && !/-dev\./.test(server.url));
  document.servers = [{ url: API_ROOT, description: "Production" }, ...sandbox];
  document.info = {
    title: surface.title,
    version: "v1",
    description: surface.summary,
    ...(document.info?.contact ? { contact: document.info.contact } : {}),
  };
}

/** Orders operations by path, then by method, so a regenerated snapshot never reshuffles the sidebar. */
function sortPaths(document: ApiDocument): void {
  const sorted: Record<string, unknown> = {};
  for (const path of Object.keys(document.paths).sort()) {
    const item = document.paths[path];
    const ordered: Record<string, unknown> = {};
    for (const key of Object.keys(item)) if (!(METHODS as readonly string[]).includes(key)) ordered[key] = item[key];
    for (const method of METHODS) if (item[method]) ordered[method] = item[method];
    sorted[path] = ordered;
  }
  document.paths = sorted;
}

function buildPublicApi(): PublicApi {
  const documents: Record<string, ApiDocument> = {};
  const filtered: FilteredOperation[] = [];
  let operationCount = 0;

  for (const surface of SURFACES) {
    const document: ApiDocument = JSON.parse(readFileSync(resolve(SNAPSHOT_DIR, `${surface.id}.json`), "utf8"));

    for (const [path, item] of Object.entries<Record<string, any>>(document.paths ?? {})) {
      for (const method of METHODS) {
        const operation = item[method];
        if (!operation) continue;
        const record: OperationRecord = { path, method, operation };
        const rule = DENY_RULES.find((candidate) => candidate.matches(record));
        if (!rule) continue;
        filtered.push({ surface: surface.id, method: method.toUpperCase(), path, operationId: operation.operationId ?? "", reason: rule.reason });
        delete item[method];
      }
      if (!METHODS.some((method) => item[method])) delete document.paths[path];
    }

    applyAuth(surface, document);
    retag(surface, document);
    polish(surface, document);
    describeDocument(surface, document);
    sortPaths(document);
    simplifyNumbers(document);
    pruneComponents(document);
    pruneSecuritySchemes(document);

    const serialized = JSON.stringify(document);
    const leak = FORBIDDEN_IN_OUTPUT.exec(serialized);
    if (leak) {
      const at = Math.max(0, leak.index - 80);
      throw new Error(`The public ${surface.id} document mentions "${leak[0]}": ...${serialized.slice(at, leak.index + 80)}...`);
    }

    for (const item of Object.values<Record<string, any>>(document.paths)) for (const method of METHODS) if (item[method]) operationCount++;
    documents[surface.id] = document;
  }

  return { documents, filtered, operationCount };
}

let cached: PublicApi | undefined;

/** The public API documents, built once per process. */
export function getPublicApi(): PublicApi {
  cached ??= buildPublicApi();
  return cached;
}
