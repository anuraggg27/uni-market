// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React, { lazy } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../apps/web/src/components/Navbar", () => ({
  Navbar: () => <div data-testid="navbar" />,
}));

import { Layout } from "../../apps/web/src/components/Layout";
import {
  Loading,
  RouteLoading,
} from "../../apps/web/src/components/LoadingSkeletons";

describe("loading skeletons", () => {
  afterEach(cleanup);

  it("keeps the application layout mounted while a lazy browse route loads", () => {
    const PendingPage = lazy(() => new Promise(() => undefined));

    render(
      <MemoryRouter initialEntries={["/browse"]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="browse" element={<PendingPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("navbar")).toBeInTheDocument();
    expect(screen.getByText("Loading products")).toBeInTheDocument();
    expect(document.querySelectorAll(".market-card")).toHaveLength(8);
  });

  it("uses product-card geometry for home loading sections", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <RouteLoading />
      </MemoryRouter>,
    );

    expect(screen.getByText("Loading home page")).toBeInTheDocument();
    expect(document.querySelectorAll(".product-grid")).toHaveLength(2);
    expect(document.querySelectorAll(".market-card")).toHaveLength(8);
    expect(document.querySelector(".h-40")).not.toBeInTheDocument();
  });

  it("uses listing and chat structures for their route fallbacks", () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={["/listing/listing-1"]}>
        <RouteLoading />
      </MemoryRouter>,
    );

    expect(screen.getByText("Loading listing")).toBeInTheDocument();
    expect(document.querySelector(".aspect-\\[4\\/3\\]")).toBeInTheDocument();
    unmount();

    render(
      <MemoryRouter initialEntries={["/chats/conversation-1"]}>
        <RouteLoading />
      </MemoryRouter>,
    );
    expect(screen.getByText("Loading messages")).toBeInTheDocument();
    expect(document.querySelector(".chat-shell")).toBeInTheDocument();
    expect(document.querySelector(".conversation-list")).toBeInTheDocument();
  });

  it("renders four stable marketplace card placeholders for card queries", () => {
    render(<Loading variant="cards" label="Loading listings" />);

    expect(screen.getByText("Loading listings")).toBeInTheDocument();
    expect(document.querySelectorAll(".market-card")).toHaveLength(4);
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(12);
  });

  it("matches the horizontal management cards on My listings", () => {
    render(
      <MemoryRouter initialEntries={["/my-listings"]}>
        <RouteLoading />
      </MemoryRouter>,
    );

    expect(screen.getByText("Loading your listings")).toBeInTheDocument();
    expect(document.querySelectorAll(".my-listing-card")).toHaveLength(4);
    expect(document.querySelectorAll(".market-card")).toHaveLength(0);
  });
});
