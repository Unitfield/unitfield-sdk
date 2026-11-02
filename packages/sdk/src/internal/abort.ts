import { RequestTimeoutError } from "../errors.js";

export function createAbortError(message = "The operation was aborted."): Error {
  return typeof DOMException === "undefined"
    ? Object.assign(new Error(message), { name: "AbortError" })
    : new DOMException(message, "AbortError");
}

/** True when `error` is an abort, or when the caller's signal has fired (whatever the runtime threw). */
export function isAbortError(error: unknown, signal?: AbortSignal | null): boolean {
  if (signal?.aborted) return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.name === "AbortError" || candidate.code === "ABORT_ERR";
}

export function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? createAbortError();
}

export function throwIfAborted(signal: AbortSignal | null | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

export function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal!));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export type AttemptSignal = {
  signal: AbortSignal;
  /** True when the attempt was cut short by `timeoutMs` rather than by the caller. */
  timedOut(): boolean;
  dispose(): void;
};

/** One signal per attempt: the caller's signal plus an optional timeout. Always `dispose()` it. */
export function attemptSignal(caller: AbortSignal | null | undefined, timeoutMs: number): AttemptSignal {
  const controller = new AbortController();
  let timedOut = false;
  const onCallerAbort = () => controller.abort(caller ? abortReason(caller) : undefined);
  if (caller) {
    if (caller.aborted) onCallerAbort();
    else caller.addEventListener("abort", onCallerAbort, { once: true });
  }
  const timer =
    timeoutMs > 0 && Number.isFinite(timeoutMs)
      ? setTimeout(() => {
          timedOut = true;
          controller.abort(new RequestTimeoutError(timeoutMs));
        }, timeoutMs)
      : undefined;
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      caller?.removeEventListener("abort", onCallerAbort);
    },
  };
}
