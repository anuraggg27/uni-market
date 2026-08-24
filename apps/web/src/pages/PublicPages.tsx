import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  CalendarDays,
  ChevronRight,
  Heart,
  ImageOff,
  Hash,
  MapPin,
  MessageCircle,
  Palette,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Tag,
} from "lucide-react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { api, jsonBody } from "../api";
import { reportReasons } from "@campus-market/shared";
import { useAuth } from "../auth";
import { postLoginDestination } from "../auth-routing";
import { ProductCard } from "../components/ProductCard";
import { ReportButton } from "../components/ReportButton";
import {
  EmptyState,
  ErrorState,
  Loading,
  SafetyReminder,
  StatusBadge,
} from "../components/UI";

import { HeroParticles } from "../components/HeroParticles";

const HOME_SEARCH_PLACEHOLDER_WORDS = [
  "books",
  "calculator",
  "cycle",
  "monitor",
  "keyboard",
] as const;
const HOME_SEARCH_PLACEHOLDER_HOLD_MS = 2400;
const HOME_SEARCH_PLACEHOLDER_TRANSITION_MS = 1100;

function useListings(search: string) {
  return useQuery({
    queryKey: ["listings", search],
    queryFn: () => api<any[]>(`/api/listings${search}`),
  });
}
function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: () => api<any[]>("/api/categories"),
  });
}

export function HomePage() {
  const navigate = useNavigate();
  const [term, setTerm] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [placeholderTransitioning, setPlaceholderTransitioning] =
    useState(false);
  const recent = useListings("?limit=8&sort=newest");
  const popular = useListings("?limit=8&sort=popular");
  const { user } = useAuth();
  const saved = useQuery({
    queryKey: ["favourites"],
    queryFn: () => api<any[]>("/api/favourites"),
    enabled: Boolean(user),
  });
  const nearbySearch = user?.campus
    ? `?limit=4&location=${encodeURIComponent(user.campus)}`
    : "?limit=4";
  const nearby = useListings(nearbySearch);

  useEffect(() => {
    if (searchFocused || term) return;

    let settleTimer: number | undefined;
    const advanceTimer = window.setTimeout(() => {
      setPlaceholderTransitioning(true);
      settleTimer = window.setTimeout(() => {
        setPlaceholderIndex(
          (current) => (current + 1) % HOME_SEARCH_PLACEHOLDER_WORDS.length,
        );
        setPlaceholderTransitioning(false);
      }, HOME_SEARCH_PLACEHOLDER_TRANSITION_MS);
    }, HOME_SEARCH_PLACEHOLDER_HOLD_MS);

    return () => {
      window.clearTimeout(advanceTimer);
      if (settleTimer !== undefined) window.clearTimeout(settleTimer);
    };
  }, [placeholderIndex, searchFocused, term]);

  const nextPlaceholderIndex =
    (placeholderIndex + 1) % HOME_SEARCH_PLACEHOLDER_WORDS.length;
  const showAnimatedPlaceholder = !searchFocused && term.length === 0;

  return (
    <>
      {/* ─── Hero Section (Minimal / Antigravity inspired) ─── */}
      <section className="home-hero relative flex min-h-[76vh] md:min-h-[82vh] flex-col items-center justify-center overflow-hidden px-4 py-16 text-center sm:px-6 md:py-24 bg-surface">
        <HeroParticles />
        <div className="relative z-10 mx-auto flex max-w-5xl flex-col items-center">
          {/* Main Heading */}
          <h1 className="home-hero-title mb-6 max-w-5xl text-ink">
            <span className="text-accent">
              Find what you need
            </span>{" "}
            <span className="text-ink">around campus</span>
          </h1>
          {/* Supporting text */}
          <p className="home-hero-copy mb-10 max-w-2xl text-lg sm:text-[20px] text-muted">
            The student marketplace for peer-to-peer textbook, tech, cycle, and
            room essentials exchanges.
          </p>
          {/* Search Pill Component */}
          <form
            className="group relative w-full max-w-2xl sm:max-w-3xl"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              if (term.trim()) {
                navigate(`/browse?q=${encodeURIComponent(term.trim())}`);
              } else {
                navigate("/browse");
              }
            }}
          >
            <div className="relative flex h-14 sm:h-16 w-full items-center rounded-full border border-line bg-surface/95 pl-5 pr-2 sm:pr-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.04)] backdrop-blur-xl transition-all duration-200 hover:border-line focus-within:border-focus focus-within:shadow-[0_12px_36px_rgba(0,0,0,0.08)]">
              <Search
                className="mr-3.5 size-5 shrink-0 text-muted"
                aria-hidden="true"
              />
              <label className="sr-only" htmlFor="home-search">
                Search products
              </label>
              <div className="home-search-field">
                <input
                  id="home-search"
                  value={term}
                  placeholder=" "
                  onChange={(event) => setTerm(event.target.value)}
                  onFocus={() => {
                    setSearchFocused(true);
                    setPlaceholderTransitioning(false);
                  }}
                  onBlur={() => setSearchFocused(false)}
                  className="search-pill-input h-full w-full bg-transparent text-[16px] text-ink font-normal outline-none focus:outline-none border-none ring-0 focus:ring-0 shadow-none"
                />
                {showAnimatedPlaceholder ? (
                  <span
                    className="home-search-placeholder"
                    aria-hidden="true"
                  >
                    <span>Search</span>
                    <span
                      className={`home-search-placeholder-keyword ${placeholderTransitioning ? "is-transitioning" : ""}`}
                    >
                      <span className="home-search-placeholder-current">
                        {HOME_SEARCH_PLACEHOLDER_WORDS[placeholderIndex]}
                      </span>
                      <span className="home-search-placeholder-next">
                        {HOME_SEARCH_PLACEHOLDER_WORDS[nextPlaceholderIndex]}
                      </span>
                    </span>
                  </span>
                ) : null}
              </div>
              <button
                type="submit"
                className="flex h-10 sm:h-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-brand px-6 text-[15px] font-semibold text-on-brand !text-on-brand shadow-none transition-all hover:bg-brand-hover active:scale-[0.98]"
              >
                <span className="text-on-brand !text-on-brand font-semibold">
                  Search
                </span>
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* ─── Marketplace Content ─── */}
      <div className="page pt-2 pb-24">
        <ProductSection title="Recently approved" query={recent} />
        <ProductSection title="Popular right now" query={popular} />
        {user ? (
          <ProductSection
            title={user.campus ? `Near ${user.campus}` : "Near you"}
            query={nearby}
          />
        ) : null}
        {user && saved.data?.length ? (
          <section className="section">
            <div className="mb-6 flex items-baseline justify-between border-b border-line pb-3">
              <h2 className="text-2xl font-semibold tracking-[-0.025em] text-ink">
                Saved for later
              </h2>
              <Link
                to="/saved"
                className="group flex items-center gap-1 text-[14px] font-medium text-muted hover:text-ink transition-colors"
              >
                <span>See saved</span>
                <span className="transition-transform duration-150 group-hover:translate-x-0.5">
                  →
                </span>
              </Link>
            </div>
            <div className="product-grid">
              {saved.data.slice(0, 4).map((listing) => (
                <ProductCard key={listing.id} listing={listing} />
              ))}
            </div>
          </section>
        ) : null}
        <section className="section">
          <SafetyReminder />
        </section>
      </div>
    </>
  );
}

function ProductSection({
  title,
  query,
}: {
  title: string;
  query: ReturnType<typeof useListings>;
}) {
  return (
    <section className="section">
      <div className="mb-6 flex items-baseline justify-between border-b border-line pb-3">
        <h2 className="text-2xl font-semibold tracking-[-0.025em] text-ink">
          {title}
        </h2>
        <Link
          to="/browse"
          className="group flex items-center gap-1 text-[14px] font-medium text-muted hover:text-ink transition-colors"
        >
          <span>Browse all</span>
          <span className="transition-transform duration-150 group-hover:translate-x-0.5">
            →
          </span>
        </Link>
      </div>
      {query.isLoading ? (
        <Loading variant="cards" label={`Loading ${title}`} />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : !query.data?.length ? (
        <EmptyState
          title="Nothing listed yet"
          body="Approved student listings will appear here."
        />
      ) : (
        <div className="product-grid">
          {query.data.map((listing) => (
            <ProductCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </section>
  );
}

type BrowseFilters = {
  q: string;
  category: string;
  minPrice: string;
  maxPrice: string;
  condition: string;
  sort: string;
  location: string;
  negotiable: boolean;
};

function filtersFromParams(params: URLSearchParams): BrowseFilters {
  return {
    q: params.get("q") ?? "",
    category: params.get("category") ?? "",
    minPrice: params.get("minPrice") ?? "",
    maxPrice: params.get("maxPrice") ?? "",
    condition: params.get("condition") ?? "",
    sort: params.get("sort") ?? "newest",
    location: params.get("location") ?? "",
    negotiable: params.get("negotiable") === "true",
  };
}

function paramsFromFilters(filters: BrowseFilters): URLSearchParams {
  const next = new URLSearchParams();
  if (filters.q.trim()) next.set("q", filters.q.trim());
  if (filters.category) next.set("category", filters.category);
  if (filters.minPrice) next.set("minPrice", filters.minPrice);
  if (filters.maxPrice) next.set("maxPrice", filters.maxPrice);
  if (filters.condition) next.set("condition", filters.condition);
  if (filters.sort && filters.sort !== "newest") next.set("sort", filters.sort);
  if (filters.location.trim()) next.set("location", filters.location.trim());
  if (filters.negotiable) next.set("negotiable", "true");
  return next;
}

export function BrowsePage() {
  const [params, setParams] = useSearchParams();
  const serialized = params.toString();
  const [filters, setFilters] = useState<BrowseFilters>(() =>
    filtersFromParams(params),
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const categories = useCategories();
  const listings = useListings(serialized ? `?${serialized}` : "");
  const displayedProducts = listings.data ?? [];
  const availableCategories = categories.data ?? [];

  useEffect(() => {
    setFilters(filtersFromParams(new URLSearchParams(serialized)));
  }, [serialized]);

  useEffect(() => {
    const query = filters.q.trim();
    const currentQuery = new URLSearchParams(serialized).get("q") ?? "";
    if (query === currentQuery) return;
    const timeout = window.setTimeout(() => {
      const next = new URLSearchParams(serialized);
      if (query) next.set("q", query);
      else next.delete("q");
      setParams(next, { replace: true });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [filters.q, serialized, setParams]);

  function updateFilter<Key extends keyof BrowseFilters>(
    key: Key,
    value: BrowseFilters[Key],
  ) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function applyFilters(event?: React.FormEvent) {
    event?.preventDefault();
    setParams(paramsFromFilters(filters));
    setFiltersOpen(false);
  }

  function resetFilters() {
    setFilters(filtersFromParams(new URLSearchParams()));
    setParams({});
    setFiltersOpen(false);
  }

  const inputClass =
    "h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-[14px] font-normal text-ink outline-none transition-colors placeholder:text-muted hover:border-line focus:border-focus focus:ring-2 focus:ring-focus/10";
  const labelClass =
    "mb-2 block text-[12px] font-medium tracking-[0.01em] text-muted";

  return (
    <div className="page !pt-10 sm:!pt-12">
      <div className="mb-7 flex flex-col gap-4 sm:mb-9 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow !mb-2">Marketplace</p>
          <h1 className="font-bold text-ink">Browse products</h1>
          <p className="mt-2 text-[15px] font-normal text-muted">
            Find great items listed by students around you.
          </p>
        </div>
        <p className="m-0 max-w-sm text-[13px] leading-relaxed text-muted md:text-right">
          Only manually approved listings appear here.
        </p>
      </div>

      <form
        className="mb-8 hidden rounded-[20px] border border-line bg-surface p-5 shadow-[0_8px_30px_rgba(17,24,39,0.025)] md:block lg:p-6"
        aria-label="Product filters"
        onSubmit={applyFilters}
      >
        <div className="grid grid-cols-3 gap-x-4 gap-y-5 xl:grid-cols-6">
          <label className="min-w-0">
            <span className={labelClass}>Search</span>
            <span className="relative block">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <input
                className={`${inputClass} !pl-10`}
                value={filters.q}
                onChange={(event) => updateFilter("q", event.target.value)}
                placeholder="Search products"
              />
            </span>
          </label>
          <label className="min-w-0">
            <span className={labelClass}>Category</span>
            <select
              className={inputClass}
              value={filters.category}
              onChange={(event) => updateFilter("category", event.target.value)}
            >
              <option value="">All categories</option>
              {availableCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0">
            <span className={labelClass}>Min price</span>
            <input
              className={inputClass}
              inputMode="numeric"
              value={filters.minPrice}
              onChange={(event) => updateFilter("minPrice", event.target.value)}
              placeholder="₹0"
            />
          </label>
          <label className="min-w-0">
            <span className={labelClass}>Max price</span>
            <input
              className={inputClass}
              inputMode="numeric"
              value={filters.maxPrice}
              onChange={(event) => updateFilter("maxPrice", event.target.value)}
              placeholder="Any"
            />
          </label>
          <label className="min-w-0">
            <span className={labelClass}>Condition</span>
            <select
              className={inputClass}
              value={filters.condition}
              onChange={(event) =>
                updateFilter("condition", event.target.value)
              }
            >
              <option value="">Any condition</option>
              {["NEW", "LIKE_NEW", "GOOD", "FAIR", "POOR"].map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0">
            <span className={labelClass}>Sort</span>
            <select
              className={inputClass}
              value={filters.sort}
              onChange={(event) => updateFilter("sort", event.target.value)}
            >
              <option value="newest">Newest</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
              <option value="popular">Popular</option>
            </select>
          </label>
        </div>

        <div className="browse-filter-divider my-5 h-px bg-line" />

        <div className="grid grid-cols-[minmax(240px,1fr)_auto_auto_auto] items-end gap-4">
          <label className="min-w-0">
            <span className={labelClass}>Location</span>
            <span className="relative block">
              <MapPin
                className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <input
                className={`${inputClass} !pl-10`}
                value={filters.location}
                onChange={(event) =>
                  updateFilter("location", event.target.value)
                }
                placeholder="Campus or area"
              />
            </span>
          </label>
          <label className="flex h-11 cursor-pointer items-center gap-2.5 whitespace-nowrap px-2 text-[14px] font-normal text-muted">
            <input
              className="size-4 rounded border-line accent-brand"
              type="checkbox"
              checked={filters.negotiable}
              onChange={(event) =>
                updateFilter("negotiable", event.target.checked)
              }
            />
            Negotiable only
          </label>
          <button
            type="submit"
            className="h-11 rounded-full bg-brand px-6 text-[14px] font-medium text-on-brand transition-colors hover:bg-brand-hover"
          >
            Apply filters
          </button>
          <button
            type="button"
            onClick={resetFilters}
            className="h-11 rounded-full border border-line bg-surface px-5 text-[14px] font-normal text-ink transition-colors hover:border-line hover:bg-surface-muted"
          >
            Reset
          </button>
        </div>
      </form>

      <form
        className="mb-7 md:hidden"
        aria-label="Product filters"
        onSubmit={applyFilters}
      >
        <div className="flex gap-2.5">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search</span>
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <input
              className={`${inputClass} !h-12 !rounded-full !pl-10`}
              value={filters.q}
              onChange={(event) => updateFilter("q", event.target.value)}
              placeholder="Search products"
            />
          </label>
          <button
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            className="flex h-12 shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-4 text-[14px] font-medium text-ink transition-colors hover:border-line hover:bg-surface-muted"
            aria-expanded={filtersOpen}
          >
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            Filters
          </button>
        </div>

        {filtersOpen ? (
          <div className="mt-3 rounded-2xl border border-line bg-surface p-4 shadow-[0_10px_30px_rgba(17,24,39,0.04)]">
            <div className="grid grid-cols-2 gap-3.5">
              <label className="col-span-2">
                <span className={labelClass}>Category</span>
                <select
                  className={inputClass}
                  value={filters.category}
                  onChange={(event) =>
                    updateFilter("category", event.target.value)
                  }
                >
                  <option value="">All categories</option>
                  {availableCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className={labelClass}>Min price</span>
                <input
                  className={inputClass}
                  inputMode="numeric"
                  value={filters.minPrice}
                  onChange={(event) =>
                    updateFilter("minPrice", event.target.value)
                  }
                  placeholder="₹0"
                />
              </label>
              <label>
                <span className={labelClass}>Max price</span>
                <input
                  className={inputClass}
                  inputMode="numeric"
                  value={filters.maxPrice}
                  onChange={(event) =>
                    updateFilter("maxPrice", event.target.value)
                  }
                  placeholder="Any"
                />
              </label>
              <label>
                <span className={labelClass}>Condition</span>
                <select
                  className={inputClass}
                  value={filters.condition}
                  onChange={(event) =>
                    updateFilter("condition", event.target.value)
                  }
                >
                  <option value="">Any</option>
                  {["NEW", "LIKE_NEW", "GOOD", "FAIR", "POOR"].map((value) => (
                    <option key={value} value={value}>
                      {value.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className={labelClass}>Sort</span>
                <select
                  className={inputClass}
                  value={filters.sort}
                  onChange={(event) => updateFilter("sort", event.target.value)}
                >
                  <option value="newest">Newest</option>
                  <option value="price_asc">Price: low to high</option>
                  <option value="price_desc">Price: high to low</option>
                  <option value="popular">Popular</option>
                </select>
              </label>
              <label className="col-span-2">
                <span className={labelClass}>Location</span>
                <span className="relative block">
                  <MapPin
                    className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
                    aria-hidden="true"
                  />
                  <input
                    className={`${inputClass} !pl-10`}
                    value={filters.location}
                    onChange={(event) =>
                      updateFilter("location", event.target.value)
                    }
                    placeholder="Campus or area"
                  />
                </span>
              </label>
            </div>
            <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-[14px] font-normal text-muted">
              <input
                className="size-4 rounded border-line accent-brand"
                type="checkbox"
                checked={filters.negotiable}
                onChange={(event) =>
                  updateFilter("negotiable", event.target.checked)
                }
              />
              Negotiable only
            </label>
            <div className="mt-4 grid grid-cols-2 gap-2.5 border-t border-line pt-4">
              <button
                type="submit"
                className="h-11 rounded-full bg-brand px-4 text-[14px] font-medium text-on-brand transition-colors hover:bg-brand-hover"
              >
                Apply filters
              </button>
              <button
                type="button"
                onClick={resetFilters}
                className="h-11 rounded-full border border-line bg-surface px-4 text-[14px] font-normal text-ink transition-colors hover:border-line hover:bg-surface-muted"
              >
                Reset
              </button>
            </div>
          </div>
        ) : null}
      </form>

      {listings.isLoading ? (
        <Loading variant="browse" label="Loading products" />
      ) : listings.isError ? (
        <ErrorState
          error={listings.error}
          retry={() => void listings.refetch()}
        />
      ) : !displayedProducts.length ? (
        <div className="flex min-h-[300px] flex-col items-center justify-center px-4 py-12 text-center sm:min-h-[340px]">
          <div className="grid size-14 place-items-center rounded-full border border-line bg-surface-muted text-muted">
            <Search className="size-5" aria-hidden="true" />
          </div>
          <h2 className="mb-0 mt-5 text-xl font-medium tracking-[-0.02em] text-ink">
            No products match
          </h2>
          <p className="mb-5 mt-2 max-w-sm text-[14px] leading-relaxed text-muted">
            Try a broader search or clear one of the filters.
          </p>
          <button
            type="button"
            className="h-10 rounded-full border border-line bg-surface px-5 text-[14px] font-normal text-ink transition-colors hover:border-line hover:bg-surface-muted"
            onClick={resetFilters}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {displayedProducts.map((listing) => (
            <ProductCard key={listing.id} listing={listing} variant="browse" />
          ))}
        </div>
      )}
    </div>
  );
}
export function ListingPage() {
  const { listingId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const client = useQueryClient();
  const categories = useCategories();
  const [activeImage, setActiveImage] = useState(0);
  const [reportOpen, setReportOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [savedOverride, setSavedOverride] = useState<boolean | null>(null);
  const [savedToast, setSavedToast] = useState<"saved" | "removed" | null>(
    null,
  );
  const query = useQuery({
    queryKey: ["listing", listingId],
    queryFn: () => api<any>(`/api/listings/${listingId}`),
  });
  const favourites = useQuery({
    queryKey: ["favourites"],
    queryFn: () => api<any[]>("/api/favourites"),
    enabled: Boolean(user),
  });
  const savedFromServer = Boolean(
    favourites.data?.some((favourite) => favourite.id === listingId),
  );
  const isSaved = savedOverride ?? savedFromServer;
  const save = useMutation({
    mutationFn: (nextSaved: boolean) =>
      api(`/api/favourites/${listingId}`, {
        method: nextSaved ? "POST" : "DELETE",
      }),
    onMutate: (nextSaved) => {
      const previousSaved = isSaved;
      setSavedOverride(nextSaved);
      return { previousSaved };
    },
    onError: (_error, _nextSaved, context) =>
      setSavedOverride(context?.previousSaved ?? null),
    onSuccess: (_data, nextSaved) => {
      setSavedToast(nextSaved ? "saved" : "removed");
      void client.invalidateQueries({ queryKey: ["favourites"] });
    },
  });
  useEffect(() => {
    if (!savedToast) return;
    const timeout = window.setTimeout(() => setSavedToast(null), 2400);
    return () => window.clearTimeout(timeout);
  }, [savedToast]);
  const contact = useMutation({
    mutationFn: () =>
      api<any>("/api/conversations", {
        method: "POST",
        ...jsonBody({ listingId }),
      }),
    onSuccess: (conversation) => navigate(`/chats/${conversation.id}`),
  });
  const buy = useMutation({
    mutationFn: () =>
      api<any>("/api/transactions", {
        method: "POST",
        ...jsonBody({ listingId }),
      }),
    onSuccess: () => navigate("/transactions"),
  });
  const report = useMutation({
    mutationFn: (data: { reason: string; details: string }) =>
      api("/api/reports", {
        method: "POST",
        ...jsonBody({ targetType: "LISTING", targetId: listingId, ...data }),
      }),
    onSuccess: () => setReportOpen(false),
  });
  if (query.isLoading)
    return (
      <Loading variant="detail" label="Loading listing" />
    );
  if (query.isError)
    return (
      <div className="page">
        <ErrorState error={query.error} />
      </div>
    );
  const item = query.data!;
  const owner = user?.id === item.sellerId;
  const images = Array.isArray(item.images) ? item.images : [];
  const activeImageUrl = images[activeImage]?.url as string | undefined;
  const listedAt = new Date(item.approvedAt ?? item.createdAt);
  const listedLabel = Number.isNaN(listedAt.getTime())
    ? null
    : listedAt.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
  const sellerRating = Number(item.seller?.rating);
  const hasSellerRating = Number.isFinite(sellerRating);
  const sellerName = item.seller?.displayName || "Marketplace seller";
  const categoryName =
    item.categoryName ||
    categories.data?.find((category) => category.id === item.categoryId)
      ?.name ||
    "Marketplace";
  const categoryHref = item.categoryId
    ? `/browse?category=${encodeURIComponent(item.categoryId)}`
    : "/browse";
  const specificationCategoryName =
    item.categoryName ||
    item.category?.name ||
    categories.data?.find((category) => category.id === item.categoryId)
      ?.name ||
    null;
  const subcategoryName =
    item.subcategoryName || item.subcategory?.name || null;
  const categoryLabel = [specificationCategoryName, subcategoryName]
    .filter(
      (value, index, values) =>
        Boolean(value) && values.indexOf(value) === index,
    )
    .join(" › ");
  const postedAt = new Date(item.createdAt);
  const postedLabel = Number.isNaN(postedAt.getTime())
    ? null
    : postedAt.toLocaleDateString("en-US");
  const specificationText = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : null;
  const conditionLabel = specificationText(item.condition)
    ?.replaceAll("_", " ")
    .toLocaleLowerCase()
    .replace(/\b\w/g, (character) => character.toLocaleUpperCase());
  const specifications = [
    { label: "Category", value: categoryLabel || null, icon: Tag },
    {
      label: "Condition",
      value: conditionLabel,
      icon: Sparkles,
    },
    { label: "Brand", value: specificationText(item.brand), icon: Building2 },
    { label: "Model", value: specificationText(item.model), icon: Hash },
    { label: "Color", value: specificationText(item.color), icon: Palette },
    { label: "Posted on", value: postedLabel, icon: CalendarDays },
    { label: "Location", value: item.location || null, icon: MapPin },
  ].filter((specification) => specification.value);
  return (
    <main className="mx-auto w-[calc(100%-24px)] max-w-[1280px] pb-24 pt-6 sm:w-[calc(100%-40px)] sm:pt-8 lg:w-[calc(100%-64px)]">
      <nav
        aria-label="Breadcrumb"
        className="mb-6 flex min-w-0 items-center gap-1.5 overflow-x-auto whitespace-nowrap pb-1 text-[13px] text-muted sm:mb-8 sm:text-sm"
      >
        <Link
          className="shrink-0 transition-colors hover:text-ink"
          to="/browse"
        >
          Browse
        </Link>
        <ChevronRight
          className="size-3.5 shrink-0 text-muted"
          aria-hidden="true"
        />
        <Link
          className="shrink-0 transition-colors hover:text-ink"
          to={categoryHref}
        >
          {categoryName}
        </Link>
        <ChevronRight
          className="size-3.5 shrink-0 text-muted"
          aria-hidden="true"
        />
        <span className="max-w-[15rem] truncate font-medium text-ink sm:max-w-md">
          {item.title}
        </span>
      </nav>
      <div className="grid items-start gap-y-0 lg:grid-cols-[minmax(0,1.16fr)_minmax(400px,0.84fr)] lg:gap-x-14 lg:gap-y-12 xl:gap-x-16">
        <section className="min-w-0" aria-label="Product gallery">
          <div className="relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-2xl border border-line bg-surface-muted">
            {activeImageUrl && !imageFailed ? (
              <img
                className="h-full w-full object-contain"
                src={activeImageUrl}
                alt={`${item.title}, image ${activeImage + 1}`}
                width={960}
                height={720}
                onError={() => setImageFailed(true)}
              />
            ) : (
              <div className="flex flex-col items-center gap-3 text-muted">
                <span className="grid size-12 place-items-center rounded-full border border-line bg-surface">
                  <ImageOff className="size-5" aria-hidden="true" />
                </span>
                <span className="text-sm">Image unavailable</span>
              </div>
            )}
          </div>

          {images.length > 1 ? (
            <div
              className="mt-4 flex gap-3 overflow-x-auto pb-1"
              aria-label="Product images"
            >
              {images.map((image: any, index: number) => (
                <button
                  type="button"
                  key={image.id}
                  onClick={() => {
                    setActiveImage(index);
                    setImageFailed(false);
                  }}
                  className={`size-16 shrink-0 overflow-hidden rounded-lg border bg-surface-muted p-0.5 transition-colors sm:size-[72px] ${
                    activeImage === index
                      ? "border-ink"
                      : "border-line hover:border-sandalwood"
                  }`}
                  aria-label={`Show image ${index + 1}`}
                  aria-pressed={activeImage === index}
                >
                  <img
                    className="h-full w-full rounded-[6px] object-cover"
                    src={image.url}
                    alt=""
                  />
                </button>
              ))}
            </div>
          ) : null}
        </section>

        <aside className="mt-10 min-w-0 lg:mt-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge value={item.lifecycleState} />
            {item.ownerPreview ? (
              <StatusBadge value={item.moderationState} />
            ) : null}
          </div>

          {item.ownerPreview && item.rejectionReason ? (
            <div
              className="mt-4 rounded-xl border border-[#fecaca] bg-[#fff8f8] p-4 text-sm text-[#7f1d1d]"
              role="status"
            >
              <strong className="font-medium">Moderator feedback</strong>
              <p className="mb-0 mt-1.5 leading-relaxed">
                {item.rejectionReason}
              </p>
            </div>
          ) : null}

          <h1 className="mb-0 mt-6 text-[28px] font-semibold leading-[1.14] tracking-[-0.035em] sm:text-[34px] xl:text-[36px] text-ink">
            {item.title}
          </h1>
          <p className="mb-0 mt-5 text-[26px] font-bold leading-none tracking-[-0.025em] sm:text-[28px] text-ink">
            {item.priceLabel || "Price unavailable"}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-muted">
            {item.condition ? (
              <span>{String(item.condition).replaceAll("_", " ")}</span>
            ) : null}
            {item.location ? (
              <>
                {item.condition ? <span aria-hidden="true">&bull;</span> : null}
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                  {item.location}
                </span>
              </>
            ) : null}
          </div>
          {listedLabel ? (
            <p className="mb-0 mt-2 text-[13px] text-muted">
              Listed {listedLabel}
            </p>
          ) : null}
          {item.negotiable ? (
            <p className="mb-0 mt-3 text-[13px] font-medium text-accent">
              Open to reasonable offers
            </p>
          ) : null}

          <section
            className="mt-8 border-y border-line py-6"
            aria-label="Seller"
          >
            <div className="flex items-center gap-3.5">
              {item.seller?.avatarUrl ? (
                <img
                  className="size-14 rounded-full object-cover"
                  src={item.seller.avatarUrl}
                  alt=""
                  width={56}
                  height={56}
                />
              ) : (
                <span className="grid size-14 shrink-0 place-items-center rounded-full bg-surface-muted text-[15px] font-medium text-ink">
                  {sellerName.charAt(0).toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
                <Link
                  to={`/seller/${item.seller.id}`}
                  className="block truncate text-[17px] font-medium text-ink hover:text-black"
                >
                  {sellerName}
                </Link>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] text-muted">
                  {item.seller.phoneVerifiedAt ? (
                    <span className="inline-flex items-center gap-1">
                      <ShieldCheck
                        className="size-3.5 text-accent"
                        aria-hidden="true"
                      />
                      Phone verified
                    </span>
                  ) : null}
                  {hasSellerRating ? (
                    <>
                      <span aria-hidden="true">•</span>
                      <span className="inline-flex items-center gap-1">
                        <Star className="size-3.5" aria-hidden="true" />
                        {sellerRating.toFixed(1)} (
                        {item.seller.reviewCount ?? 0})
                      </span>
                    </>
                  ) : null}
                  {typeof item.seller.completedSales === "number" ? (
                    <>
                      <span aria-hidden="true">•</span>
                      <span>{item.seller.completedSales} sales</span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </section>

          <div className="mt-6">
            {owner ? (
              <Link
                className="inline-flex h-11 w-full items-center justify-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium text-ink transition-colors hover:border-sandalwood hover:bg-surface-muted sm:w-auto"
                to={`/listing/${item.id}/edit`}
              >
                Edit listing
              </Link>
            ) : (
              <div className="space-y-3">
                <button
                  type="button"
                  className="inline-flex h-12 w-full items-center justify-center rounded-full !bg-brand px-7 text-[15px] font-medium !text-on-brand transition-colors hover:!bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => buy.mutate()}
                  disabled={buy.isPending || item.lifecycleState !== "ACTIVE"}
                >
                  Buy
                </button>
                <button
                  type="button"
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-line bg-surface px-5 text-[14px] font-medium text-ink transition-colors hover:border-sandalwood hover:bg-surface-muted disabled:opacity-50"
                  onClick={() => contact.mutate()}
                  disabled={contact.isPending}
                >
                  <MessageCircle className="size-4" aria-hidden="true" />
                  Contact seller
                </button>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    className={`listing-save-button inline-flex h-10 items-center justify-center gap-2 rounded-full border px-3 text-[13px] font-medium transition-colors disabled:cursor-default ${
                      isSaved
                        ? "border-[#fecaca] bg-[#fff7f7] text-[#dc2626]"
                        : "border-line bg-surface font-normal text-muted hover:bg-surface-muted"
                    }`}
                    onClick={() => save.mutate(!isSaved)}
                    disabled={save.isPending}
                    aria-pressed={isSaved}
                    aria-label={isSaved ? "Unsave item" : "Save"}
                  >
                    <Heart
                      className={`size-3.5 ${
                        isSaved ? "fill-current text-[#dc2626]" : ""
                      }`}
                      aria-hidden="true"
                    />
                    {isSaved ? "Saved" : "Save"}
                  </button>
                  <button
                    type="button"
                    className="listing-report-trigger inline-flex h-10 items-center justify-center rounded-full border px-3 text-[13px] font-medium transition-colors"
                    onClick={() => setReportOpen((value) => !value)}
                    aria-expanded={reportOpen}
                  >
                    Report
                  </button>
                </div>
                {[contact, buy, save].map((mutation, index) =>
                  mutation.error ? (
                    <p className="field-error" key={index}>
                      {mutation.error.message}
                    </p>
                  ) : null,
                )}
              </div>
            )}
          </div>

          {reportOpen ? (
            <form
              className="mt-5 grid gap-4 rounded-2xl border border-line bg-surface p-4"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                report.mutate({
                  reason: String(form.get("reason")),
                  details: String(form.get("details")),
                });
              }}
            >
              <label className="grid gap-1.5 text-[13px] font-medium text-ink">
                Reason
                <select
                  name="reason"
                  className="h-11 rounded-lg border border-line bg-surface px-3 text-sm font-normal"
                >
                  {reportReasons.map((reason) => (
                    <option value={reason} key={reason}>
                      {reason.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-[13px] font-medium text-ink">
                Details
                <textarea
                  name="details"
                  maxLength={1500}
                  className="min-h-24 resize-y rounded-lg border border-line bg-surface p-3 text-sm font-normal"
                />
              </label>
              <button
                className="listing-report-submit h-10 rounded-full border px-4 text-sm font-semibold transition-colors"
                disabled={report.isPending}
              >
                Submit report
              </button>
              {report.error ? (
                <p className="field-error">{report.error.message}</p>
              ) : null}
            </form>
          ) : null}

          <div className="mt-6">
            <SafetyReminder />
          </div>
        </aside>
        {specifications.length ? (
          <section
            className="order-4 mt-4 rounded-2xl border border-line bg-surface p-5 sm:p-6 lg:order-none lg:col-start-2 lg:row-start-2 lg:mt-0"
            aria-labelledby="product-specifications-heading"
          >
            <h2
              id="product-specifications-heading"
              className="mb-4 mt-0 text-[15px] font-medium text-ink"
            >
              Product details
            </h2>
            <dl className="m-0 divide-y divide-line">
              {specifications.map(({ label, value, icon: Icon }) => (
                <div
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-4 py-3 first:pt-0 last:pb-0"
                  key={label}
                >
                  <dt className="flex min-w-0 items-start gap-2 text-[13px] text-muted">
                    <Icon
                      className="mt-0.5 size-3.5 shrink-0 text-muted"
                      aria-hidden="true"
                    />
                    <span>{label}</span>
                  </dt>
                  <dd className="m-0 min-w-0 break-words text-[13px] leading-5 text-ink">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {item.description ||
        item.conditionExplanation ||
        item.defects ||
        item.meetupPoint ? (
          <section
            className="order-3 mt-10 rounded-2xl border border-line bg-surface p-5 sm:p-6 lg:order-none lg:col-start-1 lg:row-start-2 lg:mt-0"
            aria-labelledby="about-product-heading"
          >
            <h2
              id="about-product-heading"
              className="mb-5 mt-0 text-xs font-semibold uppercase tracking-[0.1em] text-muted"
            >
              About this product
            </h2>
            {item.description ? (
              <p className="m-0 text-[15px] leading-7 text-ink sm:text-base">
                {item.description}
              </p>
            ) : null}

            {item.defects || item.conditionExplanation || item.meetupPoint ? (
              <dl className="mb-0 mt-7 grid gap-6 border-t border-line pt-6">
                {item.defects ? (
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">
                      Known issues
                    </dt>
                    <dd className="mb-0 ml-0 mt-2 text-[14px] leading-6 text-ink">
                      {item.defects}
                    </dd>
                  </div>
                ) : null}
                {item.conditionExplanation ? (
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">
                      Condition details
                    </dt>
                    <dd className="mb-0 ml-0 mt-2 text-[14px] leading-6 text-ink">
                      {item.conditionExplanation}
                    </dd>
                  </div>
                ) : null}
                {item.meetupPoint ? (
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">
                      Preferred meetup
                    </dt>
                    <dd className="mb-0 ml-0 mt-2 text-[14px] leading-6 text-ink">
                      {item.meetupPoint}
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
          </section>
        ) : null}
      </div>
      {savedToast ? (
        <div
          className="saved-toast fixed bottom-20 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2.5 whitespace-nowrap rounded-full bg-brand px-4 py-3 text-[13px] font-medium text-on-brand shadow-[0_10px_30px_rgba(0,0,0,0.2)] sm:bottom-6"
          role="status"
          aria-live="polite"
        >
          <Heart
            className={`size-4 text-[#ef4444] ${
              savedToast === "saved" ? "fill-[#ef4444]" : ""
            }`}
            aria-hidden="true"
          />
          {savedToast === "saved"
            ? "Saved to your favourites"
            : "Removed from saved"}
        </div>
      ) : null}
    </main>
  );
}

export function SellerPage() {
  const { sellerId } = useParams();
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["seller", sellerId],
    queryFn: () => api<any>(`/api/sellers/${sellerId}`),
  });
  if (query.isLoading)
    return (
      <div className="page">
        <Loading label="Loading seller" />
      </div>
    );
  if (query.isError)
    return (
      <div className="page">
        <ErrorState error={query.error} />
      </div>
    );
  const s = query.data;
  return (
    <div className="page">
      <section className="panel">
        <div className="row">
          {s.avatarUrl ? (
            <img className="avatar" src={s.avatarUrl} alt="" />
          ) : (
            <span className="avatar">{s.displayName[0]}</span>
          )}
          <div>
            <h1>{s.displayName}</h1>
            <div className="meta">
              <span>
                <ShieldCheck width={14} />
                Phone verified
              </span>
              <span>
                Member since {new Date(s.createdAt).toLocaleDateString()}
              </span>
              <span>{s.completedSales} completed sales</span>
            </div>
          </div>
        </div>
        <p>{[s.institution, s.campus].filter(Boolean).join(" · ")}</p>
        <strong>
          {Number(s.averageRating).toFixed(1)} ★ from {s.reviewCount} reviews
        </strong>
        {user?.phoneVerifiedAt && user.id !== sellerId ? (
          <ReportButton
            targetType="USER"
            targetId={sellerId!}
            label="Report seller"
          />
        ) : null}
      </section>
      <section className="section">
        <h2>Current listings</h2>
        {s.activeListings.length ? (
          <div className="product-grid">
            {s.activeListings.map((l: any) => (
              <ProductCard key={l.id} listing={l} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No active listings"
            body="This seller has no approved products for sale right now."
          />
        )}
      </section>
      <section className="section">
        <h2>Recent verified reviews</h2>
        {s.recentReviews.length ? (
          <div className="stack">
            {s.recentReviews.map((r: any) => (
              <article className="panel" key={r.id}>
                <strong>
                  {"★".repeat(r.rating)}
                  {"☆".repeat(5 - r.rating)}
                </strong>
                <p>{r.text}</p>
                <span className="meta">
                  Verified transaction ·{" "}
                  {new Date(r.createdAt).toLocaleDateString()}
                </span>
                {user?.phoneVerifiedAt ? (
                  <ReportButton
                    targetType="REVIEW"
                    targetId={r.id}
                    label="Report review"
                  />
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No reviews yet"
            body="Reviews appear after completed transactions."
          />
        )}
      </section>
    </div>
  );
}

export function LeaderboardPage() {
  const [scope, setScope] = useState("monthly");
  const query = useQuery({
    queryKey: ["leaderboard", scope],
    queryFn: () => api<any[]>(`/api/leaderboard?scope=${scope}`),
  });
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Community reputation</p>
          <h1>Top sellers</h1>
        </div>
        <div className="tabs">
          <button
            className={scope === "monthly" ? "active" : ""}
            onClick={() => setScope("monthly")}
          >
            This month
          </button>
          <button
            className={scope === "all-time" ? "active" : ""}
            onClick={() => setScope("all-time")}
          >
            All time
          </button>
        </div>
      </div>
      <p className="lede">
        Rankings use completed, verified transactions only. Sellers need at
        least two sales to appear.
      </p>
      {query.isLoading ? (
        <Loading variant="table" label="Loading leaderboard" />
      ) : query.isError ? (
        <ErrorState error={query.error} />
      ) : !query.data?.length ? (
        <EmptyState
          title="No rankings yet"
          body="The leaderboard will appear after eligible sellers complete transactions."
        />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Seller</th>
                <th>Completed sales</th>
                <th>Rating</th>
                <th>Reviews</th>
              </tr>
            </thead>
            <tbody>
              {query.data.map((row) => (
                <tr key={row.id}>
                  <td>#{row.rank}</td>
                  <td>
                    <Link to={`/seller/${row.id}`}>{row.displayName}</Link>
                  </td>
                  <td>{row.completedSales}</td>
                  <td>{Number(row.averageRating).toFixed(1)}</td>
                  <td>{row.reviewCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(input: any): void;
          renderButton(element: HTMLElement, options: any): void;
        };
      };
    };
  }
}
export function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, refresh } = useAuth();
  const [error, setError] = useState("");
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  useEffect(() => {
    if (user) {
      navigate(postLoginDestination(user, (location.state as any)?.from), {
        replace: true,
      });
      return;
    }
    if (!clientId) return;
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const el = document.getElementById("google-button");
      if (!el) return;
      window.google?.accounts.id.initialize({
        client_id: clientId,
        ux_mode: "popup",
        auto_select: false,
        callback: async ({ credential }: { credential: string }) => {
          try {
            await api("/api/auth/google", {
              method: "POST",
              ...jsonBody({ credential }),
            });
            await refresh();
          } catch (e: any) {
            setError(e.message);
          }
        },
      });
      window.google?.accounts.id.renderButton(el, {
        theme: "outline",
        size: "large",
        width: 320,
        text: "continue_with",
      });
    };
    document.head.appendChild(script);
    return () => script.remove();
  }, [clientId, location.state, navigate, refresh, user]);
  return (
    <div className="page narrow">
      <div className="panel stack-lg">
        <div>
          <p className="eyebrow">Welcome</p>
          <h1>Sign in to Uni Market</h1>
          <p className="lede">
            Continue with any verified Google account. No university email is
            required.
          </p>
        </div>
        {clientId ? (
          <div id="google-button" />
        ) : (
          <div className="safety">
            <ShieldCheck />
            <div>
              <strong>Google sign-in needs configuration</strong>
              <p>
                Set <code>VITE_GOOGLE_CLIENT_ID</code> for this environment.
                Browsing remains available without an account.
              </p>
            </div>
          </div>
        )}
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <SafetyReminder compact />
        <Link to="/browse">Continue browsing as a guest</Link>
      </div>
    </div>
  );
}
