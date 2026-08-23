import { eq } from "drizzle-orm";
import {
  assertOwnership,
  optionalString,
  optionalLatitude,
  optionalLongitude,
  requireRouterParam,
} from "../../utils/db-helpers";
import { getDb } from "../../db/index";
import { places } from "../../db/schema";

type PlaceUpdates = Partial<typeof places.$inferInsert>;

function applyOptionalString(
  updates: PlaceUpdates,
  body: Record<string, unknown>,
  field: keyof Pick<PlaceUpdates, "subtitle" | "country" | "category">,
): void {
  const value = optionalString(body[field], field);
  if (value === undefined) {
    return;
  }
  // optionalString does not trim, so an empty-or-whitespace value clears the
  // field: store NULL rather than "" (or "   ") so a cleared value matches "no
  // value" in queries (e.g. the trending grouping by category) instead of
  // becoming a second, distinct representation.
  const trimmed = value.trim();
  updates[field] = trimmed === "" ? null : trimmed;
}

function applyOptionalName(
  updates: PlaceUpdates,
  body: Record<string, unknown>,
): void {
  const name = optionalString(body.name, "name");
  if (name === undefined) {
    return;
  }
  const trimmedName = name.trim();
  if (trimmedName === "") {
    throw createError({
      statusCode: 400,
      statusMessage: "name must not be empty when provided",
    });
  }
  updates.name = trimmedName;
}

function applyCoordinates(
  updates: PlaceUpdates,
  body: Record<string, unknown>,
): void {
  const latitude = optionalLatitude(body.latitude);
  const longitude = optionalLongitude(body.longitude);

  const hasLatitude = latitude !== undefined;
  const hasLongitude = longitude !== undefined;

  if (hasLatitude !== hasLongitude) {
    throw createError({
      statusCode: 400,
      statusMessage: "latitude and longitude must be provided together",
    });
  }

  if (hasLatitude) {
    updates.latitude = latitude;
  }

  if (hasLongitude) {
    updates.longitude = longitude;
  }
}

export default defineEventHandler(async (event) => {
  const id = requireRouterParam(event, "id");

  await assertOwnership(event, places, places.id, places.userId, id);

  const database = getDb();
  const body = ((await readBody(event)) ?? {}) as Record<string, unknown>;
  const updates: PlaceUpdates = {};

  applyOptionalName(updates, body);
  applyOptionalString(updates, body, "subtitle");
  applyOptionalString(updates, body, "country");
  applyOptionalString(updates, body, "category");
  applyCoordinates(updates, body);

  if (Object.keys(updates).length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "No valid fields provided for update",
    });
  }

  const updated = await database
    .update(places)
    .set(updates)
    .where(eq(places.id, id))
    .returning();

  return updated[0];
});
