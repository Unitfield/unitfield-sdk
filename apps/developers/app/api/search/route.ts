import { createSearchAPI, type AdvancedIndex } from "fumadocs-core/search/server";
import { guideSource, referenceLoader, referenceBreadcrumbs } from "@/lib/source";

// Exported once at build time as a static file: the browser downloads the index and searches it locally.
export const revalidate = false;

type StructuredData = AdvancedIndex["structuredData"];

async function structuredDataOf(data: { structuredData?: unknown }): Promise<StructuredData> {
  const value = typeof data.structuredData === "function" ? await data.structuredData() : data.structuredData;
  return (value ?? { headings: [], contents: [] }) as StructuredData;
}

export const { staticGET: GET } = createSearchAPI("advanced", {
  indexes: async () => {
    const guides = await Promise.all(
      guideSource.getPages().map(
        async (page): Promise<AdvancedIndex> => ({
          id: page.url,
          title: page.data.title,
          description: page.data.description,
          url: page.url,
          tag: "guides",
          breadcrumbs: ["Guides"],
          structuredData: await structuredDataOf(page.data as { structuredData?: unknown }),
        }),
      ),
    );
    const reference = await Promise.all(
      referenceLoader.getPages().map(async (page): Promise<AdvancedIndex> => {
        const structuredData = await structuredDataOf(page.data as { structuredData?: unknown });
        const method = page.type === "openapi" ? page.data._openapi.method : undefined;
        if (page.type === "openapi" && method) {
          // Let a search for a path or an operation id find the page: "/listings", "Storefront_ListListings".
          const props = page.data.getOpenAPIPageProps();
          const operation = props.operations?.[0];
          if (operation) structuredData.contents.push({ heading: structuredData.headings[0]?.id, content: `${method.toUpperCase()} ${operation.path}` });
        }
        return {
          id: page.url,
          title: page.data.title ?? page.slugs.join(" "),
          description: page.data.description,
          url: page.url,
          tag: "reference",
          breadcrumbs: referenceBreadcrumbs(page.url),
          structuredData,
        };
      }),
    );
    return [...guides, ...reference];
  },
});
