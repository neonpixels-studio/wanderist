/**
 * E2E: Anonymous public-guide viewing
 *
 * A guide marked public must open for a visitor with no Wanderist account when
 * they follow a shared link (issue #141), while private guides stay protected.
 * This seeds guides directly into the e2e database, then loads their detail
 * pages in a session-less browser context. Seeding at the DB layer (not through
 * the authenticated UI) keeps the tests focused on the anonymous read path and
 * independent of Clerk creds.
 */
import { test, expect } from "@playwright/test";
import { neon } from "@neondatabase/serverless";

// The webServer reads its connection from E2E_DATABASE_URL (server/db/index.ts);
// the test process shares that env, so seeding here hits the same database the
// running app queries.
const databaseUrl = process.env.E2E_DATABASE_URL;

// This is the only end-to-end proof of the anonymous read path; a CI run that
// silently dropped the DB env would otherwise turn it into a false green. Fail
// loud in CI, and only skip for a local run without a database.
if (!databaseUrl && process.env.CI) {
  throw new Error(
    "E2E_DATABASE_URL is required in CI for the anonymous public-guide tests",
  );
}

const runId = Date.now().toString(36);
const OWNER_ID = `e2e-guide-owner-${runId}`;
const OWNER_EMAIL = `${OWNER_ID}@example.com`;
const PUBLIC_GUIDE_ID = `e2e-public-guide-${runId}`;
const PUBLIC_GUIDE_TITLE = `Anonymous-viewable guide ${runId}`;
const PRIVATE_GUIDE_ID = `e2e-private-guide-${runId}`;

test.describe("anonymous public-guide view", () => {
  test.skip(
    !databaseUrl,
    "E2E_DATABASE_URL is not set — cannot seed guides for the anonymous read tests",
  );

  // Built once behind a real guard so the seed/cleanup hooks no-op cleanly when
  // E2E_DATABASE_URL is absent, rather than throwing inside neon().
  const sql = databaseUrl ? neon(databaseUrl) : null;

  test.beforeAll(async () => {
    if (!sql) {
      return;
    }
    await sql`INSERT INTO users (id, email) VALUES (${OWNER_ID}, ${OWNER_EMAIL}) ON CONFLICT (id) DO NOTHING`;
    // publicProfile + showOnExplore make the author discoverable, which the read
    // path requires for a non-owner (here, an anonymous visitor) to see a guide.
    await sql`INSERT INTO user_preferences (user_id, public_profile, show_on_explore)
      VALUES (${OWNER_ID}, true, true)
      ON CONFLICT (user_id) DO UPDATE SET public_profile = true, show_on_explore = true`;
    // RETURNING + assertions so a no-op insert (id collision, missing default)
    // fails here with an accurate cause rather than later at a page assertion.
    const publicRows =
      await sql`INSERT INTO guides (id, user_id, title, body, visibility)
      VALUES (${PUBLIC_GUIDE_ID}, ${OWNER_ID}, ${PUBLIC_GUIDE_TITLE}, ${"Wander slowly and eat well."}, 'public')
      RETURNING id`;
    const privateRows =
      await sql`INSERT INTO guides (id, user_id, title, body, visibility)
      VALUES (${PRIVATE_GUIDE_ID}, ${OWNER_ID}, ${"Secret itinerary"}, ${"For my eyes only."}, 'private')
      RETURNING id`;
    expect(publicRows).toHaveLength(1);
    expect(privateRows).toHaveLength(1);
  });

  test.afterAll(async () => {
    if (!sql) {
      return;
    }
    await sql`DELETE FROM guides WHERE id IN (${PUBLIC_GUIDE_ID}, ${PRIVATE_GUIDE_ID})`;
    // Deleting the user cascades to user_preferences (FK ON DELETE CASCADE).
    await sql`DELETE FROM users WHERE id = ${OWNER_ID}`;
  });

  test("opens a shared public guide for a visitor with no session", async ({
    page,
  }) => {
    await page.goto(`/guides/${PUBLIC_GUIDE_ID}`);

    // The guide actually renders for the session-less visitor. Asserting the h1
    // first waits for the page to settle, so the /login check below is evaluated
    // against the final URL rather than passing on the instant after goto.
    await expect(page.locator(".gdetail__head h1")).toHaveText(
      PUBLIC_GUIDE_TITLE,
      { timeout: 10_000 },
    );
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("hides a private guide from a visitor with no session", async ({
    page,
  }) => {
    await page.goto(`/guides/${PRIVATE_GUIDE_ID}`);

    // Protected: the anonymous visitor gets the not-found state, never the
    // private body, and is not bounced to /login.
    await expect(page.locator(".empty-note")).toHaveText(/not found/i, {
      timeout: 10_000,
    });
    await expect(page.locator("body")).not.toContainText("For my eyes only.");
    await expect(page).not.toHaveURL(/\/login/);
  });
});
