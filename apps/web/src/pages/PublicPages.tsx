import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Heart,
  MapPin,
  MessageCircle,
  Search,
  ShieldCheck,
  Star,
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
  const categories = useCategories();
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
  return (
    <>
      <section className="search-shell">
        <div className="search-inner">
          <p className="eyebrow">Buy nearby. Sell simply.</p>
          <h1>Find what you need around campus</h1>
          <form
            className="search-form"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              navigate(`/browse?q=${encodeURIComponent(term)}`);
            }}
          >
            <label className="sr-only" htmlFor="home-search">
              Search products
            </label>
            <input
              id="home-search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search books, cycles, calculators…"
            />
            <button className="button primary" type="submit">
              <Search aria-hidden="true" />
              Search
            </button>
          </form>
        </div>
      </section>
      <div className="page">
        <section aria-labelledby="categories-heading">
          <div className="section-heading">
            <h2 id="categories-heading">Browse categories</h2>
            <Link to="/browse">View all</Link>
          </div>
          {categories.isLoading ? (
            <Loading />
          ) : categories.isError ? (
            <ErrorState
              error={categories.error}
              retry={() => void categories.refetch()}
            />
          ) : (
            <div className="categories">
              {categories.data?.map((category) => (
                <Link
                  className="category"
                  key={category.id}
                  to={`/browse?category=${category.id}`}
                >
                  {category.name}
                </Link>
              ))}
            </div>
          )}
        </section>
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
            <div className="section-heading">
              <h2>Saved for later</h2>
              <Link to="/saved">See saved</Link>
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
      <div className="section-heading">
        <h2>{title}</h2>
        <Link to="/browse">Browse all</Link>
      </div>
      {query.isLoading ? (
        <Loading />
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

export function BrowsePage() {
  const [params, setParams] = useSearchParams();
  const categories = useCategories();
  const serialized = params.toString();
  const listings = useListings(serialized ? `?${serialized}` : "");
  function update(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    next.delete("page");
    setParams(next);
  }
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Marketplace</p>
          <h1>Browse products</h1>
        </div>
        <p className="lede">Only manually approved listings appear here.</p>
      </div>
      <div className="filters" aria-label="Product filters">
        <label>
          Search
          <input
            value={params.get("q") ?? ""}
            onChange={(e) => update("q", e.target.value)}
            placeholder="What do you need?"
          />
        </label>
        <label>
          Category
          <select
            value={params.get("category") ?? ""}
            onChange={(e) => update("category", e.target.value)}
          >
            <option value="">All categories</option>
            {categories.data?.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Min price
          <input
            inputMode="numeric"
            value={params.get("minPrice") ?? ""}
            onChange={(e) => update("minPrice", e.target.value)}
            placeholder="₹0"
          />
        </label>
        <label>
          Max price
          <input
            inputMode="numeric"
            value={params.get("maxPrice") ?? ""}
            onChange={(e) => update("maxPrice", e.target.value)}
            placeholder="Any"
          />
        </label>
        <label>
          Condition
          <select
            value={params.get("condition") ?? ""}
            onChange={(e) => update("condition", e.target.value)}
          >
            <option value="">Any</option>
            {["NEW", "LIKE_NEW", "GOOD", "FAIR", "POOR"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Sort
          <select
            value={params.get("sort") ?? "newest"}
            onChange={(e) => update("sort", e.target.value)}
          >
            <option value="newest">Newest</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
            <option value="popular">Popular</option>
          </select>
        </label>
        <label>
          Location
          <input
            value={params.get("location") ?? ""}
            onChange={(e) => update("location", e.target.value)}
            placeholder="Campus or area"
          />
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={params.get("negotiable") === "true"}
            onChange={(e) =>
              update("negotiable", e.target.checked ? "true" : "")
            }
          />{" "}
          Negotiable only
        </label>
      </div>
      {listings.isLoading ? (
        <Loading />
      ) : listings.isError ? (
        <ErrorState
          error={listings.error}
          retry={() => void listings.refetch()}
        />
      ) : !listings.data?.length ? (
        <EmptyState
          title="No products match"
          body="Try a broader search or clear one of the filters."
          action={
            <button className="button secondary" onClick={() => setParams({})}>
              Clear filters
            </button>
          }
        />
      ) : (
        <div className="product-grid">
          {listings.data.map((listing) => (
            <ProductCard key={listing.id} listing={listing} />
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
  const [activeImage, setActiveImage] = useState(0);
  const [reportOpen, setReportOpen] = useState(false);
  const query = useQuery({
    queryKey: ["listing", listingId],
    queryFn: () => api<any>(`/api/listings/${listingId}`),
  });
  const save = useMutation({
    mutationFn: () => api(`/api/favourites/${listingId}`, { method: "POST" }),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["favourites"] }),
  });
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
      <div className="page">
        <Loading />
      </div>
    );
  if (query.isError)
    return (
      <div className="page">
        <ErrorState error={query.error} />
      </div>
    );
  const item = query.data!;
  const owner = user?.id === item.sellerId;
  return (
    <div className="page">
      <div className="detail-grid">
        <section>
          <img
            className="gallery-main"
            src={item.images[activeImage]?.url}
            alt={`${item.title}, image ${activeImage + 1}`}
            width={900}
            height={675}
          />
          <div className="thumbs" aria-label="Product images">
            {item.images.map((image: any, index: number) => (
              <button
                key={image.id}
                onClick={() => setActiveImage(index)}
                aria-label={`Show image ${index + 1}`}
              >
                <img src={image.url} alt="" />
              </button>
            ))}
          </div>
        </section>
        <aside>
          <div className="row">
            <StatusBadge value={item.lifecycleState} />
            {item.ownerPreview ? (
              <StatusBadge value={item.moderationState} />
            ) : null}
          </div>
          {item.ownerPreview && item.rejectionReason ? (
            <div className="notice error" role="status">
              <strong>Moderator feedback</strong>
              <p>{item.rejectionReason}</p>
            </div>
          ) : null}
          <h1 className="detail-title">{item.title}</h1>
          <div className="detail-price">{item.priceLabel}</div>
          <div className="meta">
            <span>{item.condition.replaceAll("_", " ")}</span>
            <span>
              <MapPin width={14} />
              {item.location}
            </span>
            <span>
              {new Date(item.approvedAt ?? item.createdAt).toLocaleDateString()}
            </span>
          </div>
          {item.negotiable ? (
            <p>
              <strong>Open to reasonable offers</strong>
            </p>
          ) : null}
          <div className="seller-card">
            {item.seller.avatarUrl ? (
              <img className="avatar" src={item.seller.avatarUrl} alt="" />
            ) : (
              <span className="avatar">{item.seller.displayName[0]}</span>
            )}
            <div>
              <Link to={`/seller/${item.seller.id}`}>
                <strong>{item.seller.displayName}</strong>
              </Link>
              <div className="meta">
                <span>
                  <ShieldCheck width={14} />
                  Phone verified
                </span>
                <span>
                  <Star width={14} />
                  {Number(item.seller.rating).toFixed(1)} (
                  {item.seller.reviewCount})
                </span>
                <span>{item.seller.completedSales} sales</span>
              </div>
            </div>
          </div>
          {owner ? (
            <Link className="button primary" to={`/listing/${item.id}/edit`}>
              Edit listing
            </Link>
          ) : (
            <div className="stack">
              <button
                className="button primary"
                onClick={() => contact.mutate()}
                disabled={contact.isPending}
              >
                <MessageCircle />
                Contact seller
              </button>
              <button
                className="button secondary"
                onClick={() => buy.mutate()}
                disabled={buy.isPending || item.lifecycleState !== "ACTIVE"}
              >
                Request to buy
              </button>
              <button
                className="button secondary"
                onClick={() => save.mutate()}
                disabled={save.isPending}
              >
                <Heart />
                Save product
              </button>
              <button
                className="button secondary"
                onClick={() => setReportOpen((v) => !v)}
              >
                Report listing
              </button>
              {[contact, buy, save].map((m, i) =>
                m.error ? (
                  <p className="field-error" key={i}>
                    {m.error.message}
                  </p>
                ) : null,
              )}
            </div>
          )}
          {reportOpen ? (
            <form
              className="panel form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                report.mutate({
                  reason: String(f.get("reason")),
                  details: String(f.get("details")),
                });
              }}
            >
              <label className="field">
                <span>Reason</span>
                <select name="reason">
                  {reportReasons.map((reason) => (
                    <option value={reason} key={reason}>
                      {reason.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Details</span>
                <textarea name="details" maxLength={1500} />
              </label>
              <button className="button danger">Submit report</button>
              {report.error ? (
                <p className="field-error">{report.error.message}</p>
              ) : null}
            </form>
          ) : null}
          <SafetyReminder compact />
        </aside>
      </div>
      <section className="section panel">
        <h2>About this product</h2>
        <p>{item.description}</p>
        <dl>
          <dt>
            <strong>Known issues</strong>
          </dt>
          <dd>{item.defects || "None disclosed"}</dd>
          <dt>
            <strong>Condition details</strong>
          </dt>
          <dd>{item.conditionExplanation || "No additional notes"}</dd>
          <dt>
            <strong>Preferred meetup</strong>
          </dt>
          <dd>{item.meetupPoint || "Arrange a public location in chat"}</dd>
        </dl>
      </section>
    </div>
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
        <Loading />
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
        <Loading />
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
      navigate(
        postLoginDestination(user, (location.state as any)?.from),
        { replace: true },
      );
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
