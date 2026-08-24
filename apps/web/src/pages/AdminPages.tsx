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
  { to: "/admin/users", label: "Users" },
  { to: "/admin/reviews", label: "Reviews" },
  { to: "/admin/support", label: "Support" },
  { to: "/admin/audit-logs", label: "Audit logs" },
  { to: "/admin/categories", label: "Categories" },
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
    mutationFn: (term: string) =>
      api("/api/admin/prohibited-terms", {
        method: "POST",
        ...jsonBody({ term }),
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
            Terms flag listings for human review. They never approve or
            automatically remove content.
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
            createTerm.mutate(input.value);
            input.value = "";
          }}
        >
          <h3>Add prohibited term</h3>
          <label className="field">
            <span>Term or phrase</span>
            <input name="term" required minLength={2} maxLength={120} />
          </label>
          <SubmitButton pending={createTerm.isPending}>Add term</SubmitButton>
          {createTerm.error ? (
            <p className="field-error">{createTerm.error.message}</p>
          ) : null}
        </form>
      </section>
    </div>
  );
}
