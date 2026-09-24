import { ensureUser } from "../../utils/auth";
import { getDb } from "../../db/index";
import { places } from "../../db/schema";
import {
  requireString,
  optionalString,
  optionalLatitude,
  optionalLongitude,
} from "../../utils/db-helpers";
import { assertPlaceLimit } from "../../utils/planLimits";
import { applyPreciseLocationPrivacy } from "../../utils/locationPrivacy";

function generateId(): string {
  return crypto.randomUUID();
}

export default defineEventHandler(async (event) => {
  const userId = await ensureUser(event);
  await assertPlaceLimit(userId);

  const database = getDb();
  const body = await readBody(event);

  requireString(body?.name, "name");
  const name = (body.name as string).trim();

  const subtitle = optionalString(body?.subtitle, "subtitle");
  const country = optionalString(body?.country, "country");
  const category = optionalString(body?.category, "category");
  const latitude = optionalLatitude(body?.latitude);
  const longitude = optionalLongitude(body?.longitude);

  if ((latitude === undefined) !== (longitude === undefined)) {
    throw createError({
      statusCode: 400,
      statusMessage: "latitude and longitude must be provided together",
    });
  }

  const id = generateId();

  const inserted = await database
    .insert(places)
    .values({
      id,
      userId,
      name,
      subtitle,
      country,
      category,
      latitude,
      longitude,
    })
    .returning();

  const place = inserted[0];
  if (!place) {
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to create place",
    });
  }

  // Owner-only route — see locationPrivacy.ts for why the privacy check is
  // still applied here even though it's a no-op today.
  return applyPreciseLocationPrivacy(place, userId);
});
