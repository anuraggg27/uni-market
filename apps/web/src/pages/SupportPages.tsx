import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Info, LifeBuoy, Lightbulb, Plus, SendHorizontal } from "lucide-react";
import { toast } from "sonner";
import { api, jsonBody } from "../api";
import { useAuth } from "../auth";
import { EmptyState, ErrorState, Loading, SubmitButton } from "../components/UI";
import { UserAvatar } from "../components/UserAvatar";
import { ReportButton } from "../components/ReportButton";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "../components/ui/sheet";
import "./SupportPages.css";

type Ticket = {
  id: string; userId: string; subject: string; description: string; category: string;
  status: "OPEN" | "ASSIGNED" | "WAITING_FOR_USER" | "RESOLVED" | "CLOSED";
  createdAt: string; updatedAt: string; resolvedAt: string | null;
};
type Message = { id: string; senderId: string; senderName: string; body: string; createdAt: string };
type Thread = Ticket & { messages: Message[] };
const statuses = { OPEN: "Open", ASSIGNED: "Assigned", WAITING_FOR_USER: "Waiting for you", RESOLVED: "Resolved", CLOSED: "Closed" };
const categories: Record<string, string> = { ACCOUNT: "Account", LISTING: "Listing", TRANSACTION: "Transaction", SAFETY: "Safety", TECHNICAL: "Technical", OTHER: "Other" };
const date = (value: string) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const time = (value: string) => new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const inactive = (ticket: Ticket) => ticket.status === "CLOSED" || ticket.status === "RESOLVED";
function SupportStatus({ ticket }: { ticket: Ticket }) {
  return <span className={`support-status support-status-${ticket.status.toLowerCase()}`}>{statuses[ticket.status]}</span>;
}
function SupportDetails({ ticket }: { ticket: Thread }) {
  const client = useQueryClient();
  const reopen = useMutation({
    mutationFn: () => api(`/api/support/${ticket.id}/reopen`, { method: "POST" }),
    onSuccess: () => { toast.success("Request reopened"); void client.invalidateQueries({ queryKey: ["support"] }); },
  });
  const canReopen = ticket.status === "RESOLVED" && ticket.resolvedAt
    && Date.now() - new Date(ticket.resolvedAt).getTime() <= 14 * 24 * 60 * 60_000;
  return <div className="support-details-content">
    <h2>Conversation details</h2>
    <dl>
      <div><dt>Request ID</dt><dd className="support-request-id" title={ticket.id}>{ticket.id}</dd></div>
      <div><dt>Status</dt><dd><SupportStatus ticket={ticket} /></dd></div>
      <div><dt>Category</dt><dd>{categories[ticket.category] ?? ticket.category}</dd></div>
      <div><dt>Created on</dt><dd>{date(ticket.createdAt)}, {time(ticket.createdAt)}</dd></div>
      <div><dt>Last updated</dt><dd>{date(ticket.updatedAt)}, {time(ticket.updatedAt)}</dd></div>
    </dl>
    {canReopen ? <section className="support-quick-actions"><h3>Quick actions</h3><button className="button secondary" disabled={reopen.isPending} onClick={() => reopen.mutate()}>Reopen request</button>{reopen.error ? <p className="field-error" role="alert">{reopen.error.message}</p> : null}</section> : null}
    <div className="support-tip"><Lightbulb aria-hidden="true" /><div><strong>Tip</strong><p>For faster support, include relevant details, error messages, and the steps that led to the issue.</p></div></div>
  </div>;
}
function SupportConversation({ ticket }: { ticket: Thread }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const [body, setBody] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const replyInput = useRef<HTMLTextAreaElement>(null);
  const reply = useMutation({
    mutationFn: (text: string) => api(`/api/support/${ticket.id}/messages`, { method: "POST", ...jsonBody({ body: text }) }),
    onSuccess: () => { setBody(""); toast.success("Reply sent"); void client.invalidateQueries({ queryKey: ["support"] }); },
  });
  useEffect(() => { messagesEnd.current?.scrollIntoView({ block: "nearest" }); }, [ticket.id, ticket.messages.length]);
  useEffect(() => {
    const input = replyInput.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 112)}px`;
  }, [body]);
  const messages: Message[] = [{ id: "original-request", senderId: ticket.userId, senderName: user?.displayName ?? "You", body: ticket.description, createdAt: ticket.createdAt }, ...ticket.messages];
  return <>
    <section className="support-conversation" aria-label="Support conversation">
      <header className="support-conversation-header">
        <Link className="support-back button ghost" to="/support" aria-label="All support requests"><ArrowLeft /></Link>
        <span className="support-icon"><LifeBuoy aria-hidden="true" /></span>
        <div className="support-conversation-title"><h2>{ticket.subject}</h2><p><span title={ticket.id}>#{ticket.id.slice(0, 8)}</span> · Opened {date(ticket.createdAt)}</p></div>
        <SupportStatus ticket={ticket} />
        <button className="support-details-toggle button ghost" aria-label="Conversation details" onClick={() => setDetailsOpen(true)}><Info /></button>
      </header>
      <div className="support-thread">
        <div className="support-thread-content">
        {messages.map((message) => {
          const own = message.senderId === user?.id;
          return <article key={message.id} className={`support-message ${own ? "is-own" : ""}`}>
            {own ? <UserAvatar avatarId={user?.avatarId} displayName={user?.displayName ?? "You"} size={32} decorative /> : <span className="support-agent-avatar"><LifeBuoy aria-hidden="true" /></span>}
            <div className="support-message-content">
              <div className="support-message-meta"><strong>{own ? "You" : message.senderName || "Uni Market Support"}</strong><time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>{time(message.createdAt)}</time></div>
              <div className="support-bubble">{message.body}</div>
              {!own ? <ReportButton targetType="SUPPORT_RESPONSE" targetId={message.id} label="Report response" /> : null}
            </div>
          </article>;
        })}
        {!ticket.messages.length ? <p className="support-queued">Your request is queued. The team will reply here.</p> : null}
        <div ref={messagesEnd} />
        </div>
      </div>
      {ticket.status !== "CLOSED" ? <form className="support-composer" onSubmit={(event) => { event.preventDefault(); if (body.trim() && !reply.isPending) reply.mutate(body); }}>
        <label className="sr-only" htmlFor="support-reply">Reply</label>
        <textarea ref={replyInput} id="support-reply" name="body" placeholder="Type a message..." value={body} onChange={(event) => setBody(event.target.value)} maxLength={5000} required rows={1} disabled={reply.isPending} />
        <button className="button primary" type="submit" aria-label="Send reply" disabled={!body.trim() || reply.isPending}><SendHorizontal aria-hidden="true" /></button>
        {reply.error ? <p className="field-error" role="alert">{reply.error.message}</p> : null}
      </form> : <p className="support-closed-note">This request is closed. Create a new request if you need more help.</p>}
    </section>
    <aside className="support-details"><SupportDetails ticket={ticket} /></aside>
    <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}><SheetContent className="support-sheet"><SheetTitle>Request information</SheetTitle><SheetDescription>Details and available actions for this conversation.</SheetDescription><SupportDetails ticket={ticket} /></SheetContent></Sheet>
  </>;
}
function NewSupportRequest({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const create = useMutation({
    mutationFn: (data: { category: string; subject: string; description: string }) => api<Ticket>("/api/support", { method: "POST", ...jsonBody(data) }),
    onSuccess: (ticket) => { toast.success("Support request created"); void client.invalidateQueries({ queryKey: ["support"] }); onOpenChange(false); navigate(`/support/${ticket.id}`); },
  });
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="support-sheet">
    <SheetTitle>New support request</SheetTitle><SheetDescription>Tell us what happened and our support team will help.</SheetDescription>
    <form className="form" onSubmit={(event) => { event.preventDefault(); if (create.isPending) return; const f = new FormData(event.currentTarget); create.mutate({ category: String(f.get("category")), subject: String(f.get("subject")), description: String(f.get("description")) }); }}>
      <label className="field"><span>Category</span><select name="category">{Object.entries(categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="field"><span>Subject</span><input name="subject" minLength={4} maxLength={120} required /></label>
      <label className="field"><span>Describe the issue</span><textarea name="description" minLength={20} maxLength={5000} required /></label>
      <SubmitButton pending={create.isPending}>Open request</SubmitButton>
      {create.error ? <p className="field-error" role="alert">{create.error.message}</p> : null}
    </form>
  </SheetContent></Sheet>;
}
export function SupportPage() {
  const { ticketId } = useParams();
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ["support"], queryFn: () => api<Ticket[]>("/api/support") });
  const detail = useQuery({ queryKey: ["support", ticketId], queryFn: () => api<Thread>(`/api/support/${ticketId}`), enabled: Boolean(ticketId) });
  const tickets = list.data ?? [];
  const counts = { all: tickets.length, open: tickets.filter((t) => !inactive(t)).length, closed: tickets.filter(inactive).length };
  const visible = tickets.filter((t) => filter === "all" || (filter === "closed" ? inactive(t) : !inactive(t)));
  return <div className={`page support-page ${ticketId ? "has-selection" : ""}`}>
    <header className="support-page-header"><span className="support-eyebrow">Support</span><h1>Help &amp; Support</h1><p>We're here to help. Chat with our support team about any issue.</p></header>
    <div className="support-workspace">
      <nav className="support-request-list" aria-label="Support requests">
        <div className="support-list-toolbar"><button className="button primary" onClick={() => setCreating(true)}><Plus aria-hidden="true" />New support request</button>
          <div className="support-filters" role="group" aria-label="Filter support requests">{(["all", "open", "closed"] as const).map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === "all" ? "All" : value === "open" ? "Open" : "Closed"}<span>{counts[value]}</span></button>)}</div>
        </div>
        <div className="support-request-rows">{list.isLoading ? <Loading label="Loading support requests" /> : list.isError ? <ErrorState error={list.error} /> : !visible.length ? <EmptyState title="No support requests" body={filter === "all" ? "Open a request and the team will respond here." : "No requests match this filter."} /> : visible.map((ticket) => <Link className={`support-request-row ${ticketId === ticket.id ? "is-selected" : ""}`} key={ticket.id} to={`/support/${ticket.id}`} aria-current={ticketId === ticket.id ? "page" : undefined}>
          <span className="support-icon"><LifeBuoy aria-hidden="true" /></span><div className="support-request-copy"><h2>{ticket.subject}</h2><p>{ticket.description}</p></div><div className="support-request-meta"><time dateTime={ticket.updatedAt}>{new Date(ticket.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time><SupportStatus ticket={ticket} /></div>
        </Link>)}</div>
      </nav>
      {ticketId ? detail.isLoading ? <section className="support-conversation"><Loading label="Loading support request" /></section> : detail.isError ? <section className="support-conversation"><Link className="button secondary" to="/support">All support requests</Link><ErrorState error={detail.error} /></section> : detail.data ? <SupportConversation key={ticketId} ticket={detail.data} /> : null : <section className="support-no-selection"><LifeBuoy aria-hidden="true" /><h2>How can we help?</h2><p>Select a request to continue the conversation, or open a new support request.</p><button className="button secondary" onClick={() => setCreating(true)}>New support request</button></section>}
    </div>
    <NewSupportRequest open={creating} onOpenChange={setCreating} />
  </div>;
}
export function SupportDetailPage() { return <SupportPage />; }
