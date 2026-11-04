import { ServerCodeBlock } from "fumadocs-ui/components/codeblock.rsc";
import { DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/notebook/page";
import { HomeLinks } from "@/components/home-links";
import { Pillars } from "@/components/home-pillars";
import { TryItOut, type TryItEntry } from "@/components/try-it-out";
import { unitfieldCodeThemes } from "@/lib/code-theme";
import { getTryItOperations } from "@/lib/try-it";

const code = (source: string, lang: string) => <ServerCodeBlock code={source} lang={lang} themes={unitfieldCodeThemes} codeblock={{ keepBackground: false }} />;

export default function Home() {
  const entries: TryItEntry[] = getTryItOperations().map((operation) => ({
    id: operation.id,
    method: operation.method,
    label: operation.label,
    name: operation.name,
    description: operation.description,
    href: operation.href,
    status: operation.status,
    curl: code(operation.curl, "bash"),
    sdk: code(operation.sdk, "ts"),
    response: code(JSON.stringify(operation.response, null, 2), "json"),
  }));

  return (
    <DocsPage full footer={{ enabled: false }} breadcrumb={{ enabled: false }} tableOfContent={{ enabled: false }} tableOfContentPopover={{ enabled: false }}>
      <div className="uf-home">
        <DocsTitle>Unitfield Developers</DocsTitle>
        <DocsDescription>
          Build rental sites and apps on Unitfield; the homes, renters, applications and payments come from the operator&rsquo;s own Unitfield account.
        </DocsDescription>

        <section aria-labelledby="home-build">
          <h2 id="home-build">What are you building?</h2>
          <Pillars />
        </section>

        <section aria-labelledby="home-try">
          <h2 id="home-try">Try it out</h2>
          <p className="uf-section-note">Requests to the Storefront API with example responses. Nothing is sent from this page: run them with your own test key.</p>
          <TryItOut entries={entries} initial="list-listings" />
        </section>

        <section aria-labelledby="home-index">
          <h2 id="home-index">Browse the docs</h2>
          <HomeLinks />
        </section>
      </div>
    </DocsPage>
  );
}
