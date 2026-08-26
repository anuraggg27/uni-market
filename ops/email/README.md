# Email provider templates

`msg91-student-email-otp.html` is the source for the student-email OTP template managed by MSG91.

Rollout:

1. Copy the current approved MSG91 email template as a new version.
2. Paste the HTML source and keep `##OTP##` mapped to the widget OTP value.
3. Use the subject `Verify your student email` and the existing Uni Market sender/domain.
4. Submit the version for approval without changing the active widget template.
5. Once approved, select it for the Email channel in the existing OTP widget and send a real test to a supported academic address.
6. Confirm send, resend, expiry, and verification before leaving the new version active.

Student OTP mail must continue through MSG91. Do not add it to the SMTP outbox.
