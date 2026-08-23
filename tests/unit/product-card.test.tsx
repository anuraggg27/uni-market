// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { ProductCard } from "../../apps/web/src/components/ProductCard";

describe("ProductCard", () => {
  afterEach(cleanup);

  it("renders accessible product information and a lifecycle state in text", () => {
    render(
      <MemoryRouter>
        <ProductCard
          listing={{
            id: "listing-1",
            title: "Used scientific calculator",
            coverImageUrl: "https://images.example.test/calculator.webp",
            lifecycleState: "RESERVED",
            condition: "LIKE_NEW",
            location: "Main campus",
            priceType: "FIXED",
            exactPrice: 1250,
          }}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("link", { name: "View Used scientific calculator" }),
    ).toHaveAttribute("href", "/listing/listing-1");
    expect(
      screen.getByRole("img", { name: "Used scientific calculator" }),
    ).toHaveAttribute("loading", "lazy");
    expect(screen.getByText("₹1,250")).toBeVisible();
    expect(screen.getByText("LIKE NEW")).toBeVisible();
    expect(screen.getByText("RESERVED")).toBeVisible();
  });

  it("uses a real empty-image state and formats free listings", () => {
    render(
      <MemoryRouter>
        <ProductCard
          listing={{
            id: "listing-2",
            title: "Desk organizer",
            coverImageUrl: null,
            lifecycleState: "ACTIVE",
            condition: "GOOD",
            location: "Library gate",
            priceType: "FREE",
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("No image")).toBeVisible();
    expect(screen.getByText("Free")).toBeVisible();
    expect(screen.queryByText("ACTIVE")).not.toBeInTheDocument();
  });

  it("uses the same hierarchy for browse cards with category and posted time", () => {
    render(
      <MemoryRouter>
        <ProductCard
          variant="browse"
          listing={{
            id: "listing-3",
            title: "Casio FX-991EX Scientific Calculator",
            coverImageUrl: null,
            lifecycleState: "ACTIVE",
            condition: "GOOD",
            categoryName: "Calculators",
            location: "Engineering block",
            priceType: "FIXED",
            exactPrice: 850,
            approvedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Calculators")).toBeVisible();
    expect(screen.getByText("2h ago")).toBeVisible();
    expect(screen.getByText("Show")).toBeVisible();
    expect(
      screen.getByRole("link", {
        name: "View Casio FX-991EX Scientific Calculator",
      }),
    ).toHaveAttribute("href", "/listing/listing-3");
  });
});
