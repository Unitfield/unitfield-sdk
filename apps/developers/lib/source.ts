import { loader, type VirtualFile } from "fumadocs-core/source";
import { pageSchema } from "fumadocs-core/source/schema";
import { defineDocs } from "fumadocs-mdx/macro";
import { z } from "zod";
import { openapi } from "./openapi";
import { getPublicApi } from "./public-api/load";
import { SURFACES } from "./public-api/surfaces";

// ---------------------------------------------------------------------------------------------------------------------
// Guides: the repository's docs/*.mdx, read in place. Only the top level: docs/reference/index.mdx is the generated list of
// every operation in the snapshots (it includes operations this site never publishes), and the real reference replaces it.
// The sidebar follows each guide's `order` front matter.
// ---------------------------------------------------------------------------------------------------------------------
const guides = defineDocs({
  dir: "../../docs",
  docs: {
    files: ["*.mdx"],
    schema: pageSchema.extend({ order: z.number() }),
  },
});

const guideFiles = guides.toFumadocsSource();
type GuideFile = (typeof guideFiles.files)[number];

const orderedGuides = {
  ...guideFiles,
  files: [
    ...guideFiles.files,
    {
      type: "meta",
      path: "meta.json",
      data: {
        pages: guideFiles.files
          .filter((file) => file.type === "page")
          .sort((a, b) => (a.data as { order: number }).order - (b.data as { order: number }).order)
          .map((file) => file.path.replace(/\.mdx$/, "")),
      },
    } as unknown as GuideFile,
  ],
};

export const guideSource = loader({
  baseUrl: "/docs",
  source: orderedGuides,
});

// ---------------------------------------------------------------------------------------------------------------------
// API reference: one overview page per API (content/reference), the generated webhook event catalog, and one page per
// published operation, built from the public documents in lib/public-api (snapshots, filtered and overlaid).
// ---------------------------------------------------------------------------------------------------------------------
const referenceDocs = defineDocs({ dir: "content/reference" });

const kebab = (text: string) =>
  text
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

/** A stable page name from the operation id: `Resident_GetLease` is `get-lease`, `AppWebhooks_List` is `app-webhooks-list`. */
function operationSlug(operationId: string): string {
  const [head, ...tail] = operationId.split("_");
  const rest = tail.join("_");
  if (!rest) return kebab(head ?? operationId);
  return /^[A-Z][a-z0-9]*$/.test(rest) ? kebab(`${head}-${rest}`) : kebab(rest);
}

/**
 * A page's title is the operation's summary, often a full sentence. The sidebar wants a short label: the summary when it is short,
 * otherwise the operation id read as words ("Preview auto pay authorization"), without the group's own name in front.
 */
function sidebarLabel(summary: string, operationId: string, group: string): string {
  if (summary.length <= 40) return summary;
  let words = operationId.split("_").slice(1).join(" ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/\s+/).filter(Boolean);
  const own = group.toLowerCase().split(/\s+/);
  if (words.length > own.length && own.every((word, index) => words[index] === word || `${word}s` === words[index])) words = words.slice(own.length);
  if (words.length < 2) return summary;
  const label = words.join(" ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function planReference() {
  const api = getPublicApi();
  const metas: VirtualFile[] = [];
  const rootPages: string[] = ["index"];
  const names = new Map<string, { group: string; slug: string }>();
  const labels = new Map<string, string>();
  const groupTitles = new Map<string, string>();
  const taken = new Set<string>();

  for (const surface of SURFACES) {
    const document = api.documents[surface.id]!;
    const folders = new Map<string, string[]>();
    for (const [path, item] of Object.entries<Record<string, any>>(document.paths)) {
      for (const method of ["get", "put", "post", "patch", "delete"]) {
        const operation = item[method];
        if (!operation) continue;
        const group = String(operation.tags[0]);
        const slug = operationSlug(operation.operationId);
        const key = `${surface.id}/${kebab(group)}/${slug}`;
        if (taken.has(key)) throw new Error(`Two operations in ${surface.id}/${group} would share the page name "${slug}" (${operation.operationId}).`);
        taken.add(key);
        names.set(`${surface.id}\n${path}\n${method}`, { group, slug });
        labels.set(`${key}.mdx`, sidebarLabel(String(operation.summary ?? ""), operation.operationId, group));
        folders.set(group, [...(folders.get(group) ?? []), slug]);
      }
    }
    const groups = surface.groupOrder.filter((title) => folders.has(title));
    for (const title of folders.keys()) if (!groups.includes(title)) groups.push(title);
    for (const title of groups) groupTitles.set(`${surface.id}/${kebab(title)}`, title);
    for (const title of groups) metas.push({ type: "meta", path: `${surface.id}/${kebab(title)}/meta.json`, data: { title, pages: folders.get(title) } });
    metas.push({ type: "meta", path: `${surface.id}/meta.json`, data: { title: surface.title, pages: groups.map(kebab) } });
    rootPages.push(surface.id);
  }
  rootPages.push("---Webhooks---", "webhook-events");
  metas.push({ type: "meta", path: "meta.json", data: { pages: rootPages } });
  return { names, metas, groupTitles, labels };
}

const plan = planReference();

const generated = await openapi.staticSource({
  per: "operation",
  groupBy: (entry) => {
    if (entry.type !== "operation") throw new Error("The public documents declare no webhooks.");
    const found = plan.names.get(`${entry.schemaId}\n${entry.item.path}\n${entry.item.method}`);
    if (!found) throw new Error(`No page name for ${entry.item.method} ${entry.item.path}`);
    return `${entry.schemaId}/${kebab(found.group)}`;
  },
  name: (entry) => {
    if (entry.type !== "operation") throw new Error("The public documents declare no webhooks.");
    const found = plan.names.get(`${entry.schemaId}\n${entry.item.path}\n${entry.item.method}`);
    if (!found) throw new Error(`No page name for ${entry.item.method} ${entry.item.path}`);
    return found.slug;
  },
});

export const referenceLoader = loader(
  {
    docs: referenceDocs.toFumadocsSource(),
    openapi: { ...generated, files: [...generated.files, ...(plan.metas as unknown as typeof generated.files)] },
  },
  {
    baseUrl: "/reference",
    plugins: [
      {
        // Before the OpenAPI plugin, which puts the method label after the name.
        name: "unitfield:sidebar-labels",
        enforce: "pre",
        transformPageTree: {
          file(node, filePath) {
            const label = filePath ? plan.labels.get(filePath) : undefined;
            return label ? { ...node, name: label } : node;
          },
        },
      },
      openapi.loaderPlugin(),
    ],
  },
);

/** "Storefront API" and "Listings" for /reference/storefront/listings/list-listings: the trail above an operation in the sidebar. */
export function referenceBreadcrumbs(url: string): string[] {
  const [surfaceId, group] = url.replace(/^\/reference\/?/, "").split("/").filter(Boolean);
  const surface = SURFACES.find((candidate) => candidate.id === surfaceId);
  if (!surface) return ["API reference"];
  const groupTitle = group ? plan.groupTitles.get(`${surface.id}/${group}`) : undefined;
  return groupTitle ? ["API reference", surface.title, groupTitle] : ["API reference", surface.title];
}
