/**
 * Tests for applyPreciseLocationPrivacy / roundCoordinateToCityPrecision.
 *
 * Pure functions — no database or event stubbing needed. These are the
 * direct proof that the "Precise pin location" setting rounds coordinates
 * for a non-owner viewer when off, and preserves exact precision when on or
 * when the viewer is the owner (issue #276).
 */
import { describe, it, expect } from "vitest";
import {
  applyPreciseLocationPrivacy,
  roundCoordinateToCityPrecision,
  CITY_PRECISION_DECIMALS,
} from "../../../server/utils/locationPrivacy";

const OWNER_ID = "user-owner";
const OTHER_VIEWER_ID = "user-other";

const EXACT_PLACE = {
  id: "place-1",
  userId: OWNER_ID,
  name: "Home",
  latitude: 40.712776,
  longitude: -74.005974,
};

describe("roundCoordinateToCityPrecision", () => {
  it(`rounds to ${CITY_PRECISION_DECIMALS} decimal places`, () => {
    expect(roundCoordinateToCityPrecision(40.712776)).toBe(40.71);
    expect(roundCoordinateToCityPrecision(-74.005974)).toBe(-74.01);
  });

  it("leaves a value already at city precision unchanged", () => {
    expect(roundCoordinateToCityPrecision(51.5)).toBe(51.5);
  });
});

describe("applyPreciseLocationPrivacy", () => {
  it("rounds coordinates to city-level precision for a non-owner viewer when preciseLocation is off", () => {
    const result = applyPreciseLocationPrivacy(
      EXACT_PLACE,
      OTHER_VIEWER_ID,
      false,
    );

    expect(result.latitude).toBe(40.71);
    expect(result.longitude).toBe(-74.01);
  });

  it("preserves exact precision for a non-owner viewer when preciseLocation is on", () => {
    const result = applyPreciseLocationPrivacy(
      EXACT_PLACE,
      OTHER_VIEWER_ID,
      true,
    );

    expect(result.latitude).toBe(EXACT_PLACE.latitude);
    expect(result.longitude).toBe(EXACT_PLACE.longitude);
  });

  it("preserves exact precision for the owner even when preciseLocation is off", () => {
    const result = applyPreciseLocationPrivacy(EXACT_PLACE, OWNER_ID, false);

    expect(result.latitude).toBe(EXACT_PLACE.latitude);
    expect(result.longitude).toBe(EXACT_PLACE.longitude);
  });

  it("passes null coordinates through unchanged for a non-owner with preciseLocation off", () => {
    const placeWithoutCoordinates = {
      ...EXACT_PLACE,
      latitude: null,
      longitude: null,
    };

    const result = applyPreciseLocationPrivacy(
      placeWithoutCoordinates,
      OTHER_VIEWER_ID,
      false,
    );

    expect(result.latitude).toBeNull();
    expect(result.longitude).toBeNull();
  });

  it("rounds the populated axis and leaves the other null when only one coordinate is set", () => {
    const placeWithPartialCoordinates = {
      ...EXACT_PLACE,
      longitude: null,
    };

    const result = applyPreciseLocationPrivacy(
      placeWithPartialCoordinates,
      OTHER_VIEWER_ID,
      false,
    );

    expect(result.latitude).toBe(40.71);
    expect(result.longitude).toBeNull();
  });

  it("defaults preciseLocation to false (rounds) when the argument is omitted", () => {
    const result = applyPreciseLocationPrivacy(EXACT_PLACE, OTHER_VIEWER_ID);

    expect(result.latitude).toBe(40.71);
    expect(result.longitude).toBe(-74.01);
  });

  it("does not mutate the original place object", () => {
    const original = { ...EXACT_PLACE };

    applyPreciseLocationPrivacy(EXACT_PLACE, OTHER_VIEWER_ID, false);

    expect(EXACT_PLACE).toEqual(original);
  });
});
