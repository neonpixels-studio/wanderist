/**
 * Client-only plugin that watches Clerk's auth state and redirects
 * unauthenticated users away from protected routes.
 *
 * The Clerk module is configured with skipServerMiddleware: true, which means
 * auth runs only on the client. The route middleware (app/middleware/auth.ts)
 * performs the redirect when Clerk has loaded, but on initial page load Clerk's
 * isLoaded may be false while Clerk.js bootstraps. This plugin watches isLoaded
 * and fires a redirect once Clerk has initialised and the user is not signed in
 * on a protected route.
 */

const PROTECTED_ROUTES = new Set([
  "/journal",
  "/map",
  "/trips",
  "/settings",
  "/explore",
  "/home",
]);

function isProtectedRoute(path: string): boolean {
  return PROTECTED_ROUTES.has(path) || path.startsWith("/trips/");
}

export default defineNuxtPlugin(() => {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useAuth();

  watchEffect(() => {
    if (!isLoaded.value) {
      return;
    }
    if (!isSignedIn.value && isProtectedRoute(router.currentRoute.value.path)) {
      navigateTo("/login");
    }
  });
});
