import { describe, expect, it } from "vitest";
import { formatArea, formatAvailability, formatBathrooms, formatBedrooms, formatLocation, formatRent, listingFacts } from "../src/index.js";

describe("formatRent", () => {
  it("shows whole amounts without decimals and the period as a suffix", () => {
    expect(formatRent({ rent: 4800, currency: "USD", rentPeriod: "Monthly" }, "en-US")).toBe("$4,800/mo");
  });

  it("keeps cents when the rent has them", () => {
    expect(formatRent({ rent: 1890.5, currency: "USD", rentPeriod: "Monthly" }, "en-US")).toBe("$1,890.50/mo");
  });

  it("does not drop a period it does not know", () => {
    expect(formatRent({ rent: 90, currency: "USD", rentPeriod: "Nightly" }, "en-US")).toBe("$90 / nightly");
  });

  it("falls back to the code for a currency Intl rejects", () => {
    expect(formatRent({ rent: 900, currency: "nope", rentPeriod: "Monthly" }, "en-US")).toBe("900 nope/mo");
  });
});

describe("facts", () => {
  it("calls a zero-bedroom home a studio", () => {
    expect(formatBedrooms(0)).toBe("Studio");
    expect(formatBedrooms(3)).toBe("3 bd");
  });

  it("keeps half baths and drops trailing zeros", () => {
    expect(formatBathrooms(1.5)).toBe("1.5 ba");
    expect(formatBathrooms(2)).toBe("2 ba");
  });

  it("leaves out an unknown area", () => {
    expect(formatArea(0)).toBeNull();
    expect(formatArea(1200, "en-US")).toBe("1,200 sq ft");
    expect(listingFacts({ bedrooms: 1, bathrooms: 1, areaSqft: 0 })).toEqual(["1 bd", "1 ba"]);
  });
});

describe("location and availability", () => {
  it("joins the parts that exist", () => {
    expect(formatLocation({ city: "Austin", state: "TX" })).toBe("Austin, TX");
    expect(formatLocation({ city: "Austin", state: null })).toBe("Austin");
    expect(formatLocation({ city: null, state: " " })).toBeNull();
  });

  it("formats a date-only value as the same calendar day in every time zone", () => {
    expect(formatAvailability("2026-11-02", "en-US")).toBe("Nov 2, 2026");
    expect(formatAvailability("not a date")).toBe("not a date");
  });
});
