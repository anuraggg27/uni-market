// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React, { useRef, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, Link, RouterProvider } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { transferableAbortController } from "node:util";
import { UnsavedChangesGuard } from "../../apps/web/src/components/UnsavedChangesGuard";

function ListingDraft() {
  const [title, setTitle] = useState("");
  const allowLeave = useRef(false);
  return <>
    <UnsavedChangesGuard when={Boolean(title)} allowLeave={allowLeave} />
    <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
    <Link to="/other">Leave listing</Link>
  </>;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("keeps an unfinished listing when navigation is declined and leaves after confirmation", async () => {
  // React Router's data navigation creates Node's Request. Pair it with native
  // signals instead of jsdom's different AbortSignal realm.
  const nativeController = transferableAbortController();
  vi.stubGlobal("AbortController", nativeController.constructor);
  vi.stubGlobal("AbortSignal", nativeController.signal.constructor);
  const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  const router = createMemoryRouter([
    { path: "/listing", element: <ListingDraft /> },
    { path: "/other", element: <h1>Other page</h1> },
  ], { initialEntries: ["/listing"] });
  render(<RouterProvider router={router} />);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Used calculator" } });
  fireEvent.click(screen.getByRole("link", { name: "Leave listing" }));
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText("Title")).toHaveValue("Used calculator");
  fireEvent.click(screen.getByRole("link", { name: "Leave listing" }));
  expect(await screen.findByRole("heading", { name: "Other page" })).toBeVisible();
});
