import { existsSync, readFileSync } from "node:fs";

export type Call = {
  url: URL;
  method: string;
  headers: Headers;
  /** Parsed JSON body, the raw string, or undefined. */
  body: unknown;
  init: RequestInit;
};

/** A fetch double that records every request. `respond` defaults to an empty JSON object. */
export function recorder(respond?: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = async (input: URL | string | Request, init: RequestInit = {}): Promise<Response> => {
    const raw = init.body;
    let body: unknown = raw;
    if (typeof raw === "string") {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    const call: Call = { url: new URL(String(input)), method: init.method ?? "GET", headers: new Headers(init.headers), body, init };
    calls.push(call);
    return respond ? respond(call, calls.length - 1) : Response.json({});
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

/** Retry options that never wait and are deterministic; `sleeps` collects the delays the transport asked for. */
export function instantRetry(extra: Record<string, unknown> = {}) {
  const sleeps: number[] = [];
  return { sleeps, retry: { sleep: async (ms: number) => void sleeps.push(ms), random: () => 1, ...extra } };
}

export function problem(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "content-type": "application/problem+json", ...headers } });
}

export function b64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

/** An unsigned JWT: the SDK reads claims from the token endpoint over TLS and never verifies signatures. */
export function jwt(claims: Record<string, unknown>): string {
  return `${b64url(JSON.stringify({ alg: "none" }))}.${b64url(JSON.stringify(claims))}.sig`;
}

type Operation = { summary?: string; parameters?: { name: string; in: string; required?: boolean; schema?: unknown }[]; requestBody?: { content?: Record<string, { schema?: unknown }> } };
export type Document = { paths: Record<string, Record<string, Operation>>; components?: { schemas?: Record<string, unknown> } };

export function snapshot(name: string): Document | null {
  const file = new URL(`../openapi/${name}.json`, import.meta.url);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Document) : null;
}

const HTTP_METHODS = ["get", "put", "post", "delete", "patch"];

/** The most specific path template of `doc` that matches `pathname` (literal characters win over `{param}`). */
export function findOperation(doc: Document, method: string, pathname: string) {
  let best: { template: string; operation: Operation; score: number } | undefined;
  for (const [template, item] of Object.entries(doc.paths)) {
    const operation = item[method.toLowerCase()];
    if (!operation) continue;
    // A trailing slash is the same route (ASP.NET groups map "/" for a collection).
    const pattern = new RegExp(`^${template.replace(/\/+$/, "").replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]+")}$`);
    if (!pattern.test(pathname.replace(/\/+$/, ""))) continue;
    const score = template.replace(/\{[^}]+\}/g, "").length;
    if (!best || score > best.score) best = { template, operation, score };
  }
  return best;
}

export function allOperations(doc: Document): string[] {
  return Object.entries(doc.paths).flatMap(([path, item]) => Object.keys(item).filter((m) => HTTP_METHODS.includes(m)).map((m) => `${m.toUpperCase()} ${path}`));
}
