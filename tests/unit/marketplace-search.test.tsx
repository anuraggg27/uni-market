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

vi.mock("../../apps/web/src/api", () => ({
  api: apiMock,
  apiWithMeta: (path: string) => apiMock(path).then((data: Array<{ id: string }>) => ({
    data,
    meta: { page: path.includes("page=2") ? 2 : 1, limit: 24, hasMore: data.some((item) => item.id === "listing-first") },
  })),
}));

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

  it("lets buyers reach listings on the next browse page", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    apiMock.mockImplementation((path: string) => {
      if (path === "/api/categories") return Promise.resolve([]);
      if (path === "/api/listings") return Promise.resolve([{ ...result, id: "listing-first", title: "First page book" }]);
      if (path === "/api/listings?page=2") return Promise.resolve([{ ...result, id: "listing-second", title: "Second page book" }]);
      return Promise.reject(new Error(`Unexpected API call: ${path}`));
    });
    renderWithProviders(<BrowsePage />, "/browse");
    expect(await screen.findByText("First page book")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Second page book")).toBeVisible();
    expect(apiMock).toHaveBeenCalledWith("/api/listings?page=2");
    expect(screen.getByText("Page 2")).toBeVisible();
    vi.restoreAllMocks();
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
