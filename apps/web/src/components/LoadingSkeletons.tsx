import { useLocation } from "react-router-dom";
import { cn } from "../lib/utils";
import { Skeleton } from "./ui/skeleton";

type LoadingVariant =
  | "list"
  | "cards"
  | "browse"
  | "table"
  | "detail"
  | "form"
  | "metrics"
  | "my-listings"
  | "chat-list"
  | "messages";

const FOUR_ITEMS = [0, 1, 2, 3] as const;
const SIX_ITEMS = [0, 1, 2, 3, 4, 5] as const;
const EIGHT_ITEMS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

export function Loading({
  label = "Loading",
  variant = "list",
}: {
  label?: string;
  variant?: LoadingVariant;
}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <LoadingShape variant={variant} />
      <span className="sr-only">{label}</span>
    </div>
  );
}

function LoadingShape({ variant }: { variant: LoadingVariant }) {
  switch (variant) {
    case "cards":
      return <ProductGridSkeleton />;
    case "browse":
      return <ProductGridSkeleton browse />;
    case "table":
      return <TableSkeleton />;
    case "detail":
      return <ListingDetailSkeleton />;
    case "form":
      return <FormSkeleton />;
    case "metrics":
      return <MetricSkeleton />;
    case "my-listings":
      return <MyListingsSkeleton />;
    case "chat-list":
      return <ConversationListSkeleton />;
    case "messages":
      return <MessageListSkeleton />;
    default:
      return <ListSkeleton />;
  }
}

export function ProductGridSkeleton({ browse = false }: { browse?: boolean }) {
  const items = browse ? EIGHT_ITEMS : FOUR_ITEMS;
  return (
    <div
      className={cn(
        browse
          ? "grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          : "product-grid",
      )}
      aria-hidden="true"
    >
      {items.map((item) => (
        <ProductCardSkeleton key={item} />
      ))}
    </div>
  );
}

function ProductCardSkeleton() {
  return (
    <article className="market-card pointer-events-none">
      <div className="market-card-link">
        <Skeleton className="market-card-visual" />
        <div className="market-card-content">
          <div className="flex items-start justify-between gap-3">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <Skeleton className="mt-3 h-6 w-2/5" />
          <div className="mt-4 flex flex-wrap gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-14" />
          </div>
          <Skeleton className="mt-auto h-10 w-full rounded-[10px]" />
        </div>
      </div>
    </article>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      {FOUR_ITEMS.map((item) => (
        <div
          className="flex min-h-24 items-center gap-4 rounded-2xl border border-line bg-surface p-4"
          key={item}
        >
          <Skeleton className="size-14 shrink-0 rounded-xl" />
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="table-scroll" aria-hidden="true">
      <table>
        <thead>
          <tr>
            {FOUR_ITEMS.map((item) => (
              <th key={item}>
                <Skeleton className="h-3 w-20" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {FOUR_ITEMS.map((row) => (
            <tr key={row}>
              {FOUR_ITEMS.map((column) => (
                <td key={column}>
                  <Skeleton
                    className={cn("h-4", column === 0 ? "w-32" : "w-20")}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetricSkeleton() {
  return (
    <div className="metric-grid" aria-hidden="true">
      {SIX_ITEMS.map((item) => (
        <article className="metric flex flex-col gap-3" key={item}>
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-3 w-28" />
        </article>
      ))}
    </div>
  );
}

function MyListingsSkeleton() {
  return (
    <div className="my-listings-grid" aria-hidden="true">
      {FOUR_ITEMS.map((item) => (
        <article className="my-listing-card pointer-events-none" key={item}>
          <Skeleton className="my-listing-image" />
          <div className="my-listing-content flex flex-col gap-2.5">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <div className="my-listing-side">
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-9 w-24 rounded-lg" />
          </div>
        </article>
      ))}
    </div>
  );
}

export function ListingDetailSkeleton() {
  return (
    <div
      className="mx-auto w-[calc(100%-24px)] max-w-[1280px] pb-24 pt-6 sm:w-[calc(100%-40px)] sm:pt-8 lg:w-[calc(100%-64px)]"
      aria-hidden="true"
    >
      <div className="mb-6 flex gap-2 sm:mb-8">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="grid items-start gap-y-10 lg:grid-cols-[minmax(0,1.16fr)_minmax(400px,0.84fr)] lg:gap-x-14 xl:gap-x-16">
        <div>
          <Skeleton className="aspect-[4/3] w-full rounded-2xl" />
          <div className="mt-4 flex gap-3">
            {FOUR_ITEMS.map((item) => (
              <Skeleton className="size-16 rounded-lg sm:size-[72px]" key={item} />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-5">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-9 w-4/5" />
          <Skeleton className="h-8 w-2/5" />
          <Skeleton className="h-4 w-3/5" />
          <div className="mt-3 flex items-center gap-4 border-y border-line py-6">
            <Skeleton className="size-14 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-52" />
            </div>
          </div>
          <Skeleton className="h-12 w-full rounded-full" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

function FormSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-9 w-64 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <div className="flex flex-col gap-6">
          {FOUR_ITEMS.map((item) => (
            <div className="flex flex-col gap-2.5" key={item}>
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-11 w-full rounded-lg" />
            </div>
          ))}
          <Skeleton className="h-11 w-32 rounded-full" />
        </div>
      </div>
    </div>
  );
}

function ConversationListSkeleton() {
  return (
    <div className="flex flex-col" aria-hidden="true">
      {SIX_ITEMS.map((item) => (
        <div className="flex items-center gap-3 border-b border-line p-4" key={item}>
          <Skeleton className="size-[52px] shrink-0 rounded-xl" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

function MessageListSkeleton() {
  return (
    <div className="flex flex-col gap-5 p-5" aria-hidden="true">
      {SIX_ITEMS.map((item) => (
        <div
          className={cn("flex gap-3", item % 2 ? "justify-end" : "justify-start")}
          key={item}
        >
          {item % 2 === 0 ? <Skeleton className="size-8 rounded-full" /> : null}
          <Skeleton
            className={cn(
              "h-16 rounded-2xl",
              item % 3 === 0 ? "w-2/5" : "w-3/5",
            )}
          />
        </div>
      ))}
    </div>
  );
}

function HomeRouteSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <section className="relative flex min-h-[76vh] flex-col items-center justify-center overflow-hidden bg-surface px-4 py-16 text-center sm:px-6 md:min-h-[82vh] md:py-24">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-6">
          <Skeleton className="h-12 w-full max-w-3xl rounded-xl sm:h-16" />
          <Skeleton className="h-6 w-full max-w-2xl" />
          <Skeleton className="mt-4 h-14 w-full max-w-3xl rounded-full sm:h-16" />
        </div>
      </section>
      <div className="page pb-24 pt-2">
        {FOUR_ITEMS.slice(0, 2).map((item) => (
          <section className="section" key={item}>
            <div className="mb-6 flex items-center justify-between border-b border-line pb-3">
              <Skeleton className="h-7 w-52" />
              <Skeleton className="h-4 w-20" />
            </div>
            <ProductGridSkeleton />
          </section>
        ))}
      </div>
      <span className="sr-only">Loading home page</span>
    </div>
  );
}

function ProductPageSkeleton({ browse = false }: { browse?: boolean }) {
  return (
    <div className="page" role="status" aria-live="polite" aria-busy="true">
      <div className="mb-8 flex flex-col gap-3">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-10 w-64 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      {browse ? (
        <Skeleton className="mb-8 h-14 w-full rounded-2xl" aria-hidden="true" />
      ) : null}
      <ProductGridSkeleton browse={browse} />
      <span className="sr-only">Loading products</span>
    </div>
  );
}

function MyListingsRouteSkeleton() {
  return (
    <div
      className="page my-listings-page"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="my-listings-header">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-10 w-56" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-11 w-32 rounded-full" />
      </div>
      <Skeleton className="my-6 h-12 w-full rounded-xl" />
      <MyListingsSkeleton />
      <span className="sr-only">Loading your listings</span>
    </div>
  );
}

function ChatRouteSkeleton() {
  return (
    <div className="page chat-page" role="status" aria-live="polite" aria-busy="true">
      <div className="chat-shell has-conversation">
        <aside className="conversation-list">
          <header className="inbox-header flex flex-col gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-8 w-32" />
          </header>
          <ConversationListSkeleton />
        </aside>
        <div className="chat-panel">
          <MessageListSkeleton />
        </div>
      </div>
      <span className="sr-only">Loading messages</span>
    </div>
  );
}

function AdminRouteSkeleton() {
  return (
    <div className="page" role="status" aria-live="polite" aria-busy="true">
      <div className="mb-8 flex flex-col gap-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-10 w-64" />
      </div>
      <div className="admin-layout">
        <div className="flex flex-col gap-2" aria-hidden="true">
          {SIX_ITEMS.map((item) => (
            <Skeleton className="h-10 w-full rounded-lg" key={item} />
          ))}
        </div>
        <div className="flex flex-col gap-6">
          <Skeleton className="h-8 w-56" />
          <TableSkeleton />
        </div>
      </div>
      <span className="sr-only">Loading administration</span>
    </div>
  );
}

export function RouteLoading() {
  const { pathname } = useLocation();

  if (pathname === "/") return <HomeRouteSkeleton />;
  if (pathname === "/browse") return <ProductPageSkeleton browse />;
  if (pathname === "/saved") return <ProductPageSkeleton />;
  if (pathname === "/my-listings") return <MyListingsRouteSkeleton />;
  if (/^\/listing\/[^/]+$/.test(pathname)) {
    return (
      <div role="status" aria-live="polite" aria-busy="true">
        <ListingDetailSkeleton />
        <span className="sr-only">Loading listing</span>
      </div>
    );
  }
  if (pathname === "/chats" || pathname.startsWith("/chats/")) {
    return <ChatRouteSkeleton />;
  }
  if (pathname.startsWith("/admin")) return <AdminRouteSkeleton />;
  if (
    pathname === "/sell" ||
    pathname.endsWith("/edit") ||
    pathname === "/profile" ||
    pathname === "/onboarding" ||
    pathname === "/settings"
  ) {
    return (
      <div className="page narrow" role="status" aria-live="polite" aria-busy="true">
        <FormSkeleton />
        <span className="sr-only">Loading form</span>
      </div>
    );
  }

  return (
    <div className="page" role="status" aria-live="polite" aria-busy="true">
      <div className="mb-8 flex flex-col gap-3">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-10 w-64 max-w-full" />
      </div>
      <ListSkeleton />
      <span className="sr-only">Loading page</span>
    </div>
  );
}
