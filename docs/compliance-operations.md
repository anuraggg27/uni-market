# India compliance operations runbook

This runbook describes the controls implemented by the application. It is an operational aid, not a substitute for advice and approval from qualified Indian counsel.

## Accepted launch risk

At the owner's direction, the public application and deployment configuration do not collect or display a legal operator name, operator address, fixed jurisdiction city, or named Grievance Officer. Policy versions remain internal consent evidence and are not displayed on each legal page. This is a conscious product decision, not a representation that those disclosures are unnecessary or compliant; the India compliance audit continues to record the legal risk.

## Release gate

1. Fill every required grievance, privacy, processor-region, and encryption setting in `.env`. Production startup rejects development placeholders.
2. Ensure the published grievance and customer-care mailboxes and the admin grievance queue are continuously monitored during the service's stated operating coverage.
3. In **Admin → Compliance registers**, add academic domains only after checking an official institution source. Do not infer domains from user submissions.
4. Review Google, MSG91, SMTP, Neon, and Cloudflare contracts. MSG91 handles phone and student-email OTP verification; SMTP handles only non-OTP transactional messages. Record region, privacy URL, data-deletion terms, subprocessors/transfers, breach terms, and the internal evidence reference. Readiness remains false until all seeded providers are approved.
5. Start `RETENTION_MODE=dry-run`, inspect `retention_runs`, validate expected counts, take a recoverable backup, and only then use `RETENTION_MODE=enforce`.
6. Have counsel approve the Terms, Privacy Notice, Community Rules, Seller Policy, Prohibited Items Policy, marketplace disclosure, retention schedule, grievance clocks, and takedown workflow. Replace the policy version in code only as part of a reviewed release that re-collects acceptance.

## Daily grievance and safety operations

The platform admins have confirmed ownership of listing approvals, support/customer-care messages and grievance deadlines. Assign primary and backup coverage internally. Recovery/alert setup and its separate production activation checks are documented in [Recovery and operational alerts](recovery-and-alerts.md).

- Keep **Admin → Grievances & safety** open during staffed hours and monitor overdue alarms. The queue is ordered by action due time.
- The public queue contains only case summaries. Opening a case decrypts its complaint text and Uni Market link for an authorised staff member and records that access in the admin audit log.
- Acknowledge each complaint after confirming the category and target URL. Do not ask a reporter to reproduce child-safety, intimate, or other unlawful material in the platform.
- The configured service-level targets are: two hours for child-safety/victim-content categories, three hours for court or government orders, 36 hours for other unlawful content, and seven days for general grievances. Acknowledgement is targeted within 24 hours.
- Child-safety, non-consensual intimate imagery, sexual impersonation, credible threats, doxxing, and impersonation must be escalated to the trained safety decision-maker. Contact emergency services when someone faces immediate danger. Preserve only necessary references and follow counsel-approved reporting duties.
- Give the reporter a factual public response. Put sensitive evidence and legal reasoning only in approved restricted systems; the public case event is visible with the tracking secret.
- Reporter follow-ups, staff interim updates, final decisions, and appeals are recorded on the case timeline. New follow-ups and appeals notify the configured grievance mailbox.
- Appeals reopen resolved cases and restart the case deadline. A different reviewer should handle an appeal where staffing permits. The public status page also links to the statutory Grievance Appellate Committee portal.
- Deadline alerts are queued one hour before the action deadline and again when overdue. The mailbox is supplementary: staff must still review the admin queue and the grievance inbox during staffed hours.

## Moderation and fraud

- Treat term and chat detections as signals. Listing block rules stop clearly prohibited submissions; flagged cases still require human review. Chat warnings record risk codes and acknowledgement without making a second copy of message content.
- Ban attempts to disguise prohibited goods, new goods, services, digital goods, accounts, tickets, credentials, academic-misconduct products, weapons, regulated substances, counterfeit/stolen goods, intimate content, or personal data.
- Reject AI-generated or materially altered listing images, stock or catalogue substitutes, and edits that conceal defects or misrepresent condition. Confirm that photos appear to show the actual item. The platform does not claim that automated processing can reliably detect AI-generated media, so this remains part of manual review.
- Review staff roles at least quarterly. Record each outcome in the access-review register and remove unnecessary access immediately. Role changes revoke active sessions.

## Privacy, retention, and legal holds

- Account closure is immediate. Normal deletion/anonymisation is scheduled after 180 days. Pending uploads expire after one hour; removed-listing images after 180 days; old closed-user message bodies after one year. Closed grievance content is encrypted at rest and scheduled for anonymisation after `GRIEVANCE_RETENTION_DAYS` (730 days by default), unless a documented legal hold applies.
- A documented active legal hold overrides automated user or listing cleanup. Every hold needs a future review date and must be released with a reason when no longer necessary.
- The daily worker records dry-run/enforcement counts and failures. Alert operations on failed runs, sustained count spikes, and failed email-outbox jobs.
- Users can export data, revoke sessions, and request deletion in Settings. Privacy requests sent to the configured privacy address must be logged and completed under the counsel-approved procedure.

## Incident and provider review

- Maintain a current inventory of subprocessors, administrator access, secrets, backups, retention locations, and incident contacts.
- For a suspected breach, contain access, preserve audit evidence, determine affected data and people, engage counsel, notify providers, and make legally required notices within applicable deadlines.
- Re-review providers on material contract/subprocessor/region changes and at least annually. Do not mark a provider approved without evidence retained outside the public application.
