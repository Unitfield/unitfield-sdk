import { HomeLayout } from "fumadocs-ui/layouts/home";
import Link from "next/link";
import { baseOptions } from "@/lib/layout.shared";

export default function NotFound() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className="uf-home">
        <div className="uf-hero-copy" style={{ maxWidth: 560 }}>
          <h1>That page is not here</h1>
          <p>It may have moved, or the address has a typo. The guides and the API reference are a click away.</p>
          <div className="uf-actions">
            <Link href="/docs" className="uf-button uf-button-primary">
              Guides
            </Link>
            <Link href="/reference" className="uf-button uf-button-quiet">
              API reference
            </Link>
          </div>
        </div>
      </div>
    </HomeLayout>
  );
}
