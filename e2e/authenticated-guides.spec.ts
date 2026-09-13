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
 * real running server, Clerk testing helper for sign-in, tests skipped when
 * Clerk credentials are absent so a CI run without them degrades gracefully.
 */
import { test, expect, type TestInfo } from "@playwright/test";
import { clerk, clerkSetup } from "@clerk/testing/playwright";

// Fixed Clerk test identifier — no env var needed. The +clerk_test suffix marks
// it a Clerk test address, so @clerk/testing signs in with the fixed OTP 424242
// and no real email is sent. The matching user must exist in the dev instance
// (create it once via /login); the domain is irrelevant since delivery is
// bypassed. Mirrors authenticated-flows.spec.ts.
const CLERK_TEST_EMAIL = "wanderist+clerk_test@example.com";

// clerkSetup needs the dev instance's Clerk keys, passed explicitly because
// @clerk/testing reads CLERK_SECRET_KEY / CLERK_PUBLISHABLE_KEY, not the
// NUXT_-prefixed names the app uses.
const publishableKey = process.env.NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const secretKey = process.env.NUXT_CLERK_SECRET_KEY;

function hasClerkCredentials(): boolean {
  return Boolean(publishableKey && secretKey);
}

// ---------------------------------------------------------------------------
// Global setup — fetches a testing token from Clerk's Backend API once.
// Skipped when the Clerk keys are absent so the suite does not error on CI.
// ---------------------------------------------------------------------------

test.beforeAll(async () => {
  if (!hasClerkCredentials()) {
    return;
  }
  await clerkSetup({ publishableKey, secretKey });
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
// Helper: sign in with the Clerk testing helper using the email_code strategy.
// The +clerk_test suffix lets @clerk/testing auto-fill the OTP in dev mode.
// ---------------------------------------------------------------------------

async function signIn(page: Parameters<typeof clerk.signIn>[0]["page"]) {
  await page.goto("/");
  await clerk.signIn({
    page,
    signInParams: {
      strategy: "email_code",
      identifier: CLERK_TEST_EMAIL,
    },
  });
}

// ---------------------------------------------------------------------------
// Unique suffix — prevents duplicate-match strict-mode failures across runs.
// Includes the Playwright worker index to avoid collisions under sharding.
// ---------------------------------------------------------------------------

function runTag(testInfo: TestInfo): string {
  return `run-${testInfo.workerIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------------------------
// Helper: wait for the app shell to be genuinely interactive.
//
// Mirrors authenticated-flows.spec.ts's waitForAppReady — see that file for
// the full explanation of why this matters (Clerk resolves client-side only,
// so a click before hydration attaches listeners is silently dropped).
// ---------------------------------------------------------------------------

async function waitForAppReady(
  page: Parameters<typeof clerk.signIn>[0]["page"],
) {
  await page.locator('.shell[data-auth-ready="true"]').waitFor({
    state: "attached",
    timeout: 15_000,
  });
}

// ---------------------------------------------------------------------------
// Helper: create a guide via the guides page UI and wait for it to land in
// the list. Returns the card locator so callers can act on it further (e.g.
// liking it) without re-deriving the selector.
// ---------------------------------------------------------------------------

async function createGuide(
  page: Parameters<typeof clerk.signIn>[0]["page"],
  guideTitle: string,
) {
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

  const guideCard = page
    .locator(".gcard")
    .filter({ has: page.locator(".gcard__name", { hasText: guideTitle }) });
  await expect(guideCard).toBeVisible({ timeout: 10_000 });

  return guideCard;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("user can create a new guide", async ({ page }, testInfo) => {
  const tag = runTag(testInfo);
  const guideTitle = `E2E test guide ${tag}`;

  await signIn(page);
  const guideCard = await createGuide(page, guideTitle);

  // Read: the guide is on the page in the default (private) visibility.
  await expect(guideCard.locator(".tag")).toHaveText("private");
});

test("user can like and unlike their own guide", async ({ page }, testInfo) => {
  const tag = runTag(testInfo);
  const guideTitle = `E2E test guide ${tag}`;

  await signIn(page);
  const guideCard = await createGuide(page, guideTitle);

  const likeButton = guideCard.locator(".gcard__like");
  await expect(likeButton).toHaveText("0");
  await expect(likeButton).not.toHaveClass(/liked/);

  await likeButton.click();

  // Optimistic update flips immediately; the server round-trip confirms it.
  await expect(likeButton).toHaveClass(/liked/, { timeout: 10_000 });
  await expect(likeButton).toHaveText("1", { timeout: 10_000 });

  await likeButton.click();

  await expect(likeButton).not.toHaveClass(/liked/, { timeout: 10_000 });
  await expect(likeButton).toHaveText("0", { timeout: 10_000 });
});
