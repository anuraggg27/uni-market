// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock("../../apps/web/src/api", () => ({ api: apiMock }));

import { MarketplaceSearch } from "../../apps/web/src/components/MarketplaceSearch";
import { BrowsePage } from "../../apps/web/src/pages/PublicPages";

const result = {
  id: "listing-1",
  title: "LG 24-inch monitor",
  categoryName: "Electronics",
  location: "Bidholi campus",
  priceLabel: "��4,500",
  coverImageUrl: null,
  lifecycleState: "ACTIVE",
  condition: "GOOD",
};

function renderWithProviders(node: React.ReactNode, route = "/") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("marketplace live search", () => {
  beforeEach(() => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/api/categories") return Promise.resolve([]);
      if (path === "/api/listings") return Promise.resolve([]);
      if (path === "/api/listings?q=monitor") return Promise.resolve([result]);
      if (path === "/api/listings?q=monitor&limit=6") {
        return Promise.resolve([result]);
      }
      return Promise.reject(new Error(`Unexpected API call: ${path}`));
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("updates Browse results while the user types", async () => {
    renderWithProviders(<BrowsePage />, "/browse");

    const searchInputs = await screen.findAllByPlaceholderText("Search products");
    fireEvent.change(searchInputs[0], { target: { value: "monitor" } });

    await waitFor(
      () => expect(apiMock).toHaveBeenCalledWith("/api/listings?q=monitor"),
      { timeout: 1_500 },
    );
    expect(await screen.findByText("LG 24-inch monitor")).toBeVisible();
  });

  it("opens from the navbar trigger and renders live product matches", async () => {
    renderWithProviders(<MarketplaceSearch enableShortcut />);

    fireEvent.click(
      screen.getByRole("button", { name: "Search marketplace" }),
    );
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByRole("searchbox", {
      name: "Search products",
    });
    fireEvent.change(input, { target: { value: "monitor" } });

    await waitFor(
      () =>
        expect(apiMock).toHaveBeenCalledWith(
          "/api/listings?q=monitor&limit=6",
        ),
      { timeout: 1_500 },
    );
    expect(
      await within(dialog).findByRole("link", { name: /LG 24-inch monitor/ }),
    ).toHaveAttribute("href", "/listing/listing-1");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});
