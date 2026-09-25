/**
 * E2E: Authentication redirect behaviour
 *
 * These tests verify that protected pages redirect unauthenticated visitors to
 * /login, and that public pages remain accessible without a session. No test
 * user credentials are required; the Clerk middleware redirect is observable
 * purely from URL and DOM assertions.
 */
import { test, expect } from "@playwright/test";

// Protected routes that require an authenticated session.
// These are the real pages that declare `middleware: "auth"` via definePageMeta.
const PROTECTED_ROUTES = [
  "/journal",
  "/map",
  "/trips",
  "/settings",
  "/explore",
  "/home",
];

for (const route of PROTECTED_ROUTES) {
  test(`${route} redirects unauthenticated visitors to /login`, async ({
    page,
  }) => {
    await page.goto(route);
    // The auth middleware navigates to /login; allow time for the redirect.
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });
}

test("home page (/) is accessible without authentication", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL("/");
  // The hero heading is the first meaningful content on the landing page.
  await expect(page.locator("h1").first()).toBeVisible({ timeout: 10_000 });
});

test("pricing page (/pricing) is accessible without authentication", async ({
  page,
}) => {
  await page.goto("/pricing");
  await expect(page).toHaveURL("/pricing");
  // The pricing page has a unique h1 heading.
  await expect(page.locator("h1").first()).toBeVisible({ timeout: 10_000 });
});

test("login page (/login) renders the Clerk sign-in form", async ({ page }) => {
  await page.goto("/login");
  await expect(page).toHaveURL("/login");
  // Clerk renders a sign-in widget inside the auth panel.
  await expect(page.locator(".auth__form")).toBeVisible({ timeout: 10_000 });
});

// Traveler profile route (app/pages/u/[id].vue) is intentionally auth-free
// (#279) so a shared profile link unfurls for an anonymous visitor instead of
// bouncing to /login before the page's og/twitter meta ever renders. This id
// doesn't need to exist in the DB: even the "profile unavailable" not-found
// state must render in place, not redirect.
test("profile page (/u/<id>) is accessible without authentication (#279)", async ({
  page,
}) => {
  await page.goto("/u/test-user");
  // `.profile-state` covers both the loading AND not-found branches, so
  // waiting on it alone would resolve during the pre-Clerk-bootstrap loading
  // paint — before app/plugins/auth-guard.client.ts's watchEffect could even
  // have fired a redirect. Wait on the settled not-found heading instead: it
  // only renders after the gated fetch resolves (Clerk finishing, or the
  // CLERK_BOOTSTRAP_TIMEOUT_MS fallback), which is strictly after that
  // window closes — so a passing assertion here actually proves no redirect
  // happened, not just that the page hadn't gotten around to it yet.
  await expect(
    page.getByRole("heading", { name: "Profile unavailable" }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/u\/test-user/);
});
