import type { ListingSummary } from "@unitfield/sdk";
import { ApplyButton, ListingAvailability, ListingFacts, ListingImage, ListingLocation, ListingPrice, ListingTitle } from "@unitfield/react";
import Link from "next/link";

/** One home in a grid. Built from the headless parts of @unitfield/react: the markup and the styling are yours. */
export function ListingCard({ listing }: { listing: ListingSummary }) {
  return (
    <article className="card">
      <Link href={`/listings/${encodeURIComponent(listing.listingPublicId)}`} className="card-image" tabIndex={-1} aria-hidden="true">
        <ListingImage listing={listing} alt="" fallback={<span className="no-photo">No photo yet</span>} />
      </Link>
      <div className="card-body">
        <ListingTitle listing={listing} as="h2" className="card-title">
          <Link href={`/listings/${encodeURIComponent(listing.listingPublicId)}`}>{listing.title}</Link>
        </ListingTitle>
        <p className="price">
          <ListingPrice listing={listing} />
        </p>
        <ListingFacts listing={listing} className="facts" />
        <p className="muted small">
          <ListingLocation listing={listing} />
          {listing.city || listing.state ? " · " : null}
          Available <ListingAvailability listing={listing} />
        </p>
        <ApplyButton listing={listing} className="button" />
      </div>
    </article>
  );
}
