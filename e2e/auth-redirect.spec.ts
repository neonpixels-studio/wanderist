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
  // Traveler profile route (app/pages/u/[id].vue) — auth-gated like the rest.
  // Any id works since the middleware redirects before the page fetches.
  "/u/test-user",
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
