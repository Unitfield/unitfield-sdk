<script lang="ts">
  import { isUnitfieldError, type ListingDetail, type ListingSummary } from "@unitfield/sdk";
  import { onMount } from "svelte";
  import { rent, storefront } from "./storefront";

  let city = $state("");
  let bedrooms = $state("");
  let listings = $state<ListingSummary[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // The open listing lives in the URL hash (#listing=<id>), so the back button works without a router.
  const readHash = () => new URLSearchParams(location.hash.slice(1)).get("listing");
  let openId = $state<string | null>(readHash());
  let detail = $state<ListingDetail | null>(null);
  let detailError = $state<string | null>(null);

  function describe(failure: unknown): string {
    return isUnitfieldError(failure) ? failure.message : "Something went wrong. Please try again.";
  }

  let controller: AbortController | undefined;

  async function search(event?: Event) {
    event?.preventDefault();
    controller?.abort();
    const current = (controller = new AbortController());
    loading = true;
    error = null;
    try {
      const page = await storefront.listings.list(
        { limit: 24, sort: "rent", ...(city.trim() ? { city: city.trim() } : {}), ...(bedrooms ? { bedroomsMin: Number(bedrooms) } : {}) },
        { signal: current.signal },
      );
      listings = page.items;
    } catch (failure) {
      if (current.signal.aborted) return;
      error = describe(failure);
    } finally {
      if (!current.signal.aborted) loading = false;
    }
  }

  // Load the open listing whenever the id changes; a newer id cancels the older read's result.
  $effect(() => {
    const id = openId;
    detail = null;
    detailError = null;
    if (!id) return;
    let stale = false;
    storefront.listings.get(id).then(
      (value) => {
        if (!stale) detail = value;
      },
      (failure: unknown) => {
        if (!stale) detailError = describe(failure);
      },
    );
    return () => {
      stale = true;
    };
  });

  onMount(() => {
    const onHashChange = () => (openId = readHash());
    window.addEventListener("hashchange", onHashChange);
    void search();
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      controller?.abort();
    };
  });

  const summary = $derived(listings.length === 1 ? "1 home" : `${listings.length} homes`);
</script>

<main>
  {#if openId}
    <p><a href="#all">&larr; All homes</a></p>
    {#if detailError}
      <p role="alert">{detailError}</p>
    {:else if !detail}
      <p>Loading…</p>
    {:else}
      <article>
        <h1>{detail.card.title}</h1>
        <p>{rent(detail.card)} &middot; {detail.card.bedrooms} bd &middot; {detail.card.bathrooms} ba</p>
        {#if detail.photos[0]}
          <img src={detail.photos[0].url} alt={detail.photos[0].alt ?? detail.card.title} width="640" />
        {/if}
        {#each (detail.description ?? "").split(/\n+/).filter(Boolean) as paragraph (paragraph)}
          <p>{paragraph}</p>
        {/each}
        <!-- The application happens on the hosted apply page; null means this home is not taking applications. -->
        {#if detail.card.applyUrl}
          <p><a href={detail.card.applyUrl}>Apply for this home</a></p>
        {:else}
          <p>This home is not taking applications right now.</p>
        {/if}
      </article>
    {/if}
  {:else}
    <h1>Homes for rent</h1>
    <form onsubmit={search}>
      <label>City <input bind:value={city} name="city" autocomplete="off" /></label>
      <label>
        Bedrooms
        <select bind:value={bedrooms} name="bedrooms">
          <option value="">Any</option>
          <option value="1">1+</option>
          <option value="2">2+</option>
          <option value="3">3+</option>
        </select>
      </label>
      <button type="submit">Search</button>
    </form>

    {#if error}
      <p role="alert">{error}</p>
    {:else if loading}
      <p role="status">Loading…</p>
    {:else}
      <p role="status">{summary}</p>
      {#if listings.length}
        <ul>
          {#each listings as listing (listing.listingPublicId)}
            <li>
              <a href={`#listing=${encodeURIComponent(listing.listingPublicId)}`}>{listing.title}</a>
              &mdash; {rent(listing)}, {listing.bedrooms === 0 ? "studio" : `${listing.bedrooms} bd`}{listing.city ? `, ${listing.city}` : ""}
            </li>
          {/each}
        </ul>
      {:else}
        <p>No homes match.</p>
      {/if}
    {/if}
  {/if}
</main>

<style>
  :global(body) {
    font-family: system-ui, sans-serif;
    margin: 0;
  }
  main {
    max-width: 44rem;
    margin: 2rem auto;
    padding: 0 1rem;
  }
  form {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: end;
    margin-bottom: 1.5rem;
  }
  img {
    max-width: 100%;
    height: auto;
  }
</style>
