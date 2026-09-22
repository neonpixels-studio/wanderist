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
  /** Page-specific title, without the site name — useOgMeta prepends
   *  `${SITE_NAME} — ` for both <title> and og:title/twitter:title so the
   *  three pages can't drift on that prefix. */
  pageTitle: string;
  description: string;
  /** Site-relative path to the preview image (e.g. `/api/media/<id>`). Falls
   *  back to the site favicon when the page has no real image to offer. */
  imagePath?: string | null;
}

// Site-wide title prefix.
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

// Collapses runs of whitespace (including the guide body's own paragraph
// breaks) to single spaces before truncating: a preview blurb reads as one
// line on every platform, a raw "\n\n" doesn't render consistently across
// them, and this also turns a whitespace-only bio/body ("   ") into an empty
// string so the caller's own falsy check can fall back to a real summary
// instead of shipping a blank-looking description.
function normalizeDescription(description: string): string {
  return description.replace(/\s+/g, " ").trim();
}

function truncateDescription(description: string): string {
  const normalized = normalizeDescription(description);
  // Split into Unicode code points (not UTF-16 code units) so a cut at the
  // boundary can't land inside a surrogate pair (e.g. an emoji) and emit a
  // lone, unrenderable surrogate.
  const characters = Array.from(normalized);
  if (characters.length <= MAX_DESCRIPTION_LENGTH) {
    return normalized;
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
  // The route's own path (not the static useRequestURL() snapshot taken at
  // setup) so og:url stays correct across client-side in-page navigation
  // (e.g. guide-1 -> guide-2), which these pages support.
  const route = useRoute();

  // getMeta() can itself walk a chain of computeds (the page's own
  // description/title logic); wrapping it here means unhead's several
  // independent field getters below (title/ogTitle/twitterTitle, ...) share
  // one evaluation per reactive flush instead of re-running it once each.
  const meta = computed(getMeta);

  function toAbsoluteUrl(path: string): string {
    const origin = runtimeConfig.public.siteOrigin || requestUrl.origin;
    return new URL(path, origin).toString();
  }

  function currentTitle(): string {
    return `${SITE_NAME} — ${meta.value.pageTitle}`;
  }

  function currentDescription(): string {
    return truncateDescription(meta.value.description);
  }

  function currentImageUrl(): string {
    return toAbsoluteUrl(meta.value.imagePath || DEFAULT_OG_IMAGE_PATH);
  }

  // "summary_large_image" needs a real, sizeable image or the card renders
  // broken/blank on most platforms; a page with no real image (favicon
  // fallback) gets the small "summary" card instead.
  function currentTwitterCard(): "summary" | "summary_large_image" {
    return meta.value.imagePath ? "summary_large_image" : "summary";
  }

  useSeoMeta({
    title: currentTitle,
    description: currentDescription,
    ogTitle: currentTitle,
    ogDescription: currentDescription,
    ogImage: currentImageUrl,
    ogUrl: () => toAbsoluteUrl(route.path),
    ogType: "website",
    twitterCard: currentTwitterCard,
    twitterTitle: currentTitle,
    twitterDescription: currentDescription,
    twitterImage: currentImageUrl,
  });
}
