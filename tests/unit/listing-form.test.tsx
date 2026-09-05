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
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

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
    vi.spyOn(toast, "error").mockReturnValue('photo-error');
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

  it("opens the rear-camera picker without submitting and keeps the gallery separate", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><ListingFormPage /></MemoryRouter></QueryClientProvider>);
    await screen.findByRole("option", { name: "Books" });
    const camera = screen.getByLabelText("Take a product photo");
    const gallery = screen.getByLabelText("Product images");
    const cameraClick = vi.spyOn(camera, "click");
    const galleryClick = vi.spyOn(gallery, "click");
    expect(camera).toHaveAttribute("capture", "environment");
    expect(camera).toHaveAttribute("accept", "image/*");
    expect(camera).not.toHaveAttribute("multiple");
    expect(gallery).not.toHaveAttribute("capture");
    expect(gallery).toHaveAttribute("multiple");
    const button = screen.getByRole("button", { name: "Take photo" });
    expect(button).toHaveAttribute("type", "button");
    fireEvent.click(button);
    expect(cameraClick).toHaveBeenCalledOnce();
    expect(galleryClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Choose photos" }));
    expect(galleryClick).toHaveBeenCalledOnce();
    expect(apiMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });

  it("appends camera photos, keeps selections on cancel and enforces the shared limit", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><ListingFormPage /></MemoryRouter></QueryClientProvider>);
    await screen.findByRole("option", { name: "Books" });
    const camera = screen.getByLabelText("Take a product photo");
    const gallery = screen.getByLabelText("Product images");
    const files = Array.from({ length: 7 }, (_, index) => new File(['photo'], `photo-${index}.jpg`, { type: 'image/jpeg' }));
    fireEvent.change(gallery, { target: { files } });
    fireEvent.change(camera, { target: { files: [] } });
    expect(screen.getAllByAltText(/^Selected product image:/)).toHaveLength(7);
    fireEvent.change(camera, { target: { files: [new File(['camera'], 'camera.jpg', { type: 'image/jpeg' })] } });
    expect(screen.getAllByAltText(/^Selected product image:/)).toHaveLength(8);
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Choose photos' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove camera.jpg' }));
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled();
    fireEvent.change(camera, { target: { files: [new File(['again'], 'camera.jpg', { type: 'image/jpeg' })] } });
    expect(screen.getByAltText('Selected product image: camera.jpg')).toBeVisible();
    expect(camera).toHaveValue('');
  });

  it("rejects unsupported or oversized captures with clear feedback", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><ListingFormPage /></MemoryRouter></QueryClientProvider>);
    await screen.findByRole("option", { name: "Books" });
    const huge = new File(['photo'], 'large.jpg', { type: 'image/jpeg' });
    Object.defineProperty(huge, 'size', { value: 5 * 1024 * 1024 + 1 });
    const camera = screen.getByLabelText("Take a product photo");
    fireEvent.change(camera, { target: { files: [new File(['photo'], 'photo.heic', { type: 'image/heic' }), huge] } });
    expect(toast.error).toHaveBeenCalledWith('photo.heic: please use a JPG, PNG or WebP photo.');
    expect(toast.error).toHaveBeenCalledWith('large.jpg: photos must be 5 MB or smaller.');
    expect(screen.queryAllByAltText(/^Selected product image:/)).toHaveLength(0);
  });

  it("previews camera and gallery files, removes one, and uploads only the remaining file", async () => {
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
      target: { files: [detail] },
    });
    fireEvent.change(screen.getByLabelText("Take a product photo"), {
      target: { files: [book] },
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

  it("shows existing edit photos and removes a selected photo when changes are saved", async () => {
    const retainedImageId = "22222222-2222-4222-8222-222222222222";
    const removedImageId = "33333333-3333-4333-8333-333333333333";
    apiMock.mockImplementation((path: string, options?: RequestInit) => {
      if (path === "/api/categories") {
        return Promise.resolve([
          { id: "11111111-1111-4111-8111-111111111111", name: "Books" },
        ]);
      }
      if (path === "/api/listings/listing-1" && !options?.method) {
        return Promise.resolve({
          id: "listing-1",
          title: "Art of Artist",
          description: "A complete description of this second-hand art book.",
          categoryId: "11111111-1111-4111-8111-111111111111",
          condition: "GOOD",
          conditionExplanation: "",
          priceType: "FIXED",
          exactPrice: 650,
          minimumPrice: null,
          maximumPrice: null,
          negotiable: true,
          location: "Main campus",
          brand: "",
          defects: "",
          meetupPoint: "",
          images: [
            {
              id: retainedImageId,
              position: 0,
              url: "https://images.example.test/art-book.webp",
            },
            {
              id: removedImageId,
              position: 1,
              url: "https://images.example.test/art-book-back.webp",
            },
          ],
        });
      }
      if (path === "/api/listings/listing-1" && options?.method === "PATCH") {
        return Promise.resolve({ id: "listing-1" });
      }
      if (
        path === `/api/uploads/listings/listing-1/${removedImageId}` &&
        options?.method === "DELETE"
      ) {
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`Unexpected API call: ${path}`));
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/listing/listing-1/edit"]}>
          <Routes>
            <Route
              path="/listing/:listingId/edit"
              element={<ListingFormPage edit />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByAltText("Existing product image 1")).toHaveAttribute(
      "src",
      "https://images.example.test/art-book.webp",
    );
    expect(screen.getByAltText("Existing product image 2")).toHaveAttribute(
      "src",
      "https://images.example.test/art-book-back.webp",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove existing product image 2" }),
    );
    expect(screen.queryByAltText("Existing product image 2")).not.toBeInTheDocument();
    expect(screen.getByAltText("Existing product image 1")).toBeVisible();
    expect(apiMock).not.toHaveBeenCalledWith(
      `/api/uploads/listings/listing-1/${removedImageId}`,
      expect.anything(),
    );

    fireEvent.click(screen.getByLabelText(/I own this used physical item/));
    fireEvent.click(
      screen.getByLabelText(/This listing is accurate and follows the seller rules/),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `/api/uploads/listings/listing-1/${removedImageId}`,
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });
});
