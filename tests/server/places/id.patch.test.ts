import { describe, it, expect, vi, beforeEach } from "vitest";
import { stubNitroGlobals } from "../test-utils";

stubNitroGlobals();

const mockReadBody = vi.fn();
vi.stubGlobal("readBody", mockReadBody);

vi.mock("../../../server/utils/auth", () => ({
  requireUser: vi.fn(),
}));

vi.mock("../../../server/utils/db-helpers", () => ({
  requireRouterParam: vi.fn(),
  assertOwnership: vi.fn(),
  optionalString: vi.fn((value: unknown, _field: string) => {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== "string") {
      const error = new Error("must be a string") as Error & {
        statusCode: number;
        statusMessage: string;
      };
      error.statusCode = 400;
      error.statusMessage = "must be a string";
      throw error;
    }
    return value;
  }),
  optionalLatitude: vi.fn((value: unknown) => {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== "number" || !isFinite(value)) {
      const error = new Error("must be a number") as Error & {
        statusCode: number;
        statusMessage: string;
      };
      error.statusCode = 400;
      error.statusMessage = "must be a number";
      throw error;
    }
    return value;
  }),
  optionalLongitude: vi.fn((value: unknown) => {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== "number" || !isFinite(value)) {
      const error = new Error("must be a number") as Error & {
        statusCode: number;
        statusMessage: string;
      };
      error.statusCode = 400;
      error.statusMessage = "must be a number";
      throw error;
    }
    return value;
  }),
}));

vi.mock("../../../server/db/index", () => ({
  getDb: vi.fn(),
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm")>();
  return { ...original, eq: vi.fn(original.eq) };
});

import {
  requireRouterParam,
  assertOwnership,
} from "../../../server/utils/db-helpers";
import { getDb } from "../../../server/db/index";

const mockRequireRouterParam = vi.mocked(requireRouterParam);
const mockAssertOwnership = vi.mocked(assertOwnership);
const mockGetDb = vi.mocked(getDb);

function makeDbWithUpdate(returned: Record<string, unknown>) {
  const returningMock = vi.fn().mockResolvedValue([returned]);
  const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
  const setMock = vi.fn().mockReturnValue({ where: whereMock });
  const updateMock = vi.fn().mockReturnValue({ set: setMock });
  return { update: updateMock };
}

const handler = await import("../../../server/api/places/[id].patch");

describe("PATCH /api/places/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates and returns the place", async () => {
    const updatedPlace = { id: "place-1", userId: "user-1", name: "Berlin" };
    mockRequireRouterParam.mockReturnValue("place-1");
    mockReadBody.mockResolvedValue({ name: "Berlin" });
    mockAssertOwnership.mockResolvedValue(undefined);
    const mockDb = makeDbWithUpdate(updatedPlace);
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    const result = await (defaultHandler as (event: unknown) => unknown)({});

    expect(result).toEqual(updatedPlace);
  });

  it("throws 400 when id param is missing", async () => {
    const missingError = createError({
      statusCode: 400,
      statusMessage: "id is required",
    });
    mockRequireRouterParam.mockImplementation(() => {
      throw missingError;
    });
    mockReadBody.mockResolvedValue({ name: "Berlin" });

    const defaultHandler = "default" in handler ? handler.default : handler;

    await expect(
      (defaultHandler as (event: unknown) => unknown)({}),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 when no fields are provided", async () => {
    mockRequireRouterParam.mockReturnValue("place-1");
    mockReadBody.mockResolvedValue({});
    mockAssertOwnership.mockResolvedValue(undefined);
    const mockDb = makeDbWithUpdate({});
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;

    await expect(
      (defaultHandler as (event: unknown) => unknown)({}),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 when body is undefined (no body sent)", async () => {
    mockRequireRouterParam.mockReturnValue("place-1");
    mockReadBody.mockResolvedValue(undefined);
    mockAssertOwnership.mockResolvedValue(undefined);
    const mockDb = makeDbWithUpdate({});
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;

    await expect(
      (defaultHandler as (event: unknown) => unknown)({}),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("persists NULL when the category is cleared to an empty string", async () => {
    const updatedPlace = { id: "place-1", userId: "user-1", category: null };
    mockRequireRouterParam.mockReturnValue("place-1");
    mockReadBody.mockResolvedValue({ category: "" });
    mockAssertOwnership.mockResolvedValue(undefined);

    const returningMock = vi.fn().mockResolvedValue([updatedPlace]);
    const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
    const setMock = vi.fn().mockReturnValue({ where: whereMock });
    const mockDb = { update: vi.fn().mockReturnValue({ set: setMock }) };
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    await (defaultHandler as (event: unknown) => unknown)({});

    expect(setMock).toHaveBeenCalledWith({ category: null });
  });

  it("persists NULL when a cleared field is whitespace-only", async () => {
    const updatedPlace = { id: "place-1", userId: "user-1", category: null };
    mockRequireRouterParam.mockReturnValue("place-1");
    mockReadBody.mockResolvedValue({ category: "   " });
    mockAssertOwnership.mockResolvedValue(undefined);

    const returningMock = vi.fn().mockResolvedValue([updatedPlace]);
    const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
    const setMock = vi.fn().mockReturnValue({ where: whereMock });
    const mockDb = { update: vi.fn().mockReturnValue({ set: setMock }) };
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;
    await (defaultHandler as (event: unknown) => unknown)({});

    expect(setMock).toHaveBeenCalledWith({ category: null });
  });

  it("throws 400 when name is an empty string", async () => {
    mockRequireRouterParam.mockReturnValue("place-1");
    mockReadBody.mockResolvedValue({ name: "   " });
    mockAssertOwnership.mockResolvedValue(undefined);
    const mockDb = makeDbWithUpdate({});
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;

    await expect(
      (defaultHandler as (event: unknown) => unknown)({}),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 when only latitude is provided without longitude", async () => {
    mockRequireRouterParam.mockReturnValue("place-1");
    mockReadBody.mockResolvedValue({ latitude: 48.8566 });
    mockAssertOwnership.mockResolvedValue(undefined);
    const mockDb = makeDbWithUpdate({});
    mockGetDb.mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const defaultHandler = "default" in handler ? handler.default : handler;

    await expect(
      (defaultHandler as (event: unknown) => unknown)({}),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 404 when place is not owned", async () => {
    mockRequireRouterParam.mockReturnValue("place-1");
    mockReadBody.mockResolvedValue({ name: "Berlin" });
    const notFoundError = createError({
      statusCode: 404,
      statusMessage: "Not found",
    });
    mockAssertOwnership.mockRejectedValue(notFoundError);

    const defaultHandler = "default" in handler ? handler.default : handler;

    await expect(
      (defaultHandler as (event: unknown) => unknown)({}),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("throws 401 when not authenticated", async () => {
    mockRequireRouterParam.mockReturnValue("place-1");
    mockReadBody.mockResolvedValue({ name: "Berlin" });
    const unauthorizedError = createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });
    mockAssertOwnership.mockRejectedValue(unauthorizedError);

    const defaultHandler = "default" in handler ? handler.default : handler;

    await expect(
      (defaultHandler as (event: unknown) => unknown)({}),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});
