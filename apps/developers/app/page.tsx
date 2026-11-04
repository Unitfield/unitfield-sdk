import { ArrowRightIcon } from "@unitfield/ui/icons";
import { ServerCodeBlock } from "fumadocs-ui/components/codeblock.rsc";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import Link from "next/link";
import { Command } from "@/components/install-snippet";
import { unitfieldCodeThemes } from "@/lib/code-theme";
import { baseOptions } from "@/lib/layout.shared";
import { GITHUB_URL, MAIN_SITE_URL } from "@/lib/site";
import { guideSource } from "@/lib/source";

const heroCode = `import { createStorefrontClient } from "@unitfield/sdk";

const storefront = createStorefrontClient({
  publishableKey: "pk_test_…",
});

const { items } = await storefront.listings.list({
  bedroomsMin: 2,
  sort: "rent",
  limit: 3,
});`;

/** Example data for the picture of a response. Not a customer, not a real listing. */
const exampleHomes = [
  { title: "Cedar Court 2B", facts: "2 bd · 1 ba", rent: "$1,850" },
  { title: "Pier Street 5", facts: "2 bd · 2 ba", rent: "$2,140" },
  { title: "Harbor Lofts 12", facts: "3 bd · 2 ba", rent: "$2,600" },
];

const guideDescription = (slug: string) => guideSource.getPage([slug])?.data.description ?? "";

const startHere = [
  { href: "/docs/quickstart", title: "Quickstart", text: guideDescription("quickstart"), size: "wide" },
  { href: "/docs/nextjs-starter", title: "The Next.js starter", text: guideDescription("nextjs-starter"), size: "wide" },
  { href: "/docs/customer-sign-in", title: "Customer sign-in", text: guideDescription("customer-sign-in"), size: "third" },
  { href: "/docs/webhooks", title: "Webhooks", text: guideDescription("webhooks"), size: "third" },
  { href: "/reference", title: "API reference", text: "Every operation of the public APIs, with parameters, bodies and example requests.", size: "third" },
] as const;

const capabilities = [
  { title: "Read your homes", text: "The Storefront API serves your published homes, your site's brand and contact details, and takes inquiries. A publishable key reads it, and is safe in a web page.", href: "/reference/storefront" },
  { title: "Sign renters in", text: "OpenID Connect authorization code with PKCE against Unitfield's customer issuer, so a renter signs in without you running an identity system.", href: "/docs/customer-sign-in" },
  { title: "Link to the hosted flows", text: "The apply page and the account page stay on a Unitfield-hosted address, and your site links to them. You do not rebuild a regulated flow.", href: "/docs/hosted-apply" },
  { title: "Know when something changes", text: "Webhooks tell your server when listings or the site change, so a cached site refreshes at once instead of on a timer.", href: "/reference/webhook-events" },
];

const packages = [
  { name: "@unitfield/sdk", text: "The typed core. Node 20+, edge runtimes and browsers.", command: "npm install @unitfield/sdk" },
  { name: "@unitfield/react", text: "A provider, hooks and headless components for React.", command: "npm install @unitfield/react @unitfield/sdk" },
  { name: "create-unitfield-site", text: "A Next.js starter with listings, sign-in and an inquiry form.", command: "npx create-unitfield-site my-site" },
];

export default function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className="uf-home">
        <section className="uf-hero">
          <div className="uf-hero-copy">
            <h1>Build your own rental site on Unitfield</h1>
            <p>
              Unitfield runs your rentals. Put your own website in front of it, in any framework: read your homes, sign renters in, and link to the apply
              flow Unitfield hosts.
            </p>
            <div className="uf-actions">
              <Link href="/docs/quickstart" className="uf-button uf-button-primary">
                Start the quickstart
              </Link>
              <Link href="/reference" className="uf-button uf-button-quiet">
                API reference
              </Link>
            </div>
            <Command command="npx create-unitfield-site my-site" />
          </div>

          <div className="uf-hero-picture" aria-label="An SDK call and the homes it returns">
            <div className="uf-picture-code">
              <ServerCodeBlock code={heroCode} lang="ts" themes={unitfieldCodeThemes} codeblock={{ keepBackground: false }} />
            </div>
            <div className="uf-picture-result">
              <ul>
                {exampleHomes.map((home) => (
                  <li key={home.title}>
                    <span className="uf-home-title">{home.title}</span>
                    <span className="uf-home-facts">{home.facts}</span>
                    <span className="uf-home-rent">{home.rent}</span>
                    <span className="uf-home-apply">Apply</span>
                  </li>
                ))}
              </ul>
              <p>Example data. Every item carries an <code>applyUrl</code>.</p>
            </div>
          </div>
        </section>

        <section className="uf-section">
          <h2>Start here</h2>
          <div className="uf-cards">
            {startHere.map((card) => (
              <Link key={card.href} href={card.href} className="uf-card" data-size={card.size}>
                <span className="uf-card-title">{card.title}</span>
                <span className="uf-card-text">{card.text}</span>
                <ArrowRightIcon aria-hidden className="uf-card-arrow" size={18} />
              </Link>
            ))}
          </div>
        </section>

        <section className="uf-section">
          <h2>What is public, and typed</h2>
          <div className="uf-capabilities">
            {capabilities.map((item) => (
              <div key={item.title} className="uf-capability">
                <h3>{item.title}</h3>
                <p>{item.text}</p>
                <Link href={item.href} className="uf-link">
                  Read more
                </Link>
              </div>
            ))}
          </div>
        </section>

        <section className="uf-section">
          <h2>Packages</h2>
          <div className="uf-packages">
            {packages.map((item) => (
              <div key={item.name} className="uf-package">
                <div>
                  <h3>{item.name}</h3>
                  <p>{item.text}</p>
                </div>
                <Command command={item.command} />
              </div>
            ))}
          </div>
        </section>

        <footer className="uf-footer">
          <span>Unitfield</span>
          <a href={MAIN_SITE_URL}>unitfield.com</a>
          <a href={GITHUB_URL}>GitHub</a>
          <a href={`${GITHUB_URL}/issues`}>Report a docs issue</a>
        </footer>
      </div>
    </HomeLayout>
  );
}
