import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  makeInsertChain,
  makeSelectChain,
  describeEqCondition,
} from "./_helpers";

vi.mock("../../../server/db/index", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../../../server/db/index";

const mockGetDb = vi.mocked(getDb);

const { createNotification, fetchNotificationsForUser } =
  await import("../../../server/utils/notification-helpers");

describe("createNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a notification row with the provided input", async () => {
    const insertChain = makeInsertChain();
    mockGetDb.mockReturnValue(
      insertChain as unknown as ReturnType<typeof getDb>,
    );

    await createNotification({
      userId: "user-1",
      type: "new_follower",
      tone: "accent",
      body: "Someone started following you",
    });

    expect(insertChain.insert).toHaveBeenCalled();
    const valuesCall = insertChain.insert.mock.results[0].value.values;
    const insertedValue = valuesCall.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(insertedValue.userId).toBe("user-1");
    expect(insertedValue.type).toBe("new_follower");
    expect(insertedValue.tone).toBe("accent");
    expect(insertedValue.body).toBe("Someone started following you");
    expect(typeof insertedValue.id).toBe("string");
    expect(insertedValue.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("stores the provided actorId", async () => {
    const insertChain = makeInsertChain();
    mockGetDb.mockReturnValue(
      insertChain as unknown as ReturnType<typeof getDb>,
    );

    await createNotification({
      userId: "user-1",
      type: "new_follower",
      tone: "accent",
      body: "Someone started following you",
      actorId: "follower-1",
    });

    const valuesCall = insertChain.insert.mock.results[0].value.values;
    const insertedValue = valuesCall.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(insertedValue.actorId).toBe("follower-1");
  });

  it("defaults actorId to null when not provided", async () => {
    const insertChain = makeInsertChain();
    mockGetDb.mockReturnValue(
      insertChain as unknown as ReturnType<typeof getDb>,
    );

    await createNotification({
      userId: "user-1",
      type: "like",
      tone: "accent",
      body: "Someone liked your entry",
    });

    const valuesCall = insertChain.insert.mock.results[0].value.values;
    const insertedValue = valuesCall.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(insertedValue.actorId).toBeNull();
  });

  it("does not throw when the database insert fails (swallows and logs)", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetDb.mockReturnValue({
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockRejectedValue(new Error("DB connection lost")),
      }),
    } as unknown as ReturnType<typeof getDb>);

    await expect(
      createNotification({
        userId: "user-1",
        type: "new_follower",
        tone: "accent",
        body: "Someone started following you",
      }),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe("fetchNotificationsForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const LIMIT = 50;

  it("resolves a follower actor with the id and handle needed to link to their profile", async () => {
    const selectChain = makeSelectChain([
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
    ]);
    const database = selectChain as unknown as Parameters<
      typeof fetchNotificationsForUser
    >[0];

    const result = await fetchNotificationsForUser(database, "user-1", LIMIT);

    expect(result).toEqual([
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
    ]);
  });

  it("joins on the notification's actor_id, not the recipient's own user_id (join-key regression guard)", async () => {
    const selectChain = makeSelectChain([]);
    const database = selectChain as unknown as Parameters<
      typeof fetchNotificationsForUser
    >[0];

    await fetchNotificationsForUser(database, "user-1", LIMIT);

    // A join accidentally keyed off notifications.userId (the recipient)
    // instead of notifications.actorId (the follower) would still return
    // canned rows in every other test here — this is the guard against that
    // exact regression class. leftJoin(table, condition) — index 1 is the
    // condition; index 0 is just the joined table reference.
    expect(
      describeEqCondition(selectChain.firstLeftJoin.mock.calls[0][1]),
    ).toEqual(["notifications.actor_id", "users.id"]);
    expect(
      describeEqCondition(selectChain.secondLeftJoin.mock.calls[0][1]),
    ).toEqual(["notifications.actor_id", "user_preferences.user_id"]);
  });

  it("scopes the query to the requesting user and applies ordering and the limit (authz-boundary regression guard)", async () => {
    const selectChain = makeSelectChain([]);
    const database = selectChain as unknown as Parameters<
      typeof fetchNotificationsForUser
    >[0];

    await fetchNotificationsForUser(database, "user-1", LIMIT);

    // The join-key guard above proves the actor is resolved correctly; this
    // guards the authz boundary itself — a dropped or inverted `where` would
    // leak every user's notifications and still pass every other test here,
    // since the mock returns canned rows regardless of the arguments.
    expect(describeEqCondition(selectChain.where.mock.calls[0][0])).toEqual([
      "notifications.user_id",
      'literal:"user-1"',
    ]);
    expect(selectChain.orderBy).toHaveBeenCalledTimes(1);
    // Both a createdAt sort and a unique id tiebreaker must be passed —
    // without the second, rows sharing a createdAt have undefined order and
    // offset pagination can repeat or skip them. Asserting the arg count keeps
    // a dropped tiebreaker from passing silently.
    expect(selectChain.orderBy.mock.calls[0]).toHaveLength(2);
    expect(selectChain.limit).toHaveBeenCalledWith(LIMIT);
    expect(selectChain.offset).toHaveBeenCalledWith(0);
  });

  it("passes the requested offset through to the query for pagination", async () => {
    const selectChain = makeSelectChain([]);
    const database = selectChain as unknown as Parameters<
      typeof fetchNotificationsForUser
    >[0];

    await fetchNotificationsForUser(database, "user-1", LIMIT, LIMIT * 2);

    expect(selectChain.limit).toHaveBeenCalledWith(LIMIT);
    expect(selectChain.offset).toHaveBeenCalledWith(LIMIT * 2);
  });

  it("resolves an actor with a handle but no display name set (most real rows, before onboarding)", async () => {
    const selectChain = makeSelectChain([
      {
        id: "notif-handle-only",
        type: "new_follower",
        tone: "accent",
        body: "Someone started following you",
        isRead: false,
        createdAt: new Date("2024-06-01T10:00:00Z"),
        actorId: "follower-2",
        actorDisplayName: null,
        actorHandle: "elsa_far",
        actorDeletedAt: null,
      },
    ]);
    const database = selectChain as unknown as Parameters<
      typeof fetchNotificationsForUser
    >[0];

    const result = await fetchNotificationsForUser(database, "user-1", LIMIT);

    expect(result[0]?.actor).toEqual({
      id: "follower-2",
      displayName: null,
      handle: "elsa_far",
    });
  });

  it("resolves an actor with neither a display name nor a handle set to a null actor", async () => {
    // A user_preferences row can exist (e.g. created on first preferences
    // save) with both displayName and handle still null. There's nothing to
    // render, so resolveActor treats this the same as no actor at all rather
    // than returning an id with two null fields.
    const selectChain = makeSelectChain([
      {
        id: "notif-nameless-actor",
        type: "new_follower",
        tone: "accent",
        body: "Someone started following you",
        isRead: false,
        createdAt: new Date("2024-06-01T10:00:00Z"),
        actorId: "nameless-user",
        actorDisplayName: null,
        actorHandle: null,
        actorDeletedAt: null,
      },
    ]);
    const database = selectChain as unknown as Parameters<
      typeof fetchNotificationsForUser
    >[0];

    const result = await fetchNotificationsForUser(database, "user-1", LIMIT);

    expect(result[0]?.actor).toBeNull();
  });

  it("renders a legacy notification (actorId never recorded) with a null actor", async () => {
    const selectChain = makeSelectChain([
      {
        id: "notif-legacy",
        type: "new_follower",
        tone: "accent",
        body: "Someone started following you",
        isRead: true,
        createdAt: new Date("2024-01-01T00:00:00Z"),
        actorId: null,
        actorDisplayName: null,
        actorHandle: null,
        actorDeletedAt: null,
      },
    ]);
    const database = selectChain as unknown as Parameters<
      typeof fetchNotificationsForUser
    >[0];

    const result = await fetchNotificationsForUser(database, "user-1", LIMIT);

    expect(result[0]?.actor).toBeNull();
  });

  it("renders a notification with a null actor when the actor has since soft-deleted their account", async () => {
    const selectChain = makeSelectChain([
      {
        id: "notif-deleted-actor",
        type: "new_follower",
        tone: "accent",
        body: "Someone started following you",
        isRead: false,
        createdAt: new Date("2024-06-01T10:00:00Z"),
        actorId: "former-user",
        actorDisplayName: "Departed Traveler",
        actorHandle: "departed",
        actorDeletedAt: new Date("2024-05-01T00:00:00Z"),
      },
    ]);
    const database = selectChain as unknown as Parameters<
      typeof fetchNotificationsForUser
    >[0];

    const result = await fetchNotificationsForUser(database, "user-1", LIMIT);

    expect(result[0]?.actor).toBeNull();
  });

  it("returns an empty array when the user has no notifications", async () => {
    const selectChain = makeSelectChain([]);
    const database = selectChain as unknown as Parameters<
      typeof fetchNotificationsForUser
    >[0];

    const result = await fetchNotificationsForUser(database, "user-1", LIMIT);

    expect(result).toEqual([]);
  });
});
