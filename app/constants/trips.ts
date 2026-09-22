/**
 * Shared copy for the trip detail page's invite affordance. Companion invite
 * requires a trip collaborator/invite endpoint that doesn't exist yet, so the
 * invite button and row render disabled with this text instead of silently
 * no-opping. Exported so the component and its test read the same string —
 * a copy change only needs to happen once.
 */
export const INVITE_UNAVAILABLE_TITLE =
  "Inviting co-travellers isn't available yet";
