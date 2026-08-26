import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  LockKeyhole,
} from "lucide-react";
import { Link, NavLink } from "react-router-dom";
import { reportReasons } from "@campus-market/shared";
import { jsonBody, publicApi } from "../api";
import { ErrorState, Loading, SubmitButton } from "../components/UI";

type Compliance = {
  customerCareEmail: string;
  privacyEmail: string;
  grievanceRetentionDays: number;
  transactionModel: string;
  ranking: string;
};

type CaseData = {
  status: string;
  category: string;
  priority: string;
  resolvedAt?: string | null;
  response?: string | null;
  events?: Array<{ createdAt: string; message: string }>;
};

const legalLinks = [
  { to: "/terms", label: "Terms" },
  { to: "/privacy", label: "Privacy" },
  { to: "/community-rules", label: "Community" },
  { to: "/prohibited-items", label: "Prohibited items" },
  { to: "/seller-policy", label: "Selling" },
  { to: "/marketplace-disclosure", label: "How it works" },
] as const;

const reasonLabels: Record<string, string> = {
  CSAM_CHILD_SAFETY: "Child-safety material or exploitation",
  NON_CONSENSUAL_INTIMATE_IMAGE: "Non-consensual intimate imagery",
  SEXUAL_IMPERSONATION: "Sexual impersonation or deepfake",
  CREDIBLE_THREAT: "Credible threat of violence",
  DOXXING: "Doxxing or exposed private information",
  IDENTITY_IMPERSONATION: "Identity impersonation",
  COURT_GOVERNMENT_ORDER: "Court or government order",
  UNLAWFUL_CONTENT: "Other unlawful content",
  INTELLECTUAL_PROPERTY: "Intellectual-property complaint",
  PRIVACY: "Privacy complaint",
  OTHER: "Other complaint",
};

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: string | Date) {
  const normalized = typeof value === "string" && isoDatePattern.test(value)
    ? `${value}T00:00:00`
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value: string | Date) {
  const date = parseDate(value);
  return date
    ? dateTimeFormatter.format(date)
    : typeof value === "string" && value
      ? value
      : "Date unavailable";
}

function humanise(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
}

function useCompliance() {
  return useQuery({
    queryKey: ["public-compliance", 2],
    queryFn: () => publicApi<Compliance>("/api/compliance", { cache: "no-store" }),
    staleTime: 0,
    refetchOnMount: "always",
  });
}

function LegalPage({ title, summary, children }: { title: string; summary: string; children: (data: Compliance) => ReactNode }) {
  const query = useCompliance();
  if (query.isLoading) return <div className="page narrow"><Loading /></div>;
  if (query.isError) return <div className="page narrow"><ErrorState error={query.error} /></div>;
  const data = query.data!;
  return (
    <article className="page legal-page">
      <header className="legal-masthead">
        <h1>{title}</h1>
        <p>{summary}</p>
      </header>

      <nav className="legal-nav" aria-label="Legal documents">
        {legalLinks.map((item) => <NavLink key={item.to} to={item.to}>{item.label}</NavLink>)}
      </nav>

      <div className="legal-document">
          {children(data)}
          <footer className="legal-document-footer">
            <p>Questions about this policy? Email <a href={`mailto:${data.customerCareEmail}`}>{data.customerCareEmail}</a>.</p>
            <Link to="/grievance">Report a safety or legal issue <ArrowRight aria-hidden="true" /></Link>
          </footer>
      </div>
    </article>
  );
}

export function TermsPage() {
  return <LegalPage title="Terms of Use" summary="The agreement for using Uni Market and trading directly with another member.">{(data) => <>
    <h2>1. Eligibility & account security</h2>
    <p>You may browse with an ordinary Google account. To list, message, transact, review, favourite, or use member support, you must be at least 18, verify an Indian mobile number, verify a separate student email from an approved academic domain, and accept the current policies.</p>
    <p>Student-email verification expires after 12 months. Keep credentials and OTPs confidential, and do not create deceptive or duplicate accounts.</p>
    <h2>2. Independent platform</h2><p>Uni Market is an independent marketplace and is not affiliated with, endorsed by, sponsored by, or operated by any university, college, or educational institution. Institution names and email domains are used only to verify eligibility.</p>
    <h2>3. Uni Market’s role</h2><p>{data.transactionModel}</p>
    <h2>4. Your promises</h2>
    <p>Every listing must be a used physical item you own or may lawfully sell. Its description, price, condition, defects, and images must be accurate. Declare synthetic or materially altered images, and never list a prohibited item.</p>
    <h2>5. Moderation & enforcement</h2>
    <p>We may review, reject, label, restrict, preserve, or remove content; suspend or close accounts; prevent risky messages; cooperate with valid legal process; and preserve records under a legal hold. Automated rules can flag risk, but staff review material enforcement decisions.</p>
    <h2>6. Liability</h2>
    <p>To the extent permitted by law, Uni Market is provided on an “as available” basis. We do not guarantee a seller, buyer, item, price, availability, safety, or transaction outcome. Nothing excludes rights or remedies that cannot lawfully be excluded.</p>
    <h2>7. Governing law</h2><p>Indian law applies. Mandatory statutory rights and forums continue to apply.</p>
  </>}</LegalPage>;
}

export function PrivacyPage() {
  return <LegalPage title="Privacy Notice" summary="What we collect, why we need it, and the controls available to you.">{(data) => <>
    <h2>Data we use</h2><p>We use Google identity details, account profile, encrypted student email, verified phone, eligibility and policy records, listings and images, messages, transaction states, reports, support correspondence, security events, device and network metadata, and audit records.</p>
    <h2>Why we use it</h2><p>We use data to provide and secure the service, verify eligibility, moderate content, prevent scams, communicate about accounts and grievances, meet legal obligations, resolve disputes, and establish or defend claims. We do not sell personal data or use marketplace data for unrelated advertising.</p>
    <h2>Sharing</h2><p>We disclose data only where a feature requires it, to service providers needed to run the platform, to professional advisers, or to authorities where lawfully required.</p>
    <h2>Retention & deletion</h2><p>Closing an account immediately revokes its sessions. We schedule the account for deletion or irreversible anonymisation after 180 days. Closed grievance content is scheduled for erasure after {data.grievanceRetentionDays} days. Active cases, fraud, disputes, audits, statutory duties, and documented legal holds may require restricted records to be kept longer.</p>
    <h2>Your choices</h2><p>From Settings you can download account data, revoke sessions, and request deletion. For access, correction, erasure, consent withdrawal, or privacy review, email <a href={`mailto:${data.privacyEmail}`}>{data.privacyEmail}</a>.</p>
  </>}</LegalPage>;
}

export function CommunityRulesPage() {
  return <LegalPage title="Community Rules" summary="Simple standards for honest listings, respectful conversation, and safer exchanges.">{() => <>
    <h2>Be honest & respectful</h2><p>Do not impersonate another person, misrepresent affiliation, manipulate reviews, spam, harass, threaten, discriminate, dox, or publish another person’s intimate or private information. Do not evade a suspension or coordinate deceptive accounts.</p>
    <h2>Keep exchanges safe</h2><p>Never request or share an OTP, password, recovery code, card PIN, or remote-access credentials. Do not demand advance fees or use fabricated payment screenshots. Inspect the item before paying and meet in a well-lit public place.</p>
    <h2>Report urgent harm</h2><p>Use the <Link to="/grievance">safety reporting form</Link> for child-safety material, non-consensual intimate imagery, sexual impersonation, credible threats, doxxing, or identity impersonation. If anyone is in immediate danger, contact local emergency services or law enforcement first.</p>
  </>}</LegalPage>;
}

export function ProhibitedItemsPage() {
  return <LegalPage title="Prohibited Items" summary="Uni Market is only for lawful, used physical goods.">{() => <>
    <p>New goods, services, digital products, tickets, accounts, credentials, memberships, subscriptions, payment instruments, gift cards, and rentals are outside the marketplace.</p>
    <h2>Never permitted</h2>
    <ul>
      <li><strong>Dangerous or regulated goods:</strong> weapons, ammunition, explosives, fireworks, drugs, tobacco, vapes, alcohol, unlawfully offered medicines or medical devices, hazardous materials, and recalled goods.</li>
      <li><strong>Stolen or deceptive goods:</strong> stolen property, counterfeits, piracy devices, forged documents, government IDs, SIM cards, and bank or payment accounts.</li>
      <li><strong>Exploitative or invasive material:</strong> pornography, sexual services, child sexual abuse material, non-consensual intimate imagery, hate or extremist material, personal data, and surveillance tools offered for misuse.</li>
      <li><strong>Academic misconduct:</strong> exam papers, answer keys, assignment-writing, fabricated certificates, and credentials.</li>
      <li><strong>Wildlife or human material:</strong> human remains, animals, wildlife products, or anything whose sale or possession is unlawful.</li>
    </ul>
    <h2>How we enforce this</h2><p>Disguising an item through spelling, images, bundles, coded language, or off-platform redirects is prohibited. Listings are reviewed before publication and may be removed or referred to authorities where required.</p>
  </>}</LegalPage>;
}

export function SellerPolicyPage() {
  return <LegalPage title="Seller Policy" summary="What every seller must disclose before a listing can go live.">{() => <>
    <p>Before saving or submitting a listing, confirm lawful ownership, that the item is a used physical good, that the description is accurate, and that you accept this policy.</p>
    <h2>Describe the actual item</h2><p>Disclose its condition, material defects, working status, inclusions, price or price range, pickup area, and whether each image is synthetic or materially altered. Images must depict the actual item unless clearly labelled.</p>
    <h2>You are responsible for the sale</h2><p>The seller—not Uni Market—is responsible for title, legality, authenticity, description, agreed price, handover, promised returns, tax obligations, and any consumer-law obligations that apply to the seller.</p>
  </>}</LegalPage>;
}

export function MarketplaceDisclosurePage() {
  return <LegalPage title="How the Marketplace Works" summary="A plain-language explanation of exchanges, ranking, and responsibility.">{(data) => <>
    <h2>Direct exchanges</h2><p>{data.transactionModel}</p>
    <h2>How listings are ranked</h2><p>{data.ranking}</p>
    <h2>Who is responsible</h2><p>Each listing identifies its user seller. Uni Market connects users; it is not the seller and does not collect transaction payment.</p>
  </>}</LegalPage>;
}

export function GrievancePage() {
  const [receipt, setReceipt] = useState<{ reference: string; trackingSecret: string; acknowledgeDueAt: string; actionDueAt: string }>();
  const create = useMutation({ mutationFn: (body: unknown) => publicApi<any>("/api/grievances", { method: "POST", ...jsonBody(body) }), onSuccess: setReceipt });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    create.mutate({ email: form.get("email"), reason: form.get("reason"), affectedPerson: form.get("affectedPerson") === "on", targetUrl: form.get("targetUrl"), details: form.get("details"), authorityDeclaration: form.get("authorityDeclaration") === "on" });
  }
  return <div className="page grievance-page">
    <header className="grievance-masthead"><h1>Report a Grievance</h1><p>No account is required. Share the location and facts; never upload or reproduce harmful material here.</p></header>
    <div className="grievance-layout">
      {receipt ? <section className="grievance-receipt" role="status" aria-live="polite">
        <span className="grievance-receipt-icon"><CheckCircle2 aria-hidden="true" /></span><h2>Keep these details safe</h2>
        <dl><div><dt>Reference</dt><dd><code>{receipt.reference}</code></dd></div><div><dt>Tracking secret</dt><dd><code>{receipt.trackingSecret}</code></dd></div></dl>
        <p>Keep the tracking secret private. You need both values to view updates or request another review.</p>
        <div className="grievance-deadlines"><span><Clock3 aria-hidden="true" /> Acknowledgement by {formatDateTime(receipt.acknowledgeDueAt)}</span><span><Clock3 aria-hidden="true" /> Action target {formatDateTime(receipt.actionDueAt)}</span></div>
        <Link className="button primary" to="/grievance/track">Track This Case</Link>
      </section> : <form className="compliance-form" onSubmit={submit}>
        <div className="compliance-form-heading"><h2>Tell us what happened</h2><p>We will send the private tracking details to this email.</p></div>
        <div className="form-grid"><label className="field"><span>Your email</span><input name="email" type="email" required autoComplete="email" spellCheck={false} /></label><label className="field"><span>Issue category</span><select name="reason" required defaultValue="OTHER">{reportReasons.map((reason) => <option key={reason} value={reason}>{reasonLabels[reason] ?? humanise(reason)}</option>)}</select></label></div>
        <label className="field"><span>Uni Market link to the listing, profile, message, or content (optional)</span><input name="targetUrl" type="url" autoComplete="off" spellCheck={false} placeholder="https://uni.rocks/…" /></label>
        <label className="field"><span>What happened?</span><textarea name="details" minLength={20} maxLength={5000} required placeholder="Describe what happened, where it appears, and what you need us to do…" /></label>
        <div className="compliance-checks"><label><input name="affectedPerson" type="checkbox" /><span>I am the person affected by this content or conduct.</span></label><label><input name="authorityDeclaration" type="checkbox" /><span>If this is an official order, I confirm I am authorised to submit it.</span></label></div>
        <p className="form-privacy-note">Your email, link, and complaint details are used only to investigate and respond to this report. See the <Link to="/privacy">Privacy Notice</Link>.</p>
        <div className="grievance-form-actions"><SubmitButton pending={create.isPending}>Submit Grievance</SubmitButton><Link to="/grievance/track">Track an existing report <ArrowRight aria-hidden="true" /></Link></div>{create.error ? <p className="field-error" role="alert">{create.error.message}</p> : null}
      </form>}
    </div>
  </div>;
}

export function GrievanceTrackPage() {
  const [caseData, setCaseData] = useState<CaseData>();
  const [credentials, setCredentials] = useState<{ reference: string; secret: string }>();
  const [confirmation, setConfirmation] = useState<string>();
  const track = useMutation({ mutationFn: (body: { reference: string; secret: string }) => publicApi<CaseData>("/api/grievances/track", { method: "POST", ...jsonBody(body) }), onSuccess: (data, values) => { setCaseData(data); setCredentials(values); } });
  const followUp = useMutation({ mutationFn: (message: string) => publicApi(`/api/grievances/${encodeURIComponent(credentials!.reference)}/messages`, { method: "POST", ...jsonBody({ secret: credentials!.secret, message }) }), onSuccess: () => { setConfirmation("Your follow-up was added to the case."); if (credentials) track.mutate(credentials); } });
  const appeal = useMutation({ mutationFn: (reason: string) => publicApi(`/api/grievances/${encodeURIComponent(credentials!.reference)}/appeal`, { method: "POST", ...jsonBody({ secret: credentials!.secret, reason }) }), onSuccess: () => { setConfirmation("Your appeal was submitted for further review."); if (credentials) track.mutate(credentials); } });
  return <div className="page grievance-page grievance-track-page">
    <header className="grievance-masthead"><h1>Track a Grievance</h1><p>Enter the reference and private tracking secret from your receipt. These credentials keep your case private.</p></header>
    <form className="case-access-form" onSubmit={(event) => { event.preventDefault(); setConfirmation(undefined); const form = new FormData(event.currentTarget); track.mutate({ reference: String(form.get("reference")), secret: String(form.get("secret")) }); }}>
      <LockKeyhole aria-hidden="true" /><div className="form-grid"><label className="field"><span>Reference</span><input name="reference" required autoComplete="off" spellCheck={false} /></label><label className="field"><span>Tracking secret</span><input name="secret" type="password" autoComplete="off" required spellCheck={false} /></label></div><SubmitButton pending={track.isPending}>View Case Status</SubmitButton>{track.error ? <p className="field-error" role="alert">{track.error.message}</p> : null}
    </form>
    {caseData ? <div className="case-workspace">
      <section className="case-summary"><div><h2>{humanise(caseData.status)}</h2></div><dl><div><dt>Category</dt><dd>{humanise(caseData.category)}</dd></div><div><dt>Priority</dt><dd>{humanise(caseData.priority)}</dd></div></dl>{caseData.response ? <blockquote><strong>Decision</strong><p>{caseData.response}</p></blockquote> : null}</section>
      {caseData.events?.length ? <section className="case-history"><h2>Case History</h2><ol>{caseData.events.map((event, index) => <li key={`${event.createdAt}-${index}`}><span aria-hidden="true" /><div><p>{event.message}</p><time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time></div></li>)}</ol></section> : null}
      <div className="case-actions"><form className="compliance-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); followUp.mutate(String(form.get("message"))); event.currentTarget.reset(); }}><h2>Add Information</h2><label className="field"><span>Additional factual information</span><textarea name="message" minLength={2} maxLength={5000} required placeholder="Add relevant details without reproducing harmful material…" /></label><SubmitButton pending={followUp.isPending}>Send Follow-up</SubmitButton>{followUp.error ? <p className="field-error" role="alert">{followUp.error.message}</p> : null}</form>
      {caseData.resolvedAt ? <form className="compliance-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); appeal.mutate(String(form.get("reason"))); }}><h2>Request Another Review</h2><p>Explain why the decision should receive another internal review.</p><label className="field"><span>Reason for review</span><textarea name="reason" minLength={10} maxLength={5000} required placeholder="Explain what should be reconsidered…" /></label><SubmitButton pending={appeal.isPending}>Request Review</SubmitButton>{appeal.error ? <p className="field-error" role="alert">{appeal.error.message}</p> : null}</form> : null}</div>
      <p className="gac-notice">If you disagree with a decision, or the grievance is not resolved within the applicable deadline, you may file an external appeal with India’s <a href="https://gac.gov.in" target="_blank" rel="noreferrer">Grievance Appellate Committee</a>. Appeals should normally be filed within 30 days.</p>
      {confirmation ? <p className="case-confirmation" role="status" aria-live="polite">{confirmation}</p> : null}
    </div> : null}
  </div>;
}
