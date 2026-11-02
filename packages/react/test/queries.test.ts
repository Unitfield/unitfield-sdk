import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { queryKeys, unitfieldQueries } from "../src/index.js";
import { fixtureApi } from "./fixtures.js";

describe("unitfieldQueries", () => {
  it("gives each read a JSON key and a function", async () => {
    const api = fixtureApi();
    const queries = unitfieldQueries(api.client);
    expect(queries.site().queryKey).toEqual(["unitfield", "site"]);
    expect(queries.listing("clst_one").queryKey).toEqual(["unitfield", "listing", "clst_one"]);
    expect((await queries.site().queryFn()).brand.name).toBe("Maple Rentals");
    expect((await queries.listings({ city: "Austin" }).queryFn()).items).toHaveLength(2);
    expect((await queries.listing("clst_one").queryFn()).card.listingPublicId).toBe("clst_one");
  });

  it("keys equal queries equally, whatever the property order or Date form", () => {
    expect(queryKeys.listings({ city: "Austin", sort: "rent" })).toEqual(queryKeys.listings({ sort: "rent", city: "Austin" }));
    expect(queryKeys.listings({ availableBy: new Date("2026-12-01T00:00:00Z") })).toEqual(queryKeys.listings({ availableBy: "2026-12-01" }));
    expect(queryKeys.listings({ city: undefined })).toEqual(queryKeys.listings());
    expect(queryKeys.site("token")).not.toEqual(queryKeys.site());
  });

  it("plugs into TanStack Query without an adapter", async () => {
    const api = fixtureApi();
    const queries = unitfieldQueries(api.client);
    const queryClient = new QueryClient();
    const first = await queryClient.fetchQuery(queries.listings({ city: "Austin" }));
    const second = await queryClient.fetchQuery({ ...queries.listings({ city: "Austin" }), staleTime: 60_000 });
    expect(first.items).toHaveLength(2);
    expect(second).toBe(first);
    expect(api.calls).toHaveLength(1);
    // TanStack hands the query function its abort signal; the SDK request carries it.
    expect(api.calls[0]?.init.signal).toBeTruthy();
  });
});
