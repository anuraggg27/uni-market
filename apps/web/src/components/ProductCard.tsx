import { ImageOff, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import { StatusBadge } from "./UI";

export function ProductCard({ listing }: { listing: any }) {
  return (
    <article className="group relative flex flex-col rounded-2xl bg-white border border-[#f0f0f0] overflow-hidden hover:border-[#e0e0e0] shadow-[0_2px_8px_rgba(0,0,0,0.02)] hover:shadow-[0_12px_28px_rgba(0,0,0,0.05)] hover:-translate-y-0.5 transition-all duration-200">
      <Link to={`/listing/${listing.id}`} aria-label={`View ${listing.title}`} className="flex flex-col h-full">
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
            {listing.priceLabel ?? formatPrice(listing)}
          </div>
          <div className="mt-auto flex items-center justify-between text-[12px] text-[#6b7280] pt-2 border-t border-[#f5f5f5]">
            <span>{String(listing.condition).replaceAll('_', ' ')}</span>
            <span className="flex items-center gap-1 truncate max-w-[140px]">
              <MapPin className="size-3 text-[#9ca3af] shrink-0" aria-hidden="true" />
              <span className="truncate">{listing.location}</span>
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}

function formatPrice(item: any) {
  if (item.priceType === "FREE") return "Free";
  if (item.priceType === "RANGE") {
    return `₹${item.minimumPrice?.toLocaleString("en-IN")}–₹${item.maximumPrice?.toLocaleString("en-IN")}`;
  }
  return `₹${item.exactPrice?.toLocaleString("en-IN")}`;
}
