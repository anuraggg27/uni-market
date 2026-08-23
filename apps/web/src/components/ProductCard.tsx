import { useState } from "react";
import { ImageOff, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import { StatusBadge } from "./UI";

export function ProductCard({
  listing,
  variant = "default",
}: {
  listing: any;
  variant?: "default" | "browse";
}) {
  if (variant === "browse") return <BrowseProductCard listing={listing} />;

  return (
    <article className="group relative flex flex-col rounded-2xl bg-white border border-[#f0f0f0] overflow-hidden hover:border-[#e0e0e0] shadow-[0_2px_8px_rgba(0,0,0,0.02)] hover:shadow-[0_12px_28px_rgba(0,0,0,0.05)] hover:-translate-y-0.5 transition-all duration-200">
      <Link
        to={`/listing/${listing.id}`}
        aria-label={`View ${listing.title}`}
        className="flex flex-col h-full"
      >
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-[#f9faf9]">
          {listing.coverImageUrl ? (
            <img
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              src={listing.coverImageUrl}
              alt={listing.title}
              loading="lazy"
              width={640}
              height={480}
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-[#9ca3af]">
              <ImageOff className="size-5" aria-hidden="true" />
              <span className="text-xs font-normal">No image</span>
            </div>
          )}
          {listing.lifecycleState !== "ACTIVE" ? (
            <span className="absolute left-2.5 top-2.5">
              <StatusBadge value={listing.lifecycleState} />
            </span>
          ) : null}
        </div>
        <div className="flex flex-col flex-1 p-3.5">
          <h3 className="text-[15px] font-medium text-[#111827] truncate leading-tight mb-1">
            {listing.title}
          </h3>
          <div className="text-[15px] font-semibold text-[#111827] mb-2">
            {listing.priceLabel ?? formatDefaultPrice(listing)}
          </div>
          <div className="mt-auto flex items-center justify-between text-[12px] text-[#6b7280] pt-2 border-t border-[#f5f5f5]">
            <span>{String(listing.condition).replaceAll("_", " ")}</span>
            <span className="flex items-center gap-1 truncate max-w-[140px]">
              <MapPin
                className="size-3 text-[#9ca3af] shrink-0"
                aria-hidden="true"
              />
              <span className="truncate">{listing.location}</span>
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}

function BrowseProductCard({ listing }: { listing: any }) {
  const [imageFailed, setImageFailed] = useState(false);
  const title = cleanText(listing.title, "Untitled listing");
  const location = cleanText(listing.location, "Location unavailable");
  const condition = cleanText(
    listing.condition,
    "Condition unavailable",
  ).replaceAll("_", " ");
  const category = cleanText(listing.categoryName, "");
  const details = [condition, category].filter(Boolean).join(" · ");
  const href = `/listing/${listing.id}`;

  return (
    <article className="group flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-[#eceef0] bg-white transition-all duration-200 hover:-translate-y-0.5 hover:border-[#dfe3e6] hover:shadow-[0_10px_28px_rgba(17,24,39,0.045)]">
      <Link to={href} aria-label={`View ${title}`} className="block">
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-[#f6f7f6]">
          {listing.coverImageUrl && !imageFailed ? (
            <img
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.015]"
              src={listing.coverImageUrl}
              alt={title}
              loading="lazy"
              width={640}
              height={480}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <ImagePlaceholder />
          )}
          {listing.lifecycleState && listing.lifecycleState !== "ACTIVE" ? (
            <span className="absolute left-3 top-3">
              <StatusBadge value={listing.lifecycleState} />
            </span>
          ) : null}
        </div>
      </Link>

      <div className="flex flex-1 flex-col p-4 sm:p-[18px]">
        <p className="mb-2 min-h-4 truncate text-[11px] font-medium uppercase tracking-[0.06em] text-[#7b8490]">
          {details || "Campus marketplace"}
        </p>
        <h3 className="mb-2 line-clamp-2 min-h-[2.5rem] text-[16px] font-medium leading-[1.3] tracking-[-0.015em] text-[#111827]">
          {title}
        </h3>
        <p className="m-0 text-[17px] font-semibold tracking-[-0.015em] text-[#111827]">
          {getPriceLabel(listing)}
        </p>

        <div className="mt-4 flex items-center gap-3 border-t border-[#f0f1f2] pt-3.5">
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-[#6b7280]">
            <MapPin
              className="size-3.5 shrink-0 text-[#9ca3af]"
              aria-hidden="true"
            />
            <span className="truncate">{location}</span>
          </span>
          <Link
            to={href}
            className="browse-buy-button inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-[#111827] px-4 text-[13px] font-medium text-white transition-colors hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111827]/25 focus-visible:ring-offset-2"
            aria-label={`Show ${title}`}
          >
            Buy
          </Link>
        </div>
      </div>
    </article>
  );
}

function ImagePlaceholder() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[#f6f7f6] text-[#9ca3af]">
      <span className="grid size-10 place-items-center rounded-full border border-[#e5e7eb] bg-white/80">
        <ImageOff className="size-4" aria-hidden="true" />
      </span>
      <span className="text-xs font-normal">Image unavailable</span>
    </div>
  );
}

function cleanText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function getPriceLabel(item: any): string {
  const label = cleanText(item.priceLabel, "");
  return label || formatBrowsePrice(item);
}

function formatDefaultPrice(item: any) {
  if (item.priceType === "FREE") return "Free";
  if (item.priceType === "RANGE") {
    return `₹${item.minimumPrice?.toLocaleString("en-IN")}–₹${item.maximumPrice?.toLocaleString("en-IN")}`;
  }
  return `₹${item.exactPrice?.toLocaleString("en-IN")}`;
}
function formatBrowsePrice(item: any): string {
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
