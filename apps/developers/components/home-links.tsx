import Link from "next/link";
import events from "@/data/webhook-events.json";
import { SURFACES } from "@/lib/public-api/surfaces";
import { GITHUB_URL, MAIN_SITE_URL } from "@/lib/site";
import { guideSource } from "@/lib/source";

// The index of the site, in columns, built from the guides, the APIs and the event catalog: a link that points nowhere fails the build
// (here for a guide, in scripts/verify-output.mjs for the rest).

const GUIDES: { slug: string; label: string }[] = [
  { slug: "quickstart", label: "Quickstart" },
  { slug: "nextjs-starter", label: "Next.js starter" },
  { slug: "customer-sign-in", label: "Customer sign-in" },
  { slug: "hosted-apply", label: "Hosted apply" },
  { slug: "webhooks", label: "Webhooks" },
  { slug: "testing-with-test-keys", label: "Testing with test keys" },
  { slug: "account-domain", label: "Account domain" },
];

function guideLink({ slug, label }: { slug: string; label: string }) {
  const page = guideSource.getPage([slug]);
  if (!page) throw new Error(`The home page links to the guide "${slug}", which does not exist.`);
  return { label, href: page.url };
}

/** The catalog page gives each event the anchor of its name without the dot. */
const eventAnchor = (name: string) => name.replace(/\./g, "");

export function HomeLinks() {
  const siteEvents = events.events.filter((event) => event.siteEndpoint);
  return (
    <div className="uf-columns">
      <nav aria-labelledby="home-guides">
        <h3 id="home-guides">Guides</h3>
        <ul>
          {GUIDES.map(guideLink).map((item) => (
            <li key={item.href}>
              <Link href={item.href}>{item.label}</Link>
            </li>
          ))}
        </ul>
      </nav>

      <nav aria-labelledby="home-reference">
        <h3 id="home-reference">API reference</h3>
        <ul>
          {SURFACES.map((surface) => (
            <li key={surface.id}>
              <Link href={`/reference/${surface.id}`}>{surface.title}</Link>
            </li>
          ))}
        </ul>
      </nav>

      <nav aria-labelledby="home-events">
        <h3 id="home-events">Webhook events</h3>
        <ul>
          {siteEvents.map((event) => (
            <li key={event.name}>
              <Link href={`/reference/webhook-events#${eventAnchor(event.name)}`} data-code="">
                {event.name}
              </Link>
            </li>
          ))}
          <li>
            <Link href="/reference/webhook-events">All {events.events.length} events</Link>
          </li>
        </ul>
      </nav>

      <nav aria-labelledby="home-more">
        <h3 id="home-more">More</h3>
        <ul>
          <li>
            <a href={GITHUB_URL}>GitHub</a>
          </li>
          <li>
            <a href={`${GITHUB_URL}/issues`}>Report a docs issue</a>
          </li>
          <li>
            <a href={MAIN_SITE_URL}>unitfield.com</a>
          </li>
        </ul>
      </nav>
    </div>
  );
}
