// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SellerProfilePage } from "../../apps/web/src/pages/SellerProfilePage";
import { BuyerReputation, BuyerReputationSection } from "../../apps/web/src/components/BuyerReputation";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock("../../apps/web/src/api", () => ({ api: apiMock }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });
function wrapper(component: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { ...render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/seller/account"]}><Routes><Route path="/seller/:sellerId" element={component} /></Routes></MemoryRouter></QueryClientProvider>), client };
}

function profileWithPhoto(coverImageUrl: string | null | undefined) {
  return {
    id: "account", displayName: "Seller", avatarId: "avatar-01", institution: "UPES", campus: null,
    phoneVerifiedAt: null, completedSales: 0, createdAt: "2026-09-01T00:00:00Z", averageRating: 0, reviewCount: 0, recentReviews: [],
    activeListings: [{ id: "ikigai", title: "Ikigai", condition: "GOOD", location: "Sai Mandir", priceType: "FIXED", exactPrice: 200, minimumPrice: null, maximumPrice: null, viewCount: 1, approvedAt: "2026-09-08T10:00:00Z", createdAt: "2026-09-08T09:00:00Z", coverImageUrl }],
  };
}

describe("seller listing photos", () => {
  it("renders the cover photo and keeps the product link accessible", async () => {
    apiMock.mockResolvedValue(profileWithPhoto("https://images.example.test/ikigai.webp"));
    wrapper(<SellerProfilePage />);
    const image = await screen.findByRole("img", { name: "Ikigai" });
    expect(image).toHaveAttribute("src", "https://images.example.test/ikigai.webp");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(screen.queryByText("No image")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Ikigai" })).toHaveAttribute("href", "/listing/ikigai");
  });

  it.each([null, undefined])("shows the fallback when the photo URL is %s", async coverImageUrl => {
    apiMock.mockResolvedValue(profileWithPhoto(coverImageUrl));
    wrapper(<SellerProfilePage />);
    expect(await screen.findByText("No image")).toBeVisible();
    expect(screen.queryByRole("img", { name: "Ikigai" })).not.toBeInTheDocument();
  });

  it("shows the fallback if the image fails to load", async () => {
    apiMock.mockResolvedValue(profileWithPhoto("https://images.example.test/missing.webp"));
    wrapper(<SellerProfilePage />);
    fireEvent.error(await screen.findByRole("img", { name: "Ikigai" }));
    expect(screen.getByText("No image")).toBeVisible();
    expect(screen.queryByRole("img", { name: "Ikigai" })).not.toBeInTheDocument();
  });

  it("tries the new photo when a failed signed URL is refreshed", async () => {
    apiMock.mockResolvedValue(profileWithPhoto("https://images.example.test/ikigai.webp?signature=old"));
    const { client } = wrapper(<SellerProfilePage />);
    fireEvent.error(await screen.findByRole("img", { name: "Ikigai" }));
    expect(screen.getByText("No image")).toBeVisible();
    await act(async () => {
      client.setQueryData(["seller", "account"], profileWithPhoto("https://images.example.test/ikigai.webp?signature=new"));
    });
    expect(await screen.findByRole("img", { name: "Ikigai" })).toHaveAttribute("src", "https://images.example.test/ikigai.webp?signature=new");
    expect(screen.queryByText("No image")).not.toBeInTheDocument();
  });
});

describe("role-specific reputation", () => {
  it("shows an unrated seller clearly instead of displaying a star score without seller reviews", async () => {
    apiMock.mockResolvedValue({ id: "account", displayName: "Student", avatarId: "avatar-01", institution: "UPES", campus: null, phoneVerifiedAt: null, completedSales: 0, createdAt: "2026-09-01T00:00:00Z", averageRating: 0, reviewCount: 0, activeListings: [], recentReviews: [] });
    wrapper(<SellerProfilePage />);
    expect(await screen.findByRole("heading", { name: "Reviews from buyers" })).toBeVisible();
    expect(screen.getAllByText("No buyer reviews yet.")).toHaveLength(2);
    expect(screen.queryByText("0.0")).not.toBeInTheDocument();
    expect(screen.getByText("Seller rating")).toBeVisible();
  });
  it("labels buyer feedback explicitly and expands reviews from sellers", async () => {
    apiMock.mockResolvedValue({ averageRating: 5, reviewCount: 1, recentReviews: [{ id: "review", reviewerName: "Seller", rating: 5, text: "On time for pickup" }] });
    wrapper(<BuyerReputation conversationId="conversation" />);
    const summary = await screen.findByText("Buyer rating: 5.0 · 1 review");
    fireEvent.click(summary);
    expect(await screen.findByRole("region", { name: "Buyer reviews from sellers" })).toBeVisible();
    expect(screen.getByText("On time for pickup")).toBeVisible();
    expect(apiMock).toHaveBeenCalledWith("/api/conversations/conversation/buyer-reputation");
  });
  it("does not misrepresent unavailable buyer feedback as an unrated buyer", async () => {
    apiMock.mockRejectedValue(new Error("Unavailable"));
    wrapper(<BuyerReputation conversationId="conversation" />);
    expect(await screen.findByRole("button", { name: "Retry buyer feedback" })).toBeVisible();
    expect(screen.queryByText("No seller reviews yet.")).not.toBeInTheDocument();
  });
  it("shows seller feedback separately on the signed-in user profile", async () => {
    apiMock.mockResolvedValue({
      averageRating: 4,
      reviewCount: 1,
      recentReviews: [{
        id: "buyer-review",
        reviewerName: "Seller",
        reviewerAvatarId: "avatar-02",
        rating: 4,
        text: "Clear communication and prompt pickup.",
        createdAt: "2026-09-05T10:00:00Z",
      }],
    });
    wrapper(<BuyerReputationSection />);
    expect(await screen.findByRole("heading", { name: "Reviews from sellers" })).toBeVisible();
    expect(await screen.findByText("Clear communication and prompt pickup.")).toBeVisible();
    expect(screen.getByRole("img", { name: "Seller's avatar" })).toHaveAttribute("data-avatar-id", "avatar-02");
    expect(screen.getByText("1 review from sellers")).toBeVisible();
    expect(apiMock).toHaveBeenCalledWith("/api/users/me/buyer-reputation");
  });
  it("shows buyer-authored reviews and reviewer avatars on a seller profile", async () => {
    apiMock.mockResolvedValue({
      id: "account",
      displayName: "Seller",
      avatarId: "avatar-01",
      institution: "UPES",
      campus: null,
      phoneVerifiedAt: null,
      completedSales: 1,
      createdAt: "2026-09-01T00:00:00Z",
      averageRating: 5,
      reviewCount: 1,
      activeListings: [],
      recentReviews: [{ id: "review", reviewerName: "Buyer", reviewerAvatarId: "avatar-03", rating: 5, text: "Accurate listing.", createdAt: "2026-09-05T10:00:00Z" }],
    });
    wrapper(<SellerProfilePage />);
    expect(await screen.findByText("Accurate listing.")).toBeVisible();
    expect(screen.getByRole("img", { name: "Buyer's avatar" })).toHaveAttribute("data-avatar-id", "avatar-03");
    expect(screen.getByText("1 review from buyers")).toBeVisible();
  });
});
