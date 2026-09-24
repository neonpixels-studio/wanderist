/**
 * Enforces the `preciseLocation` privacy preference on place coordinates.
 *
 * `userPreferences.preciseLocation` is a per-owner opt-in: when it is false,
 * the owner has been promised (see app/pages/settings.vue's "Precise pin
 * location" copy) that their pins are rounded to city-level precision before
 * anyone other than themselves can see them. The control protects the owner
 * *from other viewers* — the owner's own view of their own pins is always
 * exact regardless of the setting, matching how "approximate location"
 * toggles work elsewhere (turning it off doesn't blind you to your own data).
 *
 * As of this writing, no endpoint in this codebase actually returns another
 * user's place coordinates: every `places/*` route is gated to the
 * authenticated owner (`requireUser`/`ensureUser` plus
 * `eq(places.userId, userId)`, or `loadOwnedOrThrow`), and every read path
 * that IS visible to other users (public trips, guides, profiles, discover,
 * search) never joins or selects `places.latitude`/`longitude` at all. That
 * made `preciseLocation` fully inert (issue #276) despite the UI promise.
 *
 * `applyPreciseLocationPrivacy` is the single point every place-returning
 * response should route through, mirroring the shared-gate pattern in
 * `publicVisibility.ts`. Wiring it into today's owner-only endpoints is a
 * no-op in production (the `isOwner` guard clause below always fires first),
 * but it means: (a) the promise is honored the instant a future feature
 * (trip pin map, discover map, etc.) serializes a place for a non-owner,
 * without depending on that feature's author remembering to call this, and
 * (b) a regression that loosens an ownership gate degrades to "shows a
 * rounded pin" instead of "leaks an exact one." That second property only
 * holds because `preciseLocation` defaults to `false` (fail closed): every
 * current call site is owner-only and omits the argument, so if `isOwner`
 * were ever wrongly `false` the row would still come back rounded rather
 * than exact.
 *
 * Be honest about what this does and doesn't fix: it does not, by itself,
 * make any coordinate visible to a non-owner today — nothing in this
 * codebase does that yet, so the rounding branch above is unreachable from
 * any current request. What it fixes is issue #276's actual bug report: the
 * setting had *no code path* that read or enforced it at all. Now every
 * place-returning response is provably routed through a tested,
 * fail-closed gate. The day a non-owner read path is added (a public trip
 * pin map, for example), that feature's author must still look up the
 * *owner's* `userPreferences.preciseLocation` and pass it in — there is no
 * DB read wired up here, deliberately, since no call site needs one yet and
 * adding one now would be unexercised code.
 */

// ~1.1km of longitude at the equator (less at higher latitudes). The issue
// this closes (#276) explicitly allows "~2 decimal places / nearest ~1km" as
// the target city-level precision.
export const CITY_PRECISION_DECIMALS = 2;

export function roundCoordinateToCityPrecision(value: number): number {
  const factor = 10 ** CITY_PRECISION_DECIMALS;
  return Math.round(value * factor) / factor;
}

export interface PlaceCoordinates {
  userId: string;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Returns `place` unchanged when `viewerId` is the owner, or when
 * `preciseLocation` is true. Otherwise returns a shallow copy with
 * `latitude`/`longitude` rounded to city-level precision, each rounded
 * independently so a row with only one axis populated doesn't leak the
 * other at full precision. Null coordinates pass through unchanged.
 *
 * `preciseLocation` defaults to `false` (round) rather than requiring every
 * caller to supply it — the safe failure mode for a privacy control is to
 * round when the caller doesn't know the owner's preference, not to guess
 * "precise."
 */
export function applyPreciseLocationPrivacy<T extends PlaceCoordinates>(
  place: T,
  viewerId: string,
  preciseLocation = false,
): T {
  const isOwner = viewerId === place.userId;

  if (isOwner || preciseLocation) {
    return place;
  }

  return {
    ...place,
    latitude:
      typeof place.latitude === "number"
        ? roundCoordinateToCityPrecision(place.latitude)
        : place.latitude,
    longitude:
      typeof place.longitude === "number"
        ? roundCoordinateToCityPrecision(place.longitude)
        : place.longitude,
  };
}
