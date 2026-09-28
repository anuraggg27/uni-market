import { useState } from "react";
import { ImageOff, MapPin } from "lucide-react";
import { Link } from "react-router-dom";

interface MarketplaceListing {
  id: string;
  title?: string | null;
  coverImageUrl?: string | null;
  lifecycleState?: string | null;
  condition?: string | null;
  location?: string | null;
  categoryName?: string | null;
  category?: { name?: string | null } | string | null;
  priceLabel?: string | null;
  priceType?: string | null;
  exactPrice?: number | null;
  minimumPrice?: number | null;
  maximumPrice?: number | null;
  approvedAt?: string | Date | null;
  createdAt?: string | Date | null;
}

export function ProductCard({
  listing,
  variant = "default",
}: {
  listing: MarketplaceListing;
  variant?: "default" | "browse";
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const title = cleanText(listing.title, "Untitled listing");
  const location = cleanText(listing.location, "Location unavailable");
  const condition = cleanText(
    listing.condition,
    "Condition unavailable",
  ).replaceAll("_", " ");
  const category = getCategoryLabel(listing);
  const postedAt = listing.approvedAt ?? listing.createdAt;
  const postedLabel = formatPostedTime(postedAt);
  const href = `/listing/${listing.id}`;
  const showImage = Boolean(listing.coverImageUrl) && !imageFailed;

  return (
    <article
      className="market-card group"
      data-variant={variant}
    >
      <Link
        to={href}
        aria-label={`View ${title}`}
        className="market-card-link"
      >
        <div className="market-card-visual">
          {showImage ? (
            <img
              className="market-card-image"
              src={listing.coverImageUrl ?? undefined}
              alt={title}
              loading="lazy"
              width={640}
              height={480}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <ImagePlaceholder />
          )}
          <span className="market-card-image-tint" aria-hidden="true" />
          <span className="market-card-category">{category}</span>
          {listing.lifecycleState &&
          listing.lifecycleState !== "ACTIVE" ? (
            <div className="market-card-badges">
              <span className="market-card-state">
                {listing.lifecycleState.replaceAll("_", " ")}
              </span>
            </div>
          ) : null}
        </div>

        <div className="market-card-content">
          <h3>{title}</h3>

          <div className="market-card-primary">
            <p className="market-card-price">{getPriceLabel(listing)}</p>
            <span
              className="market-card-condition"
              data-condition={listing.condition ?? undefined}
            >
              {condition}
            </span>
          </div>

          <div className="market-card-meta" aria-label="Listing details">
            <span className="market-card-location">
              <MapPin aria-hidden="true" />
              <span>{location}</span>
            </span>
            {postedLabel ? (
              <time dateTime={toDateTime(postedAt)}>
                <span className="market-card-meta-dot" aria-hidden="true" />
                {postedLabel}
              </time>
            ) : null}
          </div>
        </div>
      </Link>
    </article>
  );
}

function ImagePlaceholder() {
  return (
    <div className="market-card-placeholder">
      <span className="market-card-placeholder-orbit" aria-hidden="true" />
      <span className="market-card-placeholder-icon">
        <ImageOff aria-hidden="true" />
      </span>
      <span>No image</span>
    </div>
  );
}

function getCategoryLabel(item: MarketplaceListing): string {
  if (typeof item.category === "object" && item.category) {
    const nested = cleanText(item.category.name, "");
    if (nested) return nested;
  }
  if (typeof item.category === "string") {
    const direct = cleanText(item.category, "");
    if (direct) return direct;
  }
  return cleanText(item.categoryName, "Campus find");
}

function cleanText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function getPriceLabel(item: MarketplaceListing): string {
  const label = cleanText(item.priceLabel, "");
  if (label) return label;
  if (item.priceType === "FREE") return "Free";
  if (
    item.priceType === "RANGE" &&
    typeof item.minimumPrice === "number" &&
    typeof item.maximumPrice === "number"
  ) {
    return `₹${item.minimumPrice.toLocaleString("en-IN")}–₹${item.maximumPrice.toLocaleString("en-IN")}`;
  }
  if (typeof item.exactPrice === "number") {
    return `₹${item.exactPrice.toLocaleString("en-IN")}`;
  }
  return "Price unavailable";
}

function formatPostedTime(value: MarketplaceListing["createdAt"]): string {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - timestamp) / 60_000),
  );
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

function toDateTime(value: MarketplaceListing["createdAt"]): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}
