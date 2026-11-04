import { ApplyButton, ListingAvailability, ListingFacts, ListingImage, ListingLocation, ListingPrice } from "@unitfield/react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InquiryForm } from "@/components/inquiry-form";
import { inquiryMode } from "@/lib/inquiry";
import { isNotFound, storefront } from "@/lib/storefront";

type Props = { params: Promise<{ listingId: string }> };

async function load(listingId: string) {
  try {
    return await storefront().listings.get(listingId);
  } catch (error) {
    if (isNotFound(error)) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { card, description } = await load((await params).listingId);
  return { title: card.title, description: description?.slice(0, 160) ?? undefined };
}

export default async function ListingPage({ params }: Props) {
  const { listingId } = await params;
  const { card, description, photos, amenities, address1, postalCode, property, virtualTourUrl } = await load(listingId);
  const site = await storefront().site.get();
  const { contact } = site;
  const mode = inquiryMode(site);

  return (
    <article className="detail">
      <h1>{card.title}</h1>
      <p className="muted">
        {property.name}
        {address1 ? `, ${address1}` : ""}
        {card.city ? `, ${card.city}` : ""}
        {card.state ? `, ${card.state}` : ""}
        {postalCode ? ` ${postalCode}` : ""}
      </p>

      <div className="gallery" role="list" aria-label="Photos">
        {photos.length === 0 ? <p className="no-photo">No photos yet</p> : null}
        {photos.map((photo) => (
          <div role="listitem" key={photo.url}>
            <ListingImage photo={photo} />
          </div>
        ))}
      </div>

      <div className="detail-grid">
        <section aria-labelledby="about">
          <h2 id="about">About this home</h2>
          {description ? description.split(/\n+/).map((paragraph, index) => <p key={index}>{paragraph}</p>) : <p className="muted">No description yet.</p>}
          {amenities.length > 0 ? (
            <>
              <h3>Amenities</h3>
              <ul className="plain">
                {amenities.map((amenity) => (
                  <li key={amenity}>{amenity}</li>
                ))}
              </ul>
            </>
          ) : null}
          {virtualTourUrl && /^https?:\/\//i.test(virtualTourUrl) ? (
            <p>
              <a href={virtualTourUrl} rel="noopener noreferrer">
                Take the virtual tour
              </a>
            </p>
          ) : null}
        </section>

        <aside aria-label="Rent and apply" className="panel">
          <p className="price big">
            <ListingPrice listing={card} />
          </p>
          <ListingFacts listing={card} className="facts" />
          <p className="muted small">
            <ListingLocation listing={card} />
            {card.city || card.state ? " · " : null}
            Available <ListingAvailability listing={card} />
          </p>
          {/* The application itself happens on your Unitfield-hosted domain. Closed listings show a note instead. */}
          <ApplyButton listing={card} className="button primary wide" fallback={<p className="muted">This home is not taking applications right now.</p>}>
            Apply for this home
          </ApplyButton>
        </aside>
      </div>

      <section aria-labelledby="ask" className="inquiry">
        <h2 id="ask">Questions, or want to see it?</h2>
        {mode.kind === "off" ? (
          <p className="muted">
            {contact.email ? (
              <>
                Email <a href={`mailto:${contact.email}`}>{contact.email}</a>
              </>
            ) : (
              "Please get in touch with us directly."
            )}
            {contact.phone ? ` or call ${contact.phone}` : ""}.
          </p>
        ) : (
          <InquiryForm mode={mode} listingPublicId={card.listingPublicId} listingTitle={card.title} />
        )}
      </section>
    </article>
  );
}
