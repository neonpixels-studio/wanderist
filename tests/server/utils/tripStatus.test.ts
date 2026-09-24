import { describe, it, expect } from "vitest";
import { isTripCountedAsActive } from "../../../server/utils/tripStatus";
import { TRIP_STATUS } from "../../../server/db/schema";

const NOW = new Date("2026-06-15T00:00:00.000Z");
const FUTURE_DATE = new Date("2026-07-01T00:00:00.000Z");
const PAST_DATE = new Date("2026-06-01T00:00:00.000Z");

describe("isTripCountedAsActive", () => {
  it("counts an upcoming trip whose endDate is still ahead of now", () => {
    expect(
      isTripCountedAsActive(
        { status: TRIP_STATUS.UPCOMING, endDate: FUTURE_DATE },
        NOW,
      ),
    ).toBe(true);
  });

  it("counts an ongoing trip with no endDate set yet", () => {
    expect(
      isTripCountedAsActive(
        { status: TRIP_STATUS.ONGOING, endDate: null },
        NOW,
      ),
    ).toBe(true);
  });

  it("stops counting a trip whose endDate has elapsed even though status was never flipped to past", () => {
    expect(
      isTripCountedAsActive(
        { status: TRIP_STATUS.ONGOING, endDate: PAST_DATE },
        NOW,
      ),
    ).toBe(false);
  });

  it("respects an explicit 'past' status even with no endDate to derive from", () => {
    expect(
      isTripCountedAsActive({ status: TRIP_STATUS.PAST, endDate: null }, NOW),
    ).toBe(false);
  });

  it("respects an explicit 'past' status even when endDate is still in the future", () => {
    // e.g. a trip cancelled before it started — the manual status wins and
    // derivation never pulls a trip back into counting.
    expect(
      isTripCountedAsActive(
        { status: TRIP_STATUS.PAST, endDate: FUTURE_DATE },
        NOW,
      ),
    ).toBe(false);
  });

  it("still counts a trip on its end date itself — endDate is stored at UTC midnight, so the last day isn't over yet", () => {
    expect(
      isTripCountedAsActive({ status: TRIP_STATUS.ONGOING, endDate: NOW }, NOW),
    ).toBe(true);
  });

  it("stops counting once a full day has elapsed since endDate", () => {
    const oneDayAfterEndDate = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    expect(
      isTripCountedAsActive(
        { status: TRIP_STATUS.ONGOING, endDate: NOW },
        oneDayAfterEndDate,
      ),
    ).toBe(false);
  });

  it("treats a missing (undefined) endDate the same as null", () => {
    expect(
      isTripCountedAsActive(
        { status: TRIP_STATUS.UPCOMING, endDate: undefined },
        NOW,
      ),
    ).toBe(true);
  });
});
