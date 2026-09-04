// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock("../../apps/web/src/api", () => ({
  api: apiMock,
  clearCsrf: vi.fn(),
  jsonBody: (value: unknown) => ({
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  }),
}));

import { ListingFormPage } from "../../apps/web/src/pages/UserPages";

describe("ListingFormPage photos", () => {
  let previewNumber = 0;
  const fetchMock = vi.fn();

  beforeEach(() => {
    apiMock.mockClear();
    fetchMock.mockClear();
    previewNumber = 0;
    Object.defineProperties(URL, {
      createObjectURL: {
        configurable: true,
        value: vi.fn(() => `blob:preview-${++previewNumber}`),
      },
      revokeObjectURL: {
        configurable: true,
        value: vi.fn(),
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({ ok: true });
    apiMock.mockImplementation((path: string, options?: RequestInit) => {
      if (path === "/api/categories") {
        return Promise.resolve([
          { id: "11111111-1111-4111-8111-111111111111", name: "Books" },
        ]);
      }
      if (path === "/api/listings" && options?.method === "POST") {
        return Promise.resolve({ id: "listing-1" });
      }
      if (path === "/api/uploads/listings/listing-1/presign") {
        return Promise.resolve({
          uploadUrl: "https://uploads.example.test/image",
          headers: { "content-type": "image/jpeg" },
          imageId: "image-1",
        });
      }
      if (path === "/api/uploads/listings/listing-1/finalize") {
        return Promise.resolve({});
      }
      if (path === "/api/listings/listing-1/submit") {
        return Promise.resolve({ id: "listing-1", submittedAt: new Date().toISOString() });
      }
      return Promise.reject(new Error(`Unexpected API call: ${path}`));
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
  });

  it.each(["Price (₹)", "Minimum (₹)", "Maximum (₹)"])("shows a clear negative-price error for %s without saving", async (label) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><ListingFormPage /></MemoryRouter></QueryClientProvider>);
    await screen.findByRole("option", { name: "Books" });
    if (label !== "Price (₹)") {
      fireEvent.click(screen.getByLabelText("Range"));
      fireEvent.change(screen.getByLabelText("Minimum (₹)"), { target: { value: "1" } });
      fireEvent.change(screen.getByLabelText("Maximum (₹)"), { target: { value: "10" } });
    }
    const input = screen.getByLabelText(label);
    expect(input).toHaveAttribute("min", "1");
    expect(input).toHaveAttribute("step", "1");
    fireEvent.change(input, { target: { value: "-1" } });
    fireEvent.submit(screen.getByRole("button", { name: "Submit for review" }).closest("form")!);
    expect(await screen.findByText("Price must be at least ₹1. Choose Free for a giveaway.")).toBeVisible();
    expect(apiMock.mock.calls.some(([path, options]) => path === "/api/listings" && options?.method === "POST")).toBe(false);
    fireEvent.click(screen.getByLabelText("Free"));
    fireEvent.submit(screen.getByRole("button", { name: "Submit for review" }).closest("form")!);
    await waitFor(() => expect(screen.queryByText("Price must be at least ₹1. Choose Free for a giveaway.")).not.toBeInTheDocument());
  });

  it("previews selected files, removes one, and uploads only the remaining file", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ListingFormPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByRole("option", { name: "Books" });
    const book = new File(["book"], "book.jpg", { type: "image/jpeg" });
    const detail = new File(["detail"], "book-detail.jpg", {
      type: "image/jpeg",
    });
    fireEvent.change(screen.getByLabelText("Product images"), {
      target: { files: [book, detail] },
    });

    expect(
      await screen.findByAltText("Selected product image: book.jpg"),
    ).toBeVisible();
    expect(
      screen.getByAltText("Selected product image: book-detail.jpg"),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove book-detail.jpg" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByAltText("Selected product image: book-detail.jpg"),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByAltText("Selected product image: book.jpg"),
    ).toBeVisible();

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Engineering mechanics book" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: {
        value: "A clean textbook with no missing pages or annotations.",
      },
    });
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "11111111-1111-4111-8111-111111111111" },
    });
    fireEvent.change(screen.getByLabelText("Price (₹)"), {
      target: { value: "650" },
    });
    fireEvent.change(
      screen.getByLabelText(/Campus, hostel area or neighbourhood/),
      { target: { value: "Main campus" } },
    );
    fireEvent.click(screen.getByLabelText(/I own this used physical item/));
    fireEvent.click(screen.getByLabelText(/This listing is accurate and follows the seller rules/));
    fireEvent.click(
      screen.getByRole("button", { name: "Submit for review" }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/api/uploads/listings/listing-1/presign",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const presignCall = apiMock.mock.calls.find(([path]) => path === "/api/uploads/listings/listing-1/presign");
    expect(JSON.parse(String(presignCall?.[1]?.body))).toEqual({ mimeType: "image/jpeg", byteSize: book.size });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://uploads.example.test/image",
      expect.objectContaining({ body: book, method: "PUT" }),
    );
    expect(apiMock).toHaveBeenCalledWith(
      "/api/listings/listing-1/submit",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
