// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SellerProfilePage } from "../../apps/web/src/pages/SellerProfilePage";
import { BuyerReputation } from "../../apps/web/src/components/BuyerReputation";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock("../../apps/web/src/api", () => ({ api: apiMock }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });
function wrapper(component: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/seller/account"]}><Routes><Route path="/seller/:sellerId" element={component} /></Routes></MemoryRouter></QueryClientProvider>);
}

describe("role-specific reputation", () => {
  it("shows an unrated seller clearly instead of displaying a star score without seller reviews", async () => {
    apiMock.mockResolvedValue({ id: "account", displayName: "Student", avatarId: "avatar-01", institution: "UPES", campus: null, phoneVerifiedAt: null, completedSales: 0, createdAt: "2026-09-01T00:00:00Z", averageRating: 0, reviewCount: 0, activeListings: [], recentReviews: [] });
    wrapper(<SellerProfilePage />);
    expect(await screen.findByRole("heading", { name: "Reviews from buyers" })).toBeVisible();
    expect(screen.getAllByText("No seller reviews yet")).toHaveLength(2);
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
    expect(screen.queryByText("No buyer reviews yet")).not.toBeInTheDocument();
  });
});
