import { UnitfieldError } from "./errors.js";

/** The cursor envelope of the Storefront API: `?cursor=&limit=` in, `{ items, nextCursor }` out. */
export type CursorPage<T> = {
  items: T[];
  /** `null` on the last page. */
  nextCursor: string | null;
};

/** The page-number envelope some older list endpoints use (`page`, `pageSize`, `total`). */
export type NumberedPage<T> = {
  items: T[];
  page: number | string;
  pageSize: number | string;
  total: number | string;
};

export type IterateOptions = {
  /** Stop after this many items (a hard stop, not an error). */
  maxItems?: number;
  /** Stop after this many requests. */
  maxPages?: number;
};

/**
 * A lazy, re-iterable list over a paginated endpoint. Nothing is requested until you iterate.
 *
 *   for await (const listing of client.listings.iterate({ city: "Austin" })) { … }
 *   const firstPages = client.listings.iterate().pages();
 *   const everything = await client.listings.iterate({}, { maxItems: 500 }).toArray();
 */
export class PagedList<T, P extends { items: T[] } = { items: T[] }> implements AsyncIterable<T> {
  readonly #nextPages: () => AsyncGenerator<P>;
  readonly #options: IterateOptions;

  constructor(nextPages: () => AsyncGenerator<P>, options: IterateOptions = {}) {
    for (const key of ["maxItems", "maxPages"] as const) {
      const value = options[key];
      if (value !== undefined && (!Number.isInteger(value) || value < 1)) throw new TypeError(`${key} must be a positive integer.`);
    }
    this.#nextPages = nextPages;
    this.#options = options;
  }

  /** Whole pages, with their envelope metadata. */
  async *pages(): AsyncGenerator<P> {
    let requested = 0;
    for await (const page of this.#nextPages()) {
      yield page;
      requested++;
      if (this.#options.maxPages !== undefined && requested >= this.#options.maxPages) return;
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    let yielded = 0;
    for await (const page of this.pages()) {
      for (const item of page.items) {
        yield item;
        yielded++;
        if (this.#options.maxItems !== undefined && yielded >= this.#options.maxItems) return;
      }
    }
  }

  async toArray(): Promise<T[]> {
    const all: T[] = [];
    for await (const item of this) all.push(item);
    return all;
  }
}

/** Follows `nextCursor` until it is `null`. A cursor that repeats is a server bug and fails loudly instead of looping. */
export function paginateCursor<T, P extends CursorPage<T>>(
  fetchPage: (cursor: string | undefined) => Promise<P>,
  options: IterateOptions = {},
): PagedList<T, P> {
  return new PagedList<T, P>(async function* () {
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      const page = await fetchPage(cursor);
      yield page;
      const next = page.nextCursor;
      if (!next) return;
      if (seen.has(next) || next === cursor) {
        throw new UnitfieldError("The API returned a pagination cursor it had already returned.", { code: "pagination_cursor_loop" });
      }
      seen.add(next);
      cursor = next;
    }
  }, options);
}

/** Follows `page` until `page * pageSize` reaches `total`, or a page comes back empty. */
export function paginateNumbered<T, P extends NumberedPage<T>>(
  fetchPage: (page: number) => Promise<P>,
  options: IterateOptions & { firstPage?: number } = {},
): PagedList<T, P> {
  return new PagedList<T, P>(async function* () {
    let page = options.firstPage ?? 1;
    for (;;) {
      const result = await fetchPage(page);
      yield result;
      // The envelope's own numbers decide, so a walk that starts mid-way still stops at the end.
      const covered = Number(result.page) * Number(result.pageSize);
      if (result.items.length === 0 || (Number.isFinite(covered) && covered >= Number(result.total))) return;
      page++;
    }
  }, options);
}
