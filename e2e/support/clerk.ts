/**
 * Shared Clerk testing helpers for authenticated e2e specs.
 *
 * Isolates the one external service (Clerk) touched by the authenticated
 * specs behind a single module, so every spec exercises the same sign-in
 * path and a future Clerk API change only needs a fix in one place.
 *
 * Pre-requisites:
 *   - The app is running at http://localhost:3000 (or via the Playwright
 *     webServer config in playwright.config.ts).
 *   - NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY and NUXT_CLERK_SECRET_KEY must be set.
 *     Locally they come from .env (playwright.config.ts loads it); CI injects
 *     them as job env. setupClerkTestingToken() uses them to fetch a backend
 *     testing token.
 *   - A Clerk user matching CLERK_TEST_EMAIL (below) must exist in the dev
 *     instance. Its +clerk_test suffix lets @clerk/testing auto-verify the OTP
 *     (424242) without sending real email — create the account once via /login.
 *
 * Callers should skip their tests when hasClerkCredentials() is false, so a
 * CI run without credentials degrades gracefully rather than erroring.
 */
import type { Page } from "@playwright/test";
import { clerk, clerkSetup } from "@clerk/testing/playwright";

// Fixed Clerk test identifier — no env var needed. The +clerk_test suffix marks
// it a Clerk test address, so @clerk/testing signs in with the fixed OTP 424242
// and no real email is sent. The matching user must exist in the dev instance
// (create it once via /login); the domain is irrelevant since delivery is
// bypassed.
export const CLERK_TEST_EMAIL = "wanderist+clerk_test@example.com";

// clerkSetup needs the dev instance's Clerk keys, passed explicitly because
// @clerk/testing reads CLERK_SECRET_KEY / CLERK_PUBLISHABLE_KEY, not the
// NUXT_-prefixed names the app uses.
const publishableKey = process.env.NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const secretKey = process.env.NUXT_CLERK_SECRET_KEY;

export function hasClerkCredentials(): boolean {
  return Boolean(publishableKey && secretKey);
}

// Fetches a testing token from Clerk's Backend API once per test file. Skipped
// when the Clerk keys are absent so the suite does not error on CI. Call from
// each spec's own test.beforeAll — clerkSetup is safe to call once per file.
export async function setupClerkTestingToken(): Promise<void> {
  if (!hasClerkCredentials()) {
    return;
  }
  await clerkSetup({ publishableKey, secretKey });
}

// Sign in with the Clerk testing helper using the email_code strategy. The
// +clerk_test suffix lets @clerk/testing auto-fill the OTP in dev mode.
export async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await clerk.signIn({
    page,
    signInParams: {
      strategy: "email_code",
      identifier: CLERK_TEST_EMAIL,
    },
  });
}

// Wait for the app shell to be genuinely interactive.
//
// Clerk's Nuxt module runs with skipServerMiddleware: true, so auth resolves
// client-side only: the app/layouts/app.vue shell (and its click handlers,
// e.g. the compose bar) paints from SSR markup before Clerk finishes loading
// and hydration attaches listeners. A click that lands in that window is
// accepted by the DOM but silently dropped, since Vue has not bound the
// handler yet. app/layouts/app.vue exposes `data-auth-ready` once Clerk's
// `isLoaded` is true; waiting on it here avoids racing on paint.
export async function waitForAppReady(page: Page): Promise<void> {
  await page.locator('.shell[data-auth-ready="true"]').waitFor({
    state: "attached",
    timeout: 15_000,
  });
}
