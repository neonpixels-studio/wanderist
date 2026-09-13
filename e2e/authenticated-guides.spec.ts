/**
 * E2E: Authenticated guide flows
 *
 * Guides (create, read, like) has full unit coverage but, unlike entries,
 * trips, and map, no Playwright spec (issue #243) — despite going through
 * many promoted fixes and being core to the product. Anonymous public-guide
 * reading is already covered by e2e/public-guide.spec.ts; this file covers
 * the authenticated create and like paths on top of the user's own guide.
 *
 * Follows the same structure/conventions as e2e/authenticated-flows.spec.ts:
 * real running server, Clerk testing helper for sign-in (see
 * e2e/support/clerk.ts), tests skipped when Clerk credentials are absent so a
 * CI run without them degrades gracefully.
 */
import {
  test,
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import {
  hasClerkCredentials,
  setupClerkTestingToken,
  signIn,
  waitForAppReady,
} from "./support/clerk";

// A response-time timeout for the like/unlike API round trip, distinct from
// Playwright's default assertion timeout — see clickLikeButtonAndAwaitResponse.
const LIKE_REQUEST_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Global setup — fetches a testing token from Clerk's Backend API once.
// Skipped when the Clerk keys are absent so the suite does not error on CI.
// ---------------------------------------------------------------------------

test.beforeAll(async () => {
  await setupClerkTestingToken();
});

// ---------------------------------------------------------------------------
// Guard: skip individual tests when the Clerk keys are absent.
// ---------------------------------------------------------------------------

test.beforeEach(async ({}, testInfo) => {
  if (!hasClerkCredentials()) {
    testInfo.skip(
      true,
      "Clerk keys are not set — add NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY and NUXT_CLERK_SECRET_KEY to .env to run authenticated flows",
    );
  }
});

// ---------------------------------------------------------------------------
// Unique suffix — prevents duplicate-match strict-mode failures across runs.
// Includes the Playwright worker index to avoid collisions under sharding.
// ---------------------------------------------------------------------------

function runTag(testInfo: TestInfo): string {
  return `run-${testInfo.workerIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------------------------
// Helper: locate a guide card by its title. Shared by createGuide() and the
// post-reload assertions below, so a guide's card is always found the same
// way whether it was just created or re-fetched from a fresh page load.
// ---------------------------------------------------------------------------

function locateGuideCard(page: Page, guideTitle: string): Locator {
  return page
    .locator(".gcard")
    .filter({ has: page.locator(".gcard__name", { hasText: guideTitle }) });
}

// ---------------------------------------------------------------------------
// Helper: create a guide via the guides page UI and wait for it to land in
// the list. The guidesStore only splices the new row into state after its
// POST resolves (see createGuide in stores/guides.ts — it is not an
// optimistic update), so by the time the card is visible the create has
// already round-tripped the server; no extra wait is needed here. Returns the
// card locator so callers can act on it further (e.g. liking it) without
// re-deriving the selector.
// ---------------------------------------------------------------------------

async function createGuide(page: Page, guideTitle: string): Promise<Locator> {
  await page.goto("/guides");
  await expect(page.locator("h1", { hasText: "Your guides" })).toBeVisible({
    timeout: 15_000,
  });
  await waitForAppReady(page);

  await page.locator("button", { hasText: "new guide" }).click();
  await expect(page.locator(".guide-form")).toBeVisible({ timeout: 5_000 });

  const titleInput = page
    .locator(".guide-form .field__wrap input.field__input")
    .first();
  await titleInput.fill(guideTitle);

  await page
    .locator(".guide-form button", { hasText: "publish guide" })
    .click();

  const guideCard = locateGuideCard(page, guideTitle);
  await expect(guideCard).toBeVisible({ timeout: 10_000 });

  return guideCard;
}

// ---------------------------------------------------------------------------
// Helper: click a guide card's like button and wait for its like/unlike
// request to resolve successfully before returning. Without waiting, a second
// click (e.g. the unlike half of a like-then-unlike test) can fire while the
// first request is still in flight — the server sees two toggles racing, and
// a late response can overwrite the second optimistic UI flip, flaking the
// final assertion. Without checking the response status, a server-side 4xx/5xx
// would still satisfy a bare waitForResponse and let a broken like/unlike pass
// silently. Matches on the like endpoint path (not a guide id, which callers
// here don't have handy) plus HTTP method, since it is the only endpoint
// either click can trigger. click() and waitForResponse() are raced together
// via Promise.all so a click failure (e.g. a detached node) rejects
// immediately instead of leaving the response wait pending.
// ---------------------------------------------------------------------------

async function clickLikeButtonAndAwaitResponse(
  page: Page,
  likeButton: Locator,
  method: "POST" | "DELETE",
): Promise<void> {
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        /\/api\/guides\/[^/]+\/like$/.test(new URL(candidate.url()).pathname) &&
        candidate.request().method() === method,
      { timeout: LIKE_REQUEST_TIMEOUT_MS },
    ),
    likeButton.click(),
  ]);

  expect(response.ok()).toBe(true);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("user can create a new guide", async ({ page }, testInfo) => {
  const tag = runTag(testInfo);
  const guideTitle = `E2E test guide ${tag}`;

  await signIn(page);
  const guideCard = await createGuide(page, guideTitle);
  await expect(guideCard.locator(".gcard__meta .tag")).toHaveText("private");

  // Reload to prove the guide is retrievable from a fresh GET /api/guides
  // (guidesStore.fetchGuides runs on mount), not just the create response
  // already rendered in memory.
  await page.reload();
  await waitForAppReady(page);
  const guideCardAfterReload = locateGuideCard(page, guideTitle);
  await expect(guideCardAfterReload).toBeVisible({ timeout: 10_000 });
  await expect(guideCardAfterReload.locator(".gcard__meta .tag")).toHaveText(
    "private",
  );
});

test("user can like and unlike their own guide", async ({ page }, testInfo) => {
  const tag = runTag(testInfo);
  const guideTitle = `E2E test guide ${tag}`;

  await signIn(page);
  const guideCard = await createGuide(page, guideTitle);

  const likeButton = guideCard.locator(".gcard__like");
  await expect(likeButton).toHaveAttribute("aria-label", "Like guide");
  await expect(likeButton).toHaveText("0");

  await clickLikeButtonAndAwaitResponse(page, likeButton, "POST");
  await expect(likeButton).toHaveAttribute("aria-label", "Unlike guide");
  await expect(likeButton).toHaveText("1");

  // Reload to prove the like was actually persisted server-side — the heart
  // re-seeds from the server's likedByCurrentUser flag on every fetch (see
  // seedLikedGuides in pages/guides/index.vue) — not just held optimistically.
  await page.reload();
  await waitForAppReady(page);
  const guideCardAfterLike = locateGuideCard(page, guideTitle);
  const likeButtonAfterLike = guideCardAfterLike.locator(".gcard__like");
  await expect(likeButtonAfterLike).toHaveAttribute(
    "aria-label",
    "Unlike guide",
  );
  await expect(likeButtonAfterLike).toHaveText("1");

  await clickLikeButtonAndAwaitResponse(page, likeButtonAfterLike, "DELETE");
  await expect(likeButtonAfterLike).toHaveAttribute("aria-label", "Like guide");
  await expect(likeButtonAfterLike).toHaveText("0");

  // Reload again to prove the unlike was persisted too, not just the second
  // optimistic flip.
  await page.reload();
  await waitForAppReady(page);
  const guideCardAfterUnlike = locateGuideCard(page, guideTitle);
  const likeButtonAfterUnlike = guideCardAfterUnlike.locator(".gcard__like");
  await expect(likeButtonAfterUnlike).toHaveAttribute(
    "aria-label",
    "Like guide",
  );
  await expect(likeButtonAfterUnlike).toHaveText("0");
});
