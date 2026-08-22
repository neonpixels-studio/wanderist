/**
 * Ownership checks for places referenced from request bodies.
 *
 * The entry and trip-stop create/update endpoints accept an arbitrary
 * `placeId` and write it straight through. Without an owner check a caller can
 * attach another user's place id: the row's FK is satisfied (the place exists),
 * so the write succeeds, dangling the entry/stop off a foreign place
 * (cross-tenant reference, silently nulled if that place is later deleted).
 * This mirrors `assertPhotoMediaOwned` for entry photos and
 * `assertCoverImageOwned` for trip covers — the sibling referenced-resource
 * writes that already validate ownership.
 */
import { and, eq } from "drizzle-orm";
import type { getDb } from "../db/index";
import { places } from "../db/schema";

type Database = ReturnType<typeof getDb>;

/**
 * Throws 404 unless `placeId` names a place row owned by `ownerId`. An absent
 * id (`undefined`) is a no-op — the caller did not touch placeId, so a write
 * that leaves it alone is never blocked. The `null` arm exists only for type
 * compatibility with the stop patch fields (whose placeId is
 * `string | null | undefined`); callers funnel `null` through `optionalString`,
 * which collapses it to `undefined` before this runs, so `null` never reaches
 * here in practice and clearing placeId is not currently a supported operation.
 * Any supplied id — including "" — is looked up, so it can never bypass the
 * check.
 */
export async function assertPlaceOwnedIfPresent(
  database: Database,
  ownerId: string,
  placeId: string | null | undefined,
): Promise<void> {
  if (placeId === undefined || placeId === null) {
    return;
  }

  const ownedRows = await database
    .select({ id: places.id })
    .from(places)
    .where(and(eq(places.id, placeId), eq(places.userId, ownerId)))
    .limit(1);

  if (ownedRows.length === 1) {
    return;
  }

  throw createError({
    statusCode: 404,
    statusMessage: "Place not found",
  });
}
