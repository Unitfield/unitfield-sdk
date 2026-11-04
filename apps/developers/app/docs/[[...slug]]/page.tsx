import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/notebook/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getGuideComponents } from "@/components/mdx";
import { guideSource } from "@/lib/source";

export function generateStaticParams() {
  return guideSource.generateParams();
}

export async function generateMetadata(props: PageProps<"/docs/[[...slug]]">): Promise<Metadata> {
  const { slug } = await props.params;
  const page = guideSource.getPage(slug);
  if (!page) notFound();
  return { title: page.data.title, description: page.data.description };
}

export default async function Page(props: PageProps<"/docs/[[...slug]]">) {
  const { slug } = await props.params;
  const page = guideSource.getPage(slug);
  if (!page) notFound();
  const MDX = page.data.body;
  return (
    <DocsPage toc={page.data.toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={getGuideComponents()} />
      </DocsBody>
    </DocsPage>
  );
}
