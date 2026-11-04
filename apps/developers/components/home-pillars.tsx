import { ArrowRightIcon, BrowserIcon, PlugIcon, WebhookIcon } from "@unitfield/ui/icons";
import Link from "next/link";
import type { ReactNode } from "react";
import { getPublicApi } from "@/lib/public-api/load";

// Three audiences, one card each. The picture on a card is a small, real fragment of what that audience touches, drawn in the page's own
// tokens: a call and what it returns, the scopes an installation was granted, an event and its data. No window, no screenshot.

/** The scopes an installed app can be granted, read from the published document so the chips cannot drift from the API. */
function appScopes(wanted: string[]): string[] {
  const flows = getPublicApi().documents.apps?.components?.securitySchemes?.OAuth2?.flows;
  const known = Object.keys(flows?.clientCredentials?.scopes ?? {});
  for (const scope of wanted) if (!known.includes(scope)) throw new Error(`The home page shows the scope "${scope}", which the Installed apps API does not list.`);
  return wanted;
}

const k = (text: string) => <span className="uf-t-key">{text}</span>;
const s = (text: string) => <span className="uf-t-str">{text}</span>;
const p = (text: string) => <span className="uf-t-punct">{text}</span>;

function SiteFragment() {
  return (
    <div className="uf-frag">
      <code className="uf-frag-line uf-frag-call">storefront.listings.list()</code>
      <dl className="uf-frag-rows">
        <div>
          <dt>title</dt>
          <dd>{s('"Cedar Court 2B"')}</dd>
        </div>
        <div>
          <dt>rent</dt>
          <dd>1850</dd>
        </div>
        <div>
          <dt>applyUrl</dt>
          <dd>{s('"https://…/cedar-court-2b"')}</dd>
        </div>
      </dl>
    </div>
  );
}

function AppsFragment() {
  const scopes = appScopes(["listings:read", "applications:read", "payments:create", "webhooks:manage"]);
  return (
    <div className="uf-frag">
      <code className="uf-frag-line uf-frag-call">grant_type=client_credentials</code>
      <ul className="uf-chips">
        {scopes.map((scope) => (
          <li key={scope}>{scope}</li>
        ))}
      </ul>
    </div>
  );
}

function EventsFragment() {
  return (
    <div className="uf-frag">
      <pre className="uf-frag-json">
        <code>
          {p("{")}
          {"\n  "}
          {k('"type"')}
          {p(": ")}
          {s('"listing.updated"')}
          {p(",")}
          {"\n  "}
          {k('"data"')}
          {p(": {")}
          {"\n    "}
          {k('"listingPublicId"')}
          {p(": ")}
          {s('"lst_sample"')}
          {"\n  "}
          {p("}")}
          {"\n"}
          {p("}")}
        </code>
      </pre>
    </div>
  );
}

interface Pillar {
  id: string;
  icon: ReactNode;
  title: string;
  text: string;
  href: string;
  more: { label: string; href: string; code?: boolean }[];
  fragment: ReactNode;
}

const PILLARS: Pillar[] = [
  {
    id: "site",
    icon: <BrowserIcon aria-hidden size={20} />,
    title: "Your own site",
    text: "Read your published homes, sign renters in and link to the hosted apply flow, from any framework.",
    href: "/docs/quickstart",
    more: [
      { label: "@unitfield/react", href: "/docs/react", code: true },
      { label: "create-unitfield-site", href: "/docs/nextjs-starter", code: true },
    ],
    fragment: <SiteFragment />,
  },
  {
    id: "apps",
    icon: <PlugIcon aria-hidden size={20} />,
    title: "Apps for operators",
    text: "Build an app an operator installs. It calls the Installed apps API with the scopes it was granted.",
    href: "/reference/apps",
    more: [{ label: "App management API", href: "/reference/platform" }],
    fragment: <AppsFragment />,
  },
  {
    id: "events",
    icon: <WebhookIcon aria-hidden size={20} />,
    title: "Events",
    text: "Unitfield tells your server when listings or the site change, signed and retried, so nothing waits on a timer.",
    href: "/docs/webhooks",
    more: [{ label: "Event catalog", href: "/reference/webhook-events" }],
    fragment: <EventsFragment />,
  },
];

export function Pillars() {
  return (
    <div className="uf-pillars">
      {PILLARS.map((pillar) => (
        <article key={pillar.id} className="uf-pillar">
          <div className="uf-pillar-stage" aria-hidden>
            {pillar.fragment}
          </div>
          <div className="uf-pillar-body">
            <h3 className="uf-pillar-title">
              {pillar.icon}
              <Link href={pillar.href} className="uf-pillar-link">
                {pillar.title}
                <ArrowRightIcon aria-hidden size={16} className="uf-pillar-arrow" />
              </Link>
            </h3>
            <p>{pillar.text}</p>
            <ul className="uf-pillar-more">
              {pillar.more.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="uf-link" data-code={item.code ? "" : undefined}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </article>
      ))}
    </div>
  );
}
