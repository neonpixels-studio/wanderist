import { requireUser } from "../../utils/auth";
import {
  fetchOnThisDayEntries,
  parseLocalDateParam,
  resolveReferenceDate,
} from "../../utils/on-this-day-helpers";

export default defineEventHandler(async (event) => {
  const userId = requireUser(event);

  const query = getQuery(event);
  // Absent date → fall back to the server clock. Present but unparseable →
  // fail loud rather than silently keying off a different day than asked.
  if (query.date !== undefined && parseLocalDateParam(query.date) === null) {
    throw createError({ statusCode: 400, statusMessage: "Invalid date" });
  }

  const referenceDate = resolveReferenceDate(query.date);
  const entries = await fetchOnThisDayEntries(userId, referenceDate);

  return { entries };
});
