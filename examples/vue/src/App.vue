<script setup lang="ts">
import { isUnitfieldError, type ListingDetail, type ListingSummary } from "@unitfield/sdk";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { rent, storefront } from "./storefront";

const city = ref("");
const bedrooms = ref("");
const listings = ref<ListingSummary[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

// The open listing lives in the URL hash (#listing=<id>), so the back button works without a router.
const openId = ref(new URLSearchParams(location.hash.slice(1)).get("listing"));
const detail = ref<ListingDetail | null>(null);
const detailError = ref<string | null>(null);

function describe(failure: unknown): string {
  return isUnitfieldError(failure) ? failure.message : "Something went wrong. Please try again.";
}

let controller: AbortController | undefined;

async function search() {
  controller?.abort();
  controller = new AbortController();
  loading.value = true;
  error.value = null;
  try {
    const page = await storefront.listings.list(
      { limit: 24, sort: "rent", ...(city.value.trim() ? { city: city.value.trim() } : {}), ...(bedrooms.value ? { bedroomsMin: Number(bedrooms.value) } : {}) },
      { signal: controller.signal },
    );
    listings.value = page.items;
  } catch (failure) {
    if (controller.signal.aborted) return;
    error.value = describe(failure);
  } finally {
    if (!controller.signal.aborted) loading.value = false;
  }
}

async function loadDetail(id: string | null) {
  detail.value = null;
  detailError.value = null;
  if (!id) return;
  try {
    detail.value = await storefront.listings.get(id);
  } catch (failure) {
    detailError.value = describe(failure);
  }
}

function onHashChange() {
  openId.value = new URLSearchParams(location.hash.slice(1)).get("listing");
}

watch(openId, (id) => void loadDetail(id), { immediate: true });
onMounted(() => {
  window.addEventListener("hashchange", onHashChange);
  void search();
});
onBeforeUnmount(() => {
  window.removeEventListener("hashchange", onHashChange);
  controller?.abort();
});

const summary = computed(() => (listings.value.length === 1 ? "1 home" : `${listings.value.length} homes`));
</script>

<template>
  <main>
    <template v-if="openId">
      <p><a href="#all">&larr; All homes</a></p>
      <p v-if="detailError" role="alert">{{ detailError }}</p>
      <p v-else-if="!detail">Loading…</p>
      <article v-else>
        <h1>{{ detail.card.title }}</h1>
        <p>{{ rent(detail.card) }} &middot; {{ detail.card.bedrooms }} bd &middot; {{ detail.card.bathrooms }} ba</p>
        <img v-if="detail.photos[0]" :src="detail.photos[0].url" :alt="detail.photos[0].alt ?? detail.card.title" width="640" />
        <p v-for="paragraph in (detail.description ?? '').split(/\n+/).filter(Boolean)" :key="paragraph">{{ paragraph }}</p>
        <!-- The application happens on the hosted apply page; null means this home is not taking applications. -->
        <p v-if="detail.card.applyUrl"><a :href="detail.card.applyUrl">Apply for this home</a></p>
        <p v-else>This home is not taking applications right now.</p>
      </article>
    </template>

    <template v-else>
      <h1>Homes for rent</h1>
      <form @submit.prevent="search">
        <label>City <input v-model="city" name="city" autocomplete="off" /></label>
        <label>
          Bedrooms
          <select v-model="bedrooms" name="bedrooms">
            <option value="">Any</option>
            <option value="1">1+</option>
            <option value="2">2+</option>
            <option value="3">3+</option>
          </select>
        </label>
        <button type="submit">Search</button>
      </form>

      <p v-if="error" role="alert">{{ error }}</p>
      <p v-else-if="loading" role="status">Loading…</p>
      <template v-else>
        <p role="status">{{ summary }}</p>
        <ul v-if="listings.length">
          <li v-for="listing in listings" :key="listing.listingPublicId">
            <a :href="`#listing=${encodeURIComponent(listing.listingPublicId)}`">{{ listing.title }}</a>
            &mdash; {{ rent(listing) }}, {{ listing.bedrooms === 0 ? "studio" : `${listing.bedrooms} bd` }}{{ listing.city ? `, ${listing.city}` : "" }}
          </li>
        </ul>
        <p v-else>No homes match.</p>
      </template>
    </template>
  </main>
</template>

<style>
body {
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
