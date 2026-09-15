/**
 * E2E: Authenticated guide flows
 *
 * Guides (create, read, like) has full unit coverage but, unlike entries,
 * trips, and map, no Playwright spec (issue #243) — despite going through
 * many promoted fixes and being core to the product. Anonymous public-guide
 * reading is already covered by e2e/public-guide.spec.ts; this file covers
 * the authenticated create path and the self-like/unlike path on top of the
 * user's own guide. It does not cover liking a *different* user's public
 * guide (which exercises the non-owner branch of loadReadableGuide and the
 * author-notification write) — that needs a second Clerk test identity and is
 * left as a follow-up.
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
  setupClerkTestingToken,
  signIn,
  skipWithoutClerkCredentials,
  waitForAppReady,
} from "./support/clerk";

// A response-time timeout for network round trips this file waits on
// explicitly (the like/unlike API call, the initial guides fetch), distinct
// from Playwright's default assertion timeout.
const NETWORK_WAIT_TIMEOUT_MS = 15_000;
// Timeout for UI state that depends on one of the above round trips having
// already resolved (e.g. a card appearing, an attribute flipping post-reload).
const DEPENDENT_UI_TIMEOUT_MS = 10_000;

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
  skipWithoutClerkCredentials(testInfo);
});

// ---------------------------------------------------------------------------
// Cleanup: delete whichever guide the running test created, so repeated local
// runs against a persistent e2e database (unlike CI's fresh-per-run Neon
// branch) don't accumulate guides under the shared Clerk test user — the
// store walks every page of GET /api/guides on each load, so that list only
// grows more expensive to fetch over time. Tracks the title in a per-test
// variable set once createGuide() succeeds, since a create that never
// happened (or a skipped test) has nothing to clean up.
// ---------------------------------------------------------------------------

let createdGuideTitle: string | null = null;

test.afterEach(async ({ page }) => {
  if (!createdGuideTitle) {
    return;
  }
  const guideTitleToClean = createdGuideTitle;
  createdGuideTitle = null;
  await deleteGuide(page, guideTitleToClean).catch((error: unknown) => {
    // Best-effort cleanup — must not mask the test's own pass/fail result.
    console.error(
      `[e2e] failed to clean up guide "${guideTitleToClean}"`,
      error,
    );
  });
});

// ---------------------------------------------------------------------------
// Unique suffix — prevents duplicate-match strict-mode failures across runs.
// Includes the Playwright worker index to avoid collisions under sharding.
// ---------------------------------------------------------------------------

function runTag(testInfo: TestInfo): string {
  return `run-${testInfo.workerIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------------------------
// Helper: locate a guide card by its title. Shared by createGuide(), the
// post-reload assertions, and deleteGuide(), so a guide's card is always
// found the same way whether it was just created or re-fetched from a fresh
// page load.
// ---------------------------------------------------------------------------

function locateGuideCard(page: Page, guideTitle: string): Locator {
  return page
    .locator(".gcard")
    .filter({ has: page.locator(".gcard__name", { hasText: guideTitle }) });
}

// ---------------------------------------------------------------------------
// Helper: create a guide via the guides page UI and wait for it to land in
// the list.
//
// Waits for the page's initial GET /api/guides to resolve before opening the
// create form. Without this, on a slow/cold dev-server compile the create's
// own POST can resolve before that initial mount-triggered fetch does; the
// guidesStore's createGuide() then finds hasLoaded still false and awaits
// fetchGuides(), which (via its in-flight-request dedupe) returns that
// already-running, now-stale fetch — overwriting the just-created row and
// losing the card this helper is about to assert on. The waitForResponse is
// registered before goto() (not after) so it can't miss a response that
// resolves faster than the subsequent assertions run.
//
// Returns the card locator so callers can act on it further (e.g. liking it)
// without re-deriving the selector.
// ---------------------------------------------------------------------------

async function createGuide(page: Page, guideTitle: string): Promise<Locator> {
  const initialGuidesFetch = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/guides" &&
      response.request().method() === "GET",
    { timeout: NETWORK_WAIT_TIMEOUT_MS },
  );

  await page.goto("/guides");
  await expect(page.locator("h1", { hasText: "Your guides" })).toBeVisible({
    timeout: 15_000,
  });
  await waitForAppReady(page);
  await initialGuidesFetch;

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
  await expect(guideCard).toBeVisible({ timeout: DEPENDENT_UI_TIMEOUT_MS });

  return guideCard;
}

// ---------------------------------------------------------------------------
// Helper: delete a guide via its card's delete/confirm buttons (see
// GuideCard.vue). Used only for post-test cleanup; a no-op if the card is
// already gone (e.g. a test that failed before creating one).
// ---------------------------------------------------------------------------

async function deleteGuide(page: Page, guideTitle: string): Promise<void> {
  const card = locateGuideCard(page, guideTitle);
  if ((await card.count()) === 0) {
    return;
  }
  await card.locator("button", { hasText: "delete" }).click();
  await card.locator("button", { hasText: "confirm delete" }).click();
  await expect(card).toHaveCount(0, { timeout: DEPENDENT_UI_TIMEOUT_MS });
}

// ---------------------------------------------------------------------------
// Helper: click a guide card's like button and wait for its like/unlike
// request to resolve successfully before returning. Without waiting, a second
// click (e.g. the unlike half of a like-then-unlike test) can fire while the
// first request is still in flight — the server sees two toggles racing, and
// a late response can overwrite the second optimistic UI flip, flaking the
// final assertion. Without checking the response status, a server-side 4xx/5xx
// would still satisfy a bare waitForResponse and let a broken like/unlike pass
// silently — the status/body assertion below surfaces exactly which. Matches
// on the like endpoint path (not a guide id, which callers here don't have
// handy) plus HTTP method, since it is the only endpoint either click can
// trigger. click() and waitForResponse() are raced together via Promise.all
// so a click failure (e.g. a detached node) rejects immediately instead of
// leaving the response wait pending.
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
      { timeout: NETWORK_WAIT_TIMEOUT_MS },
    ),
    likeButton.click(),
  ]);

  expect(response.status(), await response.text()).toBe(200);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("user can create a new guide", async ({ page }, testInfo) => {
  const tag = runTag(testInfo);
  const guideTitle = `E2E test guide ${tag}`;

  await signIn(page);
  const guideCard = await createGuide(page, guideTitle);
  createdGuideTitle = guideTitle;
  await expect(guideCard.locator(".gcard__meta .tag")).toHaveText("private");

  // Reload to prove the guide is retrievable from a fresh GET /api/guides
  // (guidesStore.fetchGuides runs on mount), not just the create response
  // already rendered in memory.
  await page.reload();
  await waitForAppReady(page);
  const guideCardAfterReload = locateGuideCard(page, guideTitle);
  await expect(guideCardAfterReload).toBeVisible({
    timeout: DEPENDENT_UI_TIMEOUT_MS,
  });
  await expect(guideCardAfterReload.locator(".gcard__meta .tag")).toHaveText(
    "private",
    { timeout: DEPENDENT_UI_TIMEOUT_MS },
  );
});

test("user can like and unlike their own guide", async ({ page }, testInfo) => {
  const tag = runTag(testInfo);
  const guideTitle = `E2E test guide ${tag}`;

  await signIn(page);
  const guideCard = await createGuide(page, guideTitle);
  createdGuideTitle = guideTitle;

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
  await expect(guideCardAfterLike).toBeVisible({
    timeout: DEPENDENT_UI_TIMEOUT_MS,
  });
  const likeButtonAfterLike = guideCardAfterLike.locator(".gcard__like");
  await expect(likeButtonAfterLike).toHaveAttribute(
    "aria-label",
    "Unlike guide",
    { timeout: DEPENDENT_UI_TIMEOUT_MS },
  );
  await expect(likeButtonAfterLike).toHaveText("1", {
    timeout: DEPENDENT_UI_TIMEOUT_MS,
  });

  await clickLikeButtonAndAwaitResponse(page, likeButtonAfterLike, "DELETE");
  await expect(likeButtonAfterLike).toHaveAttribute("aria-label", "Like guide");
  await expect(likeButtonAfterLike).toHaveText("0");

  // Reload again to prove the unlike was persisted too, not just the second
  // optimistic flip.
  await page.reload();
  await waitForAppReady(page);
  const guideCardAfterUnlike = locateGuideCard(page, guideTitle);
  await expect(guideCardAfterUnlike).toBeVisible({
    timeout: DEPENDENT_UI_TIMEOUT_MS,
  });
  const likeButtonAfterUnlike = guideCardAfterUnlike.locator(".gcard__like");
  await expect(likeButtonAfterUnlike).toHaveAttribute(
    "aria-label",
    "Like guide",
    { timeout: DEPENDENT_UI_TIMEOUT_MS },
  );
  await expect(likeButtonAfterUnlike).toHaveText("0", {
    timeout: DEPENDENT_UI_TIMEOUT_MS,
  });
});
