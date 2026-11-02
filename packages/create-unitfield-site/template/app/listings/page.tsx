import { ListingGrid } from "@unitfield/react";
import type { Metadata } from "next";
import Link from "next/link";
import { ListingCard } from "@/components/listing-card";
import { parseSearch, searchHref, toQuery } from "@/lib/search";
import { storefront } from "@/lib/storefront";

export const metadata: Metadata = { title: "Homes for rent" };

export default async function ListingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = parseSearch(await searchParams);
  const { items, nextCursor } = await storefront().listings.list(toQuery(search));
  const filtered = search.city !== undefined || search.bedrooms !== undefined || search.maxRent !== undefined;

  return (
    <>
      <h1>Homes for rent</h1>
      {/* A plain GET form: the search lives in the URL, so it can be shared and works without JavaScript. */}
      <form action="/listings" method="get" className="filters" aria-label="Filter homes">
        <div>
          <label htmlFor="city">City</label>
          <input id="city" name="city" defaultValue={search.city ?? ""} maxLength={80} autoComplete="off" />
        </div>
        <div>
          <label htmlFor="bedrooms">Bedrooms</label>
          <select id="bedrooms" name="bedrooms" defaultValue={search.bedrooms === undefined ? "" : String(search.bedrooms)}>
            <option value="">Any</option>
            <option value="0">Studio or more</option>
            <option value="1">1 or more</option>
            <option value="2">2 or more</option>
            <option value="3">3 or more</option>
            <option value="4">4 or more</option>
          </select>
        </div>
        <div>
          <label htmlFor="maxRent">Highest rent</label>
          <input id="maxRent" name="maxRent" inputMode="numeric" pattern="[0-9]*" placeholder="No limit" defaultValue={search.maxRent ?? ""} />
        </div>
        <div>
          <label htmlFor="sort">Sort by</label>
          <select id="sort" name="sort" defaultValue={search.sort}>
            <option value="newest">Newest</option>
            <option value="rent">Rent, low to high</option>
            <option value="rent_desc">Rent, high to low</option>
            <option value="availability">Available soonest</option>
          </select>
        </div>
        <button type="submit" className="button primary">
          Search
        </button>
      </form>

      <ListingGrid
        listings={items}
        className="grid"
        empty={
          <p className="muted" role="status">
            {filtered ? "No homes match your search." : "No homes are listed right now. Please check back soon."}
            {filtered ? (
              <>
                {" "}
                <Link href="/listings">Clear the search</Link>
              </>
            ) : null}
          </p>
        }
      >
        {(listing) => <ListingCard listing={listing} />}
      </ListingGrid>

      <nav aria-label="Pages" className="pager">
        {search.cursor ? <Link href={searchHref(search)}>Back to the first page</Link> : <span />}
        {nextCursor ? (
          <Link href={searchHref(search, nextCursor)} rel="next">
            More homes
          </Link>
        ) : null}
      </nav>
    </>
  );
}
