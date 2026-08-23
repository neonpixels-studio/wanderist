import { requireUser } from "../../utils/auth";
import {
  fetchOnThisDayEntries,
  resolveReferenceDate,
} from "../../utils/on-this-day-helpers";

export default defineEventHandler(async (event) => {
  const userId = requireUser(event);

  const query = getQuery(event);
  const referenceDate = resolveReferenceDate(query.date);

  const entries = await fetchOnThisDayEntries(userId, referenceDate);

  return { entries };
});
