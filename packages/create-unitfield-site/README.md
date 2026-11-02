# create-unitfield-site

Scaffolds a [Next.js](https://nextjs.org) (App Router) site on the Unitfield storefront API.

```bash
npx create-unitfield-site my-site
cd my-site
npm run dev
```

The scaffolder asks for your publishable key (Website > Developers in Unitfield; Enter skips it), copies the starter, writes
`.env.local`, and installs dependencies. Without a terminal, say everything on the command line:

```bash
npx create-unitfield-site my-site --key pk_test_… --yes
```

| Option | |
| --- | --- |
| `--key <pk_…>` | Publishable key for `.env.local`. |
| `--api-url <url>` | API origin, default `https://api.unitfield.com`. |
| `--package-manager <npm\|pnpm\|yarn\|bun>` | Default: the one that ran the command. |
| `--no-install` | Create the files only. |
| `-y, --yes` | Never ask. |

It refuses a directory that already holds files and creates no git repository.

## What you get

- the homes for rent, a page for each home, with photos, facts and the hosted **Apply** link;
- an inquiry form (question or tour request) that posts from the browser to the Unitfield API;
- customer sign-in with OIDC authorization code + PKCE, done on the server, tokens in a sealed httpOnly cookie;
- a link to the hosted account;
- an optional webhook route that refreshes cached reads when your listings or site change;
- a plain, accessible, light and dark stylesheet you can restyle from a handful of tokens.

Dependencies are pinned to exact versions: Next.js 16 (App Router), React 19, `@unitfield/sdk` and `@unitfield/react`.
Its own README, in the new site, covers setup, sign-in, inquiries and webhooks.

## License

MIT
