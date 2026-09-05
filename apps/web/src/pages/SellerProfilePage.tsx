import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Clock3,
  Eye,
  Handshake,
  ImageOff,
  MapPin,
  MessageCircle,
  PackageCheck,
  ShieldCheck,
  ShoppingBag,
  Star,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { ReportButton } from "../components/ReportButton";
import { ProfileModeSwitcher } from "../components/ProfileModeSwitcher";
import { ErrorState, Loading } from "../components/UI";
import { UserAvatar } from "../components/UserAvatar";

type SellerListing = {
  id: string;
  title: string;
  condition: string;
  location: string;
  priceType: "FIXED" | "RANGE" | "FREE";
  exactPrice: number | null;
  minimumPrice: number | null;
  maximumPrice: number | null;
  viewCount: number;
  approvedAt: string | null;
  createdAt: string;
};

type SellerReview = {
  id: string;
  rating: number;
  text: string;
  createdAt: string;
  reviewerName: string;
};

type SellerProfile = {
  id: string;
  displayName: string;
  avatarId: string | null;
  institution: string | null;
  campus: string | null;
  phoneVerifiedAt: string | null;
  completedSales: number;
  createdAt: string;
  averageRating: number;
  reviewCount: number;
  activeListings: SellerListing[];
  recentReviews: SellerReview[];
};

export function SellerProfilePage() {
  const { sellerId } = useParams();
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["seller", sellerId],
    queryFn: () => api<SellerProfile>(`/api/sellers/${sellerId}`),
  });

  if (query.isLoading) {
    return <div className="page"><Loading label="Loading seller" /></div>;
  }
  if (query.isError) {
    return <div className="page"><ErrorState error={query.error} /></div>;
  }

  const seller = query.data!;
  const listingCount = seller.activeListings.length;
  const totalViews = seller.activeListings.reduce(
    (total, listing) => total + Number(listing.viewCount ?? 0),
    0,
  );
  const rating = Number(seller.averageRating ?? 0);
  const location = [seller.institution, seller.campus].filter(Boolean).join(" \u00b7 ");
  const isNewSeller = Number(seller.completedSales) === 0;
  const isOwnSellerProfile = user?.id === seller.id;
  const memberSince = new Date(seller.createdAt).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <main className="page seller-profile-page">
      {isOwnSellerProfile ? (
        <header className="seller-profile-page-header">
          <div>
            <h1>Seller profile</h1>
            <p>Manage your seller profile, listings, and track your sales on Uni Market.</p>
          </div>
          <ProfileModeSwitcher activeMode="seller" sellerId={seller.id} />
        </header>
      ) : null}
      <section className="seller-profile-hero">
        <div className="seller-profile-identity">
          <UserAvatar
            avatarId={seller.avatarId}
            displayName={seller.displayName}
            size={100}
            className="seller-profile-avatar"
          />

          <div className="seller-profile-copy">
            <div className="seller-profile-title-row">
              <h1>{seller.displayName}</h1>
              {seller.phoneVerifiedAt ? (
                <span className="seller-profile-verified">
                  <BadgeCheck aria-hidden="true" />
                  Phone verified
                </span>
              ) : null}
            </div>
            <div className="seller-profile-meta">
              <span><CalendarDays aria-hidden="true" />Member since {memberSince}</span>
              <span>
                <ShoppingBag aria-hidden="true" />
                {seller.completedSales} completed {seller.completedSales === 1 ? "sale" : "sales"}
              </span>
            </div>
            {location ? (
              <p className="seller-profile-location">
                <MapPin aria-hidden="true" />
                {location}
              </p>
            ) : null}
            <p className="seller-profile-rating">
              {seller.reviewCount ? <>
                <strong>{rating.toFixed(1)}</strong>
                <Star aria-hidden="true" />
                <span>from {seller.reviewCount} seller {seller.reviewCount === 1 ? "review" : "reviews"}</span>
              </> : <span>No seller reviews yet</span>}
            </p>
          </div>
        </div>

        <aside className="seller-profile-trust" aria-label="Seller status">
          <span className="seller-profile-trust-icon">
            <ShieldCheck aria-hidden="true" />
          </span>
          <div>
            <strong>{isNewSeller ? "New seller" : "Active seller"}</strong>
            <p>
              {isNewSeller
                ? "Complete successful exchanges to build a verified seller history."
                : `${seller.completedSales} completed ${seller.completedSales === 1 ? "exchange" : "exchanges"} on Uni Market.`}
            </p>
          </div>
        </aside>

        {user?.phoneVerifiedAt && user.id !== sellerId ? (
          <div className="seller-profile-report">
            <ReportButton targetType="USER" targetId={sellerId!} label="Report seller" />
          </div>
        ) : null}
      </section>

      <div className="seller-profile-layout">
        <section className="seller-profile-listings" aria-labelledby="seller-listings-heading">
          <div className="seller-profile-section-heading">
            <h2 id="seller-listings-heading">
              Current listings <span>({listingCount})</span>
            </h2>
          </div>
          {listingCount ? (
            <div className="seller-listing-stack">
              {seller.activeListings.map((listing) => (
                <SellerListingCard key={listing.id} listing={listing} />
              ))}
            </div>
          ) : (
            <SellerEmpty
              icon={<PackageCheck />}
              title="No active listings"
              body="This seller has no approved products for sale right now."
            />
          )}
        </section>

        <aside className="seller-profile-sidebar">
          <section className="seller-profile-card" aria-labelledby="seller-stats-heading">
            <h2 id="seller-stats-heading">Seller stats</h2>
            <div className="seller-stats-grid">
              <SellerStat icon={<ShoppingBag />} value={seller.completedSales} label="Completed sales" />
              <SellerStat icon={<PackageCheck />} value={listingCount} label="Active listings" />
              <SellerStat icon={<Eye />} value={totalViews} label="Total views" />
              <SellerStat icon={<Star />} value={seller.reviewCount ? rating.toFixed(1) : "—"} label="Seller rating" />
            </div>
          </section>

          <section className="seller-profile-card" aria-labelledby="seller-how-heading">
            <h2 id="seller-how-heading">How it works</h2>
            <div className="seller-how-list">
              <SellerHowStep
                icon={<MessageCircle />}
                title="Message the seller"
                body="Start a chat to ask questions or negotiate."
              />
              <SellerHowStep
                icon={<Handshake />}
                title="Meet safely"
                body="Meet in public places around campus."
              />
              <SellerHowStep
                icon={<PackageCheck />}
                title="Complete the exchange"
                body="Confirm the handover and leave a verified review."
              />
            </div>
          </section>

          <section className="seller-profile-card seller-reviews-card" aria-labelledby="seller-reviews-heading">
            <h2 id="seller-reviews-heading">Reviews from buyers</h2>
            {seller.recentReviews.length ? (
              <div className="seller-review-list">
                {seller.recentReviews.map((review) => (
                  <article className="seller-review" key={review.id}>
                    <div className="seller-review-heading">
                      <div>
                        <strong>{review.reviewerName}</strong>
                        <span>Verified transaction</span>
                      </div>
                      <span
                        className="seller-review-rating"
                        aria-label={`${review.rating} out of 5 stars`}
                      >
                        <Star aria-hidden="true" />
                        {Number(review.rating).toFixed(1)}
                      </span>
                    </div>
                    <p>{review.text}</p>
                    <time dateTime={new Date(review.createdAt).toISOString()}>
                      {new Date(review.createdAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </time>
                    {user?.phoneVerifiedAt ? (
                      <ReportButton
                        targetType="REVIEW"
                        targetId={review.id}
                        label="Report review"
                      />
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <SellerEmpty
                icon={<PackageCheck />}
                title="No seller reviews yet"
                body="Reviews from buyers appear after completed sales."
                reviews
              />
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

function SellerStat({
  icon,
  value,
  label,
}: {
  icon: ReactNode;
  value: string | number;
  label: string;
}) {
  return (
    <div className="seller-stat">
      <span className="seller-stat-icon" aria-hidden="true">{icon}</span>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

function SellerHowStep({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="seller-how-step">
      <span className="seller-how-icon" aria-hidden="true">{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
    </div>
  );
}

function SellerEmpty({
  icon,
  title,
  body,
  reviews = false,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  reviews?: boolean;
}) {
  return (
    <div className={`seller-profile-empty${reviews ? " seller-reviews-empty" : ""}`}>
      <span aria-hidden="true">{icon}</span>
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function SellerListingCard({ listing }: { listing: SellerListing }) {
  const postedAt = listing.approvedAt ?? listing.createdAt;
  const postedDate = new Date(postedAt);
  const postedLabel = formatRelativeDate(postedDate);
  const price = listing.priceType === "FREE"
    ? "Free"
    : listing.priceType === "RANGE"
      ? `\u20b9${Number(listing.minimumPrice).toLocaleString("en-IN")}\u2013\u20b9${Number(listing.maximumPrice).toLocaleString("en-IN")}`
      : `\u20b9${Number(listing.exactPrice).toLocaleString("en-IN")}`;

  return (
    <article className="seller-listing-card">
      <Link
        to={`/listing/${listing.id}`}
        className="seller-listing-link"
        aria-label={`View ${listing.title}`}
      >
        <div className="seller-listing-visual">
          <ImageOff aria-hidden="true" />
          <span>No image</span>
        </div>
        <div className="seller-listing-content">
          <span className="seller-listing-condition">
            {String(listing.condition).replaceAll("_", " ")}
          </span>
          <h3>{listing.title}</h3>
          <p className="seller-listing-location">
            <MapPin aria-hidden="true" />
            {listing.location}
          </p>
          <strong className="seller-listing-price">{price}</strong>
          <div className="seller-listing-meta">
            {postedLabel ? (
              <time dateTime={postedDate.toISOString()}>
                <Clock3 aria-hidden="true" />
                {postedLabel}
              </time>
            ) : null}
            <span><Eye aria-hidden="true" />{Number(listing.viewCount ?? 0)} views</span>
          </div>
        </div>
        <span className="seller-listing-cta">
          Show details
          <ArrowRight aria-hidden="true" />
        </span>
      </Link>
    </article>
  );
}

function formatRelativeDate(date: Date): string {
  if (!Number.isFinite(date.getTime())) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
