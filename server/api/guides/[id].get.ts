import { getDb } from "../../db/index";
import { optionalUser } from "../../utils/auth";
import { requireRouterParam } from "../../utils/db-helpers";
import { loadReadableGuide } from "../../utils/guide-queries";

export default defineEventHandler(async (event) => {
  const id = requireRouterParam(event, "id");
  // Auth is optional here: a shared public guide must open for anonymous
  // visitors. The visibility rule below still gates strictly — an anonymous
  // (null) reader is treated as a non-owner and can only read public,
  // discoverable guides; private guides stay hidden behind a 404.
  const userId = optionalUser(event);
  const database = getDb();

  // This response varies by caller (the owner reads a private guide's full body;
  // everyone else gets only public guides or a 404), discriminated by the
  // Authorization header. Forbid shared caching so a proxy/CDN keyed on URL
  // alone can't serve one viewer's private guide to another, and vary on
  // Authorization for any cache that honors it.
  setResponseHeader(event, "Cache-Control", "private, no-store");
  setResponseHeader(event, "Vary", "Authorization");

  // Returns the full guide row (including body) subject to the visibility
  // rule — owner reads any, non-owner reads public only, otherwise 404.
  return loadReadableGuide(database, id, userId);
});
