import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/notebook/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OpenAPIPage } from "@/components/api-page";
import { getMDXComponents } from "@/components/mdx";
import { referenceLoader } from "@/lib/source";

export function generateStaticParams() {
  return referenceLoader.generateParams();
}

export async function generateMetadata(props: PageProps<"/reference/[[...slug]]">): Promise<Metadata> {
  const { slug } = await props.params;
  const page = referenceLoader.getPage(slug);
  if (!page) notFound();
  return { title: page.data.title, description: page.data.description };
}

export default async function Page(props: PageProps<"/reference/[[...slug]]">) {
  const { slug } = await props.params;
  const page = referenceLoader.getPage(slug);
  if (!page) notFound();

  if (page.type === "openapi") {
    return (
      <DocsPage full>
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsBody>
          <OpenAPIPage {...page.data.getOpenAPIPageProps()} showTitle={false} showDescription />
        </DocsBody>
      </DocsPage>
    );
  }

  const MDX = page.data.body;
  return (
    <DocsPage toc={page.data.toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}
