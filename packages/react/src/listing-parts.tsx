import type { ListingSummary, PublicPhoto } from "@unitfield/sdk";
import type { AnchorHTMLAttributes, ElementType, HTMLAttributes, ImgHTMLAttributes, ReactNode } from "react";
import { formatAvailability, formatLocation, formatRent, listingFacts } from "./format.js";

// These parts have no state and no hooks, so they render in Server Components as well as in the browser. They add no
// class names, styles or wrappers beyond the one element each returns.

export type ListingGridProps = Omit<HTMLAttributes<HTMLUListElement>, "children"> & {
  listings: readonly ListingSummary[];
  /** Renders one listing. Its result goes inside an `<li>` keyed by the listing's public id. */
  children: (listing: ListingSummary, index: number) => ReactNode;
  /** Shown instead of the list when there are no listings. Without it an empty `<ul>` is rendered. */
  empty?: ReactNode;
};

/** A `<ul>` with one `<li>` per listing. */
export function ListingGrid({ listings, children, empty, ...rest }: ListingGridProps) {
  if (listings.length === 0 && empty !== undefined) return <>{empty}</>;
  return (
    <ul {...rest}>
      {listings.map((listing, index) => (
        <li key={listing.listingPublicId}>{children(listing, index)}</li>
      ))}
    </ul>
  );
}

export type ListingImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt"> & {
  /** A listing card: its cover image is shown, with the listing title as the alt text. */
  listing?: Pick<ListingSummary, "coverImageUrl" | "title">;
  /** A photo of a listing detail's gallery. Wins over `listing`. */
  photo?: PublicPhoto;
  /** Overrides the alt text. An empty string marks the image as decorative. */
  alt?: string;
  /** Rendered when there is no image. */
  fallback?: ReactNode;
};

/** The cover image or one gallery photo as a plain, lazily loaded `<img>`. */
export function ListingImage({ listing, photo, alt, fallback = null, ...rest }: ListingImageProps) {
  const src = photo?.url ?? listing?.coverImageUrl;
  if (!src) return <>{fallback}</>;
  return <img loading="lazy" decoding="async" {...rest} src={src} alt={alt ?? photo?.alt ?? listing?.title ?? ""} />;
}

type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "span" | "div";

export type ListingTitleProps = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  listing: Pick<ListingSummary, "title">;
  /** The element to render. Default `h3`. */
  as?: HeadingTag;
  children?: ReactNode;
};

export function ListingTitle({ listing, as, children, ...rest }: ListingTitleProps) {
  const Tag: ElementType = as ?? "h3";
  return <Tag {...rest}>{children ?? listing.title}</Tag>;
}

export type ListingPriceProps = HTMLAttributes<HTMLSpanElement> & { listing: Pick<ListingSummary, "rent" | "currency" | "rentPeriod">; locale?: string };

/** `$4,800/mo`. */
export function ListingPrice({ listing, locale, children, ...rest }: ListingPriceProps) {
  return <span {...rest}>{children ?? formatRent(listing, locale)}</span>;
}

export type ListingFactsProps = Omit<HTMLAttributes<HTMLUListElement>, "children"> & {
  listing: Pick<ListingSummary, "bedrooms" | "bathrooms" | "areaSqft">;
  locale?: string;
  /** Renders one fact. Default: the text. */
  children?: (fact: string, index: number) => ReactNode;
};

/** Bedrooms, bathrooms and area as a `<ul>` of short facts. */
export function ListingFacts({ listing, locale, children, ...rest }: ListingFactsProps) {
  return (
    <ul {...rest}>
      {listingFacts(listing, locale).map((fact, index) => (
        <li key={fact}>{children ? children(fact, index) : fact}</li>
      ))}
    </ul>
  );
}

export type ListingLocationProps = HTMLAttributes<HTMLSpanElement> & { listing: Pick<ListingSummary, "city" | "state"> };

/** `Austin, TX`. Renders nothing when the listing has no city or state. */
export function ListingLocation({ listing, children, ...rest }: ListingLocationProps) {
  const text = formatLocation(listing);
  return text || children ? <span {...rest}>{children ?? text}</span> : null;
}

export type ListingAvailabilityProps = Omit<HTMLAttributes<HTMLTimeElement>, "dateTime"> & { listing: Pick<ListingSummary, "availableFrom">; locale?: string };

/** `<time>` with the first day the home can be rented, for example `Nov 2, 2026`. */
export function ListingAvailability({ listing, locale, children, ...rest }: ListingAvailabilityProps) {
  return (
    <time {...rest} dateTime={listing.availableFrom}>
      {children ?? formatAvailability(listing.availableFrom, locale)}
    </time>
  );
}

export type ApplyButtonProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  /** A listing card or detail card: its `applyUrl` is the hosted apply page. */
  listing?: Pick<ListingSummary, "applyUrl">;
  /** An absolute URL, when you build it yourself. Wins over `listing`. */
  href?: string | null;
  /** Rendered when applications are closed (`applyUrl` is `null`) or the URL is not an http(s) URL. Default: nothing. */
  fallback?: ReactNode;
};

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * A link to the hosted apply page: the applicant continues on the operator's Unitfield-hosted domain, where the draft,
 * the sign-in and the submission live. It is a plain `<a>`; style it and add `target` or `rel` as you like.
 */
export function ApplyButton({ listing, href, fallback = null, children = "Apply", ...rest }: ApplyButtonProps) {
  const target = href !== undefined ? href : listing?.applyUrl;
  if (!target || !isHttpUrl(target)) return <>{fallback}</>;
  return (
    <a {...rest} href={target}>
      {children}
    </a>
  );
}
