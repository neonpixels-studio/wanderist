import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { localDateToIso, localIsoDate, isValidLocalDate } from "../localDate";

const originalTimeZone = process.env.TZ;

afterEach(() => {
  if (originalTimeZone === undefined) {
    delete process.env.TZ;
    return;
  }
  process.env.TZ = originalTimeZone;
});

describe("localDateToIso", () => {
  it("returns undefined for an empty string", () => {
    expect(localDateToIso("")).toBeUndefined();
  });

  it("returns undefined for malformed input instead of throwing", () => {
    expect(localDateToIso("not-a-date")).toBeUndefined();
    expect(localDateToIso("2026-13-01")).toBeUndefined();
    expect(localDateToIso("06/14/2026")).toBeUndefined();
  });

  it("returns undefined for a day that overflows its month", () => {
    expect(localDateToIso("2026-02-31")).toBeUndefined();
    expect(localDateToIso("2026-04-31")).toBeUndefined();
  });

  it("preserves years below 1000 verbatim rather than mapping them to 1900+year", () => {
    expect(localDateToIso("0099-06-14")).toBe("0099-06-14T00:00:00.000Z");
  });

  it("anchors the picked date at UTC midnight, independent of host timezone", () => {
    expect(localDateToIso("2026-06-14")).toBe("2026-06-14T00:00:00.000Z");
  });

  it("preserves the calendar date for an east-of-UTC (positive offset) timezone", () => {
    // Regression guard for the original bug: `new Date(y, m-1, d).toISOString()`
    // built *local* midnight, which for a positive offset rolled back to the
    // previous UTC day (e.g. 2026-06-13T15:00:00Z under UTC+9), persisting the
    // wrong calendar date.
    process.env.TZ = "Asia/Tokyo"; // UTC+9
    // Prove the override took effect, otherwise this guard is vacuous: under the
    // deleted local-midnight impl, UTC+9 rolled 2026-06-14 back to the 13th.
    expect(new Date(2026, 5, 14).getUTCDate()).toBe(13);

    const iso = localDateToIso("2026-06-14");
    const persisted = new Date(iso as string);

    expect(persisted.getUTCFullYear()).toBe(2026);
    expect(persisted.getUTCMonth()).toBe(5); // 0-indexed: 5 = June
    expect(persisted.getUTCDate()).toBe(14);
  });

  it("preserves the calendar date for a west-of-UTC (negative offset) timezone", () => {
    process.env.TZ = "Pacific/Honolulu"; // UTC-10
    // Prove the override took effect: local midnight sits at 10:00 UTC here, 00:00 under UTC.
    expect(new Date(2026, 5, 14).getUTCHours()).toBe(10);

    const iso = localDateToIso("2026-06-14");
    const persisted = new Date(iso as string);

    expect(persisted.getUTCFullYear()).toBe(2026);
    expect(persisted.getUTCMonth()).toBe(5);
    expect(persisted.getUTCDate()).toBe(14);
  });

  it("handles a year boundary without slipping into the previous year", () => {
    process.env.TZ = "Asia/Tokyo"; // UTC+9

    const iso = localDateToIso("2026-01-01");
    const persisted = new Date(iso as string);

    expect(persisted.getUTCFullYear()).toBe(2026);
    expect(persisted.getUTCMonth()).toBe(0);
    expect(persisted.getUTCDate()).toBe(1);
  });
});

describe("localIsoDate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns today's date formatted as YYYY-MM-DD under UTC", () => {
    process.env.TZ = "UTC";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T12:00:00.000Z"));
    expect(localIsoDate()).toBe("2026-09-06");
  });

  // A UTC-only assertion can't tell a correct offset conversion from one that
  // ignores getTimezoneOffset() entirely (or applies it with the wrong sign) —
  // both collapse to the same result when the offset is zero. These pin an
  // instant where the local calendar date genuinely differs from the UTC one.
  it("returns the local calendar date west of UTC, not the UTC one", () => {
    process.env.TZ = "Pacific/Honolulu"; // UTC-10
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T05:00:00.000Z")); // local: Sep 5, 19:00
    expect(localIsoDate()).toBe("2026-09-05");
  });

  it("returns the local calendar date east of UTC, not the UTC one", () => {
    process.env.TZ = "Asia/Tokyo"; // UTC+9
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T20:00:00.000Z")); // local: Sep 7, 05:00
    expect(localIsoDate()).toBe("2026-09-07");
  });
});

describe("isValidLocalDate", () => {
  it("returns true for a real calendar date string", () => {
    expect(isValidLocalDate("2026-06-14")).toBe(true);
  });

  it("returns false for a malformed string", () => {
    expect(isValidLocalDate("not-a-date")).toBe(false);
  });

  it("returns false for a day that overflows its month", () => {
    expect(isValidLocalDate("2026-02-31")).toBe(false);
  });

  it("returns false for non-string values", () => {
    expect(isValidLocalDate(undefined)).toBe(false);
    expect(isValidLocalDate(null)).toBe(false);
    expect(isValidLocalDate(20260614)).toBe(false);
  });
});
