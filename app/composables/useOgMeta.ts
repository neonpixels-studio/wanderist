/**
 * Shared Open Graph / Twitter meta builder for public-facing pages (guide
 * detail, profile, trip detail). Every public page needs the same six og and
 * twitter fields plus title/description, and the same absolute-URL plumbing
 * to build them — writing that out on each page a third time is exactly the
 * case this composable exists to avoid (#269).
 *
 * Without this, a shared guide/profile/trip link pasted into Slack, iMessage,
 * or Twitter renders a blank/title-only preview card.
 */

export interface OgMetaInput {
  title: string;
  description: string;
  /** Site-relative path to the preview image (e.g. `/api/media/<id>`). Falls
   *  back to the site favicon when the page has no real image to offer. */
  imagePath?: string | null;
}

// Site-wide title prefix, factored out so the three public pages can't drift
// on the separator/spacing between it and their own page title.
export const SITE_NAME = "Wanderist";

// No page currently ships a designed social-preview asset, so the favicon is
// the only real image on the site to fall back to. See the "default OG image
// asset" follow-up suggestion on this PR. It's paired with the "summary"
// (small-image) Twitter card below rather than "summary_large_image" — most
// platforms reject or badly upscale a favicon-sized/.ico image for a large
// card.
const DEFAULT_OG_IMAGE_PATH = "/favicon.ico";

// Most platforms truncate well before this anyway, but a guide body or
// profile bio can run to thousands of characters — cap it here so every page
// gets a sane og:description without each page reimplementing the cap.
const MAX_DESCRIPTION_LENGTH = 200;

function truncateDescription(description: string): string {
  // Split into Unicode code points (not UTF-16 code units) so a cut at the
  // boundary can't land inside a surrogate pair (e.g. an emoji) and emit a
  // lone, unrenderable surrogate.
  const characters = Array.from(description);
  if (characters.length <= MAX_DESCRIPTION_LENGTH) {
    return description;
  }
  return `${characters
    .slice(0, MAX_DESCRIPTION_LENGTH - 1)
    .join("")
    .trimEnd()}…`;
}

/**
 * Registers title, description, and og/twitter meta for the current page via
 * useSeoMeta. `getMeta` is called reactively (like a computed getter) so the
 * tags stay in sync as the page's underlying data loads in.
 */
export function useOgMeta(getMeta: () => OgMetaInput): void {
  const runtimeConfig = useRuntimeConfig();
  const requestUrl = useRequestURL();

  function toAbsoluteUrl(path: string): string {
    const origin = runtimeConfig.public.siteOrigin || requestUrl.origin;
    return new URL(path, origin).toString();
  }

  function currentTitle(): string {
    return getMeta().title;
  }

  function currentDescription(): string {
    return truncateDescription(getMeta().description);
  }

  function currentImageUrl(): string {
    return toAbsoluteUrl(getMeta().imagePath || DEFAULT_OG_IMAGE_PATH);
  }

  // "summary_large_image" needs a real, sizeable image or the card renders
  // broken/blank on most platforms; a page with no real image (favicon
  // fallback) gets the small "summary" card instead.
  function currentTwitterCard(): "summary" | "summary_large_image" {
    return getMeta().imagePath ? "summary_large_image" : "summary";
  }

  useSeoMeta({
    title: currentTitle,
    description: currentDescription,
    ogTitle: currentTitle,
    ogDescription: currentDescription,
    ogImage: currentImageUrl,
    ogUrl: () => toAbsoluteUrl(requestUrl.pathname),
    ogType: "website",
    twitterCard: currentTwitterCard,
    twitterTitle: currentTitle,
    twitterDescription: currentDescription,
    twitterImage: currentImageUrl,
  });
}
