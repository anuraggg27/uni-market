// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useNavigate } from "react-router-dom";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouteScrollRestoration } from "../../apps/web/src/components/RouteScrollRestoration";

function NavigationHarness() {
  const navigate = useNavigate();

  return (
    <>
      <button onClick={() => navigate("/listing/one")}>Open listing</button>
      <button onClick={() => navigate(-1)}>Back</button>
    </>
  );
}

describe("RouteScrollRestoration", () => {
  const scrollTo = vi.fn();
  let scrollLeft = 0;
  let scrollTop = 0;

  beforeEach(() => {
    scrollLeft = 0;
    scrollTop = 0;
    scrollTo.mockReset();
    scrollTo.mockImplementation(
      ({ left = 0, top = 0 }: ScrollToOptions) => {
        scrollLeft = left;
        scrollTop = top;
      },
    );
    vi.stubGlobal("scrollTo", scrollTo);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(window, "scrollX", "get").mockImplementation(() => scrollLeft);
    vi.spyOn(window, "scrollY", "get").mockImplementation(() => scrollTop);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("scrolls new route navigations to the top", () => {
    render(
      <MemoryRouter initialEntries={["/browse"]}>
        <RouteScrollRestoration />
        <NavigationHarness />
      </MemoryRouter>,
    );

    scrollTo.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Open listing" }));

    expect(scrollTo).toHaveBeenCalledWith({
      top: 0,
      left: 0,
      behavior: "auto",
    });
  });

  it("restores the saved position on browser Back navigation", () => {
    render(
      <MemoryRouter initialEntries={["/browse"]}>
        <RouteScrollRestoration />
        <NavigationHarness />
      </MemoryRouter>,
    );

    scrollTop = 640;
    fireEvent.click(screen.getByRole("button", { name: "Open listing" }));
    scrollTop = 900;
    scrollTo.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(scrollTo).toHaveBeenCalledWith({
      left: 0,
      top: 640,
      behavior: "auto",
    });
  });
});
