import { describe, it, expect, vi, beforeEach } from "vitest";
import { stubNitroGlobals } from "../test-utils";

stubNitroGlobals();

// Exercise the real trip-helpers module; mock only its db-helpers dependency so
// the ownership query is intercepted while the helper's own logic runs for real.
vi.mock("../../../server/utils/db-helpers", () => ({
  loadOwnedOrThrow: vi.fn(),
}));

import { loadOwnedOrThrow } from "../../../server/utils/db-helpers";
import { trips } from "../../../server/db/schema";
import { assertTripOwnershipIfPresent } from "../../../server/utils/trip-helpers";

const mockLoadOwnedOrThrow = vi.mocked(loadOwnedOrThrow);

function makeMockEvent() {
  return {} as Parameters<typeof assertTripOwnershipIfPresent>[0];
}

describe("assertTripOwnershipIfPresent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not look up ownership when tripId is undefined", async () => {
    await assertTripOwnershipIfPresent(makeMockEvent(), undefined);

    expect(mockLoadOwnedOrThrow).not.toHaveBeenCalled();
  });

  it("verifies ownership against the trips table when a tripId is supplied", async () => {
    mockLoadOwnedOrThrow.mockResolvedValue({ id: "trip-1" } as never);
    const event = makeMockEvent();

    await assertTripOwnershipIfPresent(event, "trip-1");

    expect(mockLoadOwnedOrThrow).toHaveBeenCalledWith(
      event,
      trips,
      trips.id,
      trips.userId,
      "trip-1",
    );
  });

  it("rejects with 404 when the trip is not owned by the caller", async () => {
    const notFoundError = createError({
      statusCode: 404,
      statusMessage: "Not found",
    });
    mockLoadOwnedOrThrow.mockRejectedValue(notFoundError);

    await expect(
      assertTripOwnershipIfPresent(makeMockEvent(), "trip-other"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("looks up an empty tripId rather than silently skipping the check", async () => {
    const notFoundError = createError({
      statusCode: 404,
      statusMessage: "Not found",
    });
    mockLoadOwnedOrThrow.mockRejectedValue(notFoundError);

    await expect(
      assertTripOwnershipIfPresent(makeMockEvent(), ""),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockLoadOwnedOrThrow).toHaveBeenCalledWith(
      expect.anything(),
      trips,
      trips.id,
      trips.userId,
      "",
    );
  });
});
