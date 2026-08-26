import type { AppConfig } from '../config.js';
import { emailCategory } from './email-preferences.js';

type EmailContent = {
  subject: string;
  heading: string;
  intro: string;
  details?: string[];
  cta?: { label: string; href: string };
};

export type RenderedEmail = {
  subject: string;
  text: string;
  html: string;
};

function value(payload: Record<string, unknown>, key: string): string {
  const candidate = payload[key];
  return typeof candidate === 'string' ? candidate.trim() : '';
}

function escapeHtml(input: string): string {
  return input.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]!);
}

function appUrl(config: AppConfig, path: string): string {
  return new URL(path, `${config.CLIENT_URL}/`).toString();
}

function safeExternalUrl(candidate: string, fallback: string): string {
  try {
    const parsed = new URL(candidate);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : fallback;
  } catch {
    return fallback;
  }
}

function listingName(payload: Record<string, unknown>): string {
  return value(payload, 'listingTitle') || 'your listing';
}

function templateContent(template: string, payload: Record<string, unknown>, config: AppConfig): EmailContent {
  const listingId = encodeURIComponent(value(payload, 'listingId'));
  const transactionId = encodeURIComponent(value(payload, 'transactionId'));
  const conversationId = encodeURIComponent(value(payload, 'conversationId'));
  const ticketId = encodeURIComponent(value(payload, 'ticketId'));
  const reference = value(payload, 'reference');
  const reason = value(payload, 'reason');
  const actor = value(payload, 'cancelledBy') || 'The other person';
  const listingHref = listingId ? appUrl(config, `/listing/${listingId}`) : appUrl(config, '/my-listings');
  const buyingHref = appUrl(config, `/transactions?view=buying${transactionId ? `#transaction-${transactionId}` : ''}`);
  const sellingHref = appUrl(config, `/transactions?view=selling${transactionId ? `#transaction-${transactionId}` : ''}`);

  switch (template) {
    case 'first-conversation-message':
      return { subject: `New message about ${listingName(payload)}`, heading: 'A buyer started a conversation', intro: `You have a new message about ${listingName(payload)}.`, cta: { label: 'Open conversation', href: conversationId ? appUrl(config, `/chats/${conversationId}`) : appUrl(config, '/chats') } };
    case 'listing_approved':
      return { subject: `Your listing was approved: ${listingName(payload)}`, heading: 'Your listing is live', intro: `${listingName(payload)} passed review and is now visible to buyers.`, cta: { label: 'View listing', href: listingHref } };
    case 'listing_rejected':
      return { subject: `Your listing needs attention: ${listingName(payload)}`, heading: 'Please update your listing', intro: `${listingName(payload)} did not pass review.`, ...(reason ? { details: [`Reason: ${reason}`] } : {}), cta: { label: 'Review listing', href: listingHref } };
    case 'listing_removed':
      return { subject: `Your listing was removed: ${listingName(payload)}`, heading: 'Your listing was removed', intro: `${listingName(payload)} is no longer visible on Uni Market.`, ...(reason ? { details: [`Reason: ${reason}`] } : {}), cta: { label: 'View details', href: listingHref } };
    case 'purchase-request':
      return { subject: `New request for ${listingName(payload)}`, heading: 'Someone wants to buy your item', intro: `A buyer sent a purchase request for ${listingName(payload)}.`, cta: { label: 'Review request', href: sellingHref } };
    case 'purchase-accepted':
      return { subject: `Your request was accepted: ${listingName(payload)}`, heading: 'The seller accepted your request', intro: `${listingName(payload)} is reserved for you. Open Transactions to see your exchange code and next steps.`, cta: { label: 'View purchase', href: buyingHref } };
    case 'transaction-completed-buyer':
      return { subject: `Purchase completed: ${listingName(payload)}`, heading: 'Your exchange is complete', intro: `The exchange for ${listingName(payload)} has been completed. You can now leave a verified review.`, cta: { label: 'View transaction', href: buyingHref } };
    case 'transaction-completed-seller':
      return { subject: `Sale completed: ${listingName(payload)}`, heading: 'Your sale is complete', intro: `The exchange for ${listingName(payload)} has been completed and counted in your sales.`, cta: { label: 'View transaction', href: sellingHref } };
    case 'transaction-cancelled':
      return { subject: `Purchase request cancelled: ${listingName(payload)}`, heading: 'This request was cancelled', intro: `${actor} cancelled the transaction for ${listingName(payload)}.`, cta: { label: 'View transactions', href: value(payload, 'recipientRole') === 'SELLER' ? sellingHref : buyingHref } };
    case 'support-response':
      return { subject: 'Support replied to your request', heading: 'You have a new support reply', intro: 'A support agent replied to your request.', cta: { label: 'Read reply', href: ticketId ? appUrl(config, `/support/${ticketId}`) : appUrl(config, '/support') } };
    case 'grievance-received':
      return { subject: 'Your Uni Market grievance receipt', heading: 'We received your grievance', intro: `Your reference is ${reference || 'available in your receipt'}.`, ...(value(payload, 'trackingSecret') ? { details: [`Tracking secret: ${value(payload, 'trackingSecret')}`, 'Keep this secret private. It is required to view updates.'] } : {}), cta: { label: 'Track grievance', href: appUrl(config, '/grievance/track') } };
    case 'grievance-response':
      return { subject: `Update on grievance ${reference}`.trim(), heading: 'There is an update on your grievance', intro: `An update is available for ${reference || 'your grievance'}.`, cta: { label: 'Track grievance', href: appUrl(config, '/grievance/track') } };
    case 'grievance-new-internal':
    case 'grievance-follow-up-internal':
    case 'grievance-appeal-internal':
    case 'grievance-deadline-internal': {
      const fallback = appUrl(config, '/admin/grievances');
      const internalHeading = template === 'grievance-new-internal' ? 'New grievance requires review' : template === 'grievance-follow-up-internal' ? 'A grievance has new information' : template === 'grievance-appeal-internal' ? 'A grievance appeal requires review' : 'A grievance deadline requires attention';
      const details = [
        reference ? `Reference: ${reference}` : '',
        value(payload, 'category') ? `Category: ${value(payload, 'category')}` : '',
        value(payload, 'stage') ? `Stage: ${value(payload, 'stage')}` : '',
        value(payload, 'actionDueAt') ? `Action target: ${value(payload, 'actionDueAt')}` : '',
      ].filter(Boolean);
      return { subject: internalHeading, heading: internalHeading, intro: 'Open the private staff queue to review the record.', details, cta: { label: 'Open private queue', href: safeExternalUrl(value(payload, 'adminUrl'), fallback) } };
    }
    case 'policy-reminder':
      return { subject: 'Reminder: Uni Market rules and policies', heading: 'Please review the current policies', intro: 'Review the Terms, Privacy Notice, Community Rules, and Seller Policy that apply when you use Uni Market.', cta: { label: 'Review policies', href: appUrl(config, '/terms') } };
    default:
      return { subject: 'Important Uni Market update', heading: 'There is an update on your account', intro: 'Open Uni Market to view the latest details.', cta: { label: 'Open Uni Market', href: appUrl(config, '/') } };
  }
}

export function renderEmail(input: {
  template: string;
  payload?: Record<string, unknown>;
  displayName?: string | null;
  config: AppConfig;
}): RenderedEmail {
  const payload = input.payload ?? {};
  const content = templateContent(input.template, payload, input.config);
  const greeting = input.displayName?.trim() ? `Hi ${input.displayName.trim()},` : 'Hello,';
  const preferenceUrl = appUrl(input.config, '/settings?section=email');
  const optional = emailCategory(input.template) !== null;
  const textParts = [greeting, '', content.heading, '', content.intro];
  if (content.details?.length) textParts.push('', ...content.details);
  if (content.cta) textParts.push('', `${content.cta.label}: ${content.cta.href}`);
  textParts.push('', 'Uni Market');
  if (optional) textParts.push('', `Manage email notifications: ${preferenceUrl}`);

  const detailsHtml = content.details?.length
    ? `<div style="margin:20px 0;padding:16px 18px;border:1px solid #ded4c7;border-radius:14px;background:#f8f4ee;">${content.details.map((detail, index) => `<p style="margin:0 0 ${index === content.details!.length - 1 ? '0' : '8px'};color:#403933;font-size:14px;line-height:1.55;">${escapeHtml(detail)}</p>`).join('')}</div>`
    : '';
  const ctaHtml = content.cta
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:26px 0 8px;"><tr><td style="border-radius:999px;background:#6d4055;"><a href="${escapeHtml(content.cta.href)}" style="display:inline-block;padding:13px 22px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;line-height:1;">${escapeHtml(content.cta.label)}</a></td></tr></table>`
    : '';
  const manageHtml = optional
    ? `<p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:#746b63;">Don’t want these updates? <a href="${escapeHtml(preferenceUrl)}" style="color:#6d4055;text-decoration:underline;">Manage email notifications</a>.</p>`
    : '';

  return {
    subject: content.subject.replace(/[\r\n]+/g, ' ').slice(0, 180),
    text: textParts.join('\n'),
    html: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head><body style="margin:0;padding:0;background:#eee8df;font-family:Inter,Arial,sans-serif;color:#211d1a;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#eee8df;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#fffdf9;border:1px solid #ded4c7;border-radius:22px;overflow:hidden;"><tr><td style="padding:24px 28px;border-bottom:1px solid #e8dfd4;"><a href="${escapeHtml(appUrl(input.config, '/'))}" style="color:#211d1a;text-decoration:none;font-size:20px;font-weight:800;letter-spacing:-0.4px;"><span style="color:#8a4f68;">Uni</span> Market</a></td></tr><tr><td style="padding:34px 28px 30px;"><p style="margin:0 0 24px;color:#746b63;font-size:14px;line-height:1.5;">${escapeHtml(greeting)}</p><h1 style="margin:0 0 14px;color:#211d1a;font-size:28px;line-height:1.18;letter-spacing:-0.7px;">${escapeHtml(content.heading)}</h1><p style="margin:0;color:#514943;font-size:16px;line-height:1.65;">${escapeHtml(content.intro)}</p>${detailsHtml}${ctaHtml}</td></tr><tr><td style="padding:22px 28px;background:#f8f4ee;border-top:1px solid #e8dfd4;"><p style="margin:0;color:#514943;font-size:13px;font-weight:700;">Uni Market</p><p style="margin:5px 0 0;color:#746b63;font-size:12px;line-height:1.5;">Buy and sell locally within the student community.</p>${manageHtml}</td></tr></table></td></tr></table></body></html>`,
  };
}
