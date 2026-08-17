import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  installNitroGlobals,
  unwrapHandler,
  makeSelectChain,
} from "./_helpers";

installNitroGlobals();

vi.mock("../../../server/utils/auth", () => ({
  requireUser: vi.fn(),
  ensureUser: vi.fn(),
}));

vi.mock("../../../server/db/index", () => ({
  getDb: vi.fn(),
}));

import { requireUser } from "../../../server/utils/auth";
import { getDb } from "../../../server/db/index";

const mockRequireUser = vi.mocked(requireUser);
const mockGetDb = vi.mocked(getDb);

const handler = await import("../../../server/api/notifications/index.get");
const callHandler = (query: Record<string, unknown> = {}) =>
  unwrapHandler(handler as Record<string, unknown>)({ query });

const PAGE_SIZE = 50;

function makeRawRow(id: string) {
  return {
    id,
    type: "new_follower",
    tone: "accent",
    body: "Someone started following you",
    isRead: false,
    createdAt: new Date("2024-06-01T10:00:00Z"),
    actorId: null,
    actorDisplayName: null,
    actorHandle: null,
    actorDeletedAt: null,
  };
}

describe("GET /api/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns notifications with the resolved actor for the authenticated user", async () => {
    mockRequireUser.mockReturnValue("user-1");

    const rawRows = [
      {
        id: "notif-1",
        type: "new_follower",
        tone: "accent",
        body: "Someone started following you",
        isRead: false,
        createdAt: new Date("2024-06-01T10:00:00Z"),
        actorId: "follower-1",
        actorDisplayName: "Elsa Farsdottir",
        actorHandle: "elsa_far",
        actorDeletedAt: null,
      },
    ];

    const selectChain = makeSelectChain(rawRows);
    mockGetDb.mockReturnValue(
      selectChain as unknown as ReturnType<typeof getDb>,
    );

    const result = await callHandler();
    expect(result).toEqual({
      notifications: [
        {
          id: "notif-1",
          type: "new_follower",
          tone: "accent",
          body: "Someone started following you",
          isRead: false,
          createdAt: new Date("2024-06-01T10:00:00Z"),
          actor: {
            id: "follower-1",
            displayName: "Elsa Farsdottir",
            handle: "elsa_far",
          },
        },
      ],
      page: 1,
      hasMore: false,
    });
  });

  // Legacy-row, deleted-actor, and nameless-actor resolution are exercised
  // thoroughly against fetchNotificationsForUser directly in
  // notification-helpers.test.ts — this file only needs to prove the
  // handler delegates to it with the right user and limit.
  it("returns an empty notifications array when the user has none", async () => {
    mockRequireUser.mockReturnValue("user-1");

    const selectChain = makeSelectChain([]);
    mockGetDb.mockReturnValue(
      selectChain as unknown as ReturnType<typeof getDb>,
    );

    const result = await callHandler();
    expect(result).toEqual({ notifications: [], page: 1, hasMore: false });
  });

  it("throws 401 when the user is not authenticated", async () => {
    mockRequireUser.mockImplementation(() => {
      throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
    });

    await expect(callHandler()).rejects.toMatchObject({ statusCode: 401 });
  });

  it("reports hasMore: true and page 1 when a full page of rows is returned", async () => {
    mockRequireUser.mockReturnValue("user-1");

    const fullPage = Array.from({ length: PAGE_SIZE }, (_unused, index) =>
      makeRawRow(`notif-${index}`),
    );
    const selectChain = makeSelectChain(fullPage);
    mockGetDb.mockReturnValue(
      selectChain as unknown as ReturnType<typeof getDb>,
    );

    const result = (await callHandler()) as {
      notifications: unknown[];
      page: number;
      hasMore: boolean;
    };

    expect(result.notifications).toHaveLength(PAGE_SIZE);
    expect(result.page).toBe(1);
    expect(result.hasMore).toBe(true);
    expect(selectChain.limit).toHaveBeenCalledWith(PAGE_SIZE);
    expect(selectChain.offset).toHaveBeenCalledWith(0);
  });

  it("reports hasMore: false when the page is short", async () => {
    mockRequireUser.mockReturnValue("user-1");

    const selectChain = makeSelectChain([makeRawRow("notif-1")]);
    mockGetDb.mockReturnValue(
      selectChain as unknown as ReturnType<typeof getDb>,
    );

    const result = (await callHandler()) as { hasMore: boolean };

    expect(result.hasMore).toBe(false);
  });

  it("applies the offset for the requested page", async () => {
    mockRequireUser.mockReturnValue("user-1");

    const selectChain = makeSelectChain([]);
    mockGetDb.mockReturnValue(
      selectChain as unknown as ReturnType<typeof getDb>,
    );

    const result = (await callHandler({ page: "3" })) as { page: number };

    expect(result.page).toBe(3);
    expect(selectChain.offset).toHaveBeenCalledWith(2 * PAGE_SIZE);
  });

  it("falls back to page 1 for a garbage page param", async () => {
    mockRequireUser.mockReturnValue("user-1");

    const selectChain = makeSelectChain([]);
    mockGetDb.mockReturnValue(
      selectChain as unknown as ReturnType<typeof getDb>,
    );

    const result = (await callHandler({ page: "1e300" })) as { page: number };

    expect(result.page).toBe(1);
    expect(selectChain.offset).toHaveBeenCalledWith(0);
  });

  it("reports hasMore: false at the final page even when a full page is returned", async () => {
    mockRequireUser.mockReturnValue("user-1");

    const fullPage = Array.from({ length: PAGE_SIZE }, (_unused, index) =>
      makeRawRow(`notif-${index}`),
    );
    const selectChain = makeSelectChain(fullPage);
    mockGetDb.mockReturnValue(
      selectChain as unknown as ReturnType<typeof getDb>,
    );

    const result = (await callHandler({ page: "1000" })) as {
      page: number;
      hasMore: boolean;
    };

    expect(result.page).toBe(1000);
    expect(result.hasMore).toBe(false);
  });
});
