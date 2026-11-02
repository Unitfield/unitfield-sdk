"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type QueryStatus = "idle" | "loading" | "success" | "error";

export type QueryOptions<T> = {
  /** `false` waits: nothing is fetched and the status stays `idle`. Default `true`. */
  enabled?: boolean;
  /**
   * Data you already have, usually read on the server and passed down. The hook starts in `success` with it and does not
   * fetch until the key changes or you call `refetch`.
   */
  initialData?: T;
};

export type QueryResult<T> = {
  data: T | undefined;
  /** The failure of the latest request. Compare with `isUnitfieldError` / `instanceof` the SDK's error classes. */
  error: Error | null;
  status: QueryStatus;
  /** True while a request for the current key is in flight, including after `refetch`. */
  isLoading: boolean;
  /** Reads again, even when the data is fresh. */
  refetch: () => void;
};

type State<T> = { key: string; data: T | undefined; error: Error | null; status: QueryStatus };

/**
 * One read, keyed by a string. There is no cache beyond the component: repeat reads are served by the browser's HTTP
 * cache (the API sends `Cache-Control: public, max-age=60`), and `initialData` covers what the server already fetched.
 * Rendering never fetches, so the first server render shows the `loading` (or `idle`) state, or `initialData`.
 */
export function useQuery<T>(key: string, fetcher: (signal: AbortSignal) => Promise<T>, options: QueryOptions<T> = {}): QueryResult<T> {
  const { enabled = true, initialData } = options;
  const [state, setState] = useState<State<T>>(() =>
    initialData !== undefined ? { key, data: initialData, error: null, status: "success" } : { key, data: undefined, error: null, status: enabled ? "loading" : "idle" },
  );
  const [nonce, setNonce] = useState(0);
  const latestFetcher = useRef(fetcher);
  useEffect(() => {
    latestFetcher.current = fetcher;
  });
  // The (key, nonce) pair whose result is already in `state`. It makes the effect idempotent, so React's strict-mode
  // double invocation and `initialData` never cause a second request.
  const satisfied = useRef<string | null>(initialData !== undefined ? `${key}\u0000${0}` : null);

  useEffect(() => {
    if (!enabled) return;
    const token = `${key}\u0000${nonce}`;
    if (satisfied.current === token) return;
    const controller = new AbortController();
    if (nonce > 0) setState((previous) => (previous.key === key ? { ...previous, status: "loading" } : previous));
    latestFetcher.current(controller.signal).then(
      (data) => {
        if (controller.signal.aborted) return;
        satisfied.current = token;
        setState({ key, data, error: null, status: "success" });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        satisfied.current = token;
        setState({ key, data: undefined, error: error instanceof Error ? error : new Error(String(error)), status: "error" });
      },
    );
    return () => controller.abort();
  }, [key, enabled, nonce]);

  const refetch = useCallback(() => setNonce((value) => value + 1), []);

  // A key that changed since the last result shows as loading at once, without a render that carries stale data.
  const current: State<T> = state.key === key ? state : { key, data: undefined, error: null, status: enabled ? "loading" : "idle" };
  const status: QueryStatus = !enabled && current.status === "loading" ? "idle" : current.status;
  return { data: current.data, error: current.error, status, isLoading: status === "loading", refetch };
}
