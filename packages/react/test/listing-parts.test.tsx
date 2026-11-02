import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApplyButton, ListingAvailability, ListingFacts, ListingGrid, ListingImage, ListingLocation, ListingPrice, ListingTitle } from "../src/index.js";
import { listing } from "./fixtures.js";

describe("ListingGrid", () => {
  it("renders one list item per listing and passes native props to the list", () => {
    const items = [listing(), listing({ listingPublicId: "clst_two", title: "Garden studio" })];
    render(
      <ListingGrid listings={items} className="grid" aria-label="Homes">
        {(item, index) => <span data-testid="card">{`${index}:${item.title}`}</span>}
      </ListingGrid>,
    );
    const list = screen.getByRole("list", { name: "Homes" });
    expect(list.className).toBe("grid");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByTestId("card").map((node) => node.textContent)).toEqual(["0:Sunny two-bedroom", "1:Garden studio"]);
  });

  it("shows the empty state instead of an empty list", () => {
    render(
      <ListingGrid listings={[]} empty={<p>No homes yet</p>}>
        {() => null}
      </ListingGrid>,
    );
    expect(screen.getByText("No homes yet")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("renders on the server without a DOM or hooks", () => {
    const html = renderToString(<ListingGrid listings={[listing()]}>{(item) => <ListingTitle listing={item} as="h2" />}</ListingGrid>);
    expect(html).toContain("<li><h2>Sunny two-bedroom</h2></li>");
  });
});

describe("ListingImage", () => {
  it("uses the cover image with the title as alt text and loads lazily", () => {
    render(<ListingImage listing={listing()} className="cover" />);
    const image = screen.getByRole("img");
    expect(image.getAttribute("src")).toBe("https://images.example.test/one.jpg");
    expect(image.getAttribute("alt")).toBe("Sunny two-bedroom");
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(image.className).toBe("cover");
  });

  it("prefers a gallery photo and its alt text, and lets the caller override both", () => {
    const { rerender } = render(<ListingImage listing={listing()} photo={{ url: "https://images.example.test/two.jpg", alt: "Kitchen", isCover: false }} />);
    expect(screen.getByRole("img").getAttribute("src")).toBe("https://images.example.test/two.jpg");
    expect(screen.getByRole("img").getAttribute("alt")).toBe("Kitchen");
    rerender(<ListingImage listing={listing()} alt="" />);
    expect(screen.getByRole("presentation").getAttribute("alt")).toBe("");
  });

  it("renders the fallback when there is no image", () => {
    render(<ListingImage listing={listing({ coverImageUrl: null })} fallback={<div>No photo</div>} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("No photo")).toBeTruthy();
  });
});

describe("text parts", () => {
  it("formats price, facts, location and availability from the listing", () => {
    render(
      <>
        <ListingPrice listing={listing()} locale="en-US" data-testid="price" />
        <ListingFacts listing={listing()} locale="en-US" data-testid="facts" />
        <ListingLocation listing={listing()} data-testid="where" />
        <ListingAvailability listing={listing()} locale="en-US" data-testid="when" />
      </>,
    );
    expect(screen.getByTestId("price").textContent).toBe("$2,100/mo");
    expect(Array.from(screen.getByTestId("facts").querySelectorAll("li")).map((node) => node.textContent)).toEqual(["2 bd", "1.5 ba", "1,050 sq ft"]);
    expect(screen.getByTestId("where").textContent).toBe("Austin, TX");
    expect(screen.getByTestId("when").getAttribute("datetime")).toBe("2026-11-02");
    expect(screen.getByTestId("when").textContent).toBe("Nov 2, 2026");
  });

  it("renders no location element when there is nothing to say", () => {
    const { container } = render(<ListingLocation listing={listing({ city: null, state: null })} />);
    expect(container.innerHTML).toBe("");
  });

  it("lets children replace the generated text", () => {
    render(<ListingPrice listing={listing()}>Ask us</ListingPrice>);
    expect(screen.getByText("Ask us")).toBeTruthy();
  });
});

describe("ApplyButton", () => {
  it("links to the hosted apply page of the listing", () => {
    render(<ApplyButton listing={listing()} className="button" rel="noopener" />);
    const link = screen.getByRole("link", { name: "Apply" });
    expect(link.getAttribute("href")).toBe("https://homes.example.test/apply/UNITKEY1");
    expect(link.getAttribute("rel")).toBe("noopener");
    expect(link.className).toBe("button");
  });

  it("renders nothing, or the fallback, when applications are closed", () => {
    const closed = listing({ acceptsApplications: false, applyUrl: null });
    const { container, rerender } = render(<ApplyButton listing={closed} />);
    expect(container.innerHTML).toBe("");
    rerender(<ApplyButton listing={closed} fallback={<span>Applications closed</span>} />);
    expect(screen.getByText("Applications closed")).toBeTruthy();
  });

  it("takes an explicit href over the listing and refuses anything that is not http(s)", () => {
    const { container, rerender } = render(<ApplyButton listing={listing()} href="https://other.example.test/apply">Start</ApplyButton>);
    expect(screen.getByRole("link", { name: "Start" }).getAttribute("href")).toBe("https://other.example.test/apply");
    rerender(<ApplyButton href="javascript:alert(1)">Start</ApplyButton>);
    expect(container.innerHTML).toBe("");
    rerender(<ApplyButton href="/relative">Start</ApplyButton>);
    expect(container.innerHTML).toBe("");
  });
});
