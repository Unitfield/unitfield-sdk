#!/usr/bin/env node
// Generates the webhook event catalog the site renders:
//
//   data/webhook-events.json                  the catalog as data
//   content/reference/webhook-events.mdx      the page (a table of events, one section per event, a field glossary)
//
// The events come from the API's code, `PlatformEventCatalog.cs`: the event names, the scopes an app needs, and the fields each
// event may carry. Everything else (when an event is sent, what a field means) is editorial text in this file.
//
//   node scripts/generate-webhook-events.mjs                         regenerate from ../unitfield-api (a sibling checkout, or $UNITFIELD_API_REPO)
//   node scripts/generate-webhook-events.mjs --source <file.cs>      regenerate from another copy of the C# file
//   node scripts/generate-webhook-events.mjs --check                 fail when the checked-in files differ from what the data produces
//
// The site build never needs the API repository: it reads the checked-in files. Run this after the event catalog changes.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jsonTarget = join(app, "data", "webhook-events.json");
const mdxTarget = join(app, "content", "reference", "webhook-events.mdx");
const SOURCE_PATH = "src/Unitfield.Modules/Platform/Apps/Events/PlatformEventCatalog.cs";

const args = process.argv.slice(2);
const check = args.includes("--check");
const sourceFlag = args.indexOf("--source");
const apiRepository = process.env.UNITFIELD_API_REPO ?? resolve(app, "../../..", "unitfield-api");
const sourceFile = sourceFlag >= 0 ? resolve(args[sourceFlag + 1]) : join(apiRepository, SOURCE_PATH);

// ---- editorial text ---------------------------------------------------------------------------------------------------

/** Events that a site's own endpoints (Website > Developers) can subscribe to. They need no scope. docs/webhooks.mdx lists the same six. */
const SITE_ENDPOINT_EVENTS = new Set(["site.published", "site.unpublished", "listing.published", "listing.updated", "listing.unpublished", "inquiry.created"]);

const GROUPS = [
  { id: "listings", title: "Listings", match: (name) => name.startsWith("listing.") },
  { id: "site", title: "Site", match: (name) => name.startsWith("site.") },
  { id: "inquiries", title: "Inquiries", match: (name) => name.startsWith("inquiry.") },
  { id: "applications", title: "Rental applications", match: (name) => name.startsWith("rental_application.") },
  { id: "payments", title: "Payments", match: (name) => name.startsWith("payment.") },
  { id: "leases", title: "Leases", match: (name) => name.startsWith("lease.") },
  { id: "testing", title: "Testing", match: (name) => name.startsWith("webhook.") },
];

const WHEN = {
  "listing.published": "A listing was published.",
  "listing.updated": "A published listing changed.",
  "listing.unpublished": "A listing was taken off your site.",
  "listing.availability_changed": "A listing's availability changed.",
  "site.published": "A revision of your site was published.",
  "site.unpublished": "Your site was unpublished.",
  "inquiry.created": "A visitor sent a contact or tour inquiry through your site. It says that one arrived and about what, and never carries the visitor's name, email, phone or message.",
  "rental_application.submitted": "An applicant submitted a rental application.",
  "rental_application.attachment_uploaded": "A file was uploaded to a rental application.",
  "rental_application.screening.payment_succeeded": "An applicant's screening payment succeeded.",
  "rental_application.screening.payment_failed": "An applicant's screening payment failed.",
  "payment.succeeded": "A payment succeeded.",
  "payment.failed": "A payment failed.",
  "lease.charge_created": "A charge was created on a lease.",
  "lease.payment_succeeded": "A payment on a lease succeeded.",
  "lease.created": "A lease was created.",
  "lease.activated": "A lease became active.",
  "lease.terminated": "A lease was terminated.",
  "webhook.test": "You sent a test delivery to a subscription from the platform API (or from Website > Developers, for a site endpoint).",
};

/** Events that also need a plan capability (PlatformEventDeliveryAuthority.cs). */
const PLAN_NEEDS = {
  "rental_application.screening.payment_succeeded": "screening",
  "rental_application.screening.payment_failed": "screening",
  "lease.charge_created": "leasing and basic accounting",
  "lease.payment_succeeded": "leasing and basic accounting",
};

const FIELD_TEXT = {
  listingPublicId: "The listing's public id.",
  propertyPublicId: "The property's public id.",
  unitPublicId: "The unit's public id.",
  previousStatus: "The status before the change.",
  currentStatus: "The status after the change.",
  previousVisibility: "The visibility before the change.",
  currentVisibility: "The visibility after the change.",
  publishedAtUtc: "When the listing was published (UTC).",
  updatedAtUtc: "When the record was last updated (UTC).",
  occurredAtUtc: "When the event happened (UTC).",
  availableFromUtc: "The date the home is available from (UTC).",
  isAvailable: "Whether the home is available.",
  applicationPublicId: "The rental application's public id.",
  draftPublicId: "The application draft's public id.",
  status: "The current status.",
  submittedAtUtc: "When the application was submitted (UTC).",
  attachmentType: "The kind of file that was attached.",
  fileName: "The uploaded file's name.",
  uploadedAtUtc: "When the file was uploaded (UTC).",
  stage: "The application stage.",
  screeningStatus: "The screening status.",
  contentType: "The uploaded file's media type.",
  paymentPublicId: "The payment's public id.",
  leasePublicId: "The lease's public id.",
  leasePaymentPublicId: "The lease payment's public id.",
  chargePublicId: "The charge's public id.",
  amount: "The amount of the payment or charge.",
  currency: "The currency of the amounts.",
  purpose: "What the payment is for.",
  paymentMethod: "How the payment was made.",
  paidAtUtc: "When the payment was made (UTC).",
  dueDate: "When the charge is due.",
  dueDateUtc: "When the charge is due (UTC).",
  description: "A description of the charge or payment.",
  category: "The charge category.",
  remainingAmount: "What is still owed.",
  allocatedAmount: "How much of the payment was applied.",
  transactionDateUtc: "The transaction date (UTC).",
  createdAtUtc: "When the record was created (UTC).",
  postedAtUtc: "When the record was posted (UTC).",
  paymentStatus: "The payment's status.",
  processedAtUtc: "When the payment was processed (UTC).",
  startDate: "The lease's start date.",
  endDate: "The lease's end date.",
  monthlyRent: "The monthly rent.",
  kind: "`contact` or `tour`.",
  sitePublicId: "The site's public id.",
  revision: "The site revision that was published.",
  hosts: "The host names the site is served on (a list).",
  installationPublicId: "The installation's public id.",
  webhookPublicId: "The subscription's public id.",
  message: "A fixed message that marks the delivery as a test.",
};

// ---- parse the C# source ----------------------------------------------------------------------------------------------

const strings = (text) => [...text.matchAll(/"([^"]*)"/g)].map((match) => match[1]);

/** Splits `a, [b, c], "d"` at the top level: not inside brackets, braces, parentheses or quotes. */
function splitArguments(text) {
  const parts = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const character of text) {
    if (character === '"') quoted = !quoted;
    if (!quoted) {
      if ("[({".includes(character)) depth++;
      if ("])}".includes(character)) depth--;
      if (character === "," && depth === 0) {
        parts.push(current.trim());
        current = "";
        continue;
      }
    }
    current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseCatalog(source) {
  const arrays = new Map();
  for (const match of source.matchAll(/private static readonly string\[\]\s+(\w+)\s*=\s*\[([^\]]*)\];/g)) arrays.set(match[1], strings(match[2]));

  const build = /private static IReadOnlyDictionary<string, PlatformEventPolicy> Build\(\)\s*\{([\s\S]*?)\n    \}/.exec(source)?.[1];
  if (!build) throw new Error("Could not find Build() in the event catalog source.");

  const events = [];
  for (const statement of build.split(";")) {
    const constructor = /new\(([\s\S]*)\)\s*$/.exec(statement.replace(/\s+/g, " ").trim());
    if (!constructor || !/result\[/.test(statement)) continue;
    const names = /foreach \(var name in new\[\] \{([^}]*)\}\)/.exec(statement) ? strings(/foreach \(var name in new\[\] \{([^}]*)\}\)/.exec(statement)[1]) : strings(/result\["([^"]*)"\]/.exec(statement)?.[0] ?? "");
    const [scopesText, fieldsText, resourceText, listText] = splitArguments(constructor[1]);
    const fields = /^\[/.test(fieldsText) ? strings(fieldsText) : arrays.get(fieldsText);
    if (!fields) throw new Error(`Unknown field list "${fieldsText}" in: ${statement.trim()}`);
    const resourceField = resourceText && resourceText !== "null" ? strings(resourceText)[0] : null;
    for (const name of names) events.push({ name, scopes: strings(scopesText), fields: [...fields], resourceField, listFields: listText ? strings(listText) : [] });
  }

  // The lease events also carry monthlyRent, but only for an app that holds payments:read.
  const conditional = /StartsWith\("lease\."[\s\S]*?Contains\("payments:read"[\s\S]*?data\["monthlyRent"\]/.test(source);
  for (const event of events) event.conditionalFields = conditional && event.name.startsWith("lease.") ? [{ field: "monthlyRent", scope: "payments:read" }] : [];
  return events;
}

// ---- build ------------------------------------------------------------------------------------------------------------

function build(source) {
  const parsed = parseCatalog(source);
  const unknown = [];
  const events = parsed.map((event) => {
    const group = GROUPS.find((candidate) => candidate.match(event.name));
    if (!group) throw new Error(`No group for event ${event.name}: add one to GROUPS.`);
    if (!WHEN[event.name]) unknown.push(event.name);
    return {
      name: event.name,
      group: group.id,
      when: WHEN[event.name] ?? "",
      scopes: event.scopes,
      siteEndpoint: SITE_ENDPOINT_EVENTS.has(event.name),
      planNeeds: PLAN_NEEDS[event.name] ?? null,
      resourceField: event.resourceField,
      listFields: event.listFields,
      fields: event.fields,
      conditionalFields: event.conditionalFields,
    };
  });
  if (unknown.length > 0) throw new Error(`Add a WHEN text for: ${unknown.join(", ")}`);
  events.sort((a, b) => GROUPS.findIndex((g) => g.id === a.group) - GROUPS.findIndex((g) => g.id === b.group) || parsed.findIndex((e) => e.name === a.name) - parsed.findIndex((e) => e.name === b.name));

  const glossary = new Map();
  for (const event of events) for (const field of [...event.fields, ...event.conditionalFields.map((c) => c.field)]) glossary.set(field, FIELD_TEXT[field]);
  const missing = [...glossary].filter(([, text]) => !text).map(([field]) => field);
  if (missing.length > 0) throw new Error(`Add a FIELD_TEXT entry for: ${missing.join(", ")}`);

  return {
    source: SOURCE_PATH,
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    envelope: { version: "1" },
    groups: GROUPS.map(({ id, title }) => ({ id, title })).filter((group) => events.some((event) => event.group === group.id)),
    events,
    fields: Object.fromEntries([...glossary].sort(([a], [b]) => a.localeCompare(b))),
  };
}

const code = (text) => `\`${text}\``;
const scopeList = (scopes) => scopes.map(code).join(", ");

function renderMdx(catalog) {
  const out = [];
  out.push(`---
title: Webhook events
description: Every event Unitfield can send to a webhook, with the scopes it needs and the fields it carries.
---

{/* Generated by scripts/generate-webhook-events.mjs from the API's PlatformEventCatalog.cs. Do not edit; run "pnpm --filter @unitfield/developers generate:webhook-events". */}

${catalog.events.length} events. How to subscribe, verify a signature and handle retries is in the guide [Webhooks and revalidation](/docs/webhooks). This page is the catalog: what each event means and what its \`data\` object may contain.

## The envelope

Every delivery has the same envelope. \`data\` is the event's own object, listed per event below.

\`\`\`json
{
  "id": "…",
  "type": "listing.updated",
  "created": "2026-11-02T17:00:00Z",
  "version": "1",
  "data": { "listingPublicId": "clst_…" }
}
\`\`\`

and these headers: \`X-Unitfield-Signature\`, \`X-Unitfield-Delivery\` and \`X-Unitfield-Event\`.

A field in \`data\` is sent only when the event has a value for it, so treat every field as optional, except the one an event always carries (named in its section). Nothing outside the listed fields is ever sent.

An installed app subscribes with the \`webhooks:manage\` scope, and only to events that its reviewed version declares and whose scopes it holds, all of them. A site's own endpoints (**Website > Developers**) need no scope: they can subscribe to the six events marked **Site endpoint** in the table.

## All events

| Event | Scopes | Site endpoint | When |
| --- | --- | --- | --- |`);
  for (const event of catalog.events) {
    out.push(`| [${code(event.name)}](#${event.name.replace(/[^a-z0-9_ -]/g, "")}) | ${scopeList(event.scopes)} | ${event.siteEndpoint ? "Yes" : "No"} | ${event.when.replace(/\|/g, "\\|")} |`);
  }
  out.push("");

  for (const group of catalog.groups) {
    out.push(`## ${group.title}\n`);
    for (const event of catalog.events.filter((candidate) => candidate.group === group.id)) {
      out.push(`### ${event.name}\n`);
      out.push(`${event.when}\n`);
      out.push(`- **Scopes:** ${scopeList(event.scopes)}${event.scopes.length > 1 ? " (all of them)" : ""}`);
      out.push(`- **Site endpoint:** ${event.siteEndpoint ? "Yes, with no scope." : "No. Installed apps only."}`);
      if (event.planNeeds) out.push(`- **Plan:** the organization's plan must include ${event.planNeeds}.`);
      if (event.resourceField) out.push(`- **Always present:** ${code(event.resourceField)}. An event without it is not delivered.`);
      out.push("");
      out.push("| Field | Meaning |\n| --- | --- |");
      for (const field of event.fields) out.push(`| ${code(field)} | ${catalog.fields[field]} |`);
      for (const { field, scope } of event.conditionalFields) out.push(`| ${code(field)} | ${catalog.fields[field]} Only for an app that holds ${code(scope)}. |`);
      out.push("");
    }
  }

  out.push(`## Field glossary\n`);
  out.push(`Fields share names across events, so each is explained once.\n`);
  out.push("| Field | Meaning |\n| --- | --- |");
  for (const [field, text] of Object.entries(catalog.fields)) out.push(`| ${code(field)} | ${text} |`);
  out.push("");
  return out.join("\n");
}

const source = await readFile(sourceFile, "utf8").catch(async (error) => {
  if (!check) throw new Error(`Cannot read ${sourceFile}: ${error.message}. Pass --source <PlatformEventCatalog.cs>.`);
  return null;
});

if (check) {
  // The check compares the two generated files with each other: it needs no API checkout. With one, it also compares the source hash.
  const json = JSON.parse(await readFile(jsonTarget, "utf8"));
  const current = await readFile(mdxTarget, "utf8");
  let failed = false;
  if (renderMdx(json) !== current) {
    console.error('content/reference/webhook-events.mdx does not match data/webhook-events.json. Run "generate:webhook-events".');
    failed = true;
  }
  if (source !== null && createHash("sha256").update(source).digest("hex") !== json.sourceSha256) {
    console.error("data/webhook-events.json is out of date with PlatformEventCatalog.cs. Run generate:webhook-events and commit the result.");
    failed = true;
  }
  if (failed) process.exit(1);
  console.log(`Webhook events: ${json.events.length} events, files are consistent${source === null ? "" : " with the API source"}.`);
} else {
  const catalog = build(source);
  await writeFile(jsonTarget, `${JSON.stringify(catalog, null, 2)}\n`);
  await writeFile(mdxTarget, renderMdx(catalog));
  console.log(`Wrote ${catalog.events.length} events to data/webhook-events.json and content/reference/webhook-events.mdx.`);
}
