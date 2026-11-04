import type { Root } from "fumadocs-core/page-tree";
import { SURFACES } from "./public-api/surfaces";
import { guideSource } from "./source";

/**
 * The sidebar of the home page: the whole site in one list, so the home is a page of the docs and not a brochure in front of them.
 * Guides, then one entry per API (its overview, where the operations are), then the webhook event catalog.
 */
export function homeTree(): Root {
  return {
    name: "Unitfield for developers",
    children: [
      { type: "page", name: "Overview", url: "/" },
      { type: "separator", name: "Guides" },
      ...guideSource.getPageTree().children,
      { type: "separator", name: "API reference" },
      ...SURFACES.map((surface) => ({ type: "page" as const, name: surface.title, url: `/reference/${surface.id}` })),
      { type: "separator", name: "Webhooks" },
      { type: "page", name: "Webhook events", url: "/reference/webhook-events" },
    ],
  };
}
