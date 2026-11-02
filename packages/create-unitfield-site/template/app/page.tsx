import { ListingGrid } from "@unitfield/react";
import Link from "next/link";
import { ListingCard } from "@/components/listing-card";
import { storefront } from "@/lib/storefront";

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ brand }, { items }, params] = await Promise.all([storefront().site.get(), storefront().listings.list({ limit: 6, sort: "newest" }), searchParams]);
  return (
    <>
      {params["sign-in"] === "failed" ? (
        <p role="alert" className="error banner">
          We could not sign you in. Please try again.
        </p>
      ) : null}
      <section className="hero">
        <h1>Find your next home with {brand.name}</h1>
        <p className="lead">Browse what is available now, then apply online in a few minutes.</p>
        <Link href="/listings" className="button primary">
          See all homes
        </Link>
      </section>
      <section aria-labelledby="newest">
        <h2 id="newest">Newest homes</h2>
        <ListingGrid listings={items} className="grid" empty={<p className="muted">No homes are listed right now. Please check back soon.</p>}>
          {(listing) => <ListingCard listing={listing} />}
        </ListingGrid>
      </section>
    </>
  );
}
