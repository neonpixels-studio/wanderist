import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProfileUser } from "../useProfile";

const mockApiFetch = vi.fn();

vi.stubGlobal("useApiClient", () => ({ apiFetch: mockApiFetch }));

const { useProfile } = await import("../useProfile");

function notFoundError() {
  const error = new Error("Profile not found") as Error & {
    statusCode: number;
  };
  error.statusCode = 404;
  return error;
}

const SAMPLE_PROFILE = {
  userId: "user-1",
  displayName: "Elsa",
  handle: "elsa_far",
  homeBase: "Reykjavik",
  bio: null,
  publicProfile: true,
  followerCount: 3,
  followingCount: 1,
  placeCount: 8,
  isSelf: false,
};

describe("useProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts in the loading state before any fetch runs", () => {
    const { isLoading } = useProfile();
    expect(isLoading.value).toBe(true);
  });

  it("clears loading after a resolved fetch", async () => {
    mockApiFetch.mockResolvedValue(SAMPLE_PROFILE);
    const { isLoading, fetchProfile } = useProfile();

    await fetchProfile("user-1");

    expect(isLoading.value).toBe(false);
  });

  it("clears loading after a rejected fetch", async () => {
    mockApiFetch.mockRejectedValue(new Error("boom"));
    const { isLoading, fetchProfile } = useProfile();

    await fetchProfile("user-1");

    expect(isLoading.value).toBe(false);
  });

  it("fetchProfile loads the profile and requests the right endpoint", async () => {
    mockApiFetch.mockResolvedValue(SAMPLE_PROFILE);
    const { profile, notFound, fetchProfile } = useProfile();

    await fetchProfile("user-1");

    expect(mockApiFetch).toHaveBeenCalledWith("/api/users/user-1");
    expect(profile.value).toEqual(SAMPLE_PROFILE);
    expect(notFound.value).toBe(false);
  });

  it("fetchProfile sets notFound on a 404 without setting a generic error", async () => {
    mockApiFetch.mockRejectedValue(notFoundError());
    const { profile, notFound, error, fetchProfile } = useProfile();

    await fetchProfile("missing");

    expect(profile.value).toBeNull();
    expect(notFound.value).toBe(true);
    expect(error.value).toBeNull();
  });

  it("treats an ofetch error carrying response.status 404 as not-found", async () => {
    const responseShapedError = Object.assign(new Error("Not Found"), {
      response: { status: 404 },
    });
    mockApiFetch.mockRejectedValue(responseShapedError);
    const { notFound, error, fetchProfile } = useProfile();

    await fetchProfile("missing");

    expect(notFound.value).toBe(true);
    expect(error.value).toBeNull();
  });

  it("fetchProfile sets a generic error on a non-404 failure", async () => {
    mockApiFetch.mockRejectedValue(new Error("boom"));
    const { notFound, error, fetchProfile } = useProfile();

    await fetchProfile("user-1");

    expect(notFound.value).toBe(false);
    expect(error.value).toBeTruthy();
  });

  it("discards a superseded profile response so a slow first load can't win", async () => {
    let resolveFirst!: (value: ProfileUser) => void;
    const firstPending = new Promise<ProfileUser>((resolve) => {
      resolveFirst = resolve;
    });
    mockApiFetch
      .mockReturnValueOnce(firstPending)
      .mockResolvedValueOnce({ ...SAMPLE_PROFILE, displayName: "Second" });

    const { profile, fetchProfile } = useProfile();
    const firstCall = fetchProfile("user-1");
    const secondCall = fetchProfile("user-2");
    await secondCall;

    // The first (superseded) request resolves last, but must not overwrite.
    resolveFirst({ ...SAMPLE_PROFILE, displayName: "First" });
    await firstCall;

    expect(profile.value?.displayName).toBe("Second");
  });

  it("starts followers in a loading state and clears it after a fetch", async () => {
    const { followersLoading } = useProfile();
    expect(followersLoading.value).toBe(true);

    mockApiFetch.mockResolvedValue({ followers: [], hasMore: false });
    const composable = useProfile();
    await composable.fetchFollowers("user-1");
    expect(composable.followersLoading.value).toBe(false);
  });

  it("discards a superseded followers response so a→b navigation can't cross wires", async () => {
    let resolveFirst!: (value: { followers: []; hasMore: boolean }) => void;
    const firstPending = new Promise<{ followers: []; hasMore: boolean }>(
      (resolve) => {
        resolveFirst = resolve;
      },
    );
    mockApiFetch.mockReturnValueOnce(firstPending).mockResolvedValueOnce({
      followers: [{ userId: "user-b", displayName: "B", handle: "b" }],
      hasMore: false,
    });

    const { followers, fetchFollowers } = useProfile();
    const firstCall = fetchFollowers("user-a");
    const secondCall = fetchFollowers("user-b");
    await secondCall;

    resolveFirst({ followers: [], hasMore: true });
    await firstCall;

    expect(followers.value).toEqual([
      { userId: "user-b", displayName: "B", handle: "b" },
    ]);
  });

  it("clears the list up front when switching to a different profile", async () => {
    const { followers, hasMoreFollowers, fetchFollowers } = useProfile();

    mockApiFetch.mockResolvedValueOnce({
      followers: [{ userId: "user-a-follower", displayName: "A", handle: "a" }],
      hasMore: true,
    });
    await fetchFollowers("user-a");
    expect(followers.value).toHaveLength(1);

    // A new profile's fetch is in flight (unresolved): the previous traveler's
    // followers must be gone immediately so they never render under the new name.
    mockApiFetch.mockReturnValueOnce(new Promise(() => {}));
    void fetchFollowers("user-b");

    expect(followers.value).toEqual([]);
    expect(hasMoreFollowers.value).toBe(false);
  });

  it("keeps the list visible during a same-user refresh", async () => {
    const { followers, fetchFollowers } = useProfile();

    const followerRows = [
      { userId: "user-a-follower", displayName: "A", handle: "a" },
    ];
    mockApiFetch.mockResolvedValueOnce({
      followers: followerRows,
      hasMore: false,
    });
    await fetchFollowers("user-a");
    expect(followers.value).toHaveLength(1);

    // A refresh for the same user (e.g. after a follow toggle) must not flash
    // the list away while the refetch is in flight.
    mockApiFetch.mockReturnValueOnce(new Promise(() => {}));
    void fetchFollowers("user-a");

    expect(followers.value).toEqual(followerRows);
  });

  it("encodes the user ID in the followers request path", async () => {
    mockApiFetch.mockResolvedValue({ followers: [], hasMore: false });
    const { fetchFollowers } = useProfile();

    await fetchFollowers("user/with space");

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/users/user%2Fwith%20space/followers",
    );
  });

  it("fetchFollowers loads the followers list and the hasMore flag", async () => {
    const followerRows = [
      { userId: "user-2", displayName: "Marco", handle: "marco" },
    ];
    mockApiFetch.mockResolvedValue({ followers: followerRows, hasMore: true });
    const { followers, hasMoreFollowers, fetchFollowers } = useProfile();

    await fetchFollowers("user-1");

    expect(mockApiFetch).toHaveBeenCalledWith("/api/users/user-1/followers");
    expect(followers.value).toEqual(followerRows);
    expect(hasMoreFollowers.value).toBe(true);
  });

  it("clears a previously-loaded list and surfaces an error on non-404 failure", async () => {
    const { followers, followersError, fetchFollowers } = useProfile();

    // Seed a successful load first so the failure path has something to clear.
    mockApiFetch.mockResolvedValueOnce({
      followers: [{ userId: "user-2", displayName: "Marco", handle: "marco" }],
      hasMore: false,
    });
    await fetchFollowers("user-1");
    expect(followers.value).toHaveLength(1);

    mockApiFetch.mockRejectedValueOnce(new Error("boom"));
    await expect(fetchFollowers("user-1")).resolves.toBeUndefined();

    expect(followers.value).toEqual([]);
    expect(followersError.value).toBe("Could not load followers");
  });

  it("does not raise a followers error for a 404 (private/missing profile)", async () => {
    const { followers, followersError, fetchFollowers } = useProfile();

    mockApiFetch.mockRejectedValue(notFoundError());
    await fetchFollowers("user-1");

    expect(followers.value).toEqual([]);
    expect(followersError.value).toBeNull();
  });

  it("starts following in a loading state and clears it after a fetch", async () => {
    const { followingLoading } = useProfile();
    expect(followingLoading.value).toBe(true);

    mockApiFetch.mockResolvedValue({ following: [], hasMore: false });
    const composable = useProfile();
    await composable.fetchFollowingList("user-1");
    expect(composable.followingLoading.value).toBe(false);
  });

  it("discards a superseded following response so a→b navigation can't cross wires", async () => {
    let resolveFirst!: (value: { following: []; hasMore: boolean }) => void;
    const firstPending = new Promise<{ following: []; hasMore: boolean }>(
      (resolve) => {
        resolveFirst = resolve;
      },
    );
    mockApiFetch.mockReturnValueOnce(firstPending).mockResolvedValueOnce({
      following: [{ userId: "user-b", displayName: "B", handle: "b" }],
      hasMore: false,
    });

    const { following, fetchFollowingList } = useProfile();
    const firstCall = fetchFollowingList("user-a");
    const secondCall = fetchFollowingList("user-b");
    await secondCall;

    resolveFirst({ following: [], hasMore: true });
    await firstCall;

    expect(following.value).toEqual([
      { userId: "user-b", displayName: "B", handle: "b" },
    ]);
  });

  it("clears the following list up front when switching to a different profile", async () => {
    const { following, hasMoreFollowing, fetchFollowingList } = useProfile();

    mockApiFetch.mockResolvedValueOnce({
      following: [{ userId: "user-a-followee", displayName: "A", handle: "a" }],
      hasMore: true,
    });
    await fetchFollowingList("user-a");
    expect(following.value).toHaveLength(1);

    // A new profile's fetch is in flight (unresolved): the previous traveler's
    // following list must be gone immediately so it never renders under the
    // new name.
    mockApiFetch.mockReturnValueOnce(new Promise(() => {}));
    void fetchFollowingList("user-b");

    expect(following.value).toEqual([]);
    expect(hasMoreFollowing.value).toBe(false);
  });

  it("keeps the following list visible during a same-user refresh", async () => {
    const { following, fetchFollowingList } = useProfile();

    const followingRows = [
      { userId: "user-a-followee", displayName: "A", handle: "a" },
    ];
    mockApiFetch.mockResolvedValueOnce({
      following: followingRows,
      hasMore: false,
    });
    await fetchFollowingList("user-a");
    expect(following.value).toHaveLength(1);

    // A refresh for the same user must not flash the list away while the
    // refetch is in flight.
    mockApiFetch.mockReturnValueOnce(new Promise(() => {}));
    void fetchFollowingList("user-a");

    expect(following.value).toEqual(followingRows);
  });

  it("encodes the user ID in the following request path", async () => {
    mockApiFetch.mockResolvedValue({ following: [], hasMore: false });
    const { fetchFollowingList } = useProfile();

    await fetchFollowingList("user/with space");

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/users/user%2Fwith%20space/following",
    );
  });

  it("fetchFollowingList loads the following list and the hasMore flag", async () => {
    const followingRows = [
      { userId: "user-2", displayName: "Marco", handle: "marco" },
    ];
    mockApiFetch.mockResolvedValue({
      following: followingRows,
      hasMore: true,
    });
    const { following, hasMoreFollowing, fetchFollowingList } = useProfile();

    await fetchFollowingList("user-1");

    expect(mockApiFetch).toHaveBeenCalledWith("/api/users/user-1/following");
    expect(following.value).toEqual(followingRows);
    expect(hasMoreFollowing.value).toBe(true);
  });

  it("clears a previously-loaded following list and surfaces an error on non-404 failure", async () => {
    const { following, followingError, fetchFollowingList } = useProfile();

    // Seed a successful load first so the failure path has something to clear.
    mockApiFetch.mockResolvedValueOnce({
      following: [{ userId: "user-2", displayName: "Marco", handle: "marco" }],
      hasMore: false,
    });
    await fetchFollowingList("user-1");
    expect(following.value).toHaveLength(1);

    mockApiFetch.mockRejectedValueOnce(new Error("boom"));
    await expect(fetchFollowingList("user-1")).resolves.toBeUndefined();

    expect(following.value).toEqual([]);
    expect(followingError.value).toBe("Could not load following");
  });

  it("does not raise a following error for a 404 (private/missing profile)", async () => {
    const { following, followingError, fetchFollowingList } = useProfile();

    mockApiFetch.mockRejectedValue(notFoundError());
    await fetchFollowingList("user-1");

    expect(following.value).toEqual([]);
    expect(followingError.value).toBeNull();
  });

  it("encodes the user ID in the request path", async () => {
    mockApiFetch.mockResolvedValue(SAMPLE_PROFILE);
    const { fetchProfile } = useProfile();

    await fetchProfile("user/with space");

    expect(mockApiFetch).toHaveBeenCalledWith("/api/users/user%2Fwith%20space");
  });

  it("starts trips in a loading state and clears it after a fetch", async () => {
    const { tripsLoading } = useProfile();
    expect(tripsLoading.value).toBe(true);

    mockApiFetch.mockResolvedValue({ trips: [], hasMore: false });
    const composable = useProfile();
    await composable.fetchTrips("user-1");
    expect(composable.tripsLoading.value).toBe(false);
  });

  it("discards a superseded trips response so a→b navigation can't cross wires", async () => {
    let resolveFirst!: (value: { trips: []; hasMore: boolean }) => void;
    const firstPending = new Promise<{ trips: []; hasMore: boolean }>(
      (resolve) => {
        resolveFirst = resolve;
      },
    );
    mockApiFetch.mockReturnValueOnce(firstPending).mockResolvedValueOnce({
      trips: [
        {
          id: "trip-b",
          name: "B",
          status: "past",
          startDate: null,
          endDate: null,
        },
      ],
      hasMore: false,
    });

    const { trips, fetchTrips } = useProfile();
    const firstCall = fetchTrips("user-a");
    const secondCall = fetchTrips("user-b");
    await secondCall;

    resolveFirst({ trips: [], hasMore: true });
    await firstCall;

    expect(trips.value).toEqual([
      {
        id: "trip-b",
        name: "B",
        status: "past",
        startDate: null,
        endDate: null,
      },
    ]);
  });

  it("keeps loading true when a stale trips response resolves while the newer request is still pending", async () => {
    let resolveFirst!: (value: { trips: []; hasMore: boolean }) => void;
    const firstPending = new Promise<{ trips: []; hasMore: boolean }>(
      (resolve) => {
        resolveFirst = resolve;
      },
    );
    mockApiFetch
      .mockReturnValueOnce(firstPending)
      .mockReturnValueOnce(new Promise(() => {}));

    const { trips, hasMoreTrips, tripsLoading, fetchTrips } = useProfile();
    void fetchTrips("user-a");
    void fetchTrips("user-b");

    // The stale (user-a) call settles first, but user-b's request is still
    // pending — loading must stay true and the stale payload must not apply.
    resolveFirst({ trips: [], hasMore: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(tripsLoading.value).toBe(true);
    expect(trips.value).toEqual([]);
    expect(hasMoreTrips.value).toBe(false);
  });

  it("ignores a stale trips rejection while the newer request is still pending", async () => {
    let rejectFirst!: (error: unknown) => void;
    const firstPending = new Promise<{ trips: []; hasMore: boolean }>(
      (_resolve, reject) => {
        rejectFirst = reject;
      },
    );
    mockApiFetch
      .mockReturnValueOnce(firstPending)
      .mockReturnValueOnce(new Promise(() => {}));

    const { tripsError, tripsLoading, fetchTrips } = useProfile();
    void fetchTrips("user-a");
    void fetchTrips("user-b");

    rejectFirst(new Error("boom"));
    await Promise.resolve();
    await Promise.resolve();

    expect(tripsError.value).toBeNull();
    expect(tripsLoading.value).toBe(true);
  });

  it("clears the trips list up front when switching to a different profile", async () => {
    const { trips, hasMoreTrips, fetchTrips } = useProfile();

    mockApiFetch.mockResolvedValueOnce({
      trips: [
        {
          id: "trip-a",
          name: "A",
          status: "past",
          startDate: null,
          endDate: null,
        },
      ],
      hasMore: true,
    });
    await fetchTrips("user-a");
    expect(trips.value).toHaveLength(1);

    mockApiFetch.mockReturnValueOnce(new Promise(() => {}));
    void fetchTrips("user-b");

    expect(trips.value).toEqual([]);
    expect(hasMoreTrips.value).toBe(false);
  });

  it("keeps the trips list visible during a same-user refresh", async () => {
    const { trips, fetchTrips } = useProfile();

    const tripRows = [
      {
        id: "trip-a",
        name: "A",
        status: "past",
        startDate: null,
        endDate: null,
      },
    ];
    mockApiFetch.mockResolvedValueOnce({ trips: tripRows, hasMore: false });
    await fetchTrips("user-a");
    expect(trips.value).toHaveLength(1);

    mockApiFetch.mockReturnValueOnce(new Promise(() => {}));
    void fetchTrips("user-a");

    expect(trips.value).toEqual(tripRows);
  });

  it("encodes the user ID in the trips request path", async () => {
    mockApiFetch.mockResolvedValue({ trips: [], hasMore: false });
    const { fetchTrips } = useProfile();

    await fetchTrips("user/with space");

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/users/user%2Fwith%20space/trips",
    );
  });

  it("fetchTrips loads the trips list and the hasMore flag", async () => {
    const tripRows = [
      {
        id: "trip-1",
        name: "Iceland Ring Road",
        status: "past",
        startDate: null,
        endDate: null,
      },
    ];
    mockApiFetch.mockResolvedValue({ trips: tripRows, hasMore: true });
    const { trips, hasMoreTrips, fetchTrips } = useProfile();

    await fetchTrips("user-1");

    expect(mockApiFetch).toHaveBeenCalledWith("/api/users/user-1/trips");
    expect(trips.value).toEqual(tripRows);
    expect(hasMoreTrips.value).toBe(true);
  });

  it("clears a previously-loaded trips list and surfaces an error on non-404 failure", async () => {
    const { trips, tripsError, fetchTrips } = useProfile();

    mockApiFetch.mockResolvedValueOnce({
      trips: [
        {
          id: "trip-1",
          name: "A",
          status: "past",
          startDate: null,
          endDate: null,
        },
      ],
      hasMore: false,
    });
    await fetchTrips("user-1");
    expect(trips.value).toHaveLength(1);

    mockApiFetch.mockRejectedValueOnce(new Error("boom"));
    await expect(fetchTrips("user-1")).resolves.toBeUndefined();

    expect(trips.value).toEqual([]);
    expect(tripsError.value).toBe("Could not load trips");
  });

  it("does not raise a trips error for a 404 (private/missing profile)", async () => {
    const { trips, tripsError, fetchTrips } = useProfile();

    mockApiFetch.mockRejectedValue(notFoundError());
    await fetchTrips("user-1");

    expect(trips.value).toEqual([]);
    expect(tripsError.value).toBeNull();
  });

  it("starts guides in a loading state and clears it after a fetch", async () => {
    const { guidesLoading } = useProfile();
    expect(guidesLoading.value).toBe(true);

    mockApiFetch.mockResolvedValue({ guides: [], hasMore: false });
    const composable = useProfile();
    await composable.fetchGuides("user-1");
    expect(composable.guidesLoading.value).toBe(false);
  });

  it("discards a superseded guides response so a→b navigation can't cross wires", async () => {
    let resolveFirst!: (value: { guides: []; hasMore: boolean }) => void;
    const firstPending = new Promise<{ guides: []; hasMore: boolean }>(
      (resolve) => {
        resolveFirst = resolve;
      },
    );
    mockApiFetch.mockReturnValueOnce(firstPending).mockResolvedValueOnce({
      guides: [{ id: "guide-b", title: "B", readTimeMinutes: 5, likeCount: 0 }],
      hasMore: false,
    });

    const { guides, fetchGuides } = useProfile();
    const firstCall = fetchGuides("user-a");
    const secondCall = fetchGuides("user-b");
    await secondCall;

    resolveFirst({ guides: [], hasMore: true });
    await firstCall;

    expect(guides.value).toEqual([
      { id: "guide-b", title: "B", readTimeMinutes: 5, likeCount: 0 },
    ]);
  });

  it("clears the guides list up front when switching to a different profile", async () => {
    const { guides, hasMoreGuides, fetchGuides } = useProfile();

    mockApiFetch.mockResolvedValueOnce({
      guides: [{ id: "guide-a", title: "A", readTimeMinutes: 5, likeCount: 0 }],
      hasMore: true,
    });
    await fetchGuides("user-a");
    expect(guides.value).toHaveLength(1);

    mockApiFetch.mockReturnValueOnce(new Promise(() => {}));
    void fetchGuides("user-b");

    expect(guides.value).toEqual([]);
    expect(hasMoreGuides.value).toBe(false);
  });

  it("keeps the guides list visible during a same-user refresh", async () => {
    const { guides, fetchGuides } = useProfile();

    const guideRows = [
      { id: "guide-a", title: "A", readTimeMinutes: 5, likeCount: 0 },
    ];
    mockApiFetch.mockResolvedValueOnce({ guides: guideRows, hasMore: false });
    await fetchGuides("user-a");
    expect(guides.value).toHaveLength(1);

    mockApiFetch.mockReturnValueOnce(new Promise(() => {}));
    void fetchGuides("user-a");

    expect(guides.value).toEqual(guideRows);
  });

  it("encodes the user ID in the guides request path", async () => {
    mockApiFetch.mockResolvedValue({ guides: [], hasMore: false });
    const { fetchGuides } = useProfile();

    await fetchGuides("user/with space");

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/users/user%2Fwith%20space/guides",
    );
  });

  it("fetchGuides loads the guides list and the hasMore flag", async () => {
    const guideRows = [
      {
        id: "guide-1",
        title: "Tokyo on foot",
        readTimeMinutes: 8,
        likeCount: 3,
      },
    ];
    mockApiFetch.mockResolvedValue({ guides: guideRows, hasMore: true });
    const { guides, hasMoreGuides, fetchGuides } = useProfile();

    await fetchGuides("user-1");

    expect(mockApiFetch).toHaveBeenCalledWith("/api/users/user-1/guides");
    expect(guides.value).toEqual(guideRows);
    expect(hasMoreGuides.value).toBe(true);
  });

  it("clears a previously-loaded guides list and surfaces an error on non-404 failure", async () => {
    const { guides, guidesError, fetchGuides } = useProfile();

    mockApiFetch.mockResolvedValueOnce({
      guides: [{ id: "guide-1", title: "A", readTimeMinutes: 5, likeCount: 0 }],
      hasMore: false,
    });
    await fetchGuides("user-1");
    expect(guides.value).toHaveLength(1);

    mockApiFetch.mockRejectedValueOnce(new Error("boom"));
    await expect(fetchGuides("user-1")).resolves.toBeUndefined();

    expect(guides.value).toEqual([]);
    expect(guidesError.value).toBe("Could not load guides");
  });

  it("does not raise a guides error for a 404 (private/missing profile)", async () => {
    const { guides, guidesError, fetchGuides } = useProfile();

    mockApiFetch.mockRejectedValue(notFoundError());
    await fetchGuides("user-1");

    expect(guides.value).toEqual([]);
    expect(guidesError.value).toBeNull();
  });
});
