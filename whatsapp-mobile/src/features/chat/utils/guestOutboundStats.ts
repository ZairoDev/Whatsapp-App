/**
 * Guest outbound stats — parity with Adminstro `guestOutboundStats.ts`.
 * Counts are computed server-side on GET /whatsapp/conversations; these helpers
 * mirror the same rules for optimistic updates when outgoing messages arrive.
 */

/** VacationSaga property listing URLs sent to guests */
export const VACATIONSAGA_LISTING_LINK_PATTERN =
  /vacationsaga\.com\/listing-stay-detail\/[a-zA-Z0-9]+/i;

/**
 * Outgoing text like "options sent", "option sent", "options-sent", etc.
 * Text-only messages; media/video is not matched.
 */
export const OPTIONS_SENT_TEXT_PATTERN = /\boptions?[\s_-]*sent\b/i;

export function buildOutboundBodyText(parts: {
  text?: string | null;
  caption?: string | null;
}): string {
  return `${parts.text ?? ''} ${parts.caption ?? ''}`.trim();
}

/** Increments to apply for one outgoing message (0 or 1 per counter). */
export function guestOutboundIncrementsForMessage(params: {
  bodyText: string;
  messageType?: string;
}): { listingLink: number; optionsSent: number } {
  const bodyText = params.bodyText.trim();
  if (!bodyText) {
    return { listingLink: 0, optionsSent: 0 };
  }

  const listingLink = VACATIONSAGA_LISTING_LINK_PATTERN.test(bodyText) ? 1 : 0;
  const optionsSent =
    params.messageType === 'text' && OPTIONS_SENT_TEXT_PATTERN.test(bodyText) ? 1 : 0;

  return { listingLink, optionsSent };
}
