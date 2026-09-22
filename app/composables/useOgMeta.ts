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

// No page currently ships a designed social-preview asset, so the favicon is
// the only real image on the site to fall back to. See the "default OG image
// asset" follow-up suggestion on this PR.
const DEFAULT_OG_IMAGE_PATH = "/favicon.ico";

// Most platforms truncate well before this anyway, but a guide body or
// profile bio can run to thousands of characters — cap it here so every page
// gets a sane og:description without each page reimplementing the cap.
const MAX_DESCRIPTION_LENGTH = 200;

function truncateDescription(description: string): string {
  if (description.length <= MAX_DESCRIPTION_LENGTH) {
    return description;
  }
  return `${description.slice(0, MAX_DESCRIPTION_LENGTH - 1).trimEnd()}…`;
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

  useSeoMeta({
    title: currentTitle,
    description: currentDescription,
    ogTitle: currentTitle,
    ogDescription: currentDescription,
    ogImage: currentImageUrl,
    ogUrl: () => toAbsoluteUrl(requestUrl.pathname),
    ogType: "website",
    twitterCard: "summary_large_image",
    twitterTitle: currentTitle,
    twitterDescription: currentDescription,
    twitterImage: currentImageUrl,
  });
}
