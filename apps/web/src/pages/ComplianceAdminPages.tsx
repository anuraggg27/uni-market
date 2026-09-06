import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Database,
  ExternalLink,
  FileText,
  Globe2,
  LockKeyhole,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";
import { api, jsonBody } from "../api";
import { useAuth } from "../auth";
import { EmptyState, ErrorState, Loading, StatusBadge, SubmitButton } from "../components/UI";

const adminDateTimeFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function formatDateTime(value: string | Date) {
  return adminDateTimeFormatter.format(new Date(value));
}

function humanise(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
}

function DataState({ query, emptyTitle, children }: { query: any; emptyTitle: string; children: (data: any) => ReactNode }) {
  if (query.isLoading) return <Loading variant="list" />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  if (Array.isArray(query.data) && query.data.length === 0) return <EmptyState title={emptyTitle} body="There are no records in this register." />;
  return children(query.data);
}

export function AdminGrievances() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [assignmentFilter, setAssignmentFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const query = useQuery({
    queryKey: ["admin-grievances"],
    queryFn: () => api<AdminGrievanceQueueItem[]>("/api/admin/grievances"),
    refetchInterval: 30_000,
  });
  const cases = query.data ?? EMPTY_GRIEVANCE_CASES;
  const statusOptions = useMemo(
    () => [...new Set(cases.map((item) => item.status))].sort(),
    [cases],
  );
  const categoryOptions = useMemo(
    () => [...new Set(cases.map((item) => item.category))].sort(),
    [cases],
  );
  const filteredCases = useMemo(() => {
    const needle = searchQuery.trim().toLocaleLowerCase();
    return cases
      .filter((item) => {
        const assignmentMatches =
          assignmentFilter === "ALL" ||
          (assignmentFilter === "UNASSIGNED" && !item.assignedTo) ||
          (assignmentFilter === "ASSIGNED" && Boolean(item.assignedTo)) ||
          (assignmentFilter === "MINE" && item.assignedTo === user?.id);
        return (
          (statusFilter === "ALL" || item.status === statusFilter) &&
          (categoryFilter === "ALL" || item.category === categoryFilter) &&
          assignmentMatches &&
          (!needle ||
            [
              item.publicReference,
              item.id,
              item.category,
              humanise(item.category),
              item.priority,
              item.reason,
              humanise(item.reason),
              item.status,
              item.assignedTo,
            ]
              .filter(Boolean)
              .some((value) =>
                String(value).toLocaleLowerCase().includes(needle),
              ))
        );
      })
      .sort((left, right) => {
        const difference =
          new Date(left.createdAt).getTime() -
          new Date(right.createdAt).getTime();
        return sortOrder === "newest" ? -difference : difference;
      });
  }, [assignmentFilter, cases, categoryFilter, searchQuery, sortOrder, statusFilter, user?.id]);
  const filtersActive =
    statusFilter !== "ALL" ||
    categoryFilter !== "ALL" ||
    assignmentFilter !== "ALL" ||
    Boolean(searchQuery.trim());
  const clearFilters = () => {
    setStatusFilter("ALL");
    setCategoryFilter("ALL");
    setAssignmentFilter("ALL");
    setSearchQuery("");
  };
  const metrics = [
    { label: "Open cases", value: cases.filter((item) => item.status === "OPEN").length, note: "Needs your attention", icon: FileText, tone: "plum" },
    { label: "In review", value: cases.filter((item) => item.status === "INVESTIGATING").length, note: "Currently being handled", icon: CheckCircle2, tone: "success" },
    { label: "Assigned cases", value: cases.filter((item) => Boolean(item.assignedTo)).length, note: "Current active queue", icon: UsersRound, tone: "plum" },
    { label: "Urgent cases", value: cases.filter((item) => item.priority === "URGENT").length, note: "Requires immediate action", icon: AlertTriangle, tone: "urgent" },
  ];

  return <div className="compliance-admin-page admin-safety-page">
    <header className="admin-safety-heading">
      <div><h2>Grievances &amp; safety</h2><p>Manage user grievances, safety reports, and policy violations. Ensure a safe and respectful community for all students.</p></div>
      <Link className="admin-safety-new-case" to="/grievance"><Plus aria-hidden="true" />New case</Link>
    </header>
    {query.isLoading ? <Loading variant="metrics" label="Loading grievances" /> : query.isError ? <ErrorState error={query.error} retry={() => void query.refetch()} /> : <>
      <section className="admin-safety-metrics" aria-label="Case summary">
        {metrics.map(({ icon: Icon, label, note, tone, value }) => <article className={`admin-safety-metric is-${tone}`} key={label}><span className="admin-safety-metric-icon" aria-hidden="true"><Icon /></span><p><strong>{value}</strong><b>{label}</b><span>{note}</span></p></article>)}
      </section>
      <section className="admin-safety-filters" aria-labelledby="safety-filters-title">
        <div className="admin-safety-filter-heading"><div><h3 id="safety-filters-title">Filters</h3><p>Find specific grievances by status, category, or keyword.</p></div><button type="button" className="admin-safety-clear" onClick={clearFilters} disabled={!filtersActive}><RotateCcw aria-hidden="true" />Clear filters</button></div>
        <div className="admin-safety-filter-grid">
          <label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ALL">All statuses</option>{statusOptions.map((status) => <option value={status} key={status}>{humanise(status)}</option>)}</select></label>
          <label><span>Category</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="ALL">All categories</option>{categoryOptions.map((category) => <option value={category} key={category}>{humanise(category)}</option>)}</select></label>
          <label><span>Assigned to</span><select value={assignmentFilter} onChange={(event) => setAssignmentFilter(event.target.value)}><option value="ALL">All assignments</option><option value="ASSIGNED">Assigned cases</option><option value="UNASSIGNED">Unassigned</option><option value="MINE">Assigned to me</option></select></label>
          <label className="admin-safety-search"><span>Search</span><span className="admin-safety-search-control"><Search aria-hidden="true" /><input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search by case ID, category, reason..." /></span></label>
        </div>
      </section>
      <div className="admin-safety-list-heading"><h3>Cases ({filteredCases.length})</h3><label><span>Sort by</span><select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as "newest" | "oldest")}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label></div>
      {filteredCases.length ? <><div className="admin-safety-table" role="table" aria-label="Grievance cases"><div className="admin-safety-table-head" role="row"><span role="columnheader">Case</span><span role="columnheader">Category</span><span role="columnheader">Reported by</span><span role="columnheader">Assigned to</span><span role="columnheader">Date</span><span role="columnheader">Status</span><span role="columnheader" aria-label="Action" /></div>{filteredCases.map((item) => <GrievanceCaseCard row={item} key={item.id} />)}</div><p className="admin-safety-results">Showing 1–{filteredCases.length} of {filteredCases.length} {filteredCases.length === 1 ? "case" : "cases"}</p></> : <section className="admin-safety-empty"><ShieldCheck aria-hidden="true" /><h3>{filtersActive ? "Nothing matches your filters." : "No open grievances"}</h3><p>{filtersActive ? "Try adjusting or clearing the current filters." : "All current cases have been handled."}</p></section>}
    </>}
  </div>;
}

type AdminGrievanceQueueItem = {
  id: string;
  publicReference: string;
  category: string;
  priority: string;
  reason: string;
  status: string;
  assignedTo: string | null;
  acknowledgeDueAt: string;
  actionDueAt: string;
  acknowledgedAt: string | null;
  appealedAt: string | null;
  createdAt: string;
  overdue: boolean;
};

const EMPTY_GRIEVANCE_CASES: AdminGrievanceQueueItem[] = [];

function GrievanceCaseCard({ row }: { row: AdminGrievanceQueueItem }) {
  const [expanded, setExpanded] = useState(false);
  const client = useQueryClient();
  const detail = useQuery({ queryKey: ["admin-grievance", row.id], queryFn: () => api<any>(`/api/admin/grievances/${row.id}`), enabled: expanded, staleTime: 30_000 });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["admin-grievances"] });
    void client.invalidateQueries({ queryKey: ["admin-grievance", row.id] });
  };
  const acknowledge = useMutation({ mutationFn: () => api(`/api/admin/grievances/${row.id}/acknowledge`, { method: "POST" }), onSuccess: () => { toast.success("Grievance acknowledged"); refresh(); } });
  const sendUpdate = useMutation({ mutationFn: (body: unknown) => api(`/api/admin/grievances/${row.id}/messages`, { method: "POST", ...jsonBody(body) }), onSuccess: () => { toast.success("Update sent"); refresh(); } });
  const resolve = useMutation({ mutationFn: (body: unknown) => api(`/api/admin/grievances/${row.id}/resolve`, { method: "POST", ...jsonBody(body) }), onSuccess: () => { toast.success("Decision saved"); refresh(); } });
  const mutationError = acknowledge.error ?? sendUpdate.error ?? resolve.error;
  const panelId = `grievance-case-${row.id}`;
  const actionable = row.status === "OPEN";
  const urgent = row.priority === "URGENT";

  return <article className={`admin-safety-case ${row.overdue ? "is-overdue" : ""} ${urgent ? "is-urgent" : ""}`}>
    <div className="admin-safety-row" role="row">
      <div className="admin-safety-primary" role="cell" data-label="Case">
        <span className="admin-safety-case-icon" aria-hidden="true">{urgent || row.overdue ? <AlertTriangle /> : <FileText />}</span>
        <p><strong>{row.publicReference}</strong><span>{humanise(row.reason)}</span></p>
        {row.appealedAt ? <span className="admin-safety-inline-flag">Appealed</span> : null}
      </div>
      <div className="admin-safety-category" role="cell" data-label="Category"><strong>{humanise(row.category)}</strong><span>{humanise(row.priority)} priority</span></div>
      <div className="admin-safety-reporter" role="cell" data-label="Reported by"><span className="admin-safety-person-icon" aria-hidden="true"><UserRound /></span><p><strong>Private reporter</strong><span>Protected case data</span></p></div>
      <div className="admin-safety-assignee" role="cell" data-label="Assigned to"><span className="admin-safety-person-icon" aria-hidden="true">{row.assignedTo ? <ShieldCheck /> : <UserRound />}</span><p><strong>{row.assignedTo ? "Assigned" : "Unassigned"}</strong><span>{row.assignedTo ? `#${shortCaseIdentifier(row.assignedTo)}` : "Awaiting acknowledgement"}</span></p></div>
      <time className="admin-safety-date" role="cell" data-label="Date" dateTime={row.createdAt}><span className="admin-safety-created"><CalendarDays aria-hidden="true" />{formatDateTime(row.createdAt)}</span><span className={`admin-safety-due ${row.overdue ? "is-overdue" : ""}`}><Clock3 aria-hidden="true" />{row.overdue ? "Overdue" : "Due"} {formatDateTime(row.actionDueAt)}</span></time>
      <div className="admin-safety-status" role="cell" data-label="Status"><StatusBadge value={row.status} /></div>
      <div className="admin-safety-action" role="cell"><button type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded((value) => !value)}>{expanded ? "Hide" : actionable ? "Investigate" : "View"}{expanded ? <ChevronDown aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}</button></div>
    </div>
    {expanded ? <div className="grievance-case-detail" id={panelId}>
      <div className="grievance-assignment">
        {row.acknowledgedAt ? <span><ShieldCheck aria-hidden="true" /> Acknowledged {formatDateTime(row.acknowledgedAt)}</span> : <><span><AlertTriangle aria-hidden="true" /> Awaiting staff acknowledgement</span><button type="button" className="button secondary" onClick={() => acknowledge.mutate()} disabled={acknowledge.isPending}>{acknowledge.isPending ? "Assigning…" : "Acknowledge & Assign to Me"}</button></>}
      </div>
      {detail.isLoading ? <Loading variant="list" /> : detail.isError ? <ErrorState error={detail.error} retry={() => void detail.refetch()} /> : detail.data ? <>
        <div className="grievance-case-body">
          <div><span className="admin-data-label">Complaint</span><strong>{humanise(detail.data.reason)}</strong><p>{detail.data.details}</p></div>
          <div><span className="admin-data-label">Reported location</span><a href={detail.data.targetUrl} target="_blank" rel="noreferrer">Open target <ExternalLink aria-hidden="true" /></a><p className="grievance-target-url">{detail.data.targetUrl}</p></div>
        </div>
        <section className="grievance-event-log"><h4>Case History</h4>{detail.data.events?.length ? <ol>{detail.data.events.map((event: any) => <li key={event.id}><div><strong>{humanise(event.type)}</strong><time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time></div>{event.publicMessage ? <p>{event.publicMessage}</p> : null}{event.internalMessage ? <small>Internal: {event.internalMessage}</small> : null}</li>)}</ol> : <p>No case events recorded.</p>}</section>
        <details className="admin-review-editor"><summary>Send an Update <ChevronDown aria-hidden="true" /></summary><form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); sendUpdate.mutate({ publicMessage: form.get("publicMessage"), internalReason: form.get("internalReason") }); }}><label className="field"><span>Update for reporter</span><textarea name="publicMessage" required minLength={3} placeholder="Share a factual progress update…" /></label><label className="field"><span>Internal reason</span><textarea name="internalReason" required minLength={3} placeholder="Record why this update was sent…" /></label><SubmitButton pending={sendUpdate.isPending}>Send Update</SubmitButton></form></details>
        <details className="admin-review-editor"><summary>Record a Decision <ChevronDown aria-hidden="true" /></summary><form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); resolve.mutate({ outcome: form.get("outcome"), publicResponse: form.get("publicResponse"), internalReason: form.get("internalReason") }); }}><label className="field"><span>Outcome</span><select name="outcome"><option value="RESOLVED">Resolve case</option><option value="DISMISSED">Dismiss complaint</option></select></label><label className="field"><span>Response to reporter</span><textarea name="publicResponse" required minLength={3} placeholder="Explain the decision and action taken…" /></label><label className="field"><span>Internal decision record</span><textarea name="internalReason" required minLength={3} placeholder="Record the evidence and policy basis…" /></label><SubmitButton pending={resolve.isPending}>Save Decision</SubmitButton></form></details>
      </> : null}
      {mutationError ? <p className="field-error" role="alert">{mutationError.message}</p> : null}
    </div> : null}
  </article>;
}

function shortCaseIdentifier(value: string) {
  return value.replaceAll("-", "").slice(0, 8).toUpperCase();
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
  return <div className="compliance-admin-page">
    <header className="admin-compliance-heading"><div><h2>Compliance Registers</h2><p>Operational records for eligibility, providers, retention holds, and staff access.</p></div></header>

    {superAdmin && readiness.data ? <section className={`readiness-banner ${readiness.data.ready ? "is-ready" : ""}`}><span className="readiness-icon">{readiness.data.ready ? <ShieldCheck aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}</span><div><h3>{readiness.data.ready ? "Core registers are ready" : "Review required before release"}</h3><p>{readiness.data.academicDomains} active academic domains · {readiness.data.incompleteProviders.length ? `${readiness.data.incompleteProviders.length} provider reviews incomplete` : "All provider reviews complete"}</p></div><StatusBadge value={readiness.data.ready ? "READY" : "NOT_READY"} /></section> : null}

    <section className="compliance-register-section">
      <header><span className="register-icon"><Globe2 aria-hidden="true" /></span><div><h3>Academic Domains</h3><p>Only domains verified against an official institution source belong here.</p></div></header>
      <DataState query={domains} emptyTitle="No academic domains configured">{(rows) => <div className="register-list">{rows.map((domain: any) => <article key={domain.id}><div><strong>{domain.institutionName}</strong><code>{domain.domain}</code><a href={domain.sourceUrl} target="_blank" rel="noreferrer">Official source <ExternalLink aria-hidden="true" /></a></div><StatusBadge value={domain.active ? "ACTIVE" : "DISABLED"} /></article>)}</div>}</DataState>
      <details className="register-editor"><summary>Add Academic Domain <ChevronDown aria-hidden="true" /></summary><form className="register-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); createDomain.mutate({ domain: form.get("domain"), institutionName: form.get("institutionName"), sourceUrl: form.get("sourceUrl"), allowSubdomains: form.get("allowSubdomains") === "on" }); }}><div className="form-grid"><label className="field"><span>Exact domain</span><input name="domain" required autoComplete="off" spellCheck={false} placeholder="e.g. students.institution.ac.in…" /></label><label className="field"><span>Institution</span><input name="institutionName" required autoComplete="organization" /></label></div><label className="field"><span>Official source URL</span><input name="sourceUrl" type="url" required autoComplete="off" spellCheck={false} placeholder="https://…" /></label><label className="register-checkbox"><input name="allowSubdomains" type="checkbox" /><span>Allow verified subdomains</span></label><SubmitButton pending={createDomain.isPending}>Add Reviewed Domain</SubmitButton>{createDomain.error ? <p className="field-error" role="alert">{createDomain.error.message}</p> : null}</form></details>
    </section>

    {superAdmin ? <>
      <section className="compliance-register-section">
        <header><span className="register-icon"><Database aria-hidden="true" /></span><div><h3>Service Providers</h3><p>Open a provider to review its contract, region, transfers, and deletion terms.</p></div></header>
        <DataState query={providers} emptyTitle="No providers configured">{(rows) => <div className="provider-review-list">{rows.map((provider: any) => <details className="provider-review-card" key={provider.id}><summary><div><strong>{provider.displayName}</strong><span>{provider.region || "Region not recorded"}</span></div><StatusBadge value={provider.contractStatus} /><ChevronDown aria-hidden="true" /></summary><form className="register-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); reviewProvider.mutate({ id: provider.id, body: { region: form.get("region"), privacyUrl: form.get("privacyUrl"), contractStatus: form.get("contractStatus"), subprocessorReviewed: form.get("subprocessorReviewed") === "on", deletionReviewed: form.get("deletionReviewed") === "on", breachTermsReviewed: form.get("breachTermsReviewed") === "on", evidenceReference: form.get("evidenceReference"), reason: form.get("reason") } }); }}><div className="form-grid"><label className="field"><span>Processing region</span><input name="region" defaultValue={provider.region ?? ""} required autoComplete="off" /></label><label className="field"><span>Contract status</span><select name="contractStatus" defaultValue={provider.contractStatus}><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option></select></label></div><label className="field"><span>Privacy URL</span><input name="privacyUrl" type="url" defaultValue={provider.privacyUrl ?? ""} required autoComplete="off" spellCheck={false} /></label><div className="register-checklist"><label><input name="subprocessorReviewed" type="checkbox" defaultChecked={provider.subprocessorReviewed} /><span>Subprocessors & transfers reviewed</span></label><label><input name="deletionReviewed" type="checkbox" defaultChecked={provider.deletionReviewed} /><span>Deletion & retention reviewed</span></label><label><input name="breachTermsReviewed" type="checkbox" defaultChecked={provider.breachTermsReviewed} /><span>Breach terms reviewed</span></label></div><div className="form-grid"><label className="field"><span>Evidence reference</span><input name="evidenceReference" defaultValue={provider.evidenceReference ?? ""} required autoComplete="off" /></label><label className="field"><span>Review reason</span><input name="reason" required autoComplete="off" /></label></div><SubmitButton pending={reviewProvider.isPending}>Record Provider Review</SubmitButton></form></details>)}</div>}</DataState>
      </section>

      <section className="compliance-register-section">
        <header><span className="register-icon"><LockKeyhole aria-hidden="true" /></span><div><h3>Legal Holds</h3><p>Active holds pause automated deletion for a defined case or record.</p></div></header>
        <DataState query={holds} emptyTitle="No legal holds recorded">{(rows) => <div className="register-list">{rows.map((hold: any) => <article key={hold.id}><div><strong>{humanise(hold.targetType)}</strong><code>{hold.targetId}</code><p>{hold.reason}</p></div><StatusBadge value={hold.releasedAt ? "RELEASED" : "ACTIVE"} /></article>)}</div>}</DataState>
        <details className="register-editor"><summary>Create Legal Hold <ChevronDown aria-hidden="true" /></summary><form className="register-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); createHold.mutate({ targetType: form.get("targetType"), targetId: form.get("targetId"), reason: form.get("reason"), reviewAt: form.get("reviewAt") }); }}><div className="form-grid"><label className="field"><span>Target type</span><select name="targetType"><option value="USER">User</option><option value="LISTING">Listing</option><option value="REPORT">Report</option><option value="TRANSACTION">Transaction</option><option value="CONVERSATION">Conversation</option></select></label><label className="field"><span>Target UUID</span><input name="targetId" required autoComplete="off" spellCheck={false} /></label></div><label className="field"><span>Reason</span><textarea name="reason" minLength={10} required placeholder="Explain the scope and legal basis…" /></label><label className="field"><span>Review date</span><input name="reviewAt" type="datetime-local" required /></label><SubmitButton pending={createHold.isPending}>Create Legal Hold</SubmitButton>{createHold.error ? <p className="field-error" role="alert">{createHold.error.message}</p> : null}</form></details>
      </section>

      <section className="compliance-register-section">
        <header><span className="register-icon"><UsersRound aria-hidden="true" /></span><div><h3>Staff Access Review</h3><p>Confirm that each privileged role remains necessary.</p></div></header>
        <DataState query={access} emptyTitle="No staff access to review">{(data) => <div className="access-review-list">{data.staff?.map((member: any) => <form key={`${member.userId}-${member.role}`} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); reviewAccess.mutate({ id: member.userId, body: { outcome: form.get("outcome"), reason: form.get("reason") } }); }}><div className="access-review-person"><span><UsersRound aria-hidden="true" /></span><div><strong>{member.displayName}</strong><p>{member.email}</p><small>{humanise(member.role)}</small></div></div><label><span className="sr-only">Review outcome for {member.displayName}</span><select name="outcome"><option value="RETAIN">Retain access</option><option value="CHANGE_REQUIRED">Change required</option><option value="REMOVE">Remove access</option></select></label><label><span className="sr-only">Review reason for {member.displayName}</span><input name="reason" placeholder="Reason…" autoComplete="off" required /></label><button className="button small secondary" disabled={reviewAccess.isPending}>{reviewAccess.isPending ? "Saving…" : "Record Review"}</button></form>)}</div>}</DataState>
      </section>
    </> : null}
  </div>;
}
