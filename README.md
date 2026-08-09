# Wanderist

A travel planning and exploration app.

## Requirements

- Node.js >= 24 (see [.nvmrc](.nvmrc))
- npm

## Setup

Install dependencies:

```bash
npm install
```

## Environment variables

Secrets are managed with [dotenvx](https://dotenvx.com): the `.env*` files are
committed **encrypted**, and one private key per environment (held off-repo in
`.env.keys`) decrypts them. `.env.example` documents every variable and where to
obtain it.

| File              | Environment                    | Decrypted by                    |
| ----------------- | ------------------------------ | ------------------------------- |
| `.env`            | local dev                      | `DOTENV_PRIVATE_KEY`            |
| `.env.dev`        | Netlify branch/preview deploys | `DOTENV_PRIVATE_KEY_DEV`        |
| `.env.e2e`        | e2e tests (local + CI)         | `DOTENV_PRIVATE_KEY_E2E`        |
| `.env.production` | Netlify production             | `DOTENV_PRIVATE_KEY_PRODUCTION` |

`.env.keys` holds all the private keys and is gitignored — **back it up to your
password manager**; losing it makes the encrypted files unrecoverable. To run a
command with a file's secrets injected, the npm scripts wrap it in
`dotenvx run -f <file> --` (e.g. `npm run dev` uses `.env`, `npm run e2e` uses
`.env.e2e`). Change a value with `npx dotenvx set KEY value -f <file>`.

Server-side secrets are read as `process.env.X || useRuntimeConfig().x`: at
build time dotenvx injects them into `process.env`, Nuxt bakes them into the
server bundle via `runtimeConfig`, and the deployed function reads them from
there — so they do **not** need to be set in Netlify's runtime env. The only
variables Netlify needs are the `DOTENV_PRIVATE_KEY_*` keys.

`NUXT_PUBLIC_SENTRY_DSN` is a special case: `sentry.server.config.ts` runs
before `useRuntimeConfig()` exists, so per Sentry's docs it can only read the
DSN from `process.env` — which dotenvx does not populate in a deployed function.
Because the DSN is public (non-secret), `nuxt.config.ts` inlines it as a build-
time literal via `nitro.replace`, so each environment's build bakes its own DSN
and no Netlify runtime variable is needed. The client reads the baked
`runtimeConfig.public.sentryDsn` and needs no replacement.

## Database

The app uses [Drizzle ORM](https://orm.drizzle.team) with a [Neon](https://neon.tech) serverless Postgres database.

Push the schema to Neon (useful for initial setup):

```bash
npm run db:push
```

Generate a migration from schema changes:

```bash
npm run db:generate
```

Apply pending migrations:

```bash
npm run db:migrate
```

Open Drizzle Studio (visual database browser):

```bash
npm run db:studio
```

### Migrations in CI

Migrations are generated and committed locally, then applied automatically by CI — never generated at deploy time.

- **Deploy previews / e2e:** each spec run creates an ephemeral Neon branch (copy-on-write from production, so it starts with production's schema), then applies any pending committed migrations to it before the tests run. The migrate step uses the branch's **direct** (non-pooler) connection; the app under test uses the pooled one.
- **Production:** the `migrate-production` job in `.github/workflows/ci.yml` runs on every push to `main`, after the `ci` job passes. It runs `npm run db:migrate:production` (`dotenvx run -f .env.production -- drizzle-kit migrate`), decrypting `.env.production` with the `DOTENV_PRIVATE_KEY_PRODUCTION` repository secret. Running it as its own job — rather than inside the Netlify build — makes a failed migration fail loudly instead of half-deploying.

Migrations must use a **direct** Neon connection, not the pooled one the running app uses. `.env.production` holds `DATABASE_URL_UNPOOLED` (the production Neon host without `-pooler`), and `drizzle.config.ts` prefers it over the pooled `DATABASE_URL`. Add a new migration to production by committing the generated SQL and merging to `main`.

## Map (Mapbox GL)

The `/map` page uses [Mapbox GL JS](https://docs.mapbox.com/mapbox-gl-js/guides/) to render a real interactive map with place markers, zoom controls, a base-style switcher, and a drop-a-pin flow for creating new places.

To enable the map, set a Mapbox public access token. Without it the page degrades gracefully to a CSS placeholder.

1. Create a public token at [https://account.mapbox.com/access-tokens/](https://account.mapbox.com/access-tokens/).
2. Set `NUXT_PUBLIC_MAPBOX_TOKEN=<your-token>` in your `.env`.

Available base styles: Outdoors, Streets, Satellite, Light, Dark, and Wanderist violet (custom).

## Media storage

File uploads (photos, cover images) are stored in [Netlify Blobs](https://docs.netlify.com/blobs/overview/) under the `media` store. Blobs are keyed as `<userId>/<mediaId>` and served back through the proxy route `GET /api/media/[id]`, which sets long-lived `Cache-Control` headers.

### Local development

The recommended approach is to run the app via the [Netlify CLI](https://docs.netlify.com/cli/overview/):

```bash
netlify dev
```

`netlify dev` injects `NETLIFY_SITE_ID` and an auth token automatically, so Blobs works with no extra configuration. The local store is sandboxed and does not read from production.

If you run `npm run dev` directly (without `netlify dev`), set the following variables in your `.env`:

```
NETLIFY_SITE_ID=<your-project-id>   # Project settings → General
NETLIFY_AUTH_TOKEN=<token>          # User settings → OAuth → Personal access tokens
```

### Production

On Netlify, no extra configuration is needed. The runtime injects credentials automatically.

---

## Authentication

Authentication is handled by [Clerk](https://clerk.com) via the `@clerk/nuxt` module. Server middleware at `server/middleware/auth.ts` verifies the session on every request and makes the user available at `event.context.userId` in API route handlers.

### Clerk webhook setup

Clerk webhooks keep the `users` table in sync with Clerk's user directory. The webhook handler lives at `server/api/webhooks/clerk.post.ts` and listens for `user.created`, `user.updated`, and `user.deleted` events.

To configure the webhook in the Clerk Dashboard:

1. Go to **Clerk Dashboard → Webhooks → Add Endpoint**.
2. Set the endpoint URL to `https://<your-domain>/api/webhooks/clerk`.
3. Subscribe to the `user.created`, `user.updated`, and `user.deleted` events.
4. Copy the **Signing Secret** (starts with `whsec_`) and set it as `NUXT_CLERK_WEBHOOK_SECRET` in your environment.

## Billing

Wanderist uses **[Stripe](https://stripe.com)** directly (Checkout + the Billing Portal) to sell the Wanderer and Nomad plans advertised on `/pricing` and the `/` pricing teaser, kept consistent with how billing is already set up on other projects in this account rather than going through Clerk Billing.

### Dashboard setup (required before checkout works)

1. Go to **Stripe Dashboard → Product catalog** and create two products, each with a monthly and a yearly recurring Price matching `/pricing`:
   - **Wanderer** — $8/mo, $6/mo billed yearly.
   - **Nomad** — $16/mo, $12/mo billed yearly.
2. Copy each Price's ID (`price_...`) into `STRIPE_PRICE_WANDERER_MONTHLY`, `STRIPE_PRICE_WANDERER_YEARLY`, `STRIPE_PRICE_NOMAD_MONTHLY`, `STRIPE_PRICE_NOMAD_YEARLY`. These are dashboard-generated and cannot be guessed or hardcoded — until they're set, the matching checkout button on `/pricing` and `/` renders disabled instead of opening a broken checkout.
3. Copy your **Secret key** (Developers → API keys) into `STRIPE_SECRET_KEY`. Use a test-mode key for local/staging.
4. Go to **Developers → Webhooks → Add endpoint**, set the URL to `https://<your-domain>/api/webhooks/stripe`, and subscribe to: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `checkout.session.completed`. Copy the endpoint's **Signing secret** into `STRIPE_WEBHOOK_SECRET`.
5. Go to **Settings → Billing → Customer portal** and enable it (the default configuration works — customers need to be able to cancel and update their payment method).

### How it works

- The `subscriptions` table (`server/db/schema.ts`) holds the current plan, status, billing cycle, trial/renewal dates, and Stripe customer/subscription IDs for each user. A user with no row is on the free Drifter plan by definition — Stripe never sends a subscription webhook for the implicit free tier.
- `<PlanCheckoutButton>` (`app/components/PlanCheckoutButton.vue`) and `<PlanManageButton>` (`app/components/PlanManageButton.vue`) are plain buttons that navigate the browser to `GET /api/billing/checkout` / `GET /api/billing/portal`, which create a Stripe Checkout Session / Billing Portal session server-side and redirect there — the same "redirect to a hosted third-party flow" pattern already used for Instagram OAuth (`server/api/connections/instagram/start.get.ts`). Signed-out visitors on `/pricing` and `/` still see a plain `/login` link instead of the checkout button. `checkout.get.ts` also rejects (`409`) a request from a user who already holds a live paid subscription, so a repeat click can't start a second Stripe subscription on the same customer.
- `<PlanCheckoutButton>` renders disabled until `GET /api/billing/config` (via `app/composables/useBillingConfig.ts`) confirms a Price ID is configured for that tier/cycle. This is a real per-request server call, not a build-time Nuxt public runtimeConfig value — `STRIPE_PRICE_*` are deliberately server-only env vars, so there's no `NUXT_PUBLIC_*`-named counterpart Nitro could use to refresh a baked-in config value at runtime.
- `server/api/webhooks/stripe.post.ts` verifies the `Stripe-Signature` header and syncs the `subscriptions` row from `customer.subscription.created` / `.updated` (upsert) and `customer.subscription.deleted` (mark canceled). `checkout.session.completed` is acknowledged but not separately handled — Stripe recommends syncing subscription state from `customer.subscription.*` events, which carry the full Subscription object and fire around the same time.
- `server/utils/stripe.ts` isolates every Stripe SDK call (client construction, Checkout/Portal session creation, webhook verification, Price ID ↔ plan/cycle mapping) behind one boundary so it's mockable in tests. `server/utils/subscriptions.ts` isolates the DB read/write side (mapping a Stripe Subscription onto the `subscriptions` row, plan-limit lookups) — the same split Clerk's own SDK access uses (`server/utils/clerk.ts`).
- `server/utils/planLimits.ts` centralizes the advertised `/pricing` limits (places, active trips, photo storage, map styles, Instagram sync, public traveler profile) and is wired into the relevant API routes (`POST /api/places`, `POST /api/trips`, `POST /api/media`, the Instagram connection routes, and `PATCH /api/preferences`). A request that would exceed the current plan's limit gets a `402 Payment Required` with a message naming the limit and plan. This layer is provider-agnostic and was unaffected by the Clerk Billing → Stripe switch.
- `GET /api/billing/subscription` (used by `app/composables/useBilling.ts`) returns the current user's plan/status/trial/renewal info for the Settings page.

### Product decisions

- **Cancellation timing**: canceling via the Billing Portal defaults to Stripe's own "cancel at period end" behavior — the subscription stays `active` (with `cancelAtPeriodEnd` set) for the rest of the paid period, and `customer.subscription.deleted` only fires once it actually ends, at which point access is revoked. This is a safer, more accurate default than the previous Clerk Billing integration could offer (Clerk's webhook payloads couldn't distinguish "scheduled to cancel" from "revoked now").
- **Trial detection**: Stripe's Subscription object exposes `trial_end` directly on every `customer.subscription.*` event for the life of the trial, so `trialEndsAt` is populated from day one of a trial — an improvement over the Clerk Billing integration, which could only detect a trial 3 days before it ended.
- **Plan-limit enforcement**: unchanged — `getEffectivePlan()` still collapses any non-`active` status to the free Drifter plan (no grace period for `past_due`), the same conservative default as before.

## Connected accounts

### Instagram (photo import)

Wanderist connects to Instagram via the **Instagram Graph API** (not the deprecated Basic Display API). This requires a Facebook App linked to a Business or Creator Instagram account.

**Setup:**

1. Go to [Meta for Developers](https://developers.facebook.com) → Create App → Business type.
2. Add the **Instagram** product to the app.
3. Under Instagram → Settings, add `https://<your-domain>/api/connections/instagram/callback` as a valid OAuth redirect URI.
4. Copy the **App ID** and **App Secret** and set them as `INSTAGRAM_CLIENT_ID` and `INSTAGRAM_CLIENT_SECRET` in your environment.

**How it works:**

- `GET /api/connections/instagram/start` — sets a CSRF state cookie and redirects the user to Instagram's OAuth authorization page.
- `GET /api/connections/instagram/callback` — exchanges the authorization code for a long-lived token (60-day expiry), stores the encrypted token in `connected_accounts`, then redirects to `/settings#connections`.
- `DELETE /api/connections/instagram` — removes the row from `connected_accounts`, revoking access.
- `POST /api/connections/instagram/import` — pulls geotagged media, stores images in Netlify Blobs, and creates journal entries with linked places. Refreshes the stored token first when it is near expiry so imports self-heal. The client follows Instagram's `paging.next` up to a fixed page bound (the `INSTAGRAM_MAX_MEDIA_PAGES` constant in `server/utils/instagramClient.ts`, not an env var) so photos older than the most recent batch are still ingested; re-imports are idempotent via `media.source_id`.

Access tokens are encrypted at rest using AES-256-GCM. Generate a key with `openssl rand -hex 32` and set it as `TOKEN_ENCRYPTION_KEY`.

**Token refresh.** Instagram long-lived tokens expire after 60 days. The stored expiry (`connected_accounts.expires_at`) drives two refresh paths so a connection never lapses silently:

- **On use** — `import.post` refreshes and re-persists the token whenever it is within `INSTAGRAM_REFRESH_THRESHOLD_DAYS` of expiry (`server/utils/instagramToken.ts`).
- **Scheduled** — `netlify/functions/refresh-instagram-tokens.mts` (daily via `netlify.toml`) renews tokens for accounts that go quiet, so an inactive user's connection stays alive (`server/utils/refreshInstagramTokens.ts`).

Because the scheduled function runs in the Netlify Functions runtime (not the Nitro bundle), it reads `DATABASE_URL` and `TOKEN_ENCRYPTION_KEY` directly from the environment — both must be set as Netlify site environment variables, the same requirement as the existing `purge-deleted-accounts` scheduled function for `DATABASE_URL`.

### Google (via Clerk)

Google sign-in is managed by Clerk's hosted OAuth flow — users connect Google through Clerk's sign-in UI. The Settings → Connections section reads the real connection state from Clerk's API rather than maintaining a separate database row.

- `GET /api/connections/google` — returns `{ connected, emailAddress, identificationId }` from Clerk.
- `DELETE /api/connections/google` — removes the Google external account from the user's Clerk record via the Clerk Backend API.

No additional app registration is required for Google; Clerk handles it. Configure Google OAuth in the [Clerk Dashboard](https://dashboard.clerk.com) → Social Connections → Google.

---

## Development

Start the dev server at `http://localhost:3000`:

```bash
npm run dev
```

## Testing

Run unit tests in watch mode:

```bash
npm test
```

Run once (CI mode):

```bash
npm run test:ci
```

Run end-to-end tests (requires `.env.e2e`):

```bash
npm run e2e
```

## Linting

Check for issues:

```bash
npm run lint
```

Auto-fix:

```bash
npm run lint:fix
```

## Security scanning

A deterministic scanner layer runs both locally and in CI.

### Secret detection (gitleaks)

[gitleaks](https://github.com/gitleaks/gitleaks) scans for committed secrets. The
rules live in [.gitleaks.toml](.gitleaks.toml): the built-in default ruleset plus
custom rules for Clerk secret keys (`sk_live_` / `sk_test_`) and Postgres
connection strings with embedded credentials. Example env files and test fixtures
are allowlisted.

A husky `pre-commit` hook scans staged changes and blocks the commit on any
finding. Install it (and all other hooks) with:

```bash
npm install
```

To run the same staged scan manually:

```bash
gitleaks git --staged --redact --no-banner --config .gitleaks.toml
```

Install the gitleaks binary locally with `brew install gitleaks` (macOS) or from the
[releases page](https://github.com/gitleaks/gitleaks/releases). In CI the pinned
binary is downloaded (and checksum-verified) before it runs — pull requests scan
the PR commit range, pushes scan full history, and any finding fails the build.

### Dependency vulnerabilities

CI runs `npm audit` and fails the build only on **high** or **critical**
advisories; moderate and low are printed as a summary but do not fail.
[Dependabot](.github/dependabot.yml) opens grouped minor/patch update PRs weekly.

## Build & Preview

```bash
npm run build
npm run preview
```

## Deployment

The app deploys to Netlify automatically on push to `main`. CI runs lint and unit tests before the build. E2e tests run as a separate job after CI passes.

Required repository secrets (Settings → Secrets → Actions):

- `E2E_DATABASE_URL`
- `NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `NUXT_CLERK_SECRET_KEY`
- `NUXT_CLERK_WEBHOOK_SECRET`
- `SENTRY_AUTH_TOKEN`
- `SENTRY_DSN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`
