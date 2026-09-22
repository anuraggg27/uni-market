import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  Activity,
  Armchair,
  ArrowRight,
  BadgeCheck,
  Bike,
  BookOpen,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleX,
  ClipboardCheck,
  Clock3,
  Database,
  Dumbbell,
  FileCheck2,
  ExternalLink,
  Flag,
  Globe2,
  Headphones,
  History,
  ImageIcon,
  LampDesk,
  LayoutDashboard,
  MailWarning,
  MapPin,
  MessageCircle,
  Menu,
  Monitor,
  Package,
  RotateCcw,
  Search,
  Shapes,
  Shirt,
  Phone,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Tags,
  TicketCheck,
  Trash2,
  UserRound,
  UserPlus,
  Users,
} from "lucide-react";
import { api, jsonBody } from "../api";
import { useAuth } from "../auth";
import {
  DeleteConfirmationDialog,
  EmptyState,
  ErrorState,
  Loading,
  StatusBadge,
  SubmitButton,
} from "../components/UI";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../components/ui/sheet";
import { UserAvatar } from "../components/UserAvatar";

const links = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/listings/pending", label: "Pending listings", icon: ClipboardCheck },
  { to: "/admin/listings", label: "All listings", icon: Package },
  { to: "/admin/reports", label: "Reports", icon: Flag },
  { to: "/admin/grievances", label: "Grievances & safety", icon: ShieldAlert },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/reviews", label: "Reviews", icon: Star },
  { to: "/admin/support", label: "Support", icon: Headphones },
  { to: "/admin/audit-logs", label: "Audit logs", icon: History },
  { to: "/admin/categories", label: "Categories", icon: Tags },
  { to: "/admin/compliance", label: "Compliance registers", icon: BookOpenCheck },
];

function AdminNavigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="admin-sidebar-inner">
      <div className="admin-sidebar-brand">
        <span className="admin-sidebar-brand-icon" aria-hidden="true">
          <ShieldCheck />
        </span>
        <span>
          <strong>Admin Console</strong>
          <small>Manage · Monitor · Keep Uni Market safe</small>
        </span>
      </div>
      <nav className="admin-nav" aria-label="Admin sections">
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/admin" || to === "/admin/listings"}
            onClick={onNavigate}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="admin-sidebar-note">
        <Link className="admin-sidebar-wordmark" to="/" aria-label="Uni Market home">
          <span>Uni</span><span>Market</span>
        </Link>
      </div>
    </div>
  );
}

export function AdminShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  return (
    <div className="page admin-console-page">
      <div className="admin-layout">
        <aside className="admin-sidebar">
          <AdminNavigation />
        </aside>
        <section className="admin-main">
          <header className="admin-console-header">
            <div className="admin-console-heading">
              <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                <SheetTrigger asChild>
                  <button
                    type="button"
                    className="admin-nav-trigger"
                    aria-label="Open admin navigation"
                  >
                    <Menu aria-hidden="true" />
                  </button>
                </SheetTrigger>
                <SheetContent side="left" className="admin-mobile-sheet">
                  <SheetHeader className="sr-only">
                    <SheetTitle>Admin navigation</SheetTitle>
                    <SheetDescription>Choose an administration section.</SheetDescription>
                  </SheetHeader>
                  <AdminNavigation onNavigate={() => setMobileNavOpen(false)} />
                </SheetContent>
              </Sheet>
              <div>
                <h1>Administration</h1>
                <p>Everything you need to manage Uni Market, at a glance.</p>
              </div>
            </div>
          </header>
          <Outlet />
        </section>
      </div>
    </div>
  );
}
function QueryView({
  query,
  children,
  emptyTitle = "Nothing here",
  loadingVariant = "table",
}: {
  query: any;
  children: (data: any) => React.ReactNode;
  emptyTitle?: string;
  loadingVariant?: "table" | "list" | "metrics";
}) {
  if (query.isLoading) return <Loading variant={loadingVariant} />;
  if (query.isError)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  if (Array.isArray(query.data) && !query.data.length)
    return (
      <EmptyState
        title={emptyTitle}
        body="There are no records in this queue."
      />
    );
  return children(query.data);
}

type TrafficRange = "7" | "30" | "90" | "365" | "all";
type TrafficAnalytics = {
  range: TrafficRange;
  from: string | null;
  to: string;
  trackingStartedAt: string | null;
  summary: {
    uniqueVisitors: number;
    averageDailyVisitors: number;
    peakDailyVisitors: number;
    todayVisitors: number;
  };
  series: Array<{ date: string; visitors: number }>;
  topPages: Array<{ route: string; visitors: number }>;
  referrers: Array<{ source: string; visits: number }>;
  devices: Array<{ device: string; visitors: number }>;
};

const trafficRanges: Array<{ value: TrafficRange; label: string }> = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "all", label: "All time" },
];

function trafficRangeLabel(range: TrafficRange) {
  return trafficRanges.find((item) => item.value === range)?.label ?? "Selected range";
}

function trafficRouteLabel(route: string) {
  if (route === "/") return "Home";
  return route
    .replace("/:id", " detail")
    .replace(/^\//, "")
    .split("/")
    .filter(Boolean)
    .map((part) => part.replace(/-/g, " ").replace(/^./, (character) => character.toUpperCase()))
    .join(" · ");
}

function compactMetric(value: number) {
  return new Intl.NumberFormat("en-IN", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function trafficDateLabel(value: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date(`${value}T00:00:00.000Z`));
}

function bucketTrafficSeries(series: TrafficAnalytics["series"]) {
  const bucketSize = Math.max(1, Math.ceil(series.length / 56));
  const buckets: Array<{ label: string; visitors: number; average: boolean }> = [];
  for (let index = 0; index < series.length; index += bucketSize) {
    const rows = series.slice(index, index + bucketSize);
    const end = rows.at(-1)!;
    buckets.push({
      label: rows.length === 1 ? trafficDateLabel(rows[0]!.date) : `${trafficDateLabel(rows[0]!.date)}–${trafficDateLabel(end.date)}`,
      visitors: Number((rows.reduce((sum, row) => sum + row.visitors, 0) / rows.length).toFixed(1)),
      average: rows.length > 1,
    });
  }
  return buckets;
}

function TrafficAnalyticsPanel({ range, setRange, query }: { range: TrafficRange; setRange: (range: TrafficRange) => void; query: any }) {
  const data = query.data as TrafficAnalytics | undefined;
  const buckets = data ? bucketTrafficSeries(data.series) : [];
  const chartMaximum = Math.max(1, ...buckets.map((item) => item.visitors));
  const topPageMaximum = Math.max(1, ...(data?.topPages.map((item) => item.visitors) ?? []));
  const deviceTotal = data?.devices.reduce((sum, item) => sum + item.visitors, 0) ?? 0;
  return (
    <section className="admin-traffic" aria-labelledby="admin-traffic-title">
      <div className="admin-traffic-heading">
        <div>
          <h2 id="admin-traffic-title">Website traffic</h2>
          <p>Anonymous browser visitors retained beyond Cloudflare's 30-day dashboard window.</p>
        </div>
        <div className="admin-traffic-ranges" role="group" aria-label="Traffic date range">
          {trafficRanges.map((option) => (
            <button type="button" className={range === option.value ? "is-active" : ""} aria-pressed={range === option.value} onClick={() => setRange(option.value)} key={option.value}>
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {query.isLoading ? (
        <p className="admin-traffic-state">Loading traffic history…</p>
      ) : query.isError ? (
        <div className="admin-traffic-state"><p>Traffic history is unavailable.</p><button type="button" onClick={() => void query.refetch()}>Try again</button></div>
      ) : !data?.trackingStartedAt ? (
        <div className="admin-traffic-state">
          <Activity aria-hidden="true" />
          <p><strong>Traffic collection has started</strong><span>Stats will appear after the first non-admin page view.</span></p>
        </div>
      ) : (
        <>
          <div className="admin-traffic-summary" aria-label="Traffic summary">
            <article><span><Users aria-hidden="true" /></span><p><strong>{compactMetric(data.summary.uniqueVisitors)}</strong><b>Unique visitors</b><small>{trafficRangeLabel(range)}</small></p></article>
            <article><span><Activity aria-hidden="true" /></span><p><strong>{compactMetric(data.summary.averageDailyVisitors)}</strong><b>Avg. visitors/day</b><small>Selected range</small></p></article>
            <article><span><UserPlus aria-hidden="true" /></span><p><strong>{compactMetric(data.summary.peakDailyVisitors)}</strong><b>Peak visitors/day</b><small>Selected range</small></p></article>
            <article><span><CalendarDays aria-hidden="true" /></span><p><strong>{compactMetric(data.summary.todayVisitors)}</strong><b>Visitors today</b><small>Unique today</small></p></article>
          </div>
          <div className="admin-traffic-chart-panel">
            <div className="admin-traffic-subheading">
              <div><h3>Daily unique visitors</h3><p>{buckets.length < data.series.length ? "Daily averages grouped for readability" : "One count per browser in each UTC day"}</p></div>
              <div className="admin-traffic-legend"><span className="is-visitors">Unique visitors</span></div>
            </div>
            <div className="admin-traffic-chart" role="img" aria-label={`Traffic chart for ${trafficRangeLabel(range)}`}>
              {buckets.map((item, index) => (
                <div className="admin-traffic-bar-group" aria-label={`${item.label}: ${item.visitors} ${item.average ? "average daily " : ""}unique visitors`} title={`${item.label} · ${item.visitors} ${item.average ? "average daily " : ""}unique visitors`} key={`${item.label}-${index}`}>
                  <span className="is-visitors" style={{ height: item.visitors ? `${Math.max(3, (item.visitors / chartMaximum) * 100)}%` : "2px" }} />
                </div>
              ))}
            </div>
            <div className="admin-traffic-axis"><span>{buckets[0]?.label}</span><span>{buckets.at(-1)?.label}</span></div>
          </div>
          <div className="admin-traffic-breakdown">
            <section aria-labelledby="top-pages-title">
              <div className="admin-traffic-subheading"><div><h3 id="top-pages-title">Top pages</h3><p>Unique visitors per page</p></div></div>
              {data.topPages.length ? <ol>{data.topPages.map((item) => <li key={item.route}><div><b>{trafficRouteLabel(item.route)}</b><span>{compactMetric(item.visitors)}</span></div><i style={{ width: `${Math.max(3, (item.visitors / topPageMaximum) * 100)}%` }} /></li>)}</ol> : <p className="admin-traffic-list-empty">No unique page visitors yet.</p>}
            </section>
            <section aria-labelledby="referrers-title">
              <div className="admin-traffic-subheading"><div><h3 id="referrers-title">Traffic sources</h3><p>Daily unique arrivals</p></div></div>
              {data.referrers.length ? <ol>{data.referrers.map((item) => <li key={item.source}><div><b>{item.source}</b><span>{compactMetric(item.visits)}</span></div></li>)}</ol> : <p className="admin-traffic-list-empty">No landing sources yet.</p>}
            </section>
            <section aria-labelledby="devices-title">
              <div className="admin-traffic-subheading"><div><h3 id="devices-title">Devices</h3><p>Share of unique visitors</p></div><Globe2 aria-hidden="true" /></div>
              {data.devices.length ? <ol>{data.devices.map((item) => <li key={item.device}><div><b>{item.device.replace(/^./, (character) => character.toUpperCase())}</b><span>{deviceTotal ? Math.round((item.visitors / deviceTotal) * 100) : 0}%</span></div></li>)}</ol> : <p className="admin-traffic-list-empty">No device data yet.</p>}
            </section>
          </div>
          <p className="admin-traffic-note">Tracking began {trafficDateLabel(data.trackingStartedAt)}. Reloading does not add another visitor or page count. A visitor represents one browser profile, so clearing its storage or changing browser or device can count again. The stored identifier is secret-keyed; raw identifiers and IP addresses are not retained. Browser privacy opt-outs are respected.</p>
        </>
      )}
    </section>
  );
}

export function AdminDashboard() {
  const { user } = useAuth();
  const [analyticsRange, setAnalyticsRange] = useState<TrafficRange>("90");
  const canViewAudit = Boolean(user?.roles.includes("SUPER_ADMIN"));
  const query = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: () => api<any>("/api/admin/dashboard"),
  });
  const auditQuery = useQuery({
    queryKey: ["audit-logs", "dashboard-recent"],
    queryFn: () => api<any[]>("/api/admin/audit-logs"),
    enabled: canViewAudit,
  });
  const analyticsQuery = useQuery({
    queryKey: ["admin-analytics", analyticsRange],
    queryFn: () => api<TrafficAnalytics>(`/api/admin/analytics?range=${analyticsRange}`),
  });

  return (
    <div className="admin-dashboard">
      <QueryView query={query} loadingVariant="metrics">
        {(data) => {
          const primaryMetrics = [
            { key: "totalUsers", label: "Total users", icon: Users, tone: "plum" },
            { key: "activeUsers", label: "Active users", icon: Activity, tone: "success" },
            { key: "pendingListings", label: "Pending listings", icon: FileCheck2, tone: "plum" },
            { key: "openTickets", label: "Open tickets", icon: Headphones, tone: "plum" },
          ];
          const detailedMetrics = [
            { key: "newUsers", label: "New users · 30 days", icon: UserPlus },
            { key: "verifiedUsers", label: "Verified users", icon: BadgeCheck },
            { key: "activeListings", label: "Active listings", icon: Tags },
            { key: "rejectedListings", label: "Rejected listings", icon: CircleX },
            { key: "removedListings", label: "Removed listings", icon: Trash2 },
            { key: "completedTransactions", label: "Completed transactions", icon: CheckCircle2 },
            { key: "reservedListings", label: "Reserved listings", icon: TicketCheck },
            { key: "openReports", label: "Open reports", icon: Flag },
            { key: "averageRating", label: "Average rating", icon: Star },
            { key: "emailFailures", label: "Email failures", icon: MailWarning },
            { key: "otpSuccess", label: "OTP success", icon: BadgeCheck, tone: "success" },
            { key: "otpFailure", label: "OTP failure", icon: ShieldAlert },
            { key: "r2StorageUsage", label: "R2 storage usage", icon: Database, tone: "neutral" },
          ];
          const canModerate = Boolean(
            user?.roles.some((role) => ["MODERATOR", "SUPER_ADMIN"].includes(role)),
          );
          const canSupport = Boolean(
            user?.roles.some((role) => ["SUPPORT_AGENT", "SUPER_ADMIN"].includes(role)),
          );
          const quickActions = [
            canModerate
              ? {
                  to: "/admin/listings/pending",
                  label: "Review pending listings",
                  icon: ClipboardCheck,
                  highlighted: Number(data.pendingListings) > 0,
                }
              : null,
            canModerate
              ? { to: "/admin/reports", label: "Open reports", icon: Flag }
              : null,
            canModerate
              ? { to: "/admin/users", label: "Manage users", icon: Users }
              : null,
            canSupport
              ? { to: "/admin/support", label: "View support tickets", icon: Headphones }
              : null,
          ].filter(Boolean) as Array<{
            to: string;
            label: string;
            icon: typeof ClipboardCheck;
            highlighted?: boolean;
          }>;

          return (
            <>
              <section aria-label="Primary marketplace metrics">
                <div className="admin-summary-grid">
                  {primaryMetrics.map(({ key, label, icon: Icon, tone }) => (
                    <article className={"admin-summary-card is-" + tone} key={key}>
                      <span className="admin-metric-icon" aria-hidden="true">
                        <Icon />
                      </span>
                      <p>
                        <strong>{formatAdminMetric(data[key])}</strong>
                        <span>{label}</span>
                      </p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="admin-detailed-section" aria-labelledby="detailed-metrics-title">
                <div className="admin-section-heading">
                  <h2 id="detailed-metrics-title">Detailed metrics</h2>
                  <span>Current database values</span>
                </div>
                <div className="admin-detailed-grid">
                  {detailedMetrics.map(({ key, label, icon: Icon, tone }) => (
                    <article className={"admin-detail-metric is-" + (tone ?? "plum")} key={key}>
                      <span className="admin-metric-icon" aria-hidden="true">
                        <Icon />
                      </span>
                      <p>
                        <strong>{formatAdminMetric(data[key])}</strong>
                        <span>{label}</span>
                      </p>
                    </article>
                  ))}
                </div>
              </section>

              <TrafficAnalyticsPanel range={analyticsRange} setRange={setAnalyticsRange} query={analyticsQuery} />

              <div className={"admin-dashboard-lower" + (canViewAudit ? "" : " without-activity")}>
                {canViewAudit ? (
                  <section className="admin-dashboard-panel admin-activity-panel">
                    <div className="admin-panel-heading">
                      <div>
                        <h2>Recent moderation activity</h2>
                        <p>Latest recorded admin actions</p>
                      </div>
                      <Link to="/admin/audit-logs">
                        View all <ChevronRight aria-hidden="true" />
                      </Link>
                    </div>
                    {auditQuery.isLoading ? (
                      <p className="admin-panel-state">Loading recent activity…</p>
                    ) : auditQuery.isError ? (
                      <p className="admin-panel-state">Recent activity is unavailable.</p>
                    ) : auditQuery.data?.length ? (
                      <ol className="admin-activity-list">
                        {auditQuery.data.slice(0, 4).map((entry) => (
                          <li key={entry.id}>
                            <span className="admin-activity-icon" aria-hidden="true">
                              <ShieldCheck />
                            </span>
                            <p>
                              <strong>{formatAdminAction(entry.action)}</strong>
                              <span>
                                {formatAdminTarget(entry.targetType, entry.targetId)}
                              </span>
                            </p>
                            <time dateTime={entry.createdAt}>
                              {formatAdminTime(entry.createdAt)}
                            </time>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="admin-panel-state">No moderation activity recorded yet.</p>
                    )}
                  </section>
                ) : null}

                <section className="admin-dashboard-panel admin-quick-panel">
                  <div className="admin-panel-heading">
                    <div>
                      <h2>Quick actions</h2>
                      <p>Common administration tasks</p>
                    </div>
                  </div>
                  <nav className="admin-quick-actions" aria-label="Admin quick actions">
                    {quickActions.map(({ to, label, icon: Icon, highlighted }) => (
                      <Link className={highlighted ? "is-highlighted" : ""} to={to} key={to}>
                        <Icon aria-hidden="true" />
                        <span>{label}</span>
                        <ChevronRight aria-hidden="true" />
                      </Link>
                    ))}
                  </nav>
                </section>
              </div>
            </>
          );
        }}
      </QueryView>
    </div>
  );
}

function formatAdminMetric(value: unknown) {
  if (value === null || value === undefined) return "Unavailable";
  if (typeof value === "number" && !Number.isInteger(value)) return value.toFixed(1);
  return String(value);
}

function formatAdminAction(action: unknown) {
  return String(action ?? "Admin action")
    .toLocaleLowerCase()
    .replace(/_/g, " ")
    .replace(/^./, (character) => character.toLocaleUpperCase());
}

function formatAdminTarget(type: unknown, id: unknown) {
  const target = String(type ?? "Record")
    .toLocaleLowerCase()
    .replace(/_/g, " ");
  const shortId = String(id ?? "").slice(0, 8);
  return shortId ? target + " · " + shortId : target;
}

function formatAdminTime(value: unknown) {
  const timestamp = new Date(String(value)).getTime();
  if (!Number.isFinite(timestamp)) return "Unknown time";
  const elapsedMinutes = Math.round((timestamp - Date.now()) / 60_000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(elapsedMinutes) < 60) return formatter.format(elapsedMinutes, "minute");
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (Math.abs(elapsedHours) < 24) return formatter.format(elapsedHours, "hour");
  return formatter.format(Math.round(elapsedHours / 24), "day");
}

export function AdminListings() {
  return <PendingListings browseAll />;
}

function listingModerationStatus(listing: any) {
  if (listing.moderationState === "REJECTED" && listing.requestedChanges) return "CHANGES_REQUESTED";
  if (listing.moderationState === "PENDING" && !listing.submittedAt) return "NOT_SUBMITTED";
  return listing.moderationState;
}

export function PendingListings({ browseAll = false }: { browseAll?: boolean }) {
  const [params, setParams] = useSearchParams();
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => api<any[]>("/api/categories"),
  });
  const sellers = useQuery({
    queryKey: ["admin-users-filter"],
    queryFn: () => api<any[]>("/api/admin/users"),
  });
  const query = useQuery({
    queryKey: ["admin-pending", browseAll, params.toString()],
    queryFn: async () => {
      if (browseAll) return api<{ rows: any[]; total: number; page: number; pageSize: number }>(`/api/admin/listings?${params}`);
      const rows = await api<any[]>(`/api/admin/listings/pending?${params}`);
      return { rows, total: rows.length, page: 1, pageSize: rows.length };
    },
    refetchInterval: 10_000,
  });
  const update = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (name !== "page") next.delete("page");
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next);
  };
  return (
    <div className="admin-queue-page">
      <div className="admin-queue-heading">
        <div>
          <h2>{browseAll ? "All listings" : "Pending listing queue"}</h2>
          <p className="lede">
            {browseAll ? "Browse listings across moderation decisions and sale statuses." : "Review every image and field before making a decision."}
          </p>
          <Link to={browseAll ? "/admin/listings/pending" : "/admin/listings"}>{browseAll ? "Open pending queue" : "Browse all listing statuses"}</Link>
        </div>
        <span className="admin-queue-count">
          {query.isLoading
            ? "Loading listings…"
            : browseAll ? `${query.data?.total ?? 0} listings` : formatPendingCount(query.data?.total ?? 0)}
        </span>
      </div>

      <section
        className="admin-filter-panel"
        aria-labelledby="queue-filters-title"
      >
        <div className="admin-filter-heading">
          <div className="admin-filter-title">
            <SlidersHorizontal aria-hidden="true" />
            <div>
              <h3 id="queue-filters-title">{browseAll ? "Listing filters" : "Queue filters"}</h3>
              <p>Focus the review list by seller, category, or risk signal.</p>
            </div>
          </div>
          <button
            type="button"
            className="admin-clear-filters"
            onClick={() => setParams(new URLSearchParams())}
            disabled={!params.toString()}
          >
            <RotateCcw aria-hidden="true" />
            Clear filters
          </button>
        </div>

        <div className="admin-filter-grid">
          {browseAll ? <>
            <label className="admin-filter-field">
              <span>Moderation status</span>
              <select value={params.get("status") ?? "ALL"} onChange={(e) => update("status", e.target.value)}>
                <option value="ALL">All statuses</option>
                <option value="PENDING">Pending review</option>
                <option value="CHANGES_REQUESTED">Changes requested</option>
                <option value="REJECTED">Rejected</option>
                <option value="REMOVED">Removed</option>
                <option value="APPROVED">Approved</option>
                <option value="DRAFT">Not submitted</option>
              </select>
            </label>
            <label className="admin-filter-field">
              <span>Sale status</span>
              <select value={params.get("lifecycle") ?? ""} onChange={(e) => update("lifecycle", e.target.value)}>
                <option value="">All sale statuses</option>
                <option value="DRAFT">Draft</option>
                <option value="ACTIVE">Active</option>
                <option value="RESERVED">Reserved</option>
                <option value="SOLD">Sold</option>
                <option value="EXPIRED">Expired</option>
                <option value="WITHDRAWN">Withdrawn</option>
              </select>
            </label>
          </> : null}
          <label className="admin-filter-field">
            <span>Sort by</span>
            <select
              value={params.get("sort") ?? (browseAll ? "newest" : "oldest")}
              onChange={(e) => update("sort", e.target.value)}
            >
              <option value="oldest">Oldest first</option>
              <option value="newest">Newest first</option>
            </select>
          </label>

          <label className="admin-filter-field">
            <span>Seller</span>
            <select
              value={params.get("seller") ?? ""}
              onChange={(e) => update("seller", e.target.value)}
            >
              <option value="">All sellers</option>
              {sellers.data?.map((seller) => (
                <option value={seller.id} key={seller.id}>
                  {seller.displayName}
                </option>
              ))}
            </select>
          </label>

          <label className="admin-filter-field">
            <span>Category</span>
            <select
              value={params.get("category") ?? ""}
              onChange={(e) => update("category", e.target.value)}
            >
              <option value="">All categories</option>
              {categories.data?.map((category) => (
                <option value={category.id} key={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label className="admin-keyword-toggle">
            <input
              type="checkbox"
              checked={params.get("flagged") === "true"}
              onChange={(e) =>
                update("flagged", e.target.checked ? "true" : "")
              }
              aria-describedby="flagged-keywords-hint"
            />
            <span className="admin-toggle-control" aria-hidden="true" />
            <span className="admin-toggle-copy">
              <strong>Flagged only</strong>
              <small id="flagged-keywords-hint">Show keyword matches</small>
            </span>
          </label>
        </div>
      </section>

      {query.isLoading ? (
        <Loading variant="list" label={browseAll ? "Loading listings" : "Loading pending listings"} />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : query.data?.rows.length ? (
        <>
          <div className="admin-pending-list">
            {query.data.rows.map((row: any) => (
              <article className="admin-pending-card" key={row.listing.id}>
                <div className="admin-pending-preview">
                  {row.coverImageUrl ? (
                    <div className="admin-pending-image-frame">
                      <img
                        className="admin-pending-image"
                        src={row.coverImageUrl}
                        alt={row.listing.title + " listing preview"}
                        loading="lazy"
                      />
                    </div>
                  ) : (
                    <div
                      className="admin-pending-image-fallback"
                      aria-label="Image preview unavailable"
                    >
                      <ImageIcon aria-hidden="true" />
                      <span>No preview</span>
                    </div>
                  )}
                  <div className="admin-pending-copy">
                    <h3>{row.listing.title}</h3>
                    <p>{row.listing.description}</p>
                    {browseAll ? <>
                      <div className="row"><StatusBadge value={listingModerationStatus(row.listing)} /><StatusBadge value={row.listing.lifecycleState} /></div>
                      {row.listing.requestedChanges || row.listing.rejectionReason ? <p><strong>Feedback:</strong> {row.listing.requestedChanges || row.listing.rejectionReason}</p> : null}
                    </> : null}
                  </div>
                </div>

                <div className="admin-pending-meta admin-pending-seller">
                  <span className="admin-pending-label">Seller</span>
                  <div>
                    <span className="admin-seller-initials" aria-hidden="true">
                      {sellerInitials(row.sellerName)}
                    </span>
                    <p>
                      <strong>{row.sellerName}</strong>
                      <span>{formatCompletedSales(row.sellerCompletedSales)}</span>
                    </p>
                  </div>
                </div>

                <div className="admin-pending-meta">
                  <span className="admin-pending-label">Category</span>
                  <p className="admin-pending-inline-value">
                    <Tags aria-hidden="true" />
                    <span>{row.categoryName}</span>
                  </p>
                </div>

                <div className="admin-pending-meta">
                  <span className="admin-pending-label">Submitted</span>
                  <p className="admin-pending-inline-value">
                    <CalendarDays aria-hidden="true" />
                    <time dateTime={row.listing.submittedAt}>
                      {row.listing.submittedAt ? formatSubmittedAt(row.listing.submittedAt) : "Not submitted"}
                    </time>
                  </p>
                </div>

                <div className="admin-pending-actions">
                  {row.flaggedTerms.length ? (
                    <span
                      className="admin-flag-badge"
                      title={"Matched terms: " + row.flaggedTerms.join(", ")}
                    >
                      <Flag aria-hidden="true" />
                      Flagged
                    </span>
                  ) : null}
                  <Link
                    className="admin-review-button"
                    to={"/admin/listings/" + row.listing.id}
                    state={{ returnTo: `${browseAll ? "/admin/listings" : "/admin/listings/pending"}?${params}` }}
                  >
                    {browseAll ? "View listing" : "Review"}
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </div>
              </article>
            ))}
          </div>
          <p className="admin-pending-results">
            Showing {(query.data.page - 1) * query.data.pageSize + 1}–{(query.data.page - 1) * query.data.pageSize + query.data.rows.length} of {query.data.total}{" "}
            {browseAll ? "listings" : query.data.total === 1 ? "pending listing" : "pending listings"}
          </p>
        </>
      ) : (
        <section className="admin-pending-empty">
          <span aria-hidden="true">
            <CheckCircle2 />
          </span>
          <h3>{browseAll ? "No matching listings" : "No pending listings"}</h3>
          <p>{browseAll ? "Try a different status or clear the filters." : "Everything has been reviewed."}</p>
        </section>
      )}
      {browseAll && query.data && (query.data.total > query.data.pageSize || query.data.page > 1) ? (
        <nav className="row" aria-label="Listing pages">
          <button className="button secondary" disabled={query.data.page <= 1} onClick={() => update("page", String(query.data!.page - 1))}>Previous</button>
          <span>Page {query.data.page} of {Math.max(1, Math.ceil(query.data.total / query.data.pageSize))}</span>
          <button className="button secondary" disabled={query.data.page * query.data.pageSize >= query.data.total} onClick={() => update("page", String(query.data!.page + 1))}>Next</button>
        </nav>
      ) : null}
    </div>
  );
}

function formatPendingCount(count: number) {
  return count + " pending " + (count === 1 ? "listing" : "listings");
}

function sellerInitials(name: unknown) {
  const words = String(name ?? "")
    .trim()
    .split(/s+/)
    .filter(Boolean);
  if (!words.length) return "?";
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toLocaleUpperCase();
}

function formatCompletedSales(value: unknown) {
  const count = Number(value ?? 0);
  return count + " completed " + (count === 1 ? "sale" : "sales");
}

function formatSubmittedAt(value: unknown) {
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return "Unavailable";
  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function AdminListingReview() {
  const { listingId } = useParams();
  const location = useLocation();
  const previousList = location.state?.returnTo;
  const returnTo = typeof previousList === "string" && /^\/admin\/listings(?:\/pending)?(?:\?|$)/.test(previousList) ? previousList : "/admin/listings";
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [moderationDecision, setModerationDecision] = useState("APPROVE");
  const client = useQueryClient();
  const admin = useQuery({
    queryKey: ["admin-listing", listingId],
    queryFn: () => api<any>(`/api/admin/listings/${listingId}`),
  });
  const detail = useQuery({
    queryKey: ["listing", listingId],
    queryFn: () => api<any>(`/api/listings/${listingId}`),
  });
  const decision = useMutation({
    mutationFn: (data: any) =>
      api(`/api/admin/listings/${listingId}/decision`, {
        method: "POST",
        ...jsonBody(data),
      }),
    onSuccess: (_data, variables) => {
      const messages: Record<string, string> = {
        APPROVE: "Listing approved",
        REJECT: "Listing rejected",
        REQUEST_CHANGES: "Changes requested",
        REMOVE: "Listing removed",
      };
      toast.success(messages[variables.decision] ?? "Decision recorded");
      void client.invalidateQueries({ queryKey: ["admin-pending"] });
      void client.invalidateQueries({ queryKey: ["admin-listing", listingId] });
      void client.invalidateQueries({ queryKey: ["listing", listingId] });
    },
  });
  const deleteListing = useMutation({
    mutationFn: () => api(`/api/admin/listings/${listingId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Listing deleted");
      void client.invalidateQueries({ queryKey: ["admin-pending"] });
      navigate(returnTo);
    },
  });
  if (admin.isLoading || detail.isLoading)
    return <Loading variant="detail" label="Loading listing review" />;
  if (admin.isError || detail.isError)
    return <ErrorState error={admin.error ?? detail.error} />;
  const row = admin.data;
  const item = detail.data;
  return (
    <div className="stack-lg">
      <Link to={returnTo}>← Back to listings</Link>
      <div>
        <h2>{item.title}</h2>
        <div className="row">
          <StatusBadge value={listingModerationStatus(item)} />
          <StatusBadge value={item.lifecycleState} />
        </div>
      </div>
      <div className="product-grid">
        {item.images.map((image: any, index: number) => (
          <a href={image.url} target="_blank" rel="noreferrer" key={image.id}>
            <img
              className="product-image"
              src={image.url}
              alt={`${item.title}, moderation image ${index + 1}`}
            />
          </a>
        ))}
      </div>
      <section className="panel">
        <h3>Listing details</h3>
        {item.moderationRiskCodes?.length ? <p role="alert"><strong>Automated moderation signals:</strong> {item.moderationRiskCodes.join(", ")}. Review the actual listing and policy before deciding.</p> : null}
        <p>{item.description}</p>
        <dl>
          <dt>Category</dt>
          <dd>{item.categoryId}</dd>
          <dt>Condition</dt>
          <dd>
            {item.condition} — {item.conditionExplanation}
          </dd>
          <dt>Price</dt>
          <dd>{item.priceLabel}</dd>
          <dt>Location</dt>
          <dd>{item.location}</dd>
          <dt>Defects</dt>
          <dd>{item.defects || "None disclosed"}</dd>
        </dl>
      </section>
      {item.requestedChanges || item.rejectionReason ? (
        <section className="panel">
          <h3>{listingModerationStatus(item) === "CHANGES_REQUESTED" ? "Requested changes" : "Moderation feedback"}</h3>
          <p>{item.requestedChanges || item.rejectionReason}</p>
        </section>
      ) : null}
      <section className="panel">
        <h3>Seller summary</h3>
        <p>
          {row.seller.displayName} · {row.seller.completedSales} sales ·{" "}
          {row.seller.phoneVerifiedAt ? "Phone verified" : "Phone not verified"}
        </p>
        {row.rejectionHistory.length ? (
          <>
            <h4>Previous rejections</h4>
            {row.rejectionHistory.map((h: any) => (
              <p key={h.id}>
                {h.title}: {h.rejectionReason}
              </p>
            ))}
          </>
        ) : (
          <p>No previous rejection history.</p>
        )}
      </section>
      <DeleteConfirmationDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete listing?"
        description={`Are you sure you want to delete "${item.title}"?`}
        pending={deleteListing.isPending}
        onConfirm={() => deleteListing.mutate()}
      />
      <section className="panel form">
        <h3>Delete listing</h3>
        <p>This hides the listing while retaining its audit and transaction history.</p>
        <button
          className="button danger"
          onClick={() => setDeleteOpen(true)}
          disabled={deleteListing.isPending}
        >
          Delete listing
        </button>
        {deleteListing.error ? <p className="field-error">{deleteListing.error.message}</p> : null}
      </section>
      <form
        className="form panel"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          decision.mutate({
            decision: String(f.get("decision")),
            internalReason: String(f.get("internalReason")),
            userVisibleReason: String(f.get("userVisibleReason")) || undefined,
            note: String(f.get("note")) || undefined,
          });
        }}
      >
        <h3>Moderation decision</h3>
        <label className="field">
          <span>Decision</span>
          <select name="decision" value={moderationDecision} onChange={(event) => setModerationDecision(event.target.value)}>
            <option value="APPROVE">Approve</option>
            <option value="REJECT">Reject</option>
            <option value="REQUEST_CHANGES">Request changes</option>
            <option value="REMOVE">Remove</option>
          </select>
        </label>
        <label className="field">
          <span>Internal reason {moderationDecision === "APPROVE" ? "(optional)" : ""}</span>
          <textarea name="internalReason" required={moderationDecision !== "APPROVE"} minLength={moderationDecision === "APPROVE" ? undefined : 3} />
        </label>
        <label className="field">
          <span>User-visible reason (required unless approving)</span>
          <textarea name="userVisibleReason" />
        </label>
        <label className="field">
          <span>Internal moderation note</span>
          <textarea name="note" />
        </label>
        <SubmitButton pending={decision.isPending}>
          Record decision
        </SubmitButton>
        {decision.error ? (
          <p className="field-error">{decision.error.message}</p>
        ) : null}
      </form>
    </div>
  );
}

export function AdminReports() {
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [reasonFilter, setReasonFilter] = useState("ALL");
  const [targetFilter, setTargetFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const query = useQuery({
    queryKey: ["admin-reports"],
    queryFn: () => api<AdminReportRecord[]>("/api/admin/reports"),
  });
  const reports = query.data ?? EMPTY_ADMIN_REPORTS;
  const statusOptions = useMemo(
    () => [...new Set(reports.map((report) => report.status))].sort(),
    [reports],
  );
  const reasonOptions = useMemo(
    () => [...new Set(reports.map((report) => report.reason))].sort(),
    [reports],
  );
  const targetOptions = useMemo(
    () => [...new Set(reports.map((report) => report.targetType))].sort(),
    [reports],
  );
  const filteredReports = useMemo(() => {
    const needle = searchQuery.trim().toLocaleLowerCase();
    return reports
      .filter(
        (report) =>
          (statusFilter === "ALL" || report.status === statusFilter) &&
          (reasonFilter === "ALL" || report.reason === reasonFilter) &&
          (targetFilter === "ALL" || report.targetType === targetFilter) &&
          (!needle ||
            [
              report.publicReference,
              report.id,
              report.reason,
              report.details,
              report.targetType,
              report.targetId,
              report.reporterId,
            ]
              .filter(Boolean)
              .some((value) =>
                String(value).toLocaleLowerCase().includes(needle),
              )),
      )
      .sort((left, right) => {
        const difference =
          new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
        return sortOrder === "newest" ? -difference : difference;
      });
  }, [
    reasonFilter,
    reports,
    searchQuery,
    sortOrder,
    statusFilter,
    targetFilter,
  ]);
  const filtersActive =
    statusFilter !== "ALL" ||
    reasonFilter !== "ALL" ||
    targetFilter !== "ALL" ||
    Boolean(searchQuery.trim());
  const clearFilters = () => {
    setStatusFilter("ALL");
    setReasonFilter("ALL");
    setTargetFilter("ALL");
    setSearchQuery("");
  };
  const metrics = [
    {
      label: "Open reports",
      value: reports.filter((report) => report.status === "OPEN").length,
      note: "Needs your attention",
      icon: Flag,
      tone: "plum",
    },
    {
      label: "In review",
      value: reports.filter((report) => report.status === "INVESTIGATING").length,
      note: "Current active queue",
      icon: CheckCircle2,
      tone: "success",
    },
    {
      label: "Users reported",
      value: new Set(
        reports
          .filter((report) => report.targetType === "USER" && report.targetId)
          .map((report) => report.targetId),
      ).size,
      note: "Current active queue",
      icon: Users,
      tone: "plum",
    },
    {
      label: "Listings reported",
      value: new Set(
        reports
          .filter((report) => report.targetType === "LISTING" && report.targetId)
          .map((report) => report.targetId),
      ).size,
      note: "Current active queue",
      icon: ClipboardCheck,
      tone: "plum",
    },
  ];

  return (
    <div className="admin-reports-page">
      <header className="admin-reports-heading">
        <h2>Reports</h2>
        <p>
          Review reported listings, users, and messages. Take action to keep Uni
          Market safe and trustworthy.
        </p>
      </header>

      {query.isLoading ? (
        <Loading variant="metrics" label="Loading reports" />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          <section className="admin-report-metrics" aria-label="Report summary">
            {metrics.map(({ icon: Icon, label, note, tone, value }) => (
              <article className={"admin-report-metric is-" + tone} key={label}>
                <span className="admin-report-metric-icon" aria-hidden="true">
                  <Icon />
                </span>
                <p>
                  <strong>{value}</strong>
                  <b>{label}</b>
                  <span>{note}</span>
                </p>
              </article>
            ))}
          </section>

          <section
            className="admin-report-filters"
            aria-labelledby="report-filters-title"
          >
            <div className="admin-report-filter-heading">
              <div>
                <h3 id="report-filters-title">Filters</h3>
                <p>Find specific reports by status, type, or keyword.</p>
              </div>
              <button
                type="button"
                className="admin-report-clear"
                onClick={clearFilters}
                disabled={!filtersActive}
              >
                <RotateCcw aria-hidden="true" />
                Clear filters
              </button>
            </div>
            <div className="admin-report-filter-grid">
              <label>
                <span>Status</span>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="ALL">All statuses</option>
                  {statusOptions.map((status) => (
                    <option value={status} key={status}>
                      {formatAdminReportLabel(status)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Report type</span>
                <select
                  value={reasonFilter}
                  onChange={(event) => setReasonFilter(event.target.value)}
                >
                  <option value="ALL">All types</option>
                  {reasonOptions.map((reason) => (
                    <option value={reason} key={reason}>
                      {formatAdminReportLabel(reason)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Target</span>
                <select
                  value={targetFilter}
                  onChange={(event) => setTargetFilter(event.target.value)}
                >
                  <option value="ALL">All targets</option>
                  {targetOptions.map((target) => (
                    <option value={target} key={target}>
                      {formatAdminReportLabel(target)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-report-search">
                <span>Search</span>
                <span className="admin-report-search-control">
                  <Search aria-hidden="true" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search by keyword (reason, target, report ID...)"
                  />
                </span>
              </label>
            </div>
          </section>

          <div className="admin-report-list-heading">
            <h3>Reports ({filteredReports.length})</h3>
            <label>
              <span>Sort by</span>
              <select
                value={sortOrder}
                onChange={(event) =>
                  setSortOrder(event.target.value as "newest" | "oldest")
                }
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </label>
          </div>

          {filteredReports.length ? (
            <>
              <div className="admin-report-table" role="table" aria-label="Reports">
                <div className="admin-report-table-head" role="row">
                  <span role="columnheader">Report</span>
                  <span role="columnheader">Reason</span>
                  <span role="columnheader">Target</span>
                  <span role="columnheader">Reported by</span>
                  <span role="columnheader">Date</span>
                  <span role="columnheader">Status</span>
                  <span role="columnheader" aria-label="Action" />
                </div>
                {filteredReports.map((report) => (
                  <AdminReportRow report={report} key={report.id} />
                ))}
              </div>
              <p className="admin-report-results">
                Showing 1–{filteredReports.length} of {filteredReports.length}{" "}
                {filteredReports.length === 1 ? "report" : "reports"}
              </p>
            </>
          ) : (
            <section className="admin-report-empty">
              <ShieldCheck aria-hidden="true" />
              <h3>No reports found</h3>
              <p>
                {filtersActive
                  ? "Try adjusting or clearing your filters."
                  : "Everything looks clear."}
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}

type AdminReportRecord = {
  id: string;
  publicReference: string;
  reporterId: string | null;
  targetType: string;
  targetId: string | null;
  reason: string;
  details: string | null;
  status: string;
  createdAt: string;
};

type AdminReportListingContext = {
  title: string;
  location?: string | null;
  images?: Array<{ url: string }>;
};

type AdminReportUserContext = {
  displayName: string;
  avatarId?: string | null;
  campus?: string | null;
};

const EMPTY_ADMIN_REPORTS: AdminReportRecord[] = [];

function AdminReportRow({ report }: { report: AdminReportRecord }) {
  const TargetIcon = adminReportTargetIcon(report.targetType);
  const listingQuery = useQuery({
    queryKey: ["admin-report-listing-context", report.targetId],
    queryFn: () =>
      api<AdminReportListingContext>(`/api/listings/${report.targetId}`),
    enabled: report.targetType === "LISTING" && Boolean(report.targetId),
    retry: false,
  });
  const targetUserQuery = useQuery({
    queryKey: ["admin-report-user-context", report.targetId],
    queryFn: () =>
      api<AdminReportUserContext>(`/api/admin/users/${report.targetId}`),
    enabled: report.targetType === "USER" && Boolean(report.targetId),
    retry: false,
  });
  const reporterQuery = useQuery({
    queryKey: ["admin-report-reporter-context", report.reporterId],
    queryFn: () =>
      api<AdminReportUserContext>(`/api/admin/users/${report.reporterId}`),
    enabled: Boolean(report.reporterId),
    retry: false,
  });
  const listing = listingQuery.data;
  const targetUser = targetUserQuery.data;
  const reporter = reporterQuery.data;
  const entityName =
    listing?.title ?? targetUser?.displayName ?? report.publicReference;
  const entityReference = report.targetId
    ? `#${shortAdminIdentifier(report.targetId)}`
    : `#${shortAdminIdentifier(report.id)}`;
  const reporterReference = report.reporterId
    ? "#" + shortAdminIdentifier(report.reporterId)
    : "Identity not available";
  return (
    <article className="admin-report-row" role="row">
      <div className="admin-report-primary" role="cell" data-label="Report">
        {listing?.images?.[0]?.url ? (
          <span className="admin-report-entity-image">
            <TargetIcon
              className="admin-report-entity-image-fallback"
              aria-hidden="true"
            />
            <img
              src={listing.images[0].url}
              alt={`${listing.title} thumbnail`}
              loading="lazy"
              onError={(event) => {
                event.currentTarget.hidden = true;
              }}
            />
          </span>
        ) : targetUser ? (
          <UserAvatar
            avatarId={targetUser.avatarId ?? null}
            displayName={targetUser.displayName}
            size={42}
            className="admin-report-entity-avatar"
            decorative
          />
        ) : (
          <span className="admin-report-target-icon" aria-hidden="true">
            <TargetIcon />
          </span>
        )}
        <p>
          <strong>{entityName}</strong>
          <span>{entityReference}</span>
        </p>
      </div>
      <div className="admin-report-reason" role="cell" data-label="Reason">
        <strong>{formatAdminReportLabel(report.reason)}</strong>
        <span>{report.details || "No additional details provided"}</span>
      </div>
      <div className="admin-report-target" role="cell" data-label="Target">
        <span className="admin-report-target-kind-icon" aria-hidden="true">
          <TargetIcon />
        </span>
        <p>
          <strong>{formatAdminReportLabel(report.targetType)}</strong>
          <span>
            {listing?.location ??
              targetUser?.campus ??
              (report.targetId
                ? "#" + shortAdminIdentifier(report.targetId)
                : "No target identifier")}
          </span>
        </p>
      </div>
      <div className="admin-report-reporter" role="cell" data-label="Reported by">
        {reporter ? (
          <UserAvatar
            avatarId={reporter.avatarId ?? null}
            displayName={reporter.displayName}
            size={34}
            className="admin-report-reporter-avatar-image"
            decorative
          />
        ) : (
          <span className="admin-report-reporter-avatar" aria-hidden="true">
            <UserRound />
          </span>
        )}
        <p>
          <strong>
            {reporter?.displayName ??
              (report.reporterId ? "Registered user" : "Anonymous")}
          </strong>
          <span>{reporterReference}</span>
        </p>
      </div>
      <time
        className="admin-report-date"
        role="cell"
        data-label="Date"
        dateTime={report.createdAt}
      >
        {new Date(report.createdAt).toLocaleString()}
      </time>
      <div className="admin-report-status" role="cell" data-label="Status">
        <StatusBadge value={report.status} />
      </div>
      <div className="admin-report-action" role="cell">
        <Link to={"/admin/reports/" + report.id}>
          {adminReportActionLabel(report.status)}
          <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}

function adminReportTargetIcon(targetType: string) {
  if (targetType === "USER") return UserRound;
  if (targetType === "REVIEW") return Star;
  if (targetType === "CONVERSATION") return MessageCircle;
  if (targetType === "SUPPORT_RESPONSE") return Headphones;
  return ClipboardCheck;
}

function adminReportActionLabel(status: string) {
  if (status === "OPEN") return "Investigate";
  if (status === "INVESTIGATING") return "View";
  return "View details";
}

function shortAdminIdentifier(value: string) {
  return value.replaceAll("-", "").slice(0, 8).toUpperCase();
}

function formatAdminReportLabel(value: string) {
  return value
    .toLocaleLowerCase()
    .split("_")
    .map((word) =>
      word === "csam" ? "CSAM" : word.charAt(0).toLocaleUpperCase() + word.slice(1),
    )
    .join(" ");
}
export function AdminReportDetail() {
  const { reportId } = useParams();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["admin-report", reportId],
    queryFn: () => api<any>(`/api/admin/reports/${reportId}`),
  });
  const resolve = useMutation({
    mutationFn: (data: any) =>
      api(`/api/admin/reports/${reportId}/resolve`, {
        method: "POST",
        ...jsonBody(data),
      }),
    onSuccess: () => {
      toast.success("Report closed");
      void client.invalidateQueries({ queryKey: ["admin-reports"] });
    },
  });
  return (
    <QueryView query={query}>
      {(r) => (
        <div className="stack">
          <Link to="/admin/reports">← Reports</Link>
          <h2>{r.reason.replaceAll("_", " ")}</h2>
          <p>{r.details || "No extra details provided."}</p>
          {r.context?.length ? (
            <section className="panel">
              <h3>Reported conversation window</h3>
              {r.context.map((m: any) => (
                <p key={m.id}>
                  <strong>{m.senderId.slice(0, 8)}</strong>: {m.body}
                </p>
              ))}
            </section>
          ) : null}
          <form
            className="panel form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              resolve.mutate({
                outcome: String(f.get("outcome")),
                reason: String(f.get("reason")),
              });
            }}
          >
            <label className="field">
              <span>Outcome</span>
              <select name="outcome">
                <option value="RESOLVED">Resolved</option>
                <option value="DISMISSED">Dismissed</option>
              </select>
            </label>
            <label className="field">
              <span>Investigation reason</span>
              <textarea name="reason" required />
            </label>
            <SubmitButton pending={resolve.isPending}>
              Close report
            </SubmitButton>
          </form>
        </div>
      )}
    </QueryView>
  );
}

type AdminUserListItem = {
  id: string;
  displayName: string;
  avatarId: string | null;
  email: string;
  phoneVerifiedAt: string | null;
  suspendedAt: string | null;
  completedSales: number;
  createdAt: string;
  roles: string[];
};

type AdminUserMetrics = {
  totalUsers: number;
  verifiedUsers: number;
  activeUsers: number;
  newUsers: number;
};

const EMPTY_ADMIN_USERS: AdminUserListItem[] = [];

function formatAdminUserDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "unknown";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function AdminUserRow({ user }: { user: AdminUserListItem }) {
  const role = getPrimaryAdminUserRole(user.roles);
  return (
    <article className="admin-user-row" role="row">
      <div className="admin-user-primary" role="cell" data-label="User">
        <UserAvatar
          avatarId={user.avatarId}
          displayName={user.displayName}
          size={38}
          className="admin-user-avatar"
        />
        <p>
          <strong>{user.displayName}</strong>
          <span>#{user.id.replaceAll("-", "").slice(0, 8).toLocaleUpperCase()} · Joined {formatAdminUserDate(user.createdAt)}</span>
        </p>
      </div>
      <div className="admin-user-email" role="cell" data-label="Email" title={user.email}>{user.email}</div>
      <div className={`admin-user-verification ${user.phoneVerifiedAt ? "is-verified" : ""}`} role="cell" data-label="Phone">
        {user.phoneVerifiedAt ? <BadgeCheck aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
        <span>{user.phoneVerifiedAt ? "Verified" : "Not verified"}</span>
      </div>
      <div className="admin-user-sales" role="cell" data-label="Sales">{user.completedSales}</div>
      <div className="admin-user-status" role="cell" data-label="Status">
        <StatusBadge value={user.suspendedAt ? "SUSPENDED" : "ACTIVE"} />
      </div>
      <div className="admin-user-roles" role="cell" data-label="Roles">
        <span data-role={role ?? "NONE"}>{role ? role.replaceAll("_", " ") : "No role"}</span>
      </div>
      <div className="admin-user-action" role="cell">
        <Link to={`/admin/users/${user.id}`}><UserRound aria-hidden="true" />View</Link>
      </div>
    </article>
  );
}

function getPrimaryAdminUserRole(roles: string[]) {
  if (roles.includes("SUPER_ADMIN")) return "SUPER_ADMIN";
  return roles.length ? "USER" : null;
}

export function AdminUsers() {
  const [params, setParams] = useSearchParams();
  const searchQuery = params.get("q") ?? "";
  const roleFilter = params.get("role") ?? "ALL";
  const verificationFilter = params.get("verification") ?? "ALL";
  const statusFilter = params.get("status") ?? "ALL";
  const sortOrder = params.get("sort") ?? "newest";
  const query = useQuery({
    queryKey: ["admin-users", searchQuery],
    queryFn: () =>
      api<AdminUserListItem[]>(`/api/admin/users?q=${encodeURIComponent(searchQuery)}`),
  });
  const metricsQuery = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: () => api<AdminUserMetrics>("/api/admin/dashboard"),
  });
  const rows = query.data ?? EMPTY_ADMIN_USERS;
  const roleOptions = useMemo(
    () => [...new Set(rows.map((user) => getPrimaryAdminUserRole(user.roles)).filter((role) => role !== null))].sort(),
    [rows],
  );
  const filteredRows = useMemo(() => rows
    .filter((user) => {
      const role = roleFilter === "ALL" || getPrimaryAdminUserRole(user.roles) === roleFilter;
      const verified = verificationFilter === "ALL"
        || (verificationFilter === "VERIFIED" && Boolean(user.phoneVerifiedAt))
        || (verificationFilter === "UNVERIFIED" && !user.phoneVerifiedAt);
      const status = statusFilter === "ALL"
        || (statusFilter === "ACTIVE" && !user.suspendedAt)
        || (statusFilter === "SUSPENDED" && Boolean(user.suspendedAt));
      return role && verified && status;
    })
    .sort((left, right) => {
      if (sortOrder === "name") return left.displayName.localeCompare(right.displayName);
      const difference = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      return sortOrder === "oldest" ? difference : -difference;
    }), [roleFilter, rows, sortOrder, statusFilter, verificationFilter]);
  const filtersActive = Boolean(searchQuery)
    || roleFilter !== "ALL"
    || verificationFilter !== "ALL"
    || statusFilter !== "ALL"
    || sortOrder !== "newest";
  const updateFilter = (name: string, value: string, defaultValue = "ALL") => {
    const next = new URLSearchParams(params);
    if (!value || value === defaultValue) next.delete(name);
    else next.set(name, value);
    setParams(next, { replace: true });
  };
  const metrics = [
    { key: "totalUsers" as const, label: "Total users", note: "Across Uni Market", icon: Users, tone: "plum" },
    {
      key: "verifiedUsers" as const,
      label: "Phone verified",
      note: metricsQuery.data?.totalUsers
        ? `${Math.round((metricsQuery.data.verifiedUsers / metricsQuery.data.totalUsers) * 100)}% of all users`
        : "Verified phone numbers",
      icon: BadgeCheck,
      tone: "success",
    },
    { key: "activeUsers" as const, label: "Active users", note: "Active in the last 24 hours", icon: Activity, tone: "success" },
    { key: "newUsers" as const, label: "New users", note: "Joined in the last 30 days", icon: UserPlus, tone: "plum" },
  ];
  return (
    <div className="admin-users-page">
      <header className="admin-users-heading">
        <div>
          <h2>Users</h2>
          <p>Manage and monitor all users on Uni Market.</p>
        </div>
      </header>
      <section className="admin-user-metrics" aria-label="User summary">
        {metrics.map(({ icon: Icon, key, label, note, tone }) => (
          <article className={`admin-user-metric is-${tone}`} key={key}>
            <span className="admin-user-metric-icon" aria-hidden="true"><Icon /></span>
            <p>
              <span>{label}</span>
              <strong>{metricsQuery.isLoading ? "—" : formatAdminMetric(metricsQuery.data?.[key])}</strong>
              <small>{note}</small>
            </p>
          </article>
        ))}
      </section>
      <section className="admin-user-filters" aria-labelledby="admin-user-filters-title">
        <div className="admin-user-filter-heading">
          <div className="admin-user-filter-title">
            <span aria-hidden="true"><SlidersHorizontal /></span>
            <div>
              <h3 id="admin-user-filters-title">Filters</h3>
              <p>Find specific users by name, email, or phone verification status.</p>
            </div>
          </div>
          <button type="button" onClick={() => setParams({}, { replace: true })} disabled={!filtersActive}>
            <RotateCcw aria-hidden="true" />Clear filters
          </button>
        </div>
        <div className="admin-user-filter-grid">
          <label className="admin-user-search">
            <span>Search</span>
            <span className="admin-user-search-control">
              <Search aria-hidden="true" />
              <input
                type="search"
                placeholder="Search name or email..."
                value={searchQuery}
                onChange={(event) => updateFilter("q", event.target.value, "")}
              />
            </span>
          </label>
          <label>
            <span>Role</span>
            <select value={roleFilter} onChange={(event) => updateFilter("role", event.target.value)}>
              <option value="ALL">All roles</option>
              {roleOptions.map((role) => (
                <option value={role} key={role}>{role.replaceAll("_", " ")}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Phone verification</span>
            <select value={verificationFilter} onChange={(event) => updateFilter("verification", event.target.value)}>
              <option value="ALL">All verification states</option>
              <option value="VERIFIED">Verified</option>
              <option value="UNVERIFIED">Not verified</option>
            </select>
          </label>
          <label>
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => updateFilter("status", event.target.value)}>
              <option value="ALL">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
            </select>
          </label>
        </div>
      </section>
      <div className="admin-user-list-heading">
        <h3>Users ({filteredRows.length})</h3>
        <label>
          <span>Sort by</span>
          <select value={sortOrder} onChange={(event) => updateFilter("sort", event.target.value, "newest")}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="name">Name A–Z</option>
          </select>
        </label>
      </div>
      {query.isLoading ? (
        <Loading variant="table" label="Loading users" />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : filteredRows.length ? (
        <>
          <div className="admin-user-table" role="table" aria-label="Users">
            <div className="admin-user-table-head" role="row">
              <span role="columnheader">User</span>
              <span role="columnheader">Email</span>
              <span role="columnheader">Phone</span>
              <span role="columnheader">Sales</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">Role</span>
              <span role="columnheader">Action</span>
            </div>
            {filteredRows.map((user) => <AdminUserRow user={user} key={user.id} />)}
          </div>
        </>
      ) : (
        <section className="admin-user-empty">
          <Users aria-hidden="true" />
          <h3>No users found</h3>
          <p>{filtersActive ? "Try adjusting or clearing your filters." : "There are no user records to display."}</p>
        </section>
      )}
    </div>
  );
}
type AdminUserDetailData = {
  id: string;
  displayName: string;
  email: string;
  avatarId: string | null;
  institution: string | null;
  campus: string | null;
  phoneE164: string | null;
  phoneVerifiedAt: string | null;
  studentEmailVerifiedAt: string | null;
  onboardingComplete: boolean;
  suspendedAt: string | null;
  deletedAt: string | null;
  closedAt: string | null;
  fraudInvestigation: boolean;
  completedSales: number;
  lastActiveAt: string;
  createdAt: string;
  updatedAt: string;
  roles: { role: string; createdAt: string }[];
};

type AdminUserAuditEntry = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  internalReason: string;
  createdAt: string;
};

function formatAdminUserDetailDate(value: string, includeTime = false) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unavailable';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(includeTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(date);
}

function adminUserAccountStatus(user: AdminUserDetailData) {
  if (user.deletedAt) return 'Deleted';
  if (user.closedAt) return 'Closed';
  if (user.suspendedAt) return 'Suspended';
  return 'Active';
}

const staffRoleOptions = [
  ['SUPPORT_AGENT', 'Support Agent', 'Can respond to user inquiries and manage support tickets.'],
  ['MODERATOR', 'Moderator', 'Can moderate listings, messages, and user content.'],
  ['SUPER_ADMIN', 'Super Admin', 'Full administrative access to the platform.'],
] as const;

function AdminUserOverview({
  user, status, role, location,
}: {
  user: AdminUserDetailData;
  status: string;
  role: string;
  location: string;
}) {
  return (
    <section className='admin-user-detail-card admin-user-overview-card' aria-labelledby='user-overview-title'>
      <div className='admin-user-detail-card-heading'>
        <h3 id='user-overview-title'>User overview</h3>
        <span className='admin-user-reference'>#{user.id.replaceAll('-', '').slice(0, 8).toLocaleUpperCase()}</span>
      </div>
      <div className='admin-user-overview-profile'>
        <UserAvatar avatarId={user.avatarId} displayName={user.displayName} size={82} />
        <div>
          <h4>{user.displayName}</h4>
          <p>{user.email}</p>
          <div className='admin-user-overview-badges' aria-label='Account status'>
            <span className={status === 'Active' ? 'is-positive' : 'is-warning'}>
              {status === 'Active' ? <CheckCircle2 aria-hidden='true' /> : <ShieldAlert aria-hidden='true' />}
              {status}
            </span>
            <span className={user.phoneVerifiedAt ? 'is-positive' : 'is-warning'}>
              {user.phoneVerifiedAt ? <CheckCircle2 aria-hidden='true' /> : <CircleX aria-hidden='true' />}
              {user.phoneVerifiedAt ? 'Phone verified' : 'Phone not verified'}
            </span>
            <span>{role.replaceAll('_', ' ')}</span>
          </div>
        </div>
      </div>
      <dl className='admin-user-overview-summary'>
        <div><TicketCheck aria-hidden='true' /><dt>Completed sales</dt><dd>{user.completedSales}</dd></div>
        <div><CalendarDays aria-hidden='true' /><dt>Joined</dt><dd>{formatAdminUserDetailDate(user.createdAt)}</dd></div>
        {location ? <div><MapPin aria-hidden='true' /><dt>Campus / institution</dt><dd>{location}</dd></div> : null}
        <div><Users aria-hidden='true' /><dt>Role</dt><dd>{role.replaceAll('_', ' ')}</dd></div>
      </dl>
    </section>
  );
}

function AdminAccountSignals({
  user, status, role, location,
}: {
  user: AdminUserDetailData;
  status: string;
  role: string;
  location: string;
}) {
  return (
    <section className='admin-user-detail-card admin-user-signals-card' aria-labelledby='account-signals-title'>
      <div className='admin-user-detail-card-heading'>
        <h3 id='account-signals-title'><ShieldCheck aria-hidden='true' />Account signals</h3>
      </div>
      <dl className='admin-user-signal-list'>
        <div>
          <dt><BadgeCheck aria-hidden='true' />Student email</dt>
          <dd className={user.studentEmailVerifiedAt ? 'is-positive' : 'is-warning'}>
            {user.studentEmailVerifiedAt ? <CheckCircle2 aria-hidden='true' /> : <CircleX aria-hidden='true' />}
            {user.studentEmailVerifiedAt ? 'Verified' : 'Not verified'}
          </dd>
        </div>
        <div>
          <dt><Phone aria-hidden='true' />Phone</dt>
          <dd className={user.phoneVerifiedAt ? 'is-positive' : 'is-warning'}>
            {user.phoneVerifiedAt ? <CheckCircle2 aria-hidden='true' /> : <CircleX aria-hidden='true' />}
            {user.phoneVerifiedAt ? 'Verified' : 'Not verified'}
          </dd>
        </div>
        <div><dt><ShieldCheck aria-hidden='true' />Account status</dt><dd>{status}</dd></div>
        <div><dt><UserRound aria-hidden='true' />Account access</dt><dd>{role.replaceAll('_', ' ')}</dd></div>
        <div><dt><BadgeCheck aria-hidden='true' />Onboarding</dt><dd>{user.onboardingComplete ? 'Complete' : 'Incomplete'}</dd></div>
        {user.fraudInvestigation ? (
          <div>
            <dt><ShieldAlert aria-hidden='true' />Review flag</dt>
            <dd className='is-warning'><ShieldAlert aria-hidden='true' />Under investigation</dd>
          </div>
        ) : null}
        {location ? <div><dt><MapPin aria-hidden='true' />Campus / institution</dt><dd>{location}</dd></div> : null}
        <div><dt><TicketCheck aria-hidden='true' />Completed sales</dt><dd>{user.completedSales}</dd></div>
        <div><dt><Clock3 aria-hidden='true' />Last active</dt><dd>{formatAdminUserDetailDate(user.lastActiveAt, true)}</dd></div>
      </dl>
    </section>
  );
}

function AdminStaffAccess({ user, mutation }: { user: AdminUserDetailData; mutation: any }) {
  const assigned = user.roles.map((item) => item.role);
  return (
    <section className='admin-user-detail-card admin-user-staff-card' aria-labelledby='staff-access-title'>
      <div className='admin-user-detail-card-heading is-stacked'>
        <h3 id='staff-access-title'>Staff access</h3>
        <p>User access is always retained. Staff roles cannot be requested through public registration.</p>
      </div>
      <form
        key={assigned.slice().sort().join('-')}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          mutation.mutate({
            roles: form.getAll('roles').map(String),
            reason: String(form.get('reason')),
          });
        }}
      >
        <div className='admin-staff-role-list'>
          {staffRoleOptions.map(([value, label, description]) => (
            <label key={value}>
              <input
                type='checkbox'
                name='roles'
                value={value}
                defaultChecked={assigned.includes(value)}
                disabled={mutation.isPending}
              />
              <span><strong>{label}</strong><small>{description}</small></span>
            </label>
          ))}
        </div>
        <label className='admin-user-detail-field'>
          <span>Reason for access change</span>
          <textarea name='reason' required minLength={3} rows={2} placeholder='Add a reason for this access change...' />
        </label>
        <SubmitButton pending={mutation.isPending}>Update staff access</SubmitButton>
        {mutation.error ? <p className='field-error'>{mutation.error.message}</p> : null}
      </form>
    </section>
  );
}

function AdminModerationActions({ mutation }: { mutation: any }) {
  return (
    <section className='admin-user-detail-card admin-user-moderation-card' aria-labelledby='moderation-actions-title'>
      <div className='admin-user-detail-card-heading is-stacked'>
        <h3 id='moderation-actions-title'>Moderation actions</h3>
        <p>Take action on this user's account. All actions are logged in the audit trail.</p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          mutation.mutate({
            action: String(form.get('action')),
            reason: String(form.get('reason')),
          });
        }}
      >
        <label className='admin-user-detail-field'>
          <span>Action</span>
          <select name='action'>
            <option value='warn'>Warn user</option>
            <option value='suspend'>Suspend user</option>
          </select>
        </label>
        <label className='admin-user-detail-field'>
          <span>Reason</span>
          <textarea name='reason' required minLength={3} rows={2} placeholder='Describe the reason for this action...' />
        </label>
        <SubmitButton pending={mutation.isPending}>Record action</SubmitButton>
        {mutation.error ? <p className='field-error'>{mutation.error.message}</p> : null}
      </form>
    </section>
  );
}

function AdminUserActivity({ user }: { user: AdminUserDetailData }) {
  const entries = [
    {
      id: 'account-created',
      title: 'Account created',
      detail: 'User registered on Uni Market',
      timestamp: user.createdAt,
      icon: <UserPlus aria-hidden='true' />,
    },
    ...(new Date(user.updatedAt).getTime() > new Date(user.createdAt).getTime() + 1000
      ? [{
          id: 'account-updated',
          title: 'Account record updated',
          detail: 'Account information or status changed',
          timestamp: user.updatedAt,
          icon: <Activity aria-hidden='true' />,
        }]
      : []),
    ...user.roles.filter((item) => item.role !== 'USER').map((item) => ({
      id: `role-${item.role}`,
      title: `${item.role.replaceAll('_', ' ')} access granted`,
      detail: 'Staff access assignment',
      timestamp: item.createdAt,
      icon: <ShieldCheck aria-hidden='true' />,
    })),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 4);
  return (
    <section className='admin-user-detail-card admin-user-activity-card' aria-labelledby='recent-activity-title'>
      <div className='admin-user-detail-card-heading'>
        <h3 id='recent-activity-title'><Activity aria-hidden='true' />Recent activity</h3>
      </div>
      <ol className='admin-user-timeline'>
        {entries.map((entry) => (
          <li key={entry.id}>
            <span aria-hidden='true'>{entry.icon}</span>
            <div><strong>{entry.title}</strong><small>{entry.detail}</small></div>
            <time dateTime={entry.timestamp}>{formatAdminUserDetailDate(entry.timestamp, true)}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}

function AdminUserAudit({ query, entries }: { query: any; entries: AdminUserAuditEntry[] }) {
  return (
    <section className='admin-user-detail-card admin-user-audit-card' aria-labelledby='user-audit-title'>
      <div className='admin-user-detail-card-heading'>
        <h3 id='user-audit-title'><History aria-hidden='true' />Audit trail</h3>
        <Link to='/admin/audit-logs'>View all</Link>
      </div>
      {query.isLoading ? (
        <p className='admin-user-detail-state'>Loading audit entries...</p>
      ) : query.isError ? (
        <p className='admin-user-detail-state'>Audit entries are unavailable.</p>
      ) : entries.length ? (
        <ol className='admin-user-timeline'>
          {entries.map((entry) => (
            <li key={entry.id}>
              <span aria-hidden='true'><History /></span>
              <div><strong>{formatAdminAction(entry.action)}</strong><small>{entry.internalReason}</small></div>
              <time dateTime={entry.createdAt}>{formatAdminUserDetailDate(entry.createdAt, true)}</time>
            </li>
          ))}
        </ol>
      ) : (
        <p className='admin-user-detail-state'>No admin actions recorded for this user.</p>
      )}
    </section>
  );
}

function AdminUserDetailWorkspace({
  user, isSuperAdmin, auditQuery, action, roles,
}: {
  user: AdminUserDetailData;
  isSuperAdmin: boolean;
  auditQuery: any;
  action: any;
  roles: any;
}) {
  const assignedRoles = user.roles.map((item) => item.role);
  const primaryRole = getPrimaryAdminUserRole(assignedRoles) ?? 'USER';
  const accountStatus = adminUserAccountStatus(user);
  const location = [user.campus, user.institution]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
    .join(' · ');
  const publicProfileAvailable = !user.suspendedAt && !user.deletedAt;
  const auditEntries = (auditQuery.data ?? [])
    .filter((entry: AdminUserAuditEntry) => entry.targetType === 'USER' && entry.targetId === user.id)
    .slice(0, 4);
  return (
    <div className='admin-user-detail-page'>
      <nav className='admin-user-detail-breadcrumb' aria-label='Breadcrumb'>
        <span>Administration</span><ChevronRight aria-hidden='true' />
        <Link to='/admin/users'>Users</Link><ChevronRight aria-hidden='true' />
        <strong>View user</strong>
      </nav>
      <header className='admin-user-detail-heading'>
        <div><h2>User profile</h2><p>Review account details, staff access, and moderation actions.</p></div>
        <div className='admin-user-detail-actions'>
          <Link className='button secondary' to='/admin/users'>
            <ChevronLeft aria-hidden='true' />Back to users
          </Link>
          {publicProfileAvailable ? (
            <Link className='button primary' to={`/seller/${user.id}`}>
              View in marketplace<ExternalLink aria-hidden='true' />
            </Link>
          ) : null}
        </div>
      </header>
      <div className={`admin-user-detail-grid ${isSuperAdmin ? 'has-staff-access' : ''}`}>
        <AdminUserOverview user={user} status={accountStatus} role={primaryRole} location={location} />
        <AdminAccountSignals user={user} status={accountStatus} role={primaryRole} location={location} />
        {isSuperAdmin ? <AdminStaffAccess user={user} mutation={roles} /> : null}
        <AdminModerationActions mutation={action} />
        <AdminUserActivity user={user} />
        {isSuperAdmin ? <AdminUserAudit query={auditQuery} entries={auditEntries} /> : null}
      </div>
    </div>
  );
}

export function AdminUserDetail() {
  const { userId } = useParams();
  const { user: currentUser } = useAuth();
  const client = useQueryClient();
  const isSuperAdmin = Boolean(currentUser?.roles.includes('SUPER_ADMIN'));
  const query = useQuery({
    queryKey: ['admin-user', userId],
    queryFn: () => api<AdminUserDetailData>(`/api/admin/users/${userId}`),
  });
  const auditQuery = useQuery({
    queryKey: ['audit-logs', 'admin-user', userId],
    queryFn: () => api<AdminUserAuditEntry[]>('/api/admin/audit-logs'),
    enabled: isSuperAdmin,
  });
  const action = useMutation({
    mutationFn: ({ action, reason }: { action: string; reason: string }) =>
      api(`/api/admin/users/${userId}/${action}`, {
        method: 'POST',
        ...jsonBody({ reason }),
      }),
    onSuccess: (_data, variables) => {
      toast.success(variables.action === 'suspend' ? 'User suspended' : 'Warning recorded');
      void client.invalidateQueries({ queryKey: ['admin-user', userId] });
      void client.invalidateQueries({ queryKey: ['audit-logs'] });
    },
  });
  const roles = useMutation({
    mutationFn: (data: { roles: string[]; reason: string }) =>
      api(`/api/admin/users/${userId}/roles`, {
        method: 'PUT',
        ...jsonBody(data),
      }),
    onSuccess: () => {
      toast.success('Staff access updated');
      void client.invalidateQueries({ queryKey: ['admin-user', userId] });
      void client.invalidateQueries({ queryKey: ['audit-logs'] });
    },
  });
  return (
    <QueryView query={query}>
      {(user: AdminUserDetailData) => (
        <AdminUserDetailWorkspace
          user={user}
          isSuperAdmin={isSuperAdmin}
          auditQuery={auditQuery}
          action={action}
          roles={roles}
        />
      )}
    </QueryView>
  );
}

type AdminReviewItem = {
  id: string;
  transactionId: string;
  reviewerId: string;
  revieweeId: string;
  rating: number;
  text: string;
  tags: string[];
  hiddenAt: string | null;
  hiddenReason: string | null;
  deletedAt: string | null;
  createdAt: string;
  direction: 'BUYER_TO_SELLER' | 'SELLER_TO_BUYER' | null;
  listing: {
    id: string;
    title: string;
    coverImageUrl: string | null;
  };
  reviewer: {
    id: string;
    displayName: string;
    avatarId: string | null;
  };
};

function adminReviewDirectionLabel(direction: AdminReviewItem['direction']) {
  if (direction === 'BUYER_TO_SELLER') return 'Buyer \u2192 Seller';
  if (direction === 'SELLER_TO_BUYER') return 'Seller \u2192 Buyer';
  return 'Direction unavailable';
}

function adminReviewStatus(review: AdminReviewItem) {
  if (review.deletedAt) return 'DELETED';
  if (review.hiddenAt) return 'HIDDEN';
  return 'VISIBLE';
}

function adminReviewShortId(id: string) {
  return '#' + id.replaceAll('-', '').slice(0, 8).toLocaleUpperCase();
}

function formatAdminReviewDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unavailable';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function AdminReviewStars({ rating }: { rating: number }) {
  return (
    <span className='admin-review-stars' role='img' aria-label={rating + ' out of 5 stars'}>
      {[1, 2, 3, 4, 5].map((value) => (
        <Star aria-hidden='true' className={value <= rating ? 'is-filled' : ''} key={value} />
      ))}
    </span>
  );
}

function AdminReviewRow({
  review,
  onHide,
  pending,
}: {
  review: AdminReviewItem;
  onHide: (review: AdminReviewItem) => void;
  pending: boolean;
}) {
  const status = adminReviewStatus(review);
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <article className='admin-review-row' role='row'>
      <div className='admin-review-primary' role='cell' data-label='Review'>
        <span className='admin-review-listing-image'>
          {review.listing.coverImageUrl && !imageFailed ? (
            <img
              src={review.listing.coverImageUrl}
              alt={review.listing.title}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <ImageIcon aria-hidden='true' />
          )}
        </span>
        <div>
          <strong>{review.listing.title}</strong>
          <p>{review.text}</p>
          {review.tags.length ? (
            <span className='admin-review-tags'>{review.tags.slice(0, 2).join(' · ')}</span>
          ) : null}
        </div>
      </div>
      <div className='admin-review-rating' role='cell' data-label='Rating'>
        <AdminReviewStars rating={review.rating} />
      </div>
      <div className='admin-review-exchange' role='cell' data-label='Exchange'>
        <strong>Verified exchange</strong>
        <span>{adminReviewShortId(review.transactionId)}</span>
      </div>
      <div className='admin-review-direction' role='cell' data-label='Review type'>
        <span data-direction={review.direction ?? 'UNKNOWN'}>{adminReviewDirectionLabel(review.direction)}</span>
      </div>
      <div className='admin-review-reviewer' role='cell' data-label='Reviewed by'>
        <UserAvatar
          avatarId={review.reviewer.avatarId}
          displayName={review.reviewer.displayName}
          size={35}
          className='admin-review-avatar'
        />
        <div>
          <strong>{review.reviewer.displayName}</strong>
          <span>{adminReviewShortId(review.reviewerId)}</span>
        </div>
      </div>
      <time className='admin-review-date' role='cell' data-label='Date' dateTime={review.createdAt}>
        {formatAdminReviewDate(review.createdAt)}
      </time>
      <div className='admin-review-status' role='cell' data-label='Status'>
        <span data-status={status}>{status}</span>
      </div>
      <div className='admin-review-action' role='cell' data-label='Action'>
        {status === 'VISIBLE' ? (
          <button type='button' onClick={() => onHide(review)} disabled={pending}>
            <CircleX aria-hidden='true' />Hide review
          </button>
        ) : (
          <span className='admin-review-no-action'>No action available</span>
        )}
      </div>
    </article>
  );
}

export function AdminReviews() {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const query = useQuery({
    queryKey: ['admin-reviews'],
    queryFn: () => api<AdminReviewItem[]>('/api/admin/reviews'),
  });
  const hide = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api(`/api/admin/reviews/${id}/hide`, {
        method: 'POST',
        ...jsonBody({ reason }),
      }),
    onSuccess: () => {
      toast.success('Review hidden');
      void client.invalidateQueries({ queryKey: ['admin-reviews'] });
      void client.invalidateQueries({ queryKey: ['audit-logs'] });
    },
  });

  const rows = useMemo(() => query.data ?? [], [query.data]);
  const ratingFilter = params.get('rating') ?? 'ALL';
  const statusFilter = params.get('status') ?? 'ALL';
  const directionFilter = params.get('direction') ?? 'ALL';
  const reviewerFilter = params.get('reviewer') ?? 'ALL';
  const searchQuery = params.get('q') ?? '';
  const sortOrder = params.get('sort') ?? 'newest';
  const reviewerOptions = useMemo(
    () => [...new Set(rows.map((review) => review.reviewerId))]
      .map((id) => rows.find((review) => review.reviewerId === id)!.reviewer)
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [rows],
  );
  const filteredRows = useMemo(() => {
    const needle = searchQuery.trim().toLocaleLowerCase();
    return rows
      .filter((review) => {
        const matchesRating = ratingFilter === 'ALL' || String(review.rating) === ratingFilter;
        const matchesStatus = statusFilter === 'ALL' || adminReviewStatus(review) === statusFilter;
        const matchesDirection = directionFilter === 'ALL' || review.direction === directionFilter;
        const matchesReviewer = reviewerFilter === 'ALL' || review.reviewerId === reviewerFilter;
        const haystack = [
          review.text,
          review.tags.join(' '),
          review.id,
          review.transactionId,
          review.reviewerId,
          review.reviewer.displayName,
          review.listing.title,
          adminReviewDirectionLabel(review.direction),
        ].join(' ').toLocaleLowerCase();
        return matchesRating && matchesStatus && matchesDirection && matchesReviewer && (!needle || haystack.includes(needle));
      })
      .sort((a, b) => {
        if (sortOrder === 'oldest') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        if (sortOrder === 'rating-high') return b.rating - a.rating;
        if (sortOrder === 'rating-low') return a.rating - b.rating;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [directionFilter, ratingFilter, reviewerFilter, rows, searchQuery, sortOrder, statusFilter]);

  const updateFilter = (name: string, value: string, defaultValue = 'ALL') => {
    const next = new URLSearchParams(params);
    if (value === defaultValue || !value) next.delete(name);
    else next.set(name, value);
    setParams(next, { replace: true });
  };
  const clearFilters = () => setParams({}, { replace: true });
  const filtersActive = Boolean(searchQuery || ratingFilter !== 'ALL' || statusFilter !== 'ALL' || directionFilter !== 'ALL' || reviewerFilter !== 'ALL');
  const hiddenCount = rows.filter((review) => adminReviewStatus(review) === 'HIDDEN').length;
  const buyerToSellerCount = rows.filter((review) => review.direction === 'BUYER_TO_SELLER').length;
  const sellerToBuyerCount = rows.filter((review) => review.direction === 'SELLER_TO_BUYER').length;
  const metrics: Array<{
    icon: typeof Star;
    value: string | number;
    label: string;
    helper: string;
    tone: string;
  }> = [
    { icon: Star, value: rows.length, label: 'Total reviews', helper: 'Across all verified exchanges', tone: 'plum' },
    { icon: Package, value: buyerToSellerCount, label: 'Buyer \u2192 Seller', helper: 'Seller-reputation reviews', tone: 'success' },
    { icon: UserRound, value: sellerToBuyerCount, label: 'Seller \u2192 Buyer', helper: 'Buyer-reputation reviews', tone: 'neutral' },
    { icon: CircleX, value: hiddenCount, label: 'Hidden', helper: 'Removed by moderation', tone: 'warning' },
  ];
  const hideReview = (review: AdminReviewItem) => {
    const reason = window.prompt('Reason for hiding this review?');
    if (reason?.trim()) hide.mutate({ id: review.id, reason: reason.trim() });
  };

  return (
    <div className='admin-reviews-page'>
      <header className='admin-reviews-heading'>
        <h2>Reviews</h2>
        <p>Monitor marketplace reviews to ensure a safe, fair, and trustworthy community.</p>
      </header>
      {query.isLoading ? (
        <Loading variant='table' label='Loading reviews' />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          <section className='admin-review-metrics' aria-label='Review summary'>
            {metrics.map(({ icon: Icon, value, label, helper, tone }) => (
              <article className={'admin-review-metric is-' + tone} key={label}>
                <span className='admin-review-metric-icon' aria-hidden='true'><Icon /></span>
                <p><strong>{value}</strong><span>{label}</span><small>{helper}</small></p>
              </article>
            ))}
          </section>
          <section className='admin-review-filters' aria-labelledby='admin-review-filters-title'>
            <div className='admin-review-filter-heading'>
              <div>
                <span aria-hidden='true'><SlidersHorizontal /></span>
                <div><h3 id='admin-review-filters-title'>Filters</h3><p>Find specific reviews by rating, visibility, reviewer, or keyword.</p></div>
              </div>
              <button type='button' onClick={clearFilters} disabled={!filtersActive}>
                <RotateCcw aria-hidden='true' />Clear filters
              </button>
            </div>
            <div className='admin-review-filter-grid'>
              <label><span>Rating</span><select aria-label='Rating' value={ratingFilter} onChange={(event) => updateFilter('rating', event.target.value)}>
                <option value='ALL'>All ratings</option>
                {[5, 4, 3, 2, 1].map((rating) => <option value={rating} key={rating}>{rating} stars</option>)}
              </select></label>
              <label><span>Status</span><select aria-label='Status' value={statusFilter} onChange={(event) => updateFilter('status', event.target.value)}>
                <option value='ALL'>All statuses</option><option value='VISIBLE'>Visible</option><option value='HIDDEN'>Hidden</option><option value='DELETED'>Deleted</option>
              </select></label>
              <label><span>Review type</span><select aria-label='Review type' value={directionFilter} onChange={(event) => updateFilter('direction', event.target.value)}>
                <option value='ALL'>All reviews</option><option value='BUYER_TO_SELLER'>{'Buyer \u2192 Seller'}</option><option value='SELLER_TO_BUYER'>{'Seller \u2192 Buyer'}</option>
              </select></label>
              <label><span>Reviewer</span><select aria-label='Reviewer' value={reviewerFilter} onChange={(event) => updateFilter('reviewer', event.target.value)}>
                <option value='ALL'>All reviewers</option>
                {reviewerOptions.map((reviewer) => <option value={reviewer.id} key={reviewer.id}>{reviewer.displayName}</option>)}
              </select></label>
              <label className='admin-review-search'><span>Search</span><span className='admin-review-search-control'><Search aria-hidden='true' /><input type='search' aria-label='Search' value={searchQuery} onChange={(event) => updateFilter('q', event.target.value, '')} placeholder='Search by keyword (review, user, exchange...)' /></span></label>
            </div>
          </section>
          <div className='admin-review-list-heading'>
            <h3>Reviews ({filteredRows.length})</h3>
            <label><span>Sort by</span><select aria-label='Sort by' value={sortOrder} onChange={(event) => updateFilter('sort', event.target.value, 'newest')}>
              <option value='newest'>Newest first</option><option value='oldest'>Oldest first</option><option value='rating-high'>Highest rating</option><option value='rating-low'>Lowest rating</option>
            </select></label>
          </div>
          {filteredRows.length ? (
            <div className='admin-review-table' role='table' aria-label='Reviews'>
              <div className='admin-review-table-head' role='row'>
                <span role='columnheader'>Review</span><span role='columnheader'>Rating</span><span role='columnheader'>Exchange</span><span role='columnheader'>Review type</span><span role='columnheader'>Reviewed by</span><span role='columnheader'>Date</span><span role='columnheader'>Status</span><span role='columnheader'>Action</span>
              </div>
              {filteredRows.map((review) => <AdminReviewRow review={review} onHide={hideReview} pending={hide.isPending} key={review.id} />)}
            </div>
          ) : (
            <section className='admin-review-empty'>
              <Star aria-hidden='true' /><h3>{directionFilter !== 'ALL' ? 'No reviews match this direction.' : 'No reviews found'}</h3>
              <p>{filtersActive ? 'Try adjusting or clearing your filters.' : 'There are no reviews to moderate.'}</p>
            </section>
          )}
          <p className='admin-review-count'>Showing {filteredRows.length} of {rows.length} reviews</p>
        </>
      )}
    </div>
  );
}

type AdminSupportProfile = {
  id: string;
  displayName: string;
  avatarId: string | null;
};

type AdminSupportTicket = {
  id: string;
  userId: string;
  category: string;
  subject: string;
  description: string;
  status: 'OPEN' | 'ASSIGNED' | 'WAITING_FOR_USER' | 'RESOLVED' | 'CLOSED';
  assignedTo: string | null;
  referenceType: string | null;
  referenceId: string | null;
  escalatedReportId: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  requester: AdminSupportProfile;
  assignee: AdminSupportProfile | null;
};

function adminSupportLabel(value: string) {
  return value.replaceAll('_', ' ').toLocaleLowerCase().replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());
}

function adminSupportShortId(value: string) {
  return '#' + value.replaceAll('-', '').slice(0, 10).toLocaleUpperCase();
}

function formatAdminSupportDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unavailable';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date);
}

function formatAdminSupportRelative(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Unknown update';
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function AdminSupportIdentity({
  id,
  profile,
  currentUser,
  assignee = false,
}: {
  id: string | null;
  profile: AdminSupportProfile | null;
  currentUser: ReturnType<typeof useAuth>['user'];
  assignee?: boolean;
}) {
  if (!id) {
    return <span className='admin-support-identity is-unassigned'><span aria-hidden='true'><UserRound /></span><strong>Unassigned</strong></span>;
  }
  if (currentUser?.id === id) {
    return (
      <span className='admin-support-identity'>
        <UserAvatar avatarId={currentUser.avatarId} displayName={currentUser.displayName} size={32} decorative />
        <strong>You</strong>
      </span>
    );
  }
  if (profile) {
    return (
      <span className='admin-support-identity'>
        <UserAvatar avatarId={profile.avatarId} displayName={profile.displayName} size={32} decorative />
        <strong>{profile.displayName}</strong>
      </span>
    );
  }
  return (
    <span className='admin-support-identity'>
      <span aria-hidden='true'><UserRound /></span>
      <strong>{assignee ? 'Assigned staff' : `User ${adminSupportShortId(id)}`}</strong>
    </span>
  );
}

function AdminSupportRow({ ticket, currentUser }: { ticket: AdminSupportTicket; currentUser: ReturnType<typeof useAuth>['user'] }) {
  return (
    <article className='admin-support-row' role='row'>
      <div className='admin-support-primary' role='cell' data-label='Ticket / subject'>
        <span className='admin-support-ticket-icon' aria-hidden='true'><Headphones /></span>
        <div><strong>{ticket.subject}</strong><span>{adminSupportShortId(ticket.id)}</span></div>
      </div>
      <div className='admin-support-category' role='cell' data-label='Category'>{adminSupportLabel(ticket.category)}</div>
      <div role='cell' data-label='Requester'><AdminSupportIdentity id={ticket.userId} profile={ticket.requester} currentUser={currentUser} /></div>
      <time className='admin-support-updated' role='cell' data-label='Last updated' dateTime={ticket.updatedAt}>
        <strong>{formatAdminSupportRelative(ticket.updatedAt)}</strong><span>{formatAdminSupportDate(ticket.updatedAt)}</span>
      </time>
      <div className='admin-support-status' role='cell' data-label='Status'><StatusBadge value={ticket.status} /></div>
      <div role='cell' data-label='Assigned to'><AdminSupportIdentity id={ticket.assignedTo} profile={ticket.assignee} currentUser={currentUser} assignee /></div>
      <div className='admin-support-action' role='cell'>
        <Link to={`/admin/support/${ticket.id}`}>{ticket.status === 'WAITING_FOR_USER' ? 'Open thread' : 'View'}<ArrowRight aria-hidden='true' /></Link>
      </div>
    </article>
  );
}

export function AdminSupport() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const query = useQuery({
    queryKey: ['admin-support'],
    queryFn: () => api<AdminSupportTicket[]>('/api/admin/support'),
  });
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const statusFilter = params.get('status') ?? 'ALL';
  const categoryFilter = params.get('category') ?? 'ALL';
  const assigneeFilter = params.get('assignee') ?? 'ALL';
  const searchQuery = params.get('q') ?? '';
  const sortOrder = params.get('sort') ?? 'updated-newest';
  const categories = useMemo(() => [...new Set(rows.map((ticket) => ticket.category))].sort(), [rows]);
  const filteredRows = useMemo(() => {
    const needle = searchQuery.trim().toLocaleLowerCase();
    return rows.filter((ticket) => {
      const statusMatches = statusFilter === 'ALL' || ticket.status === statusFilter;
      const categoryMatches = categoryFilter === 'ALL' || ticket.category === categoryFilter;
      const assigneeMatches = assigneeFilter === 'ALL'
        || (assigneeFilter === 'UNASSIGNED' && !ticket.assignedTo)
        || (assigneeFilter === 'MINE' && ticket.assignedTo === user?.id)
        || (assigneeFilter === 'ASSIGNED' && Boolean(ticket.assignedTo));
      const searchMatches = !needle || [ticket.id, ticket.subject, ticket.userId, ticket.requester.displayName, ticket.assignee?.displayName ?? ''].join(' ').toLocaleLowerCase().includes(needle);
      return statusMatches && categoryMatches && assigneeMatches && searchMatches;
    }).sort((left, right) => {
      if (sortOrder === 'created-oldest') return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      if (sortOrder === 'created-newest') return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      if (sortOrder === 'updated-oldest') return new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime();
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
  }, [assigneeFilter, categoryFilter, rows, searchQuery, sortOrder, statusFilter, user?.id]);
  const updateFilter = (name: string, value: string, defaultValue = 'ALL') => {
    const next = new URLSearchParams(params);
    if (!value || value === defaultValue) next.delete(name);
    else next.set(name, value);
    setParams(next, { replace: true });
  };
  const filtersActive = Boolean(searchQuery || statusFilter !== 'ALL' || categoryFilter !== 'ALL' || assigneeFilter !== 'ALL' || sortOrder !== 'updated-newest');
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const metrics = [
    { icon: Headphones, value: rows.filter((ticket) => ticket.status === 'OPEN' || ticket.status === 'ASSIGNED').length, label: 'Open tickets', helper: 'Needs attention from your team', tone: 'plum' },
    { icon: Clock3, value: rows.filter((ticket) => ticket.status === 'WAITING_FOR_USER').length, label: 'Waiting for user', helper: 'Awaiting a response', tone: 'warning' },
    { icon: CheckCircle2, value: rows.filter((ticket) => ticket.resolvedAt && new Date(ticket.resolvedAt) >= startOfToday).length, label: 'Resolved today', helper: 'Completed today', tone: 'success' },
    { icon: UserRound, value: rows.filter((ticket) => !ticket.assignedTo).length, label: 'Unassigned', helper: 'Available for support staff', tone: 'neutral' },
  ];
  return (
    <div className='admin-support-page'>
      <header className='admin-support-heading'><h2>Support</h2><p>Manage student support requests, replies, and resolution flow from one place.</p></header>
      {query.isLoading ? <Loading variant='table' label='Loading support queue' /> : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          <section className='admin-support-metrics' aria-label='Support summary'>
            {metrics.map(({ icon: Icon, value, label, helper, tone }) => (
              <article className={`admin-support-metric is-${tone}`} key={label}><span aria-hidden='true'><Icon /></span><p><strong>{value}</strong><b>{label}</b><small>{helper}</small></p></article>
            ))}
          </section>
          <section className='admin-support-filters' aria-labelledby='admin-support-filters-title'>
            <div className='admin-support-filter-heading'><div><SlidersHorizontal aria-hidden='true' /><span><h3 id='admin-support-filters-title'>Filters</h3><p>Refine the queue to find tickets faster.</p></span></div><button type='button' disabled={!filtersActive} onClick={() => setParams({}, { replace: true })}><RotateCcw aria-hidden='true' />Clear filters</button></div>
            <div className='admin-support-filter-grid'>
              <label><span>Status</span><select aria-label='Status' value={statusFilter} onChange={(event) => updateFilter('status', event.target.value)}><option value='ALL'>All statuses</option>{['OPEN', 'ASSIGNED', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED'].map((status) => <option value={status} key={status}>{adminSupportLabel(status)}</option>)}</select></label>
              <label><span>Category</span><select aria-label='Category' value={categoryFilter} onChange={(event) => updateFilter('category', event.target.value)}><option value='ALL'>All categories</option>{categories.map((category) => <option value={category} key={category}>{adminSupportLabel(category)}</option>)}</select></label>
              <label><span>Assigned to</span><select aria-label='Assigned to' value={assigneeFilter} onChange={(event) => updateFilter('assignee', event.target.value)}><option value='ALL'>All assignments</option><option value='UNASSIGNED'>Unassigned</option><option value='MINE'>Assigned to me</option><option value='ASSIGNED'>Any assigned staff</option></select></label>
              <label className='admin-support-search'><span>Search</span><span><Search aria-hidden='true' /><input type='search' aria-label='Search' value={searchQuery} onChange={(event) => updateFilter('q', event.target.value, '')} placeholder='Search by ticket ID, subject, or user...' /></span></label>
            </div>
          </section>
          <div className='admin-support-list-heading'><h3>Support queue ({filteredRows.length})</h3><label><span>Sort by</span><select aria-label='Sort by' value={sortOrder} onChange={(event) => updateFilter('sort', event.target.value, 'updated-newest')}><option value='updated-newest'>Recently updated</option><option value='updated-oldest'>Least recently updated</option><option value='created-newest'>Newest first</option><option value='created-oldest'>Oldest first</option></select></label></div>
          {filteredRows.length ? (
            <div className='admin-support-table' role='table' aria-label='Support queue'><div className='admin-support-table-head' role='row'><span role='columnheader'>Ticket / subject</span><span role='columnheader'>Category</span><span role='columnheader'>Requester</span><span role='columnheader'>Last updated</span><span role='columnheader'>Status</span><span role='columnheader'>Assigned to</span><span role='columnheader'>Action</span></div>{filteredRows.map((ticket) => <AdminSupportRow ticket={ticket} currentUser={user} key={ticket.id} />)}</div>
          ) : (
            <section className='admin-support-empty'><Headphones aria-hidden='true' /><h3>{rows.length ? 'No tickets match your filters' : 'No support requests'}</h3><p>{rows.length ? 'Try adjusting or clearing your filters.' : 'Everything is caught up.'}</p></section>
          )}
          <p className='admin-support-count'>Showing {filteredRows.length} of {rows.length} tickets</p>
        </>
      )}
    </div>
  );
}
export function AdminSupportDetail() {
  const { ticketId } = useParams();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["admin-support", ticketId],
    queryFn: () => api<any>(`/api/admin/support/${ticketId}`),
  });
  const reply = useMutation({
    mutationFn: (data: any) =>
      api(`/api/admin/support/${ticketId}/reply`, {
        method: "POST",
        ...jsonBody(data),
      }),
    onSuccess: () => {
      toast.success("Reply sent");
      void client.invalidateQueries({ queryKey: ["admin-support", ticketId] });
    },
  });
  const escalate = useMutation({
    mutationFn: (reason: string) =>
      api(`/api/admin/support/${ticketId}/escalate`, {
        method: "POST",
        ...jsonBody({ reason }),
      }),
    onSuccess: () => toast.success("Ticket escalated"),
  });
  return (
    <QueryView query={query}>
      {(t) => (
        <div className="stack">
          <Link to="/admin/support">← Support queue</Link>
          <div className="row between">
            <h2>{t.subject}</h2>
            <StatusBadge value={t.status} />
          </div>
          <p>{t.description}</p>
          {t.messages.map((m: any) => (
            <article className="panel" key={m.id}>
              <p>{m.body}</p>
              {m.internal ? <StatusBadge value="INTERNAL" /> : null}
            </article>
          ))}
          <form
            className="panel form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              reply.mutate({
                body: String(f.get("body")),
                status: String(f.get("status")),
                internal: Boolean(f.get("internal")),
              });
            }}
          >
            <label className="field">
              <span>Reply</span>
              <textarea name="body" required />
            </label>
            <label className="field">
              <span>New status</span>
              <select name="status">
                <option value="WAITING_FOR_USER">Waiting for user</option>
                <option value="ASSIGNED">Assigned</option>
                <option value="RESOLVED">Resolved</option>
              </select>
            </label>
            <label className="row">
              <input type="checkbox" name="internal" />
              Internal note (not visible to user)
            </label>
            <SubmitButton pending={reply.isPending}>Send reply</SubmitButton>
          </form>
          <button
            className="button danger"
            onClick={() => {
              const reason = window.prompt(
                "Why should moderation review this?",
              );
              if (reason) escalate.mutate(reason);
            }}
          >
            Escalate to moderator
          </button>
        </div>
      )}
    </QueryView>
  );
}

type AdminAuditLog = {
  id: string;
  adminId: string;
  role: string;
  action: string;
  targetType: string;
  targetId: string;
  previousState: unknown;
  newState: unknown;
  internalReason: string;
  userVisibleReason: string | null;
  requestId: string;
  ipHash: string | null;
  createdAt: string;
};

function adminAuditLabel(value: string) {
  return value.replaceAll('_', ' ').toLocaleLowerCase().replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());
}

function adminAuditShortId(value: string) {
  const normalized = value.replaceAll('-', '');
  return normalized.length > 8 ? normalized.slice(0, 8).toLocaleUpperCase() : value;
}

function formatAdminAuditTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { date: 'Unavailable', time: '' };
  return {
    date: new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(date),
    time: new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(date),
  };
}

function AdminAuditActionIcon({ action }: { action: string }) {
  const normalized = action.toLocaleUpperCase();
  if (normalized.includes('APPROVE') || normalized.includes('ACKNOWLEDG')) return <CheckCircle2 />;
  if (normalized.includes('DELETE') || normalized.includes('REMOVE') || normalized.includes('REJECT')) return <Trash2 />;
  if (normalized.includes('ROLE') || normalized.includes('PERMISSION') || normalized.includes('SUSPEND')) return <ShieldAlert />;
  if (normalized.includes('VIEW')) return <Search />;
  return <History />;
}

function AdminAuditRow({ entry }: { entry: AdminAuditLog }) {
  const timestamp = formatAdminAuditTime(entry.createdAt);
  return (
    <article className='admin-audit-row' role='row'>
      <time className='admin-audit-time' role='cell' data-label='Time' dateTime={entry.createdAt}><strong>{timestamp.date}</strong><span>{timestamp.time}</span></time>
      <div className='admin-audit-action-name' role='cell' data-label='Action'>
        <span data-action={entry.action} aria-hidden='true'><AdminAuditActionIcon action={entry.action} /></span>
        <div><strong>{entry.action}</strong><small>{adminAuditLabel(entry.action)}</small></div>
      </div>
      <div className='admin-audit-target' role='cell' data-label='Target'><strong>{entry.targetType}</strong><span title={entry.targetId}>{adminAuditShortId(entry.targetId)}</span></div>
      <div className='admin-audit-role' role='cell' data-label='Role'><span>{entry.role}</span></div>
      <div className='admin-audit-reason' role='cell' data-label='Reason' title={entry.internalReason}>{entry.internalReason}</div>
      <div className='admin-audit-request' role='cell' data-label='Request'><code title={entry.requestId}>{entry.requestId}</code></div>
    </article>
  );
}

export function AuditLogs() {
  const [params, setParams] = useSearchParams();
  const query = useQuery({
    queryKey: ['audit-logs'],
    queryFn: () => api<AdminAuditLog[]>('/api/admin/audit-logs'),
  });
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const actionFilter = params.get('action') ?? 'ALL';
  const targetFilter = params.get('target') ?? 'ALL';
  const roleFilter = params.get('role') ?? 'ALL';
  const searchQuery = params.get('q') ?? '';
  const sortOrder = params.get('sort') ?? 'newest';
  const actions = useMemo(() => [...new Set(rows.map((entry) => entry.action))].sort(), [rows]);
  const targets = useMemo(() => [...new Set(rows.map((entry) => entry.targetType))].sort(), [rows]);
  const roles = useMemo(() => [...new Set(rows.map((entry) => entry.role))].sort(), [rows]);
  const filteredRows = useMemo(() => {
    const needle = searchQuery.trim().toLocaleLowerCase();
    return rows.filter((entry) => {
      const matchesAction = actionFilter === 'ALL' || entry.action === actionFilter;
      const matchesTarget = targetFilter === 'ALL' || entry.targetType === targetFilter;
      const matchesRole = roleFilter === 'ALL' || entry.role === roleFilter;
      const haystack = [entry.action, entry.targetType, entry.targetId, entry.role, entry.internalReason, entry.userVisibleReason ?? '', entry.requestId, entry.adminId].join(' ').toLocaleLowerCase();
      return matchesAction && matchesTarget && matchesRole && (!needle || haystack.includes(needle));
    }).sort((left, right) => {
      const difference = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      return sortOrder === 'oldest' ? difference : -difference;
    });
  }, [actionFilter, roleFilter, rows, searchQuery, sortOrder, targetFilter]);
  const updateFilter = (name: string, value: string, defaultValue = 'ALL') => {
    const next = new URLSearchParams(params);
    if (!value || value === defaultValue) next.delete(name);
    else next.set(name, value);
    setParams(next, { replace: true });
  };
  const filtersActive = Boolean(searchQuery || actionFilter !== 'ALL' || targetFilter !== 'ALL' || roleFilter !== 'ALL' || sortOrder !== 'newest');
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const metrics = [
    { icon: History, value: rows.length, label: 'Total actions', helper: 'Loaded immutable records', tone: 'plum' },
    { icon: Users, value: new Set(rows.map((entry) => entry.adminId)).size, label: 'Unique admins', helper: 'Performed loaded actions', tone: 'success' },
    { icon: Clock3, value: rows.filter((entry) => new Date(entry.createdAt) >= startOfToday).length, label: 'Actions today', helper: 'Since 12:00 AM', tone: 'warning' },
    { icon: Tags, value: targets.length, label: 'Target types', helper: 'Recorded entity categories', tone: 'neutral' },
  ];
  return (
    <div className='admin-audit-page'>
      <header className='admin-audit-heading'><h2>Audit logs</h2><p>Track important actions across the platform for transparency and security.</p></header>
      {query.isLoading ? <Loading variant='table' label='Loading audit logs' /> : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          <section className='admin-audit-metrics' aria-label='Audit summary'>
            {metrics.map(({ icon: Icon, value, label, helper, tone }) => <article className={`admin-audit-metric is-${tone}`} key={label}><span aria-hidden='true'><Icon /></span><p><strong>{value}</strong><b>{label}</b><small>{helper}</small></p></article>)}
          </section>
          <section className='admin-audit-filters' aria-labelledby='admin-audit-filters-title'>
            <div className='admin-audit-filter-heading'><div><SlidersHorizontal aria-hidden='true' /><span><h3 id='admin-audit-filters-title'>Filters</h3><p>Find specific audit logs by action, target, role, or keyword.</p></span></div><button type='button' disabled={!filtersActive} onClick={() => setParams({}, { replace: true })}><RotateCcw aria-hidden='true' />Clear filters</button></div>
            <div className='admin-audit-filter-grid'>
              <label><span>Action</span><select aria-label='Action' value={actionFilter} onChange={(event) => updateFilter('action', event.target.value)}><option value='ALL'>All actions</option>{actions.map((action) => <option value={action} key={action}>{action}</option>)}</select></label>
              <label><span>Target type</span><select aria-label='Target type' value={targetFilter} onChange={(event) => updateFilter('target', event.target.value)}><option value='ALL'>All targets</option>{targets.map((target) => <option value={target} key={target}>{target}</option>)}</select></label>
              <label><span>Role</span><select aria-label='Role' value={roleFilter} onChange={(event) => updateFilter('role', event.target.value)}><option value='ALL'>All roles</option>{roles.map((role) => <option value={role} key={role}>{role}</option>)}</select></label>
              <label className='admin-audit-search'><span>Search</span><span><Search aria-hidden='true' /><input type='search' aria-label='Search' value={searchQuery} onChange={(event) => updateFilter('q', event.target.value, '')} placeholder='Search by keyword (action, reason, request...)' /></span></label>
            </div>
          </section>
          <div className='admin-audit-list-heading'><h3>Audit log ({filteredRows.length})</h3><label><span>Sort by</span><select aria-label='Sort by' value={sortOrder} onChange={(event) => updateFilter('sort', event.target.value, 'newest')}><option value='newest'>Newest first</option><option value='oldest'>Oldest first</option></select></label></div>
          {filteredRows.length ? (
            <div className='admin-audit-table' role='table' aria-label='Audit logs'><div className='admin-audit-table-head' role='row'><span role='columnheader'>Time</span><span role='columnheader'>Action</span><span role='columnheader'>Target</span><span role='columnheader'>Role</span><span role='columnheader'>Reason</span><span role='columnheader'>Request</span></div>{filteredRows.map((entry) => <AdminAuditRow entry={entry} key={entry.id} />)}</div>
          ) : (
            <section className='admin-audit-empty'><History aria-hidden='true' /><h3>No audit logs found</h3><p>{rows.length ? 'Try adjusting or clearing your filters.' : 'No administrative actions have been recorded.'}</p></section>
          )}
          <p className='admin-audit-count'>Showing {filteredRows.length} of {rows.length} loaded logs</p>
        </>
      )}
    </div>
  );
}

type AdminCategoryRecord = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  sortOrder: number;
};

type AdminProhibitedTermRecord = {
  id: string;
  term: string;
  severity: "FLAG" | "BLOCK";
  active: boolean;
};

function AdminCategoryIcon({ category }: { category: AdminCategoryRecord }) {
  const value = `${category.slug} ${category.name}`.toLowerCase();
  const Icon = value.match(/book|note|academic|study/) ? BookOpen
    : value.match(/electronic|computer|phone|tech/) ? Monitor
      : value.match(/furniture|desk|chair/) ? Armchair
        : value.match(/cycle|bike|transport/) ? Bike
          : value.match(/cloth|fashion|wear/) ? Shirt
            : value.match(/sport|fitness|gym/) ? Dumbbell
              : value.match(/room|home|essential/) ? LampDesk
                : value.match(/other|misc/) ? Shapes
                  : Package;
  return <Icon />;
}

function AdminCategoryRow({
  category,
  pending,
  onToggle,
}: {
  category: AdminCategoryRecord;
  pending: boolean;
  onToggle: () => void;
}) {
  return (
    <article className="admin-category-row" role="row">
      <div className="admin-category-order" role="cell" data-label="Order">
        <span>{category.sortOrder}</span>
      </div>
      <div className="admin-category-name" role="cell" data-label="Name">
        <span aria-hidden="true"><AdminCategoryIcon category={category} /></span>
        <strong>{category.name}</strong>
      </div>
      <div className="admin-category-slug" role="cell" data-label="Slug">
        <code>{category.slug}</code>
      </div>
      <div className="admin-category-status" role="cell" data-label="Status">
        <StatusBadge value={category.active ? "ACTIVE" : "DISABLED"} />
      </div>
      <div className="admin-category-actions" role="cell" data-label="Actions">
        <button
          type="button"
          className="button small secondary"
          disabled={pending}
          onClick={onToggle}
          aria-label={`${category.active ? "Disable" : "Enable"} ${category.name}`}
        >
          {pending ? "Saving..." : category.active ? "Disable" : "Enable"}
        </button>
      </div>
    </article>
  );
}

function AdminProhibitedTermRow({
  term,
  pending,
  onToggle,
}: {
  term: AdminProhibitedTermRecord;
  pending: boolean;
  onToggle: () => void;
}) {
  return (
    <article className="admin-term-row" role="row">
      <div className="admin-term-name" role="cell" data-label="Term or phrase">
        <strong>{term.term}</strong>
      </div>
      <div className="admin-term-enforcement" role="cell" data-label="Enforcement">
        <StatusBadge value={term.severity} />
      </div>
      <div className="admin-term-status" role="cell" data-label="Status">
        <StatusBadge value={term.active ? "ACTIVE" : "DISABLED"} />
      </div>
      <div className="admin-term-actions" role="cell" data-label="Actions">
        <button
          type="button"
          className="button small secondary"
          disabled={pending}
          onClick={onToggle}
          aria-label={`${term.active ? "Disable" : "Enable"} ${term.term}`}
        >
          {pending ? "Saving..." : term.active ? "Disable" : "Enable"}
        </button>
      </div>
    </article>
  );
}

export function AdminCategories() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["admin-categories"],
    queryFn: () => api<AdminCategoryRecord[]>("/api/admin/categories"),
  });
  const terms = useQuery({
    queryKey: ["admin-prohibited-terms"],
    queryFn: () => api<AdminProhibitedTermRecord[]>("/api/admin/prohibited-terms"),
  });
  const create = useMutation({
    mutationFn: (data: { name: string; slug: string; sortOrder: number }) =>
      api("/api/admin/categories", { method: "POST", ...jsonBody(data) }),
    onSuccess: () => {
      toast.success("Category added");
      void client.invalidateQueries({ queryKey: ["admin-categories"] });
      void client.invalidateQueries({ queryKey: ["categories"] });
    },
  });
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api(`/api/admin/categories/${id}`, {
        method: "PATCH",
        ...jsonBody({ active }),
      }),
    onSuccess: (_data, variables) => {
      toast.success(variables.active ? "Category enabled" : "Category disabled");
      void client.invalidateQueries({ queryKey: ["admin-categories"] });
      void client.invalidateQueries({ queryKey: ["categories"] });
    },
  });
  const createTerm = useMutation({
    mutationFn: ({ term, severity }: { term: string; severity: string }) =>
      api("/api/admin/prohibited-terms", {
        method: "POST",
        ...jsonBody({ term, severity }),
      }),
    onSuccess: () => {
      toast.success("Prohibited term added");
      void client.invalidateQueries({ queryKey: ["admin-prohibited-terms"] });
    },
  });
  const toggleTerm = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api(`/api/admin/prohibited-terms/${id}`, {
        method: "PATCH",
        ...jsonBody({ active }),
      }),
    onSuccess: (_data, variables) => {
      toast.success(variables.active ? "Term enabled" : "Term disabled");
      void client.invalidateQueries({ queryKey: ["admin-prohibited-terms"] });
    },
  });
  const categories = query.data ?? [];
  const prohibitedTerms = terms.data ?? [];
  const activeCategories = categories.filter((category) => category.active).length;
  const metrics = [
    { icon: Tags, value: categories.length, label: "Total categories", helper: "Organize marketplace listings", tone: "plum" },
    { icon: CheckCircle2, value: activeCategories, label: "Active categories", helper: "Visible to users", tone: "success" },
    { icon: CircleX, value: categories.length - activeCategories, label: "Disabled categories", helper: "Hidden from listing form", tone: "disabled" },
  ];

  return (
    <div className="admin-categories-page">
      <header className="admin-categories-heading">
        <nav aria-label="Breadcrumb"><span>Administration</span><span aria-hidden="true">/</span><strong>Categories</strong></nav>
        <h2>Categories</h2>
        <p>Manage listing categories and content filters for Uni Market.</p>
      </header>

      {query.isLoading ? <Loading variant="metrics" label="Loading categories" /> : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          <section className="admin-category-metrics" aria-label="Category summary">
            {metrics.map(({ icon: Icon, value, label, helper, tone }) => (
              <article className={`admin-category-metric is-${tone}`} key={label}>
                <span aria-hidden="true"><Icon /></span>
                <p><strong>{value}</strong><b>{label}</b><small>{helper}</small></p>
              </article>
            ))}
          </section>

          <section className="admin-category-table-card" aria-labelledby="admin-category-list-title">
            <header>
              <h3 id="admin-category-list-title">Categories ({categories.length})</h3>
              <p>Active categories appear in All categories and the listing form. The homepage shows the first 8, or the first 5 on mobile, in sort order.</p>
            </header>
            {categories.length ? (
              <div className="admin-category-table" role="table" aria-label="Categories">
                <div className="admin-category-table-head" role="row">
                  <span role="columnheader">Order</span>
                  <span role="columnheader">Name</span>
                  <span role="columnheader">Slug</span>
                  <span role="columnheader">Status</span>
                  <span role="columnheader">Actions</span>
                </div>
                {categories.map((category) => (
                  <AdminCategoryRow
                    category={category}
                    key={category.id}
                    pending={toggle.isPending && toggle.variables?.id === category.id}
                    onToggle={() => toggle.mutate({ id: category.id, active: !category.active })}
                  />
                ))}
              </div>
            ) : (
              <div className="admin-category-empty"><Tags aria-hidden="true" /><h4>No categories configured</h4><p>Add the first category below.</p></div>
            )}
            {toggle.error ? <p className="field-error" role="alert">{toggle.error.message}</p> : null}
          </section>
        </>
      )}

      <form
        className="admin-category-form-card"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const form = e.currentTarget;
          create.mutate({
            name: String(f.get("name")),
            slug: String(f.get("slug")),
            sortOrder: Number(f.get("sortOrder")),
          }, { onSuccess: () => form.reset() });
        }}
      >
        <header><h3>Add category</h3><p>Create a new category for marketplace listings.</p></header>
        <div className="admin-category-form-grid">
        <label>
          <span>Name</span>
          <input name="name" placeholder="e.g. Books & notes" required />
        </label>
        <label>
          <span>Slug</span>
          <input name="slug" placeholder="e.g. books-notes" pattern="[a-z0-9-]+" required />
          <small>Lowercase, hyphen-separated. Category names and slugs must be unique.</small>
        </label>
        <label>
          <span>Sort order</span>
          <input name="sortOrder" type="number" defaultValue="0" required />
          <small>Lower numbers appear first. Shared numbers are allowed; ties are sorted alphabetically.</small>
        </label>
        </div>
        <SubmitButton pending={create.isPending}>Add category</SubmitButton>
        {create.error ? <p className="field-error" role="alert">{create.error.message}</p> : null}
      </form>

      <section className="admin-terms-card" aria-labelledby="admin-prohibited-terms-title">
        <header>
          <div>
            <h3 id="admin-prohibited-terms-title">Prohibited terms ({prohibitedTerms.length})</h3>
            <p>Flag or block specific terms to keep the marketplace safe.</p>
          </div>
          <p className="admin-terms-explainer"><strong>FLAG</strong> sends a submission for human review. <strong>BLOCK</strong> rejects a prohibited submission.</p>
        </header>
        {terms.isLoading ? <Loading variant="table" label="Loading prohibited terms" /> : terms.isError ? (
          <ErrorState error={terms.error} retry={() => void terms.refetch()} />
        ) : prohibitedTerms.length ? (
          <div className="admin-terms-table" role="table" aria-label="Prohibited terms">
            <div className="admin-terms-table-head" role="row">
              <span role="columnheader">Term or phrase</span>
              <span role="columnheader">Enforcement</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">Actions</span>
            </div>
            {prohibitedTerms.map((term) => (
              <AdminProhibitedTermRow
                term={term}
                key={term.id}
                pending={toggleTerm.isPending && toggleTerm.variables?.id === term.id}
                onToggle={() => toggleTerm.mutate({ id: term.id, active: !term.active })}
              />
            ))}
          </div>
        ) : (
          <div className="admin-category-empty"><ShieldAlert aria-hidden="true" /><h4>No prohibited terms configured</h4><p>Add the first term below.</p></div>
        )}
        {toggleTerm.error ? <p className="field-error" role="alert">{toggleTerm.error.message}</p> : null}
      </section>

        <form
          className="admin-term-form-card"
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.elements.namedItem(
              "term",
            ) as HTMLInputElement;
            const severity = (e.currentTarget.elements.namedItem("severity") as HTMLSelectElement).value;
            createTerm.mutate({ term: input.value, severity }, { onSuccess: () => { input.value = ""; } });
          }}
        >
          <header><h3>Add prohibited term</h3><p>Add a term or phrase to automatically flag or block listings.</p></header>
          <div className="admin-term-form-grid">
          <label>
            <span>Term or phrase</span>
            <input name="term" placeholder="e.g. fake id" required minLength={2} maxLength={120} />
          </label>
          <label><span>Enforcement</span><select name="severity"><option value="FLAG">Flag for human review</option><option value="BLOCK">Block submission</option></select></label>
          </div>
          <SubmitButton pending={createTerm.isPending}>Add term</SubmitButton>
          {createTerm.error ? (
            <p className="field-error" role="alert">{createTerm.error.message}</p>
          ) : null}
        </form>
    </div>
  );
}

export function AdminGrievances() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["admin-grievances"], queryFn: () => api<any[]>("/api/admin/grievances"), refetchInterval: 30_000 });
  const acknowledge = useMutation({ mutationFn: (id: string) => api(`/api/admin/grievances/${id}/acknowledge`, { method: "POST" }), onSuccess: () => { toast.success("Grievance acknowledged"); void client.invalidateQueries({ queryKey: ["admin-grievances"] }); } });
  const resolve = useMutation({ mutationFn: ({ id, body }: { id: string; body: unknown }) => api(`/api/admin/grievances/${id}/resolve`, { method: "POST", ...jsonBody(body) }), onSuccess: () => { toast.success("Grievance resolved"); void client.invalidateQueries({ queryKey: ["admin-grievances"] }); } });
  return <div><h2>Grievance and emergency-safety queue</h2><p className="lede">Ordered by statutory action target. Overdue cases show an alarm and urgent victim, child-safety, threat, and official-order reports remain separated by category and staff role.</p><QueryView query={query} emptyTitle="No open grievances">{(rows) => <div className="list">{rows.map((row: any) => <article className="panel form" key={row.id}>
    <div className="split"><div><StatusBadge value={row.overdue ? "OVERDUE" : row.priority} /><h3>{row.publicReference}</h3></div><span>{row.category}</span></div>
    <p><strong>{row.reason.replaceAll("_", " ")}</strong> · target {new Date(row.actionDueAt).toLocaleString()}</p><p>{row.targetUrl}</p><p>{row.details}</p>
    {!row.acknowledgedAt ? <button className="button secondary" onClick={() => acknowledge.mutate(row.id)} disabled={acknowledge.isPending}>Acknowledge and assign to me</button> : <p>Acknowledged {new Date(row.acknowledgedAt).toLocaleString()}</p>}
    <form className="form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); resolve.mutate({ id: row.id, body: { outcome: form.get("outcome"), publicResponse: form.get("publicResponse"), internalReason: form.get("internalReason") } }); }}><label className="field"><span>Outcome</span><select name="outcome"><option value="RESOLVED">Resolved</option><option value="DISMISSED">Dismissed</option></select></label><label className="field"><span>Public response</span><textarea name="publicResponse" required minLength={3} /></label><label className="field"><span>Internal decision reason</span><textarea name="internalReason" required minLength={3} /></label><SubmitButton pending={resolve.isPending}>Resolve case</SubmitButton></form>
  </article>)}</div>}</QueryView>{acknowledge.error ? <p className="field-error">{acknowledge.error.message}</p> : null}{resolve.error ? <p className="field-error">{resolve.error.message}</p> : null}</div>;
}

export function AdminCompliance() {
  const { user } = useAuth();
  const client = useQueryClient();
  const superAdmin = Boolean(user?.roles.includes("SUPER_ADMIN"));
  const canManageDomains = superAdmin || Boolean(user?.roles.includes("SUPPORT_AGENT"));
  const readiness = useQuery({ queryKey: ["compliance-readiness"], queryFn: () => api<any>("/api/admin/compliance/readiness"), enabled: superAdmin });
  const domains = useQuery({ queryKey: ["academic-domains"], queryFn: () => api<any[]>("/api/admin/academic-domains"), enabled: canManageDomains });
  const providers = useQuery({ queryKey: ["service-providers"], queryFn: () => api<any[]>("/api/admin/service-providers"), enabled: superAdmin });
  const holds = useQuery({ queryKey: ["legal-holds"], queryFn: () => api<any[]>("/api/admin/legal-holds"), enabled: superAdmin });
  const access = useQuery({ queryKey: ["access-reviews"], queryFn: () => api<any>("/api/admin/access-reviews"), enabled: superAdmin });
  const createDomain = useMutation({ mutationFn: (body: unknown) => api("/api/admin/academic-domains", { method: "POST", ...jsonBody(body) }), onSuccess: () => { toast.success("Academic domain added"); void client.invalidateQueries({ queryKey: ["academic-domains"] }); } });
  const reviewProvider = useMutation({ mutationFn: ({ id, body }: { id: string; body: unknown }) => api(`/api/admin/service-providers/${id}`, { method: "PATCH", ...jsonBody(body) }), onSuccess: () => { toast.success("Provider review saved"); void client.invalidateQueries({ queryKey: ["service-providers"] }); void client.invalidateQueries({ queryKey: ["compliance-readiness"] }); } });
  const createHold = useMutation({ mutationFn: (body: unknown) => api("/api/admin/legal-holds", { method: "POST", ...jsonBody(body) }), onSuccess: () => { toast.success("Legal hold created"); void client.invalidateQueries({ queryKey: ["legal-holds"] }); } });
  const reviewAccess = useMutation({ mutationFn: ({ id, body }: { id: string; body: unknown }) => api(`/api/admin/access-reviews/${id}`, { method: "POST", ...jsonBody(body) }), onSuccess: () => { toast.success("Access review recorded"); void client.invalidateQueries({ queryKey: ["access-reviews"] }); } });
  if (!canManageDomains) return <ErrorState error={new Error("This section is available to support and super administrators.")} />;
  return <div className="stack"><div><h2>Compliance registers</h2><p className="lede">Changes are reasoned, attributed, time-stamped, and written to the immutable staff audit log.</p></div>
    {superAdmin && readiness.data ? <section className="panel"><h3>Release readiness</h3><StatusBadge value={readiness.data.ready ? "READY" : "NOT_READY"} /><p>{readiness.data.academicDomains} active academic domains; incomplete providers: {readiness.data.incompleteProviders.join(", ") || "none"}.</p></section> : null}
    <section><h3>Reviewed academic domains</h3>{domains.data?.map((domain: any) => <article className="list-item" key={domain.id}><div><strong>{domain.institutionName}</strong><p>{domain.domain} · source: <a href={domain.sourceUrl}>{domain.sourceUrl}</a></p></div><StatusBadge value={domain.active ? "ACTIVE" : "DISABLED"} /></article>)}<form className="panel form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); createDomain.mutate({ domain: form.get("domain"), institutionName: form.get("institutionName"), sourceUrl: form.get("sourceUrl"), allowSubdomains: form.get("allowSubdomains") === "on" }); }}><h4>Add after official-source review</h4><label className="field"><span>Exact domain</span><input name="domain" required /></label><label className="field"><span>Institution</span><input name="institutionName" required /></label><label className="field"><span>Official source URL</span><input name="sourceUrl" type="url" required /></label><label className="checkbox-row"><input name="allowSubdomains" type="checkbox" /><span>Allow subdomains</span></label><SubmitButton pending={createDomain.isPending}>Add reviewed domain</SubmitButton>{createDomain.error ? <p className="field-error">{createDomain.error.message}</p> : null}</form></section>
    {superAdmin ? <><section><h3>Service-provider reviews</h3>{providers.data?.map((provider: any) => <form className="panel form" key={provider.id} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); reviewProvider.mutate({ id: provider.id, body: { region: form.get("region"), privacyUrl: form.get("privacyUrl"), contractStatus: form.get("contractStatus"), subprocessorReviewed: form.get("subprocessorReviewed") === "on", deletionReviewed: form.get("deletionReviewed") === "on", breachTermsReviewed: form.get("breachTermsReviewed") === "on", evidenceReference: form.get("evidenceReference"), reason: form.get("reason") } }); }}><h4>{provider.displayName}</h4><label className="field"><span>Processing region</span><input name="region" defaultValue={provider.region ?? ""} required /></label><label className="field"><span>Privacy URL</span><input name="privacyUrl" type="url" defaultValue={provider.privacyUrl ?? ""} required /></label><label className="field"><span>Contract status</span><select name="contractStatus" defaultValue={provider.contractStatus}><option>PENDING</option><option>APPROVED</option><option>REJECTED</option></select></label><label className="checkbox-row"><input name="subprocessorReviewed" type="checkbox" defaultChecked={provider.subprocessorReviewed} /><span>Subprocessors and transfers reviewed</span></label><label className="checkbox-row"><input name="deletionReviewed" type="checkbox" defaultChecked={provider.deletionReviewed} /><span>Deletion and retention reviewed</span></label><label className="checkbox-row"><input name="breachTermsReviewed" type="checkbox" defaultChecked={provider.breachTermsReviewed} /><span>Breach terms reviewed</span></label><label className="field"><span>Evidence reference</span><input name="evidenceReference" defaultValue={provider.evidenceReference ?? ""} required /></label><label className="field"><span>Review reason</span><input name="reason" required /></label><SubmitButton pending={reviewProvider.isPending}>Record review</SubmitButton></form>)}</section>
    <section><h3>Legal holds</h3><p>Active holds override automated deletion until formally released.</p>{holds.data?.map((hold: any) => <article className="list-item" key={hold.id}><div><strong>{hold.targetType} {hold.targetId}</strong><p>{hold.reason}</p></div><StatusBadge value={hold.releasedAt ? "RELEASED" : "ACTIVE"} /></article>)}<form className="panel form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); createHold.mutate({ targetType: form.get("targetType"), targetId: form.get("targetId"), reason: form.get("reason"), reviewAt: form.get("reviewAt") }); }}><h4>Create legal hold</h4><label className="field"><span>Target type</span><select name="targetType"><option>USER</option><option>LISTING</option><option>REPORT</option><option>TRANSACTION</option><option>CONVERSATION</option></select></label><label className="field"><span>Target UUID</span><input name="targetId" required /></label><label className="field"><span>Reason</span><textarea name="reason" minLength={10} required /></label><label className="field"><span>Review date</span><input name="reviewAt" type="datetime-local" required /></label><SubmitButton pending={createHold.isPending}>Create hold</SubmitButton></form></section>
    <section><h3>Staff access review</h3>{access.data?.staff?.map((member: any) => <form className="list-item" key={`${member.userId}-${member.role}`} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); reviewAccess.mutate({ id: member.userId, body: { outcome: form.get("outcome"), reason: form.get("reason") } }); }}><div><strong>{member.displayName}</strong><p>{member.email} · {member.role}</p></div><select name="outcome"><option>RETAIN</option><option>CHANGE_REQUIRED</option><option>REMOVE</option></select><input name="reason" aria-label="Access review reason" required /><button className="button small secondary">Record review</button></form>)}</section></> : null}
  </div>;
}
