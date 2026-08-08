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

  it("encodes the user ID in the request path", async () => {
    mockApiFetch.mockResolvedValue(SAMPLE_PROFILE);
    const { fetchProfile } = useProfile();

    await fetchProfile("user/with space");

    expect(mockApiFetch).toHaveBeenCalledWith("/api/users/user%2Fwith%20space");
  });
});
