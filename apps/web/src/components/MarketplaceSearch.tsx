import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ImageOff,
  MapPin,
  Search,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";

interface SearchListing {
  id: string;
  title?: string | null;
  categoryName?: string | null;
  location?: string | null;
  priceLabel?: string | null;
  coverImageUrl?: string | null;
}

export function MarketplaceSearch({
  compact = false,
  enableShortcut = false,
}: {
  compact?: boolean;
  enableShortcut?: boolean;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [debouncedTerm, setDebouncedTerm] = useState("");
  const normalizedTerm = debouncedTerm.trim();

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedTerm(term), 220);
    return () => window.clearTimeout(timeout);
  }, [term]);

  useEffect(() => {
    if (!enableShortcut) return;
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditable =
        target?.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "");
      const commandSearch =
        (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
      const slashSearch = event.key === "/" && !isEditable;
      if (!commandSearch && !slashSearch) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [enableShortcut]);

  const results = useQuery<SearchListing[]>({
    queryKey: ["marketplace-search", normalizedTerm],
    queryFn: () =>
      api<SearchListing[]>(
        `/api/listings?q=${encodeURIComponent(normalizedTerm)}&limit=6`,
      ),
    enabled: open && normalizedTerm.length >= 2,
    staleTime: 30_000,
  });

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setTerm("");
      setDebouncedTerm("");
    }
  }

  function viewAllResults() {
    const query = term.trim();
    handleOpenChange(false);
    navigate(query ? `/browse?q=${encodeURIComponent(query)}` : "/browse");
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className={`marketplace-search-trigger ${compact ? "compact" : ""}`}
          aria-label="Search marketplace"
        >
          <Search aria-hidden="true" />
          {!compact ? (
            <>
              <span>Search</span>
              <kbd>Ctrl K</kbd>
            </>
          ) : null}
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="marketplace-search-overlay" />
        <Dialog.Content className="marketplace-search-dialog">
          <Dialog.Title className="sr-only">Search Uni Market</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search approved products across Uni Market.
          </Dialog.Description>

          <form
            className="marketplace-search-form"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              viewAllResults();
            }}
          >
            <Search aria-hidden="true" />
            <label className="sr-only" htmlFor="marketplace-global-search">
              Search products
            </label>
            <input
              id="marketplace-global-search"
              type="search"
              autoFocus
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search products, categories or descriptions"
              autoComplete="off"
            />
            <Dialog.Close asChild>
              <button
                type="button"
                className="marketplace-search-close"
                aria-label="Close search"
              >
                <X aria-hidden="true" />
              </button>
            </Dialog.Close>
          </form>

          <div className="marketplace-search-results" aria-live="polite">
            {term.trim().length < 2 ? (
              <div className="marketplace-search-empty">
                <Search aria-hidden="true" />
                <strong>Search the marketplace</strong>
                <p>Type at least two characters to find campus listings.</p>
              </div>
            ) : results.isLoading || normalizedTerm !== term.trim() ? (
              <div className="marketplace-search-status">
                Searching Uni Market&
              </div>
            ) : results.isError ? (
              <div className="marketplace-search-status">
                Search is unavailable right now. Please try again.
              </div>
            ) : results.data?.length ? (
              <div className="marketplace-search-list">
                {results.data.map((listing) => (
                  <Link
                    key={listing.id}
                    to={`/listing/${listing.id}`}
                    className="marketplace-search-result"
                    onClick={() => handleOpenChange(false)}
                  >
                    <span className="marketplace-search-result-image">
                      {listing.coverImageUrl ? (
                        <img src={listing.coverImageUrl} alt="" />
                      ) : (
                        <ImageOff aria-hidden="true" />
                      )}
                    </span>
                    <span className="marketplace-search-result-copy">
                      <strong>{listing.title || "Untitled listing"}</strong>
                      <span>
                        {listing.categoryName || "Campus find"}
                        {listing.location ? (
                          <>
                            <span aria-hidden="true"> � </span>
                            <MapPin aria-hidden="true" />
                            {listing.location}
                          </>
                        ) : null}
                      </span>
                    </span>
                    <span className="marketplace-search-result-price">
                      {listing.priceLabel || "View price"}
                    </span>
                    <ArrowRight aria-hidden="true" />
                  </Link>
                ))}
              </div>
            ) : (
              <div className="marketplace-search-empty">
                <Search aria-hidden="true" />
                <strong>No matching products</strong>
                <p>Try a shorter term or browse all available listings.</p>
              </div>
            )}
          </div>

          <div className="marketplace-search-footer">
            <span>
              Press <kbd>Esc</kbd> to close
            </span>
            <button type="button" onClick={viewAllResults}>
              View all results
              <ArrowRight aria-hidden="true" />
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
