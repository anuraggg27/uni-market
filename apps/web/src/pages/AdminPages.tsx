import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  NavLink,
  Outlet,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
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

const links = [
  { to: "/admin", label: "Dashboard" },
  { to: "/admin/listings/pending", label: "Pending listings" },
  { to: "/admin/reports", label: "Reports" },
  { to: "/admin/grievances", label: "Grievances & safety" },
  { to: "/admin/users", label: "Users" },
  { to: "/admin/reviews", label: "Reviews" },
  { to: "/admin/support", label: "Support" },
  { to: "/admin/audit-logs", label: "Audit logs" },
  { to: "/admin/categories", label: "Categories" },
  { to: "/admin/compliance", label: "Compliance registers" },
];
export function AdminShell() {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Staff workspace</p>
          <h1>Administration</h1>
        </div>
      </div>
      <div className="admin-layout">
        <nav className="admin-nav" aria-label="Admin sections">
          {links.map(({ to, label }) => (
            <NavLink key={to} to={to} end={to === "/admin"}>
              {label}
            </NavLink>
          ))}
        </nav>
        <section>
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

export function AdminDashboard() {
  const query = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: () => api<any>("/api/admin/dashboard"),
  });
  return (
    <div>
      <h2>Live marketplace overview</h2>
      <p className="lede">
        All values come from the current database. R2 usage appears only when
        the provider exposes it.
      </p>
      <QueryView query={query} loadingVariant="metrics">
        {(data) => (
          <div className="metric-grid">
            {Object.entries(data).map(([key, value]) => (
              <article className="metric" key={key}>
                <strong>
                  {typeof value === "number" && !Number.isInteger(value)
                    ? value.toFixed(1)
                    : String(value ?? "Unavailable")}
                </strong>
                <span>
                  {key
                    .replace(/([A-Z])/g, " $1")
                    .replace(/^./, (v) => v.toUpperCase())}
                </span>
              </article>
            ))}
          </div>
        )}
      </QueryView>
    </div>
  );
}

export function PendingListings() {
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
    queryKey: ["admin-pending", params.toString()],
    queryFn: () => api<any[]>(`/api/admin/listings/pending?${params}`),
    refetchInterval: 10_000,
  });
  const update = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next);
  };
  return (
    <div className="admin-queue-page">
      <div className="admin-queue-heading">
        <h2>Pending listing queue</h2>
        <p className="lede">
          Review every image and field before making a decision.
        </p>
      </div>

      <section
        className="admin-filter-panel"
        aria-labelledby="queue-filters-title"
      >
        <div className="admin-filter-heading">
          <div>
            <h3 id="queue-filters-title">Queue filters</h3>
            <p>Focus the review list by seller, category, or risk signal.</p>
          </div>
        </div>

        <div className="admin-filter-grid">
          <label className="admin-filter-field">
            <span>Sort by</span>
            <select
              value={params.get("sort") ?? "oldest"}
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

      <QueryView query={query} emptyTitle="Queue is clear">
        {(rows) => (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Listing</th>
                  <th>Seller</th>
                  <th>Category</th>
                  <th>Submitted</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row: any) => (
                  <tr key={row.listing.id}>
                    <td>
                      {row.listing.title}
                      {row.flaggedTerms.length ? (
                        <>
                          <br />
                          <small>Flagged: {row.flaggedTerms.join(", ")}</small>
                        </>
                      ) : null}
                    </td>
                    <td>
                      {row.sellerName}
                      <br />
                      <small>{row.sellerCompletedSales} completed sales</small>
                    </td>
                    <td>{row.categoryName}</td>
                    <td>{new Date(row.listing.updatedAt).toLocaleString()}</td>
                    <td>
                      <Link
                        className="button small primary"
                        to={`/admin/listings/${row.listing.id}`}
                      >
                        Review
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>
    </div>
  );
}

export function AdminListingReview() {
  const { listingId } = useParams();
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
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["admin-pending"] });
      void client.invalidateQueries({ queryKey: ["admin-listing", listingId] });
    },
  });
  const deleteListing = useMutation({
    mutationFn: () => api(`/api/admin/listings/${listingId}`, { method: "DELETE" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["admin-pending"] });
      navigate("/admin/listings/pending");
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
      <Link to="/admin/listings/pending">← Back to queue</Link>
      <div>
        <h2>{item.title}</h2>
        <div className="row">
          <StatusBadge value={item.moderationState} />
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
        {item.images.some((image: any) => image.syntheticStatus === "SYNTHETIC_OR_MATERIALLY_ALTERED") ? <p><strong>Synthetic-image disclosure:</strong> one or more seller images are declared AI-generated or materially altered.</p> : null}
      </section>
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
        {decision.isSuccess ? (
          <p role="status">Decision recorded and audited.</p>
        ) : null}
      </form>
    </div>
  );
}

export function AdminReports() {
  const query = useQuery({
    queryKey: ["admin-reports"],
    queryFn: () => api<any[]>("/api/admin/reports"),
  });
  return (
    <div>
      <h2>Open reports</h2>
      <QueryView query={query} emptyTitle="No open reports">
        {(rows) => (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Reason</th>
                  <th>Target</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td>{r.reason.replaceAll("_", " ")}</td>
                    <td>{r.targetType}</td>
                    <td>
                      <StatusBadge value={r.status} />
                    </td>
                    <td>{new Date(r.createdAt).toLocaleString()}</td>
                    <td>
                      <Link to={`/admin/reports/${r.id}`}>Investigate</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>
    </div>
  );
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
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["admin-reports"] }),
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

export function AdminUsers() {
  const [params, setParams] = useSearchParams();
  const query = useQuery({
    queryKey: ["admin-users", params.get("q")],
    queryFn: () =>
      api<any[]>(
        `/api/admin/users?q=${encodeURIComponent(params.get("q") ?? "")}`,
      ),
  });
  return (
    <div>
      <div className="row between">
        <h2>Users</h2>
        <input
          className="control"
          placeholder="Search name or email"
          value={params.get("q") ?? ""}
          onChange={(e) => setParams({ q: e.target.value })}
        />
      </div>
      <QueryView query={query}>
        {(rows) => (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Sales</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u: any) => (
                  <tr key={u.id}>
                    <td>
                      <Link to={`/admin/users/${u.id}`}>{u.displayName}</Link>
                    </td>
                    <td>{u.email}</td>
                    <td>{u.phoneVerifiedAt ? "Verified" : "Not verified"}</td>
                    <td>{u.completedSales}</td>
                    <td>
                      {u.suspendedAt ? (
                        <StatusBadge value="SUSPENDED" />
                      ) : (
                        <StatusBadge value="ACTIVE" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>
    </div>
  );
}
export function AdminUserDetail() {
  const { userId } = useParams();
  const { user: currentUser } = useAuth();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["admin-user", userId],
    queryFn: () => api<any>(`/api/admin/users/${userId}`),
  });
  const action = useMutation({
    mutationFn: ({ action, reason }: { action: string; reason: string }) =>
      api(`/api/admin/users/${userId}/${action}`, {
        method: "POST",
        ...jsonBody({ reason }),
      }),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["admin-user", userId] }),
  });
  const roles = useMutation({
    mutationFn: (data: { roles: string[]; reason: string }) =>
      api(`/api/admin/users/${userId}/roles`, {
        method: "PUT",
        ...jsonBody(data),
      }),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["admin-user", userId] }),
  });
  return (
    <QueryView query={query}>
      {(u) => (
        <div className="stack">
          <Link to="/admin/users">← Users</Link>
          <h2>{u.displayName}</h2>
          <div className="panel">
            <p>{u.email}</p>
            <p>{u.phoneE164 || "Phone not verified"}</p>
            <p>Roles: {u.roles.map((r: any) => r.role).join(", ")}</p>
            <p>{u.completedSales} completed sales</p>
          </div>
          {currentUser?.roles.includes("SUPER_ADMIN") ? (
            <form
              className="panel form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                roles.mutate({
                  roles: f.getAll("roles").map(String),
                  reason: String(f.get("reason")),
                });
              }}
            >
              <h3>Staff access</h3>
              <p className="hint">
                User access is always retained. Staff roles cannot be requested
                through public registration.
              </p>
              {(["SUPPORT_AGENT", "MODERATOR", "SUPER_ADMIN"] as const).map(
                (role) => (
                  <label className="row" key={role}>
                    <input
                      type="checkbox"
                      name="roles"
                      value={role}
                      defaultChecked={u.roles.some(
                        (item: any) => item.role === role,
                      )}
                    />
                    {role.replaceAll("_", " ")}
                  </label>
                ),
              )}
              <label className="field">
                <span>Reason for access change</span>
                <textarea name="reason" required minLength={3} />
              </label>
              <SubmitButton pending={roles.isPending}>
                Update staff access
              </SubmitButton>
              {roles.error ? (
                <p className="field-error">{roles.error.message}</p>
              ) : null}
              {roles.isSuccess ? (
                <p role="status">Staff access updated and audited.</p>
              ) : null}
            </form>
          ) : null}
          <form
            className="panel form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              action.mutate({
                action: String(f.get("action")),
                reason: String(f.get("reason")),
              });
            }}
          >
            <label className="field">
              <span>Action</span>
              <select name="action">
                <option value="warn">Warn user</option>
                <option value="suspend">Suspend user</option>
              </select>
            </label>
            <label className="field">
              <span>Reason</span>
              <textarea name="reason" required />
            </label>
            <SubmitButton pending={action.isPending}>
              Record action
            </SubmitButton>
          </form>
        </div>
      )}
    </QueryView>
  );
}

export function AdminReviews() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["admin-reviews"],
    queryFn: () => api<any[]>("/api/admin/reviews"),
  });
  const hide = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api(`/api/admin/reviews/${id}/hide`, {
        method: "POST",
        ...jsonBody({ reason }),
      }),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["admin-reviews"] }),
  });
  return (
    <div>
      <h2>Review moderation</h2>
      <QueryView query={query} emptyTitle="No reviews">
        {(rows) => (
          <div className="stack">
            {rows.map((r: any) => (
              <article className="panel" key={r.id}>
                <div className="row between">
                  <strong>{r.rating} stars</strong>
                  {r.hiddenAt ? <StatusBadge value="HIDDEN" /> : null}
                </div>
                <p>{r.text}</p>
                {!r.hiddenAt ? (
                  <button
                    className="button small danger"
                    onClick={() => {
                      const reason = window.prompt(
                        "Reason for hiding this review?",
                      );
                      if (reason) hide.mutate({ id: r.id, reason });
                    }}
                  >
                    Hide review
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </QueryView>
    </div>
  );
}

export function AdminSupport() {
  const query = useQuery({
    queryKey: ["admin-support"],
    queryFn: () => api<any[]>("/api/admin/support"),
  });
  return (
    <div>
      <h2>Support queue</h2>
      <QueryView query={query} emptyTitle="No assigned or open tickets">
        {(rows) => (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t: any) => (
                  <tr key={t.id}>
                    <td>
                      <Link to={`/admin/support/${t.id}`}>{t.subject}</Link>
                    </td>
                    <td>{t.category}</td>
                    <td>
                      <StatusBadge value={t.status} />
                    </td>
                    <td>{new Date(t.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>
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
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["admin-support", ticketId] }),
  });
  const escalate = useMutation({
    mutationFn: (reason: string) =>
      api(`/api/admin/support/${ticketId}/escalate`, {
        method: "POST",
        ...jsonBody({ reason }),
      }),
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

export function AuditLogs() {
  const query = useQuery({
    queryKey: ["audit-logs"],
    queryFn: () => api<any[]>("/api/admin/audit-logs"),
  });
  return (
    <div>
      <h2>Audit log</h2>
      <QueryView query={query} emptyTitle="No admin actions">
        {(rows) => (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Role</th>
                  <th>Reason</th>
                  <th>Request</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td>{new Date(r.createdAt).toLocaleString()}</td>
                    <td>{r.action}</td>
                    <td>
                      {r.targetType} {r.targetId.slice(0, 8)}
                    </td>
                    <td>{r.role}</td>
                    <td>{r.internalReason}</td>
                    <td>{r.requestId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>
    </div>
  );
}

export function AdminCategories() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["admin-categories"],
    queryFn: () => api<any[]>("/api/admin/categories"),
  });
  const terms = useQuery({
    queryKey: ["admin-prohibited-terms"],
    queryFn: () => api<any[]>("/api/admin/prohibited-terms"),
  });
  const create = useMutation({
    mutationFn: (data: any) =>
      api("/api/admin/categories", { method: "POST", ...jsonBody(data) }),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["admin-categories"] }),
  });
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api(`/api/admin/categories/${id}`, {
        method: "PATCH",
        ...jsonBody({ active }),
      }),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["admin-categories"] }),
  });
  const createTerm = useMutation({
    mutationFn: ({ term, severity }: { term: string; severity: string }) =>
      api("/api/admin/prohibited-terms", {
        method: "POST",
        ...jsonBody({ term, severity }),
      }),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["admin-prohibited-terms"] }),
  });
  const toggleTerm = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api(`/api/admin/prohibited-terms/${id}`, {
        method: "PATCH",
        ...jsonBody({ active }),
      }),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["admin-prohibited-terms"] }),
  });
  return (
    <div className="stack-lg">
      <h2>Categories</h2>
      <QueryView query={query}>
        {(rows) => (
          <div className="list">
            {rows.map((c: any) => (
              <article className="list-item" key={c.id}>
                <div />
                <div>
                  <h3>{c.name}</h3>
                  <p>{c.slug}</p>
                </div>
                <button
                  className="button small secondary"
                  onClick={() => toggle.mutate({ id: c.id, active: !c.active })}
                >
                  {c.active ? "Disable" : "Enable"}
                </button>
              </article>
            ))}
          </div>
        )}
      </QueryView>
      <form
        className="panel form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          create.mutate({
            name: String(f.get("name")),
            slug: String(f.get("slug")),
            sortOrder: Number(f.get("sortOrder")),
          });
        }}
      >
        <h3>Add category</h3>
        <label className="field">
          <span>Name</span>
          <input name="name" required />
        </label>
        <label className="field">
          <span>Slug</span>
          <input name="slug" pattern="[a-z0-9-]+" required />
        </label>
        <label className="field">
          <span>Sort order</span>
          <input name="sortOrder" type="number" defaultValue="0" />
        </label>
        <SubmitButton pending={create.isPending}>Add category</SubmitButton>
      </form>
      <section className="stack">
        <div>
          <h2>Prohibited terms</h2>
          <p className="lede">
            FLAG terms highlight a submission for human review. BLOCK terms
            reject a prohibited submission; neither setting automatically approves content.
          </p>
        </div>
        <QueryView query={terms} emptyTitle="No prohibited terms configured">
          {(rows) => (
            <div className="list">
              {rows.map((term: any) => (
                <article className="list-item" key={term.id}>
                  <div />
                  <div>
                    <h3>{term.term}</h3>
                    <StatusBadge value={term.severity} />
                    <StatusBadge value={term.active ? "ACTIVE" : "DISABLED"} />
                  </div>
                  <button
                    className="button small secondary"
                    onClick={() =>
                      toggleTerm.mutate({ id: term.id, active: !term.active })
                    }
                  >
                    {term.active ? "Disable" : "Enable"}
                  </button>
                </article>
              ))}
            </div>
          )}
        </QueryView>
        <form
          className="panel form"
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.elements.namedItem(
              "term",
            ) as HTMLInputElement;
            const severity = (e.currentTarget.elements.namedItem("severity") as HTMLSelectElement).value;
            createTerm.mutate({ term: input.value, severity });
            input.value = "";
          }}
        >
          <h3>Add prohibited term</h3>
          <label className="field">
            <span>Term or phrase</span>
            <input name="term" required minLength={2} maxLength={120} />
          </label>
          <label className="field"><span>Enforcement</span><select name="severity"><option value="FLAG">Flag for human review</option><option value="BLOCK">Block submission</option></select></label>
          <SubmitButton pending={createTerm.isPending}>Add term</SubmitButton>
          {createTerm.error ? (
            <p className="field-error">{createTerm.error.message}</p>
          ) : null}
        </form>
      </section>
    </div>
  );
}

export function AdminGrievances() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["admin-grievances"], queryFn: () => api<any[]>("/api/admin/grievances"), refetchInterval: 30_000 });
  const acknowledge = useMutation({ mutationFn: (id: string) => api(`/api/admin/grievances/${id}/acknowledge`, { method: "POST" }), onSuccess: () => void client.invalidateQueries({ queryKey: ["admin-grievances"] }) });
  const resolve = useMutation({ mutationFn: ({ id, body }: { id: string; body: unknown }) => api(`/api/admin/grievances/${id}/resolve`, { method: "POST", ...jsonBody(body) }), onSuccess: () => void client.invalidateQueries({ queryKey: ["admin-grievances"] }) });
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
  const createDomain = useMutation({ mutationFn: (body: unknown) => api("/api/admin/academic-domains", { method: "POST", ...jsonBody(body) }), onSuccess: () => void client.invalidateQueries({ queryKey: ["academic-domains"] }) });
  const reviewProvider = useMutation({ mutationFn: ({ id, body }: { id: string; body: unknown }) => api(`/api/admin/service-providers/${id}`, { method: "PATCH", ...jsonBody(body) }), onSuccess: () => { void client.invalidateQueries({ queryKey: ["service-providers"] }); void client.invalidateQueries({ queryKey: ["compliance-readiness"] }); } });
  const createHold = useMutation({ mutationFn: (body: unknown) => api("/api/admin/legal-holds", { method: "POST", ...jsonBody(body) }), onSuccess: () => void client.invalidateQueries({ queryKey: ["legal-holds"] }) });
  const reviewAccess = useMutation({ mutationFn: ({ id, body }: { id: string; body: unknown }) => api(`/api/admin/access-reviews/${id}`, { method: "POST", ...jsonBody(body) }), onSuccess: () => void client.invalidateQueries({ queryKey: ["access-reviews"] }) });
  if (!canManageDomains) return <ErrorState error={new Error("This section is available to support and super administrators.")} />;
  return <div className="stack"><div><h2>Compliance registers</h2><p className="lede">Changes are reasoned, attributed, time-stamped, and written to the immutable staff audit log.</p></div>
    {superAdmin && readiness.data ? <section className="panel"><h3>Release readiness</h3><StatusBadge value={readiness.data.ready ? "READY" : "NOT_READY"} /><p>{readiness.data.academicDomains} active academic domains; incomplete providers: {readiness.data.incompleteProviders.join(", ") || "none"}.</p></section> : null}
    <section><h3>Reviewed academic domains</h3>{domains.data?.map((domain: any) => <article className="list-item" key={domain.id}><div><strong>{domain.institutionName}</strong><p>{domain.domain} · source: <a href={domain.sourceUrl}>{domain.sourceUrl}</a></p></div><StatusBadge value={domain.active ? "ACTIVE" : "DISABLED"} /></article>)}<form className="panel form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); createDomain.mutate({ domain: form.get("domain"), institutionName: form.get("institutionName"), sourceUrl: form.get("sourceUrl"), allowSubdomains: form.get("allowSubdomains") === "on" }); }}><h4>Add after official-source review</h4><label className="field"><span>Exact domain</span><input name="domain" required /></label><label className="field"><span>Institution</span><input name="institutionName" required /></label><label className="field"><span>Official source URL</span><input name="sourceUrl" type="url" required /></label><label className="checkbox-row"><input name="allowSubdomains" type="checkbox" /><span>Allow subdomains</span></label><SubmitButton pending={createDomain.isPending}>Add reviewed domain</SubmitButton>{createDomain.error ? <p className="field-error">{createDomain.error.message}</p> : null}</form></section>
    {superAdmin ? <><section><h3>Service-provider reviews</h3>{providers.data?.map((provider: any) => <form className="panel form" key={provider.id} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); reviewProvider.mutate({ id: provider.id, body: { region: form.get("region"), privacyUrl: form.get("privacyUrl"), contractStatus: form.get("contractStatus"), subprocessorReviewed: form.get("subprocessorReviewed") === "on", deletionReviewed: form.get("deletionReviewed") === "on", breachTermsReviewed: form.get("breachTermsReviewed") === "on", evidenceReference: form.get("evidenceReference"), reason: form.get("reason") } }); }}><h4>{provider.displayName}</h4><label className="field"><span>Processing region</span><input name="region" defaultValue={provider.region ?? ""} required /></label><label className="field"><span>Privacy URL</span><input name="privacyUrl" type="url" defaultValue={provider.privacyUrl ?? ""} required /></label><label className="field"><span>Contract status</span><select name="contractStatus" defaultValue={provider.contractStatus}><option>PENDING</option><option>APPROVED</option><option>REJECTED</option></select></label><label className="checkbox-row"><input name="subprocessorReviewed" type="checkbox" defaultChecked={provider.subprocessorReviewed} /><span>Subprocessors and transfers reviewed</span></label><label className="checkbox-row"><input name="deletionReviewed" type="checkbox" defaultChecked={provider.deletionReviewed} /><span>Deletion and retention reviewed</span></label><label className="checkbox-row"><input name="breachTermsReviewed" type="checkbox" defaultChecked={provider.breachTermsReviewed} /><span>Breach terms reviewed</span></label><label className="field"><span>Evidence reference</span><input name="evidenceReference" defaultValue={provider.evidenceReference ?? ""} required /></label><label className="field"><span>Review reason</span><input name="reason" required /></label><SubmitButton pending={reviewProvider.isPending}>Record review</SubmitButton></form>)}</section>
    <section><h3>Legal holds</h3><p>Active holds override automated deletion until formally released.</p>{holds.data?.map((hold: any) => <article className="list-item" key={hold.id}><div><strong>{hold.targetType} {hold.targetId}</strong><p>{hold.reason}</p></div><StatusBadge value={hold.releasedAt ? "RELEASED" : "ACTIVE"} /></article>)}<form className="panel form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); createHold.mutate({ targetType: form.get("targetType"), targetId: form.get("targetId"), reason: form.get("reason"), reviewAt: form.get("reviewAt") }); }}><h4>Create legal hold</h4><label className="field"><span>Target type</span><select name="targetType"><option>USER</option><option>LISTING</option><option>REPORT</option><option>TRANSACTION</option><option>CONVERSATION</option></select></label><label className="field"><span>Target UUID</span><input name="targetId" required /></label><label className="field"><span>Reason</span><textarea name="reason" minLength={10} required /></label><label className="field"><span>Review date</span><input name="reviewAt" type="datetime-local" required /></label><SubmitButton pending={createHold.isPending}>Create hold</SubmitButton></form></section>
    <section><h3>Staff access review</h3>{access.data?.staff?.map((member: any) => <form className="list-item" key={`${member.userId}-${member.role}`} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); reviewAccess.mutate({ id: member.userId, body: { outcome: form.get("outcome"), reason: form.get("reason") } }); }}><div><strong>{member.displayName}</strong><p>{member.email} · {member.role}</p></div><select name="outcome"><option>RETAIN</option><option>CHANGE_REQUIRED</option><option>REMOVE</option></select><input name="reason" aria-label="Access review reason" required /><button className="button small secondary">Record review</button></form>)}</section></> : null}
  </div>;
}
