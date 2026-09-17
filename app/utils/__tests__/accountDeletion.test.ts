import { describe, it, expect } from "vitest";
import { DELETION_GRACE_PERIOD_DAYS } from "../accountDeletion";
import { DELETE_GRACE_PERIOD_DAYS } from "../../../server/utils/accountLifecycle";

describe("DELETION_GRACE_PERIOD_DAYS", () => {
  it("stays in sync with the server's real purge grace period", () => {
    // This UI-copy constant can't import the server constant directly (see
    // accountDeletion.ts), so this test is what actually prevents the two
    // from drifting apart — if the purge window ever changes server-side
    // without this constant being updated, this fails instead of the
    // settings page silently promising the wrong number of days.
    expect(DELETION_GRACE_PERIOD_DAYS).toBe(DELETE_GRACE_PERIOD_DAYS);
  });
});
