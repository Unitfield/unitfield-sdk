import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { createStorefrontClient, NotFoundError, type StorefrontClient } from "@unitfield/sdk";
import { StrictMode, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UnitfieldProvider, useListing, useListings, useSite, useUnitfield } from "../src/index.js";
import { API, KEY, detail, fakeApi, fixtureApi, listing } from "./fixtures.js";

function wrapperFor(client: ReturnType<typeof fixtureApi>["client"]) {
  return ({ children }: { children: ReactNode }) => <UnitfieldProvider client={client}>{children}</UnitfieldProvider>;
}

describe("UnitfieldProvider", () => {
  it("builds a client from the key and API URL and sends the key on every read", async () => {
    const api = fixtureApi();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <UnitfieldProvider publishableKey={KEY} apiUrl={API} fetchOptions={{ cache: "no-store" }}>
        {children}
      </UnitfieldProvider>
    );
    // The provider builds its own client, so route its fetch through the fake by wrapping the global for this test.
    const original = globalThis.fetch;
    globalThis.fetch = api.fetch;
    try {
      const { result } = renderHook(() => useSite(), { wrapper });
      await waitFor(() => expect(result.current.status).toBe("success"));
      expect(result.current.data?.brand.name).toBe("Maple Rentals");
      expect(api.calls[0]?.url.origin).toBe(API);
      expect(api.calls[0]?.headers.get("x-unitfield-key")).toBe(KEY);
      expect(api.calls[0]?.init.cache).toBe("no-store");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("rejects a malformed publishable key the way the SDK does", () => {
    expect(() => renderToString(<UnitfieldProvider publishableKey="not-a-key" />)).toThrow(TypeError);
  });

  it("reuses one client while its inputs stay the same", () => {
    const api = fixtureApi();
    const seen: unknown[] = [];
    function Probe() {
      seen.push(useUnitfield().client);
      return null;
    }
    const { rerender } = render(<UnitfieldProvider client={api.client}><Probe /></UnitfieldProvider>);
    rerender(<UnitfieldProvider client={api.client}><Probe /></UnitfieldProvider>);
    expect(new Set(seen).size).toBe(1);
  });

  it("makes the hooks fail loudly outside a provider", () => {
    expect(() => renderHook(() => useSite())).toThrow(/UnitfieldProvider/);
  });
});

describe("useSite", () => {
  it("goes from loading to success with the site", async () => {
    const api = fixtureApi();
    const { result } = renderHook(() => useSite(), { wrapper: wrapperFor(api.client) });
    expect(result.current.status).toBe("loading");
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.data?.hostedUrls.applyBaseUrl).toBe("https://homes.example.test/apply");
    expect(result.current.error).toBeNull();
  });

  it("sends the preview token and nothing is cached by the hook", async () => {
    const api = fixtureApi();
    const { result } = renderHook(() => useSite({ previewToken: "preview-token" }), { wrapper: wrapperFor(api.client) });
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(api.calls[0]?.headers.get("x-unitfield-preview")).toBe("preview-token");
    expect(api.calls[0]?.init.cache).toBe("no-store");
  });
});

describe("useListings", () => {
  it("passes the query to the API", async () => {
    const api = fixtureApi();
    const { result } = renderHook(() => useListings({ city: "Austin", bedroomsMin: 2, sort: "rent", limit: 12 }), { wrapper: wrapperFor(api.client) });
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.data?.items.map((item) => item.listingPublicId)).toEqual(["clst_one", "clst_two"]);
    expect(Object.fromEntries(api.calls[0]!.url.searchParams)).toEqual({ city: "Austin", bedroomsMin: "2", sort: "rent", limit: "12" });
  });

  it("does not read again for an inline query object with the same values", async () => {
    const api = fixtureApi();
    const { result, rerender } = renderHook(() => useListings({ city: "Austin", bedroomsMin: 2 }), { wrapper: wrapperFor(api.client) });
    await waitFor(() => expect(result.current.status).toBe("success"));
    rerender();
    rerender();
    expect(api.calls).toHaveLength(1);
  });

  it("reads again when a value changes, and never shows the previous query's data as current", async () => {
    const api = fixtureApi();
    const { result, rerender } = renderHook(({ city }: { city: string }) => useListings({ city }), { wrapper: wrapperFor(api.client), initialProps: { city: "Austin" } });
    await waitFor(() => expect(result.current.status).toBe("success"));
    rerender({ city: "Dallas" });
    expect(result.current.status).toBe("loading");
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(api.calls.map((call) => call.url.searchParams.get("city"))).toEqual(["Austin", "Dallas"]);
  });

  it("starts from initialData without a request, until refetch", async () => {
    const api = fixtureApi();
    const initialData = { items: [listing({ title: "From the server" })], nextCursor: null };
    const { result } = renderHook(() => useListings({}, { initialData }), { wrapper: wrapperFor(api.client) });
    expect(result.current.status).toBe("success");
    expect(result.current.data?.items[0]?.title).toBe("From the server");
    await act(async () => {});
    expect(api.calls).toHaveLength(0);

    act(() => result.current.refetch());
    expect(result.current.status).toBe("loading");
    expect(result.current.data?.items[0]?.title).toBe("From the server");
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(api.calls).toHaveLength(1);
    expect(result.current.data?.items[0]?.title).toBe("Sunny two-bedroom");
  });

  it("waits while disabled", async () => {
    const api = fixtureApi();
    const { result, rerender } = renderHook(({ enabled }: { enabled: boolean }) => useListings({}, { enabled }), { wrapper: wrapperFor(api.client), initialProps: { enabled: false } });
    expect(result.current.status).toBe("idle");
    await act(async () => {});
    expect(api.calls).toHaveLength(0);
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(api.calls).toHaveLength(1);
  });

  it("surfaces a typed SDK error", async () => {
    const api = fakeApi(() => Response.json({ code: "storefront.key_invalid" }, { status: 401 }));
    const client = createStorefrontClient({ publishableKey: KEY, baseUrl: API, fetch: api.fetch, retry: false });
    const { result } = renderHook(() => useListings(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.name).toBe("AuthenticationError");
    expect(result.current.data).toBeUndefined();
  });

  it("hands the SDK an abort signal and fires it when the component unmounts, so a late answer is dropped", async () => {
    let signal: AbortSignal | null | undefined;
    let answer: (page: { items: never[]; nextCursor: null }) => void = () => {};
    // The SDK's own signal handling is tested in the SDK; here the contract is what the hook passes in and does afterwards.
    const client = {
      listings: {
        list: (_query: unknown, options: { signal?: AbortSignal | null }) => {
          signal = options.signal;
          return new Promise((resolve) => (answer = resolve as typeof answer));
        },
      },
    } as unknown as StorefrontClient;
    const { result, unmount } = renderHook(() => useListings(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(signal).toBeTruthy());
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
    answer({ items: [], nextCursor: null });
    await act(async () => {});
    expect(result.current.status).toBe("loading");
  });

  it("aborts the previous request when the query changes", async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    const client = {
      listings: {
        list: (_query: unknown, options: { signal?: AbortSignal | null }) => {
          signals.push(options.signal);
          return new Promise(() => {});
        },
      },
    } as unknown as StorefrontClient;
    const { rerender } = renderHook(({ city }: { city: string }) => useListings({ city }), { wrapper: wrapperFor(client), initialProps: { city: "Austin" } });
    await waitFor(() => expect(signals).toHaveLength(1));
    rerender({ city: "Dallas" });
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it("makes one logical read under StrictMode", async () => {
    const api = fixtureApi();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <UnitfieldProvider client={api.client}>{children}</UnitfieldProvider>
      </StrictMode>
    );
    const { result } = renderHook(() => useListings(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("success"));
    // Strict mode runs effects twice in development: the first request is aborted, the second one answers.
    expect(api.calls.length).toBeLessThanOrEqual(2);
    expect(result.current.data?.items).toHaveLength(2);
  });
});

describe("useListing", () => {
  it("reads one listing by its public id", async () => {
    const api = fixtureApi();
    const { result } = renderHook(() => useListing("clst_two"), { wrapper: wrapperFor(api.client) });
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(api.calls[0]?.url.pathname).toBe("/api/storefront/v1/listings/clst_two");
    expect(result.current.data?.card.title).toBe("Garden studio");
  });

  it("waits for an id and reports a missing listing as NotFoundError", async () => {
    const api = fixtureApi();
    const { result, rerender } = renderHook(({ id }: { id: string | undefined }) => useListing(id), { wrapper: wrapperFor(api.client), initialProps: { id: undefined as string | undefined } });
    expect(result.current.status).toBe("idle");
    expect(api.calls).toHaveLength(0);
    rerender({ id: "clst_missing" });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBeInstanceOf(NotFoundError);
  });

  it("accepts server-read detail as initialData", () => {
    const api = fixtureApi();
    const { result } = renderHook(() => useListing("clst_one", { initialData: detail() }), { wrapper: wrapperFor(api.client) });
    expect(result.current.status).toBe("success");
    expect(api.calls).toHaveLength(0);
  });
});

describe("server rendering", () => {
  it("renders the loading state and starts no request", () => {
    const api = fixtureApi();
    function Page() {
      const { status, data } = useListings();
      return <p>{`${status}:${data?.items.length ?? "none"}`}</p>;
    }
    const html = renderToString(
      <UnitfieldProvider client={api.client}>
        <Page />
      </UnitfieldProvider>,
    );
    expect(html).toContain("loading:none");
    expect(api.calls).toHaveLength(0);
  });

  it("renders initialData as is", () => {
    const api = fixtureApi();
    function Page() {
      const { data } = useListings({}, { initialData: { items: [listing()], nextCursor: null } });
      return <p>{data?.items[0]?.title}</p>;
    }
    expect(renderToString(<UnitfieldProvider client={api.client}><Page /></UnitfieldProvider>)).toContain("Sunny two-bedroom");
    expect(api.calls).toHaveLength(0);
  });

  it("shows the same markup on the first client render as on the server", async () => {
    const api = fixtureApi();
    function Page() {
      const { status } = useSite();
      return <p>{status}</p>;
    }
    const tree = (
      <UnitfieldProvider client={api.client}>
        <Page />
      </UnitfieldProvider>
    );
    const server = renderToString(tree);
    const { container } = render(tree);
    expect(server).toContain(">loading<");
    expect(container.textContent).toBe("loading");
    await waitFor(() => expect(screen.getByText("success")).toBeTruthy());
  });
});
