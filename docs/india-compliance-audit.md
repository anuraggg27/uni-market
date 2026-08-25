# India Compliance and Misuse Audit

**System:** Uni Market / `uni.rocks`
**Audit date:** 25 August 2026
**Version:** 1.0
**Status:** Pre-launch remediation baseline
**Scope:** Repository, configuration, automated tests, and publicly reachable web application

> This is a product and engineering compliance assessment, not a legal opinion. Indian counsel should validate the legal classifications, public policies, retention schedule, grievance appointments, and regulated-goods catalogue before launch.

> **Implementation update — 26 August 2026:** Most engineering remediations from this baseline are implemented in the working tree. At the owner's direction, the public application intentionally omits the legal operator name, operator address, fixed jurisdiction city, and named Grievance Officer; policy versions are retained as internal consent evidence but not repeated in the legal-page UI. These are accepted launch risks rather than completed remediations. This document preserves the original findings for traceability. See `docs/compliance-operations.md`.

## 1. Executive decision

The baseline platform had a credible security and moderation foundation, but was **not ready for a broad public launch in India**. The principal baseline blockers were missing public legal policies and operator disclosures; unrestricted marketplace access despite the stated student-only and 18+ model; no public statutory grievance channel or deadline engine; incomplete marketplace/seller disclosures; no emergency-content workflow; and no documented CERT-In or data-governance programme.

These are mostly governance and product-surface gaps, not evidence that the platform is currently unlawful. Several obligations depend on the platform's final legal classification and facts of operation. Resolve all P0 items in section 10 and obtain Indian counsel sign-off before inviting users beyond a controlled test group.

### Risk summary

| Rating | Count | Meaning |
|---|---:|---|
| Critical | 0 | No confirmed actively exploited or immediately catastrophic defect found |
| High | 15 | Launch blocker or material legal/safety exposure |
| Medium | 4 | Required maturity work or conditional exposure |
| Low | 1 | Hygiene or assurance improvement |

## 2. Approved operating model

This assessment assumes the following product boundaries. A change to any boundary triggers the legal review in section 14.

- The service is operated by an independent, India-incorporated company formed before launch.
- The brand is neutral and makes no claim of affiliation with UPES or any university.
- Users must be at least 18 years old and must verify an email domain belonging to a recognised Indian university or college.
- Support may add an institution's official domain after verification; there is no identity-document fallback.
- Only used physical goods may be listed. Services, digital goods, tickets, accounts, and academic work are not allowed.
- Buyers and sellers communicate through the platform and complete exchanges offline.
- The platform does not collect money, charge transaction fees, provide escrow, arrange shipping, guarantee goods, or act as seller.
- The initial user base is below the significant social media intermediary threshold.

At the time of the baseline, the product contradicted two of these assumptions: it accepted any verified Google account for marketplace activity and did not capture an 18+ attestation. The remediated flow permits ordinary Google sign-in for browsing but gates marketplace activity on a separately verified student email, Indian phone, explicit 18+ declaration, and current policy acceptance.

## 3. Method and limitations

The audit covered:

- authentication, session, user-profile, listing, messaging, reporting, support, moderation, audit, and upload code;
- database schema and migrations;
- deployment and security configuration;
- browser-visible login, navigation, footer, and public pages;
- automated test, dependency, type, build, and browser-test baselines; and
- current central Indian statutes, rules, directions, and official government guidance relevant to the approved model.

It did not include penetration testing, cloud-account inspection, employee interviews, contract review, production database inspection, Android/iOS applications, state-specific trade licensing, or a legal opinion. Assertions about operational practice must be evidenced outside the repository before they can be treated as implemented.

### Rating definitions

- **High:** address before public launch unless counsel formally accepts the risk.
- **Medium:** address in the first 30–90 days, or before the affected feature is enabled.
- **Low:** assurance improvement with limited immediate exposure.
- **Current:** an obligation already in force as of the audit date.
- **Staged:** enacted or notified but its relevant substantive provisions have a future commencement date.
- **Conditional:** applicability depends on facts such as legal classification, scale, goods, or business-model changes.

## 4. Positive controls already present

The following controls materially reduce risk and should be preserved:

- Google identity email verification, server-side sessions stored as hashes, `HttpOnly`, `Secure`, `SameSite=Lax` cookies, and CSRF protection.
- Exact-origin CORS, Helmet/CSP, typed validation, parameterised database access, role checks, account suspension, rate limits, and Turnstile controls.
- Private object storage, signed image access, content-type and magic-byte validation, image size limits, and server-side re-encoding.
- Manual approval of every listing, prohibited-term administration, reporting, blocking, moderator notes, seller notifications, and moderation audit logs.
- Reported-conversation access limited to a relevant time window and recorded in the audit log.
- Database constraints around identity, conversations, messages, reviews, reservations, and transaction state.
- Log-redaction utilities and a security-oriented deployment configuration.

These controls are useful evidence of reasonable care, but they do not substitute for public notices, statutory procedures, documented operating controls, or verified execution.

## 5. Legal applicability and timing

### 5.1 Information Technology Act and Intermediary Rules — current

The service allows users to publish listings, reviews, and messages and should be operated on the assumption that it is an intermediary for those activities. Safe-harbour protection is conditional, not automatic. The current Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules require prominently published rules, privacy policy, and user agreement; notice to users about prohibited information; a grievance mechanism and officer; preservation duties; cooperation with lawful orders; and observance of the prescribed content and complaint deadlines.

The rules were amended on 10 February 2026. The implementation must be built against the consolidated current text, not older summaries. The current operational targets relevant here include:

| Event | Maximum target |
|---|---:|
| Acknowledge an ordinary grievance | 24 hours |
| Resolve an ordinary grievance | 7 days |
| Act on specified unlawful-content complaints | 36 hours |
| Act on intimate imagery, sexual impersonation, or similar victim complaints | 2 hours |
| Remove/disable content upon qualifying court or government notice | 3 hours |
| Preserve registration information after cancellation | 180 days |
| Preserve removed content and associated records | 180 days, or longer when lawfully required |

The 2026 amendments also introduce duties concerning synthetically generated information. Because users can upload images, the final control design must be reviewed against Rule 3(3), including prevention of specified unlawful synthetic information, visible labelling, and provenance/metadata for permitted synthetic information. The express user-declaration and declaration-verification duty in Rule 4(1A) applies to significant social media intermediaries; under the approved below-threshold assumption, a declaration here is a proposed control rather than a claim that Rule 4(1A) already applies. The current WebP re-encoding pipeline removes source metadata, so this cannot be treated as a policy-only issue.

### 5.2 Digital Personal Data Protection Act and Rules — staged readiness

The Digital Personal Data Protection Act, 2023 and Digital Personal Data Protection Rules, 2025 use staged commencement. The principal notice, consent, data-principal rights, security, breach, processor, and related operational obligations relevant to this product are scheduled to commence on **13 May 2027**, eighteen months after notification of the Rules, unless the Government changes the schedule.

The platform should implement readiness now because its user, message, report, transaction, device, and authentication data will persist into the commencement date. Do not label staged duties as already in force; do not wait until May 2027 to build the required controls.

The approved 18+ restriction avoids designing a child-consent flow, but it must be technically enforced and truthfully described. If minors are later permitted, the child-data analysis must be redone before that change.

### 5.3 Consumer and e-commerce law — current, classification to confirm

The Consumer Protection Act, Consumer Protection (E-Commerce) Rules, and dark-pattern guidelines may apply to a marketplace facilitating peer-to-peer goods transactions even when settlement occurs offline. Indian counsel must confirm the exact classification and which seller-information duties apply to individual student sellers.

The conservative implementation is to provide clear operator and grievance disclosures, seller undertakings, accurate listing and product information, complaint tracking, ranking disclosures, and unambiguous explanations of the platform's role. Any return, refund, warranty, delivery, payment, or guarantee representation must be accurate; where the service does not provide one, the interface should state that clearly before a user commits to meet.

### 5.4 CERT-In Directions — current

The incident-response programme should assume the CERT-In Directions apply. It needs a designated point of contact, synchronised clocks, secure information and communications technology logs retained for a rolling 180 days within India, and a process capable of reporting specified cyber incidents within six hours of noticing them or being brought to notice.

### 5.5 Product and content laws — current or conditional

The prohibited-goods and escalation programme must account for, at minimum, intellectual-property law, the Bharatiya Nyaya Sanhita, POCSO mandatory-reporting duties, the Arms Act, Explosives Act, NDPS Act, Drugs and Cosmetics law, tobacco restrictions, Legal Metrology requirements, and product-specific BIS compulsory certification. Tax and GST analysis changes if the platform charges fees, intermediates payment, or admits business sellers. Counsel must convert this legal universe into an approved, maintainable catalogue rather than relying on keyword intuition.

## 6. Findings register

### IND-01 — Legal operator and public identity are absent

**Rating:** High · **Status:** Current/conditional · **Owner:** Founders + Legal

No legal entity name, registered address, customer-care contact, grievance officer, or institutional non-affiliation statement appears in the repository's public UI. The approved model requires an entity before launch, but the running service currently presents no accountable operator.

**Remediation and acceptance:** Form the operator; obtain tax and corporate advice; publish its exact legal name, registered and customer-care addresses, email/phone where required, grievance details, and an explicit statement that the service is independent and not affiliated with or endorsed by listed institutions. Counsel must approve placement and wording. The footer and each legal document must expose these details without requiring sign-in.

### IND-02 — No Terms, Privacy Notice, Community Rules, or policy acceptance

**Rating:** High · **Status:** Current · **Owner:** Legal + Product + Engineering

`apps/web/src/App.tsx` has no legal-policy routes and `apps/web/src/components/Layout.tsx` has no legal links. No user-facing terms, privacy notice, seller rules, community rules, or versioned acceptance records were found. Internal moderation notes are not a substitute for prominently published user rules.

**Remediation and acceptance:** Publish counsel-approved documents at stable, public URLs; link them from onboarding, listing creation, reporting, and every page footer; capture document version, timestamp, user, locale, and acceptance source; require re-acceptance for material changes; and retain evidence. Create the quarterly user-notice process required by the Intermediary Rules and preserve dispatch evidence.

### IND-03 — Statutory grievance mechanism is missing

**Rating:** High · **Status:** Current · **Owner:** Grievance Officer + Engineering

Reports and support tickets require a signed-in, verified user. There is no public grievance officer page, victim/non-user intake, formal receipt, complainant status page, appellate information, or deadline-based routing. The existing report workflow has no fields enforcing the two-hour, three-hour, 36-hour, or seven-day deadlines.

**Remediation and acceptance:** Appoint a resident grievance officer as applicable; publish contact details; provide an unauthenticated, abuse-resistant intake for affected persons and lawful notices; issue an opaque receipt; categorise by statutory clock; record every decision and communication; expose status without leaking case data; and explain appeal to the Grievance Appellate Committee where applicable. Pager tests must prove urgent cases reach an on-call human in time.

### IND-04 — Student-only and 18+ eligibility is not enforced

**Rating:** High · **Status:** Product representation/data risk · **Owner:** Product + Engineering

`apps/api/src/routes/auth.ts` accepts any Google identity with a verified email. `apps/web/src/pages/PublicPages.tsx` explicitly tells users that no university email is required, and `README.md` says institution details are optional. No date-of-birth or adult attestation is recorded.

**Remediation and acceptance:** Before account creation, require an email whose domain is in a reviewed institution-domain registry and an explicit 18+ attestation. Store the verification method, domain record, timestamp, and policy versions—not identity documents. Support may add a domain only after a documented review. Existing accounts must be re-verified or restricted. Remove contradictory copy and add the non-affiliation statement.

### IND-05 — Marketplace and seller disclosures are incomplete

**Rating:** High · **Status:** Current/conditional · **Owner:** Legal + Product

Listings do not collect a seller undertaking to provide accurate information and lawful goods. The service does not publish the main ranking parameters or differentiated treatment, and does not consistently explain the offline-only transaction model, responsibility for inspecting goods, or absence of platform payment, shipping, escrow, refund, warranty, or guarantee.

**Remediation and acceptance:** Have counsel confirm application of the E-Commerce Rules to individual sellers. Add an enforceable seller declaration; truthful product/condition/ownership fields; any legally required seller and importer/manufacturer/product details; ranking and sponsored-treatment disclosure; complaint tracking; and concise role/transaction disclaimers at decision points. Do not use disclaimers to waive non-waivable consumer rights.

### IND-06 — Synthetic-media compliance is not designed

**Rating:** High · **Status:** Current rule, counsel interpretation required · **Owner:** Legal + Trust & Safety + Engineering

The platform accepts listing images but captures no synthetic-media declaration and displays no label. `apps/api/src/services/storage.ts` rotates, resizes, and converts uploads to WebP; this sanitises images but normally strips embedded provenance metadata.

**Remediation and acceptance:** Obtain a written interpretation of current Rule 3(3). As a practical control, add an upload declaration even while below the significant-intermediary threshold; preserve a secured original or extracted provenance record where lawful and necessary; display a durable label when required; prevent removal of platform-applied labels; and include false declarations in enforcement rules. Balance provenance preservation with minimisation and image-privacy controls. Tests must verify the label survives every thumbnail and detail view. If the service reaches the significant-intermediary threshold, implement Rule 4(1A)'s declaration-verification requirements before crossing it.

### IND-07 — Emergency and victim-content routes are incomplete

**Rating:** High · **Status:** Current · **Owner:** Trust & Safety + Legal

The shared report taxonomy does not expressly cover child sexual abuse material, intimate imagery, sexual impersonation/deepfakes, doxxing, identity impersonation, or credible threats. The authenticated generic form cannot reliably start the shortest statutory clocks or support victims who lack an account. POCSO reporting and evidence-preservation procedures are not documented.

**Remediation and acceptance:** Add dedicated, privacy-preserving categories and an unauthenticated victim channel; isolate rather than unnecessarily copy suspected illegal media; restrict staff access; define immediate removal/disablement and escalation paths; document POCSO and law-enforcement handling with counsel; and conduct tabletop drills. Never require a victim to submit more intimate material than necessary to identify the content.

### IND-08 — CERT-In incident response and logging are not evidenced

**Rating:** High · **Status:** Current · **Owner:** Security + Operations

No incident plan, CERT-In point of contact, six-hour reporting runbook, incident taxonomy, evidence procedure, time-synchronisation evidence, or India-resident 180-day ICT-log control was found. Caddy emits JSON logs to stdout, but destination, access control, geography, retention, and alerting are not documented.

**Remediation and acceptance:** Name the point of contact; inventory reportable events; implement a 24/7 escalation path; confirm clock sources; centralise relevant logs in India for at least 180 days; protect and test access; document the six-hour decision/report procedure; and run a recorded exercise. Secrets and message content should not be added to logs merely to satisfy retention.

### IND-09 — Personal-data governance and DPDP readiness are absent

**Rating:** High · **Status:** Staged for 13 May 2027; current transparency risk · **Owner:** Privacy + Engineering

The schema processes email, name, avatar, OAuth subject, institution, graduation year, phone, session metadata, IP hashes, messages, images, transactions, reviews, reports, support messages, and audit records. There is no data inventory mapped to purpose and authority; no itemised notice; and no user workflow for access, correction, erasure, consent withdrawal, grievance, or nomination.

**Remediation and acceptance:** Build a processing inventory and data-flow map; define purpose, necessity, source, recipients, storage region, and retention per field; deliver a clear itemised notice before collection; minimise optional profile fields; implement authenticated rights requests and identity verification proportionate to risk; and prepare for the security, breach, processor, consent, and one-year-log requirements commencing in 2027. Ensure withdrawal is as easy as giving consent where consent is relied upon.

### IND-10 — No enforceable retention, deletion, or legal-hold lifecycle

**Rating:** High · **Status:** Current and staged · **Owner:** Legal + Privacy + Engineering

Important records use soft deletion, but no scheduled deletion, retention matrix, legal-hold register, account-closure workflow, or verified backup expiry is present. Temporary-upload cleanup is described as a recommendation rather than an enforced job.

**Remediation and acceptance:** Approve the matrix in section 9; implement deletion and anonymisation jobs; distinguish account closure, erasure request, moderation preservation, lawful preservation, and legal hold; expire backups on a documented cycle; make holds scoped and reviewable; and alert on failed jobs. Quarterly sampling must prove deletion in primary storage, object storage, search/cache layers, and backups when due.

### IND-11 — Processor and data-location assurance is incomplete

**Rating:** High · **Status:** Staged/current contractual risk · **Owner:** Legal + Security

The code indicates use of Google, OTP vendors, SMTP, Neon, Cloudflare R2, and Turnstile. No approved processor register, contract checklist, security assessment, data-location map, subprocessor-change process, deletion assurance, or incident-notification commitments were found.

**Remediation and acceptance:** Inventory every vendor and data element; document regions and transfer paths; execute appropriate data-processing and confidentiality terms; verify deletion, breach, access, and subprocessor commitments; minimise data shared; and define exit/export procedures. Reassess before adding analytics, advertising, or customer-support tools.

### IND-12 — Prohibited-goods detection is too narrow

**Rating:** High · **Status:** Current/conditional · **Owner:** Trust & Safety

Manual approval is a strong control, but the seeded list contains only seven phrases: `exam leak`, `student id for sale`, `vape`, `cigarette`, `weapon`, `prescription medicine`, and `counterfeit`. Matching cannot cover spelling variants, Unicode obfuscation, slang, images, regulated-product context, stolen goods, recalled products, or repeat sellers.

**Remediation and acceptance:** Adopt a counsel-approved catalogue with clear allowed/prohibited/restricted examples; add normalisation and evasion signals; give moderators image and account-history context; introduce risk-based second review; record reason codes; monitor repeat offenders; and review false positives. High-risk detection must queue human review rather than make unsupported legal conclusions.

### IND-13 — Report tracking, notice, and appeals lack due process

**Rating:** High · **Status:** Current/operational · **Owner:** Trust & Safety + Engineering

Complainants cannot view a formal case status, and the schema lacks statutory due times and escalation state. The existing audit trail and seller notifications are useful, but a complete notice-and-appeal lifecycle is not evidenced.

**Remediation and acceptance:** Add receipt, source, category, priority, statutory due time, owner, action, rationale, evidence pointer, notifications, appeal deadline, and final disposition. Give affected users a meaningful reason and appeal route unless prohibited by law or safety needs. Measure acknowledgement, action, overdue rate, reversal rate, and repeat-abuse rate without publishing sensitive case data.

### IND-14 — Ownership, authenticity, and regulated-product evidence is weak

**Rating:** High · **Status:** Conditional · **Owner:** Product + Trust & Safety

Listings do not require an ownership/lawful-possession attestation or structured authenticity, recall, safety, serial-number, mandatory-mark, warranty, or bill information. That increases stolen-goods, counterfeit, unsafe-product, and consumer-misrepresentation risk.

**Remediation and acceptance:** Require seller attestations; add category-specific prompts; prohibit serial-number exposure in public while allowing protected moderator evidence; publish counterfeit and stolen-goods processes; check relevant recall/mandatory-certification sources for higher-risk categories; and disable categories whose compliance cannot be operated safely.

### IND-15 — Scam prevention in chat and offline exchange needs expansion

**Rating:** High · **Status:** Safety risk · **Owner:** Product + Trust & Safety

The platform provides block/report and transaction-state controls but lacks a documented response for advance-payment scams, QR/UPI collect requests, OTP or recovery-code theft, malicious links, coercion, off-platform migration, unsafe meeting places, and account takeover.

**Remediation and acceptance:** Add contextual warnings without claiming to guarantee safety; detect high-confidence scam patterns with privacy-minimised processing; prohibit requests for OTPs, passwords, recovery phrases, or remote-access installation; rate-limit risky outreach; provide one-tap conversation reporting; recommend public meeting places and item inspection; and create account-takeover recovery. Do not silently scan more message content than the published notice permits.

### IND-16 — Privileged-access governance is incomplete

**Rating:** Medium · **Status:** Operational · **Owner:** Security + Operations

RBAC and audit logs exist, but no joiner-mover-leaver process, periodic access review, emergency-access procedure, moderator confidentiality standard, or two-person review for the most sensitive cases was found.

**Remediation and acceptance:** Define least-privilege roles; require strong MFA for staff; review access quarterly; expire emergency elevation; use two-person approval for exports and sensitive-media access; train moderators; and alert on unusual searches, downloads, or case access. Preserve audit evidence under the approved schedule.

### IND-17 — Accessibility has not been audited

**Rating:** Medium · **Status:** Current/conditional · **Owner:** Design + Engineering

Automated browser journeys cover viewport usability, but there is no recorded WCAG audit, keyboard/screen-reader review, accessible grievance testing, or accessibility statement. Current intermediary obligations should be reviewed with counsel alongside the Rights of Persons with Disabilities framework.

**Remediation and acceptance:** Target WCAG 2.2 AA; test keyboard, focus order, zoom, contrast, errors, labels, announcements, and reduced motion; include grievance and authentication journeys; publish an accessibility contact; and remediate critical failures before launch.

### IND-18 — Policy change and user-notice governance is absent

**Rating:** Medium · **Status:** Current · **Owner:** Legal + Operations

No policy owner, approval workflow, changelog, translation process, material-change rule, quarterly reminder register, or immutable publication archive was found.

**Remediation and acceptance:** Assign owners and review dates; version each policy; archive every published version; require legal/security/product approvals; define material versus editorial changes; preserve notification and acceptance evidence; and review policies after incidents, law changes, and at least annually.

### IND-19 — Business-model change controls are not defined

**Rating:** Medium · **Status:** Conditional · **Owner:** Founders + Legal

Payments, fees, shipping, advertising, business sellers, minors, and scale would materially change the compliance profile. There is no launch gate preventing such changes from shipping without review.

**Remediation and acceptance:** Add a compliance impact review to product approval. Mandatory triggers include money movement, escrow, delivery, transaction fees, commercial sellers, under-18 access, identity documents, credit, targeted advertising, new data processors, mobile apps, or approaching the significant-intermediary threshold.

### IND-20 — Test-suite parallelism is flaky

**Rating:** Low · **Status:** Engineering assurance · **Owner:** Engineering

The aggregate test command produced two transient timeout/socket failures, while the same 39 integration cases passed serially. This does not indicate a compliance failure, but unreliable CI can hide regressions in safety controls.

**Remediation and acceptance:** Remove shared-state or resource contention, set deterministic worker limits for integration tests, and require stable repeated CI passes before relying on the suite as control evidence.

## 7. Misuse threat model

| Scenario | Existing protection | Material gap | Required response |
|---|---|---|---|
| Non-student or banned user joins | Google verified email; suspension | Any Google account is accepted; no academic-domain or adult check | Domain registry, adult attestation, re-verification, device/account risk review |
| Stolen or counterfeit goods | Manual listing approval; report reasons | No ownership attestation; weak catalogue/signals | Seller declaration, protected evidence, IP/stolen-goods intake, repeat-offender linkage |
| Drugs, weapons, tobacco/vapes, unsafe or recalled goods | Seven seeded terms; human review | Easy obfuscation; images and category rules weak | Maintained legal catalogue, normalisation, image/context review, second review |
| Exam leaks, IDs, academic cheating | Seeded terms and misconduct report reason | Services/digital content not explicitly blocked end-to-end | Product-type restriction, policy examples, enforcement ladder |
| Advance-payment/UPI/QR/OTP scam | Chat, block/report, account suspension | No contextual warnings or dedicated scam playbook | Warnings, high-confidence signals, rapid account containment and recovery |
| Harassment, stalking, doxxing, threats | Block/report; limited moderator transcript access | Incomplete categories and emergency escalation | Dedicated routes, evidence preservation, victim safety and law-enforcement procedure |
| NCII, synthetic sexual content, CSAM | Generic explicit-content reason; image sanitisation | No victim route, two-hour clock, provenance or POCSO runbook | Immediate restricted queue, minimal handling, rapid disablement, counsel-approved reporting |
| Malicious links or malware | General moderation/rate limits | No link reputation or file/link policy documented | Safe-link handling, warnings, restriction, incident escalation |
| Review manipulation/collusion | One review per transaction constraints | Multi-account/collusion monitoring absent | Eligibility enforcement, risk analytics, transparent appeals |
| Moderator misuse or data browsing | RBAC, scoped transcript access, audit logs | Access reviews and alerting not documented | MFA, quarterly reviews, anomaly alerts, two-person sensitive access |
| False or abusive reports | Authentication and moderator review | Public intake will introduce spam; no abuse controls yet | Turnstile/rate limit, evidence-based triage, reporter sanctions, never block genuine victim access |
| Physical meetup harm | `UNSAFE_MEETUP` reason | Limited preventive safety guidance and crisis response | Public-place guidance, no home-address pressure, trusted-contact advice, emergency disclaimer |

## 8. Required product and data interfaces

Names below are implementation proposals, not a mandate to expose internal legal terminology.

### 8.1 Public pages

Create stable, indexable, no-login routes:

- `/terms`
- `/privacy`
- `/community-rules`
- `/seller-policy`
- `/grievance`
- `/safety`
- `/accessibility`

Every page should show version, effective date, previous versions, legal operator, contact route, and language availability. The footer should link to them and display the non-affiliation statement.

### 8.2 Grievance and safety API

Provide a public intake such as `POST /api/grievances` with strict validation, rate limits, bot protection, attachment isolation, and no login requirement. Capture only necessary information:

- category and whether the reporter is the affected person;
- target URL/listing/user/conversation reference;
- explanation and narrowly scoped evidence;
- safe reply contact and preferred language;
- consent/authority declarations where relevant; and
- lawful-notice metadata when submitted by an authority.

Return an opaque receipt and a safe status mechanism. Never expose sequential identifiers, reporter identity, moderation notes, or other users' data. Route urgent categories synchronously to the on-call queue even if email or background jobs fail.

### 8.3 Eligibility and policy acceptance

Add auditable fields or related records for:

- `adult_attested_at`;
- `academic_email_verified_at` and `academic_domain_id`;
- institution-domain source, reviewer, status, and review history;
- policy name/version, acceptance timestamp, channel, and locale; and
- re-verification/re-acceptance requirements.

Do not infer age from graduation year. Do not collect Aadhaar or student identity documents for this approved flow.

### 8.4 User data controls

Provide authenticated requests for access/export, correction, account closure/erasure, consent withdrawal where applicable, grievance, and nomination readiness. Use step-up authentication for high-risk actions, delayed execution with cancellation for account takeover safety, clear exceptions for required preservation, and status receipts.

### 8.5 Moderation and legal-operation schema

Add structured records such as:

- `grievances` and append-only `grievance_events`;
- `policy_versions` and `policy_acceptances`;
- `academic_domains` and review history;
- `data_rights_requests`;
- scoped `legal_holds`;
- report SLA, escalation, notice, appeal, and disposition fields; and
- synthetic-media declaration, label, provenance status, and moderator decision per image.

Sensitive evidence should use isolated storage, short-lived access, explicit purpose checks, and audit logging—not ordinary listing-image paths.

## 9. Proposed retention baseline

Counsel and the security/privacy owners must approve this table before implementation. “Minimum” legal preservation must not become indefinite default retention.

| Data | Proposed rule | Basis/notes |
|---|---|---|
| Active account/profile | While necessary for the active service | Minimise optional and stale fields |
| Registration information after cancellation | At least 180 days | Current Intermediary Rules; delete/anonymise when the approved period ends unless another basis/hold applies |
| Removed content and associated records | At least 180 days | Current Intermediary Rules; isolate from public access |
| Relevant ICT/security logs | Rolling minimum 180 days, stored within India | CERT-In Directions; restrict access and avoid content/secrets |
| Processing/security logs covered by DPDP Rules | Prepare for at least one year from the relevant processing | Staged for May 2027; reconcile with other duties |
| Pending upload objects | Delete rapidly; operational target no more than one hour | Existing architecture recommendation; monitor failures |
| Messages and transaction records | Counsel-approved necessity period, shown in notice | Consider safety, disputes, limitation, and user expectations; avoid indefinite retention |
| Grievance, moderation, appeal, and audit records | Counsel-approved case period plus lawful preservation | Separate evidence from general product access |
| Backups | Fixed rolling expiry matching approved recovery need | Erasure completes when backup ages out; prevent ordinary restoration of deleted records |
| Legal hold | Until documented release, reviewed periodically | Scope by person/data/date/matter; override deletion only for the held data |

## 10. Remediation roadmap

### P0 — Before public launch

1. Form and name the operating entity; appoint counsel-approved grievance and security contacts.
2. Publish Terms, Privacy Notice, Community Rules, Seller Policy, Grievance, Safety, and Accessibility pages with operator and non-affiliation disclosures.
3. Implement versioned policy acceptance and quarterly reminder evidence.
4. Enforce 18+ attestation and reviewed academic-email domains; migrate or restrict existing users.
5. Add public/victim grievance intake, opaque receipts, current statutory clocks, pager escalation, GAC information, and appeals.
6. Add emergency NCII/sexual-impersonation/CSAM/threat/doxxing/impersonation categories and counsel-approved handling runbooks.
7. Obtain Rule 3(3) advice and implement synthetic-media declaration, labels, and a provenance-preserving architecture.
8. Confirm marketplace classification and add seller, product, ranking, platform-role, and offline-transaction disclosures.
9. Approve the prohibited/restricted-goods catalogue and moderator decision guide; disable unsafe categories pending capability.
10. Establish the CERT-In point of contact, 180-day India log control, six-hour incident process, clock synchronisation, and incident exercise.
11. Approve vendor/processor contracts, regions, and data flows.
12. Approve retention/legal-hold rules and implement the highest-risk deletion jobs, including abandoned uploads.

### P1 — Within 30 days after controlled launch

1. Deliver account export, correction, closure/erasure, withdrawal, and request-status workflows.
2. Add case metrics, overdue alerts, appeal handling, enforcement transparency, and quality sampling.
3. Expand scam, account-takeover, malicious-link, repeat-offender, and obfuscation controls.
4. Complete staff MFA, privileged-access reviews, emergency elevation, and sensitive-case two-person approval.
5. Complete keyboard/screen-reader/manual accessibility testing and fix serious defects.
6. Run incident, urgent-grievance, child-safety, data-breach, and account-erasure tabletop exercises.

### P2 — Within 90 days and continuously

1. Complete DPDP May 2027 readiness, including processor governance, breach workflow, nomination, and one-year processing/security logs where required.
2. Verify deletion and legal holds through quarterly sampling and backup restoration tests.
3. Review category-level product safety, recall, BIS, Legal Metrology, and IP controls.
4. Publish carefully aggregated transparency metrics after privacy and gaming-risk review.
5. Repeat dependency, security, privacy, accessibility, and misuse reviews after material releases.
6. Fix integration-test parallelism and maintain stable evidence-producing CI.

## 11. Acceptance tests

The launch gate should include at least these automated and tabletop cases:

1. A Gmail/non-academic Google identity can sign in and browse, but cannot perform gated marketplace activity until a separate approved academic email is verified.
2. A supported academic address and 18+ attestation produce timestamped, versioned evidence.
3. A revoked or mistyped institution domain cannot be self-approved; support changes are audited.
4. Every public page exposes current legal links, operator details, effective dates, and non-affiliation text without login.
5. A material policy change prevents continued gated activity until re-accepted and preserves both versions.
6. An unauthenticated victim can report an image URL, receive a non-enumerable receipt, and get two-hour routing.
7. A general complaint and qualifying unlawful-content complaint receive the correct independent deadlines and overdue escalation.
8. A lawful government/court notice reaches the three-hour workflow and preserves the original request, decision, and action.
9. Reporter identity and attachments are not exposed to the reported user, public status endpoint, logs, or analytics.
10. Synthetic-media declarations and required labels persist through upload, resize, thumbnails, search cards, and detail views.
11. Suspected illegal sexual media is quarantined with least-privilege access and no unnecessary staff copying.
12. Account closure preserves only data covered by the approved 180-day/legal-hold rules and schedules everything else for deletion.
13. Export excludes other users' private data, staff notes, secrets, and internal anti-abuse signals while covering the user's entitled data.
14. Retention jobs delete expired database rows, objects, caches, derived files, and backup copies according to policy and produce alerts on failure.
15. A reportable cyber incident can be classified, escalated, and reported within six hours using evidence from India-resident logs.
16. Blocked/suspended/repeat accounts cannot evade restrictions through ordinary sign-in paths.
17. Moderators cannot open unrelated conversations and every permitted access is searchable in an immutable audit trail.
18. Keyboard and screen-reader users can register, read policies, submit a grievance, track it, and close an account.

## 12. Engineering baseline on 25 August 2026

| Check | Result |
|---|---|
| Production dependency audit (`npm audit --omit=dev`) | Pass: 0 known vulnerabilities across 242 production dependencies |
| Type checking | Pass |
| Production build | Pass; Vite reports one main chunk above 500 kB, a performance warning rather than compliance failure |
| End-to-end browser tests | Pass: 6/6 |
| Aggregate lint/type/test command | Lint and type checks passed; 129/131 tests passed before two integration timeouts/socket failures stopped the command |
| Isolated affected integration suites | Pass: 39/39 with one worker, indicating parallel resource/shared-state flakiness |
| Public security headers | HSTS, CSP, frame restriction, MIME-sniffing protection, and referrer policy observed on `https://uni.rocks` |

## 13. Evidence map

| Area | Primary repository evidence |
|---|---|
| Open Google onboarding | `README.md`; `apps/api/src/routes/auth.ts`; `apps/web/src/pages/PublicPages.tsx` |
| Missing public legal routes | `apps/web/src/App.tsx`; `apps/web/src/components/Layout.tsx` |
| Personal data and soft deletion | `apps/api/src/db/schema.ts`; `docs/architecture.md` |
| Reporting/support and deadlines | `apps/api/src/routes/operations.ts`; `packages/shared/src/index.ts` |
| Moderation catalogue | `apps/api/src/db/seed.ts`; admin prohibited-terms routes/pages |
| Image transformation/provenance risk | `apps/api/src/services/storage.ts`; `apps/api/src/routes/uploads.ts` |
| Security controls | `apps/api/src/app.ts`; authentication and middleware; `docs/security.md`; `infra/uni-market.caddy` |
| Deployment/vendor configuration | `.env.example`; storage, OTP, OAuth, SMTP, Turnstile, and database modules |

## 14. Mandatory legal review triggers

Stop release and obtain a scoped review before:

- processing platform payments, escrow, deposits, refunds, fees, credit, or insurance;
- arranging shipping, warehousing, fulfilment, inspection, or guarantees;
- admitting business sellers or selling new goods;
- allowing anyone under 18;
- collecting Aadhaar, government identity, biometrics, precise live location, or student-card images;
- introducing advertising, profiling, recommendations based on sensitive behaviour, or data brokerage;
- adding services, digital goods, accounts, event tickets, medicines, food, vehicles, animals, or other regulated categories;
- launching a native mobile app or new language/region with changed disclosures;
- changing the legal operator or any core processor/data region;
- receiving a government designation or approaching the significant social media intermediary threshold; or
- materially changing generative-AI creation, editing, or sharing features.

## 15. Official sources

Use the current consolidated text and counsel advice rather than relying only on this summary.

- [Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Amendment Rules, 2026 — MeitY](https://www.meity.gov.in/static/uploads/2026/02/550681ab908f8afb135b0ad42816a1c9.pdf)
- [Digital Personal Data Protection Act, 2023 — India Code](https://www.indiacode.nic.in/bitstream/123456789/22037/1/a2023-22.pdf)
- [Digital Personal Data Protection Rules, 2025 — MeitY](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf)
- [Consumer Protection Act and E-Commerce Rules — Department of Consumer Affairs](https://consumeraffairs.nic.in/acts-and-rules/consumer-protection/consumer-protection)
- [Consumer Protection (E-Commerce) (Amendment) Rules, 2021 — Department of Consumer Affairs](https://consumeraffairs.nic.in/sites/default/files/Consumer%20Protection%20%28E-Commerce%29%20%28Amendment%29%20Rules%2C%202021.pdf)
- [Marketplace seller-information advisory — Department of Consumer Affairs](https://consumeraffairs.nic.in/sites/default/files/PIB1766650.pdf)
- [CERT-In Directions under section 70B — CERT-In](https://www.cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf)

## 16. Sign-off record

Before public launch, record named approval from:

- India legal counsel — intermediary, consumer/e-commerce, product/content, privacy, corporate, and tax scope;
- grievance officer and Trust & Safety lead — workflow, staffing, and exercises;
- security lead — incident reporting, logging, access, vendors, and evidence;
- privacy owner — inventory, notices, rights, retention, and DPDP readiness;
- engineering lead — acceptance tests, monitoring, and rollback; and
- company director/founder — residual-risk acceptance and confirmation that the operating assumptions remain true.
