import { describe, it, expect } from "vitest";
import { formatTripDateRange } from "../tripDates";

describe("formatTripDateRange", () => {
  it("returns 'dates TBD' when there is no start date", () => {
    expect(formatTripDateRange(null, null)).toBe("dates TBD");
    expect(formatTripDateRange(null, "2024-06-14T00:00:00.000Z")).toBe(
      "dates TBD",
    );
  });

  it("returns just the start date when there is no end date", () => {
    expect(formatTripDateRange("2024-06-01T00:00:00.000Z", null)).toBe(
      "Jun 1, 2024",
    );
  });

  it("returns the date range with the day count when both dates are set", () => {
    expect(
      formatTripDateRange(
        "2024-06-01T00:00:00.000Z",
        "2024-06-14T00:00:00.000Z",
      ),
    ).toBe("Jun 1, 2024 – Jun 14, 2024 · 13 days");
  });

  it("accepts Date instances as well as ISO strings", () => {
    expect(
      formatTripDateRange(
        new Date("2024-06-01T00:00:00.000Z"),
        new Date("2024-06-02T00:00:00.000Z"),
      ),
    ).toBe("Jun 1, 2024 – Jun 2, 2024 · 1 day");
  });

  it("renders dates in UTC regardless of the runtime's local timezone", () => {
    // 2024-06-01T23:30:00Z is still June 1st in UTC even though a
    // west-of-UTC local clock would show May 31st.
    expect(
      formatTripDateRange(
        "2024-06-01T23:30:00.000Z",
        "2024-06-02T23:30:00.000Z",
      ),
    ).toBe("Jun 1, 2024 – Jun 2, 2024 · 1 day");
  });

  it("falls back to 'dates TBD' for an unparseable start date instead of rendering Invalid Date", () => {
    expect(formatTripDateRange("not-a-date", "2024-06-14T00:00:00.000Z")).toBe(
      "dates TBD",
    );
  });

  it("falls back to just the start label for an unparseable end date", () => {
    expect(formatTripDateRange("2024-06-01T00:00:00.000Z", "not-a-date")).toBe(
      "Jun 1, 2024",
    );
  });

  it("renders just the start label for a same-day trip instead of '· 0 days'", () => {
    expect(
      formatTripDateRange(
        "2024-06-01T00:00:00.000Z",
        "2024-06-01T00:00:00.000Z",
      ),
    ).toBe("Jun 1, 2024");
  });
});
