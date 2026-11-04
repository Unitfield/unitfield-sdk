import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { Logo } from "@/components/logo";
import { GITHUB_URL } from "./site";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: { title: <Logo />, url: "/" },
    githubUrl: GITHUB_URL,
    links: [
      { text: "Guides", url: "/docs", active: "nested-url" },
      { text: "API reference", url: "/reference", active: "nested-url" },
      { text: "Webhooks", url: "/reference/webhook-events", active: "url" },
    ],
  };
}
