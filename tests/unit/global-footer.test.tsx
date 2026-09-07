// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../apps/web/src/components/Navbar", () => ({
  Navbar: () => <div data-testid="navbar" />,
}));

import { Layout } from "../../apps/web/src/components/Layout";

describe("global footer", () => {
  afterEach(cleanup);

  it("renders the editorial wordmark and only supported application links", () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<div>Page content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByText("Buy and sell locally.")).toBeVisible();
    const wordmark = within(footer).getByRole("link", {
      name: "Uni Market home",
    });
    expect(wordmark).toHaveClass("site-footer-wordmark");
    expect(footer.querySelector(".site-footer-inner")?.lastElementChild).toBe(
      wordmark,
    );

    const supportedDestinations = [
      "/browse",
      "/categories",
      "/sell",
      "/saved",
      "/my-listings",
      "/chats",
      "/notifications",
      "/leaderboard",
      "/profile",
      "/support",
      "/settings",
      "/terms",
      "/privacy",
      "/community-rules",
      "/prohibited-items",
      "/seller-policy",
      "/grievance",
      "/marketplace-disclosure",
    ];
    const hrefs = within(footer)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    for (const destination of supportedDestinations) {
      expect(hrefs).toContain(destination);
    }
    expect(within(footer).queryByText(/not affiliated with, endorsed by/)).not.toBeInTheDocument();
    expect(within(footer).getByRole("link", { name: "Terms" })).toBeVisible();
    expect(within(footer).getAllByRole("link", { name: "Privacy" })).toHaveLength(2);
  });
});
