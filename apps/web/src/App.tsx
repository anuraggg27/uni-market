import { lazy, type ComponentType } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, RequireAuth } from "./auth";
import { Layout } from "./components/Layout";
import { NotificationUpdates } from "./components/NotificationUpdates";
import { PageSeo } from "./components/PageSeo";

function lazyNamed<Props = Record<string, never>>(
  loader: () => Promise<any>,
  name: string,
) {
  return lazy<ComponentType<Props>>(async () => ({
    default: (await loader())[name],
  }));
}

const publicPages = () => import("./pages/PublicPages");
const userPages = () => import("./pages/UserPages");
const adminPages = () => import("./pages/AdminPages");
const complianceAdminPages = () => import("./pages/ComplianceAdminPages");
const legalPages = () => import("./pages/LegalPages");
const BrowsePage = lazyNamed(publicPages, "BrowsePage");
const CategoriesPage = lazyNamed(publicPages, "CategoriesPage");
const HomePage = lazyNamed(publicPages, "HomePage");
const LeaderboardPage = lazyNamed(publicPages, "LeaderboardPage");
const ListingPage = lazyNamed(publicPages, "ListingPage");
const LoginPage = lazyNamed(publicPages, "LoginPage");
const SellerPage = lazyNamed(publicPages, "SellerPage");
const ChatsPage = lazyNamed(userPages, "ChatsPage");
const ListingFormPage = lazyNamed<{ edit?: boolean }>(
  userPages,
  "ListingFormPage",
);
const MyListingsPage = lazyNamed(userPages, "MyListingsPage");
const NotificationsPage = lazyNamed(userPages, "NotificationsPage");
const ProfilePage = lazyNamed<{ onboarding?: boolean }>(
  userPages,
  "ProfilePage",
);
const SavedPage = lazyNamed(userPages, "SavedPage");
const SettingsPage = lazyNamed(userPages, "SettingsPage");
const SupportDetailPage = lazyNamed(userPages, "SupportDetailPage");
const SupportPage = lazyNamed(userPages, "SupportPage");
const RequestsPage = lazyNamed(userPages, "RequestsPage");
const AdminCategories = lazyNamed(adminPages, "AdminCategories");
const AdminCompliance = lazyNamed(complianceAdminPages, "AdminCompliance");
const AdminDashboard = lazyNamed(adminPages, "AdminDashboard");
const AdminListingReview = lazyNamed(adminPages, "AdminListingReview");
const AdminReportDetail = lazyNamed(adminPages, "AdminReportDetail");
const AdminReports = lazyNamed(adminPages, "AdminReports");
const AdminGrievances = lazyNamed(complianceAdminPages, "AdminGrievances");
const AdminReviews = lazyNamed(adminPages, "AdminReviews");
const AdminShell = lazyNamed(adminPages, "AdminShell");
const AdminSupport = lazyNamed(adminPages, "AdminSupport");
const AdminSupportDetail = lazyNamed(adminPages, "AdminSupportDetail");
const AdminUserDetail = lazyNamed(adminPages, "AdminUserDetail");
const AdminUsers = lazyNamed(adminPages, "AdminUsers");
const AuditLogs = lazyNamed(adminPages, "AuditLogs");
const PendingListings = lazyNamed(adminPages, "PendingListings");
const AdminListings = lazyNamed(adminPages, "AdminListings");
const CommunityRulesPage = lazyNamed(legalPages, "CommunityRulesPage");
const GrievancePage = lazyNamed(legalPages, "GrievancePage");
const GrievanceTrackPage = lazyNamed(legalPages, "GrievanceTrackPage");
const MarketplaceDisclosurePage = lazyNamed(legalPages, "MarketplaceDisclosurePage");
const PrivacyPage = lazyNamed(legalPages, "PrivacyPage");
const ProhibitedItemsPage = lazyNamed(legalPages, "ProhibitedItemsPage");
const SellerPolicyPage = lazyNamed(legalPages, "SellerPolicyPage");
const TermsPage = lazyNamed(legalPages, "TermsPage");

function LegacyTransactionsRedirect() {
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  if (search.get("view") === "buying") search.set("view", "sent");
  if (search.get("view") === "selling") search.set("view", "received");
  const query = search.toString();
  return <Navigate to={{ pathname: "/requests", search: query ? `?${query}` : "", hash: location.hash }} replace />;
}

export function App() {
  return (
    <AuthProvider>
      <PageSeo />
      <NotificationUpdates />
      <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="browse" element={<BrowsePage />} />
            <Route path="categories" element={<CategoriesPage />} />
            <Route path="category/:categorySlug" element={<BrowsePage />} />
            <Route path="listing/:listingId" element={<ListingPage />} />
            <Route path="login" element={<LoginPage />} />
            <Route path="seller/:sellerId" element={<SellerPage />} />
            <Route path="leaderboard" element={<LeaderboardPage />} />
            <Route path="terms" element={<TermsPage />} />
            <Route path="privacy" element={<PrivacyPage />} />
            <Route path="community-rules" element={<CommunityRulesPage />} />
            <Route path="prohibited-items" element={<ProhibitedItemsPage />} />
            <Route path="seller-policy" element={<SellerPolicyPage />} />
            <Route path="marketplace-disclosure" element={<MarketplaceDisclosurePage />} />
            <Route path="grievance" element={<GrievancePage />} />
            <Route path="grievance/track" element={<GrievanceTrackPage />} />
            <Route
              path="onboarding"
              element={
                <RequireAuth>
                  <ProfilePage onboarding />
                </RequireAuth>
              }
            />
            <Route
              path="sell"
              element={
                <RequireAuth phone>
                  <ListingFormPage />
                </RequireAuth>
              }
            />
            <Route
              path="listing/:listingId/edit"
              element={
                <RequireAuth phone>
                  <ListingFormPage edit />
                </RequireAuth>
              }
            />
            <Route
              path="my-listings"
              element={
                <RequireAuth>
                  <MyListingsPage />
                </RequireAuth>
              }
            />
            <Route
              path="saved"
              element={
                <RequireAuth>
                  <SavedPage />
                </RequireAuth>
              }
            />
            <Route
              path="chats"
              element={
                <RequireAuth phone>
                  <ChatsPage />
                </RequireAuth>
              }
            />
            <Route
              path="chats/:conversationId"
              element={
                <RequireAuth phone>
                  <ChatsPage />
                </RequireAuth>
              }
            />
            <Route
              path="requests"
              element={
                <RequireAuth phone>
                  <RequestsPage />
                </RequireAuth>
              }
            />
            <Route path="transactions" element={<LegacyTransactionsRedirect />} />
            <Route
              path="profile"
              element={
                <RequireAuth>
                  <ProfilePage />
                </RequireAuth>
              }
            />
            <Route
              path="notifications"
              element={
                <RequireAuth>
                  <NotificationsPage />
                </RequireAuth>
              }
            />
            <Route
              path="support"
              element={
                <RequireAuth phone>
                  <SupportPage />
                </RequireAuth>
              }
            />
            <Route
              path="support/:ticketId"
              element={
                <RequireAuth phone>
                  <SupportDetailPage />
                </RequireAuth>
              }
            />
            <Route
              path="settings"
              element={
                <RequireAuth>
                  <SettingsPage />
                </RequireAuth>
              }
            />
            <Route
              path="admin"
              element={
                <RequireAuth
                  roles={["MODERATOR", "SUPPORT_AGENT", "SUPER_ADMIN"]}
                >
                  <AdminShell />
                </RequireAuth>
              }
            >
              <Route index element={<AdminDashboard />} />
              <Route
                path="listings"
                element={
                  <RequireAuth roles={["MODERATOR", "SUPER_ADMIN"]}>
                    <AdminListings />
                  </RequireAuth>
                }
              />
              <Route
                path="listings/pending"
                element={
                  <RequireAuth roles={["MODERATOR", "SUPER_ADMIN"]}>
                    <PendingListings />
                  </RequireAuth>
                }
              />
              <Route
                path="listings/:listingId"
                element={
                  <RequireAuth roles={["MODERATOR", "SUPER_ADMIN"]}>
                    <AdminListingReview />
                  </RequireAuth>
                }
              />
              <Route
                path="reports"
                element={
                  <RequireAuth roles={["MODERATOR", "SUPER_ADMIN"]}>
                    <AdminReports />
                  </RequireAuth>
                }
              />
              <Route path="grievances" element={<AdminGrievances />} />
              <Route
                path="reports/:reportId"
                element={
                  <RequireAuth roles={["MODERATOR", "SUPER_ADMIN"]}>
                    <AdminReportDetail />
                  </RequireAuth>
                }
              />
              <Route
                path="users"
                element={
                  <RequireAuth roles={["MODERATOR", "SUPER_ADMIN"]}>
                    <AdminUsers />
                  </RequireAuth>
                }
              />
              <Route
                path="users/:userId"
                element={
                  <RequireAuth roles={["MODERATOR", "SUPER_ADMIN"]}>
                    <AdminUserDetail />
                  </RequireAuth>
                }
              />
              <Route
                path="reviews"
                element={
                  <RequireAuth roles={["MODERATOR", "SUPER_ADMIN"]}>
                    <AdminReviews />
                  </RequireAuth>
                }
              />
              <Route
                path="support"
                element={
                  <RequireAuth roles={["SUPPORT_AGENT", "SUPER_ADMIN"]}>
                    <AdminSupport />
                  </RequireAuth>
                }
              />
              <Route
                path="support/:ticketId"
                element={
                  <RequireAuth roles={["SUPPORT_AGENT", "SUPER_ADMIN"]}>
                    <AdminSupportDetail />
                  </RequireAuth>
                }
              />
              <Route
                path="audit-logs"
                element={
                  <RequireAuth roles={["SUPER_ADMIN"]}>
                    <AuditLogs />
                  </RequireAuth>
                }
              />
              <Route
                path="categories"
                element={
                  <RequireAuth roles={["SUPER_ADMIN"]}>
                    <AdminCategories />
                  </RequireAuth>
                }
              />
              <Route
                path="compliance"
                element={
                  <RequireAuth roles={["SUPPORT_AGENT", "SUPER_ADMIN"]}>
                    <AdminCompliance />
                  </RequireAuth>
                }
              />
            </Route>
            <Route path="*" element={<section className="page"><h1>Page not found</h1><p>This page is unavailable.</p><Link className="button secondary" to="/browse">Browse products</Link></section>} />
          </Route>
      </Routes>
    </AuthProvider>
  );
}
