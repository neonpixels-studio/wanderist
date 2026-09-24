import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, enableAutoUnmount } from "@vue/test-utils";
import { nextTick, reactive, ref, watch } from "vue";
import ProfilePage from "../u/[id].vue";
import { CLERK_BOOTSTRAP_TIMEOUT_MS } from "~/composables/useClerkGatedFetch";

// The #280 gate below makes the page's useAsyncData handler re-fire through a
// real `watch` (see the useAsyncData stub below), so a mounted page's watcher
// stays alive past its own test unless explicitly torn down — the next test's
// route/Clerk-ref mutation would otherwise still be observed by leftover
// watchers from every earlier test in this file, double- (or 21-times-)
// counting calls against the shared mockFetch* spies below.
enableAutoUnmount(afterEach);
import ProfileHeader from "~/components/ProfileHeader.vue";
import ProfileFollowerList from "~/components/ProfileFollowerList.vue";
import ProfileFollowingList from "~/components/ProfileFollowingList.vue";
import ProfileTripList from "~/components/ProfileTripList.vue";
import ProfileGuideList from "~/components/ProfileGuideList.vue";
import type {
  ProfileUser,
  ProfileFollower,
  ProfileFollowee,
  ProfileTrip,
  ProfileGuide,
} from "~/composables/useProfile";
import {
  lastSeoMetaCall,
  stubOgMetaGlobals,
} from "~/composables/__tests__/ogMetaTestUtils";

// The profile route is keyed by the target user's id. Reactive so a test can
// simulate the viewer navigating to another profile mid-interaction. `path`
// is a getter (not a static string) so useOgMeta's og:url reflects a
// route-param change, not just the value at mount.
const routeParams = reactive({ id: "user-1" });
vi.stubGlobal("useRoute", () => ({
  params: routeParams,
  query: {},
  get path() {
    return `/u/${routeParams.id}`;
  },
}));

// #269 og/twitter meta coverage below reads this trackable useSeoMeta stub.
const useSeoMetaMock = stubOgMetaGlobals();

// isClerkLoaded/isSignedIn drive the fetch's #280 gate below; drive them from
// shared refs so a test can simulate the Clerk bootstrap window and a viewer
// signing in after the fact, same pattern as trip-detail.test.ts's #255
// coverage.
const clerkLoadedRef = ref(true);
const clerkSignedInRef = ref(false);
vi.stubGlobal("useClerkAuth", () => ({
  isLoaded: clerkLoadedRef,
  isSignedIn: clerkSignedInRef,
  getToken: vi.fn().mockResolvedValue(null),
}));

// The page loads via useAsyncData; the global stub ignores the handler, so
// invoke it here to exercise the mount-time fetches and record the call so the
// wiring (key + watch on the route param and retryGeneration) can be
// asserted. Honour the real refetch-on-watch contract (not just record the
// watch array) so a test can assert the #280 gate's retryGeneration actually
// re-triggers the fetch once Clerk resolves.
let lastAsyncDataCall: {
  key: () => string;
  options: { watch?: unknown[]; server?: boolean };
} | null = null;
vi.stubGlobal(
  "useAsyncData",
  (
    key: () => string,
    handler: () => Promise<unknown>,
    options: { watch?: unknown[]; server?: boolean } = {},
  ) => {
    lastAsyncDataCall = { key, options };
    handler();
    if (options.watch) {
      watch(options.watch as Parameters<typeof watch>[0], () => {
        handler();
      });
    }
    return {
      data: ref(null),
      pending: ref(false),
      error: ref(null),
      refresh: vi.fn(),
    };
  },
);

const profile = ref<ProfileUser | null>(null);
const followers = ref<ProfileFollower[]>([]);
const hasMoreFollowers = ref(false);
const following = ref<ProfileFollowee[]>([]);
const hasMoreFollowing = ref(false);
const trips = ref<ProfileTrip[]>([]);
const hasMoreTrips = ref(false);
const guides = ref<ProfileGuide[]>([]);
const hasMoreGuides = ref(false);
const isLoading = ref(false);
const followersLoading = ref(false);
const followingLoading = ref(false);
const tripsLoading = ref(false);
const guidesLoading = ref(false);
const notFound = ref(false);
const profileError = ref<string | null>(null);
const followersError = ref<string | null>(null);
const followingError = ref<string | null>(null);
const tripsError = ref<string | null>(null);
const guidesError = ref<string | null>(null);
const mockFetchProfile = vi.fn();
const mockFetchFollowers = vi.fn();
const mockFetchFollowingList = vi.fn();
const mockFetchTrips = vi.fn();
const mockFetchGuides = vi.fn();

vi.stubGlobal("useProfile", () => ({
  profile,
  followers,
  hasMoreFollowers,
  following,
  hasMoreFollowing,
  trips,
  hasMoreTrips,
  guides,
  hasMoreGuides,
  isLoading,
  followersLoading,
  followingLoading,
  tripsLoading,
  guidesLoading,
  notFound,
  error: profileError,
  followersError,
  followingError,
  tripsError,
  guidesError,
  fetchProfile: mockFetchProfile,
  fetchFollowers: mockFetchFollowers,
  fetchFollowingList: mockFetchFollowingList,
  fetchTrips: mockFetchTrips,
  fetchGuides: mockFetchGuides,
}));

const followingIds = ref<Set<string>>(new Set());
const pendingUserIds = ref<Set<string>>(new Set());
const followError = ref<string | null>(null);
const mockToggleFollow = vi.fn();
const mockFetchFollowing = vi.fn();

vi.stubGlobal("useFollows", () => ({
  fetchFollowing: mockFetchFollowing,
  toggleFollow: mockToggleFollow,
  isFollowing: (userId: string) => followingIds.value.has(userId),
  isPending: (userId: string) => pendingUserIds.value.has(userId),
  error: followError,
}));

const iconStub = { template: "<svg data-icon />" };
const topbarStub = {
  template: '<header class="topbar"><slot /></header>',
  props: ["title", "crumb"],
};
const linkStub = {
  template: '<a :href="to"><slot /></a>',
  props: ["to"],
};
const alertStub = {
  template: '<div class="alert-stub" :data-message="message" />',
  props: ["intent", "message", "dismissible"],
};

const globalConfig = {
  global: {
    // Register the real profile child components so the page renders deeply;
    // they have their own focused unit tests.
    components: {
      ProfileHeader,
      ProfileFollowerList,
      ProfileFollowingList,
      ProfileTripList,
      ProfileGuideList,
    },
    stubs: {
      AppIcon: iconStub,
      AppTopbar: topbarStub,
      AppAlert: alertStub,
      NuxtLink: linkStub,
    },
  },
};

const SAMPLE_PROFILE: ProfileUser = {
  userId: "user-1",
  displayName: "Elsa",
  handle: "elsa_far",
  homeBase: "Reykjavik",
  bio: "Cold-water swimmer chasing coastlines.",
  publicProfile: true,
  followerCount: 3,
  followingCount: 1,
  placeCount: 8,
  isSelf: false,
};

describe("profile page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeParams.id = "user-1";
    profile.value = null;
    followers.value = [];
    hasMoreFollowers.value = false;
    following.value = [];
    hasMoreFollowing.value = false;
    trips.value = [];
    hasMoreTrips.value = false;
    guides.value = [];
    hasMoreGuides.value = false;
    isLoading.value = false;
    followersLoading.value = false;
    followingLoading.value = false;
    tripsLoading.value = false;
    guidesLoading.value = false;
    notFound.value = false;
    profileError.value = null;
    followersError.value = null;
    followingError.value = null;
    tripsError.value = null;
    guidesError.value = null;
    followingIds.value = new Set();
    pendingUserIds.value = new Set();
    clerkLoadedRef.value = true;
    clerkSignedInRef.value = false;
  });

  it("loads via useAsyncData keyed on and watching the route param", () => {
    mount(ProfilePage, globalConfig);

    // The watch source must be the route param itself — that is what makes
    // /u/a → /u/b refetch instead of showing stale data.
    expect(lastAsyncDataCall?.key()).toBe("profile-user-1");
    const watched = lastAsyncDataCall?.options.watch?.[0] as {
      value: string;
    };
    expect(watched.value).toBe("user-1");
    // Client-only: the fetches carry the Clerk token, so SSR would 401.
    expect(lastAsyncDataCall?.options.server).toBe(false);
  });

  it("fetches the profile, followers, following, trips, guides, and follow state on mount", () => {
    profile.value = { ...SAMPLE_PROFILE };
    mount(ProfilePage, globalConfig);

    expect(mockFetchProfile).toHaveBeenCalledWith("user-1");
    expect(mockFetchFollowers).toHaveBeenCalledWith("user-1");
    expect(mockFetchFollowingList).toHaveBeenCalledWith("user-1");
    expect(mockFetchTrips).toHaveBeenCalledWith("user-1");
    expect(mockFetchGuides).toHaveBeenCalledWith("user-1");
    expect(mockFetchFollowing).toHaveBeenCalled();
  });

  // Regression coverage for #280: /u/[id]'s fetch used to fire with no
  // isClerkLoaded gate at all, so a hard refresh raced an unresolved Clerk
  // bootstrap and 401'd anonymously — even for a viewer loading their own
  // profile, since middleware: "auth" lets navigation through before Clerk
  // finishes loading (see app/middleware/auth.ts).
  it("does not fetch until Clerk resolves, then fetches exactly once already authenticated (no anonymous 401 race)", async () => {
    clerkLoadedRef.value = false;
    clerkSignedInRef.value = false;

    mount(ProfilePage, globalConfig);
    expect(mockFetchProfile).not.toHaveBeenCalled();
    expect(mockFetchFollowing).not.toHaveBeenCalled();

    // Clerk resolves isLoaded and isSignedIn together, same as the #255 fix.
    clerkSignedInRef.value = true;
    clerkLoadedRef.value = true;
    await nextTick();

    expect(mockFetchProfile).toHaveBeenCalledTimes(1);
    expect(mockFetchProfile).toHaveBeenCalledWith("user-1");
    expect(mockFetchFollowing).toHaveBeenCalledTimes(1);
  });

  it("still fetches a profile anonymously once the Clerk bootstrap grace period lapses", async () => {
    vi.useFakeTimers();
    try {
      clerkLoadedRef.value = false;
      clerkSignedInRef.value = false;

      mount(ProfilePage, globalConfig);
      expect(mockFetchProfile).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(CLERK_BOOTSTRAP_TIMEOUT_MS);

      expect(mockFetchProfile).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("watches retryGeneration (not just the route param) so a delayed Clerk resolution re-triggers the fetch", () => {
    mount(ProfilePage, globalConfig);

    expect(lastAsyncDataCall?.options.watch).toHaveLength(2);
  });

  it("renders a loaded public profile", () => {
    profile.value = { ...SAMPLE_PROFILE };
    followers.value = [
      { userId: "user-2", displayName: "Marco", handle: "marco" },
    ];
    const wrapper = mount(ProfilePage, globalConfig);

    expect(wrapper.text()).toContain("Elsa");
    expect(wrapper.text()).toContain("@elsa_far");
    expect(wrapper.text()).toContain("followers");
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("shows the unavailable state when the profile is private or missing", () => {
    notFound.value = true;
    const wrapper = mount(ProfilePage, globalConfig);

    expect(wrapper.text()).toContain("Profile unavailable");
    expect(wrapper.find(".phead").exists()).toBe(false);
  });

  it("forwards the followers loading state so the list shows no false empty state", () => {
    profile.value = { ...SAMPLE_PROFILE };
    followersLoading.value = true;
    const wrapper = mount(ProfilePage, globalConfig);
    const followerList = wrapper.findComponent(ProfileFollowerList);

    expect(followerList.props("loading")).toBe(true);
    expect(wrapper.text()).toContain("Loading followers…");
    // Scoped to this list: ProfileFollowingList renders the same `a.person`
    // shape via the shared ProfilePersonRow, so an unscoped find would pass
    // for the wrong reason once following has rows too.
    expect(followerList.find("a.person").exists()).toBe(false);
  });

  it("forwards a followers error so the list is replaced by the error", () => {
    profile.value = { ...SAMPLE_PROFILE };
    followersError.value = "Could not load followers";
    const wrapper = mount(ProfilePage, globalConfig);
    const followerList = wrapper.findComponent(ProfileFollowerList);

    expect(followerList.props("errorMessage")).toBe("Could not load followers");
    expect(followerList.find(".alert-stub").attributes("data-message")).toBe(
      "Could not load followers",
    );
    expect(followerList.find("a.person").exists()).toBe(false);
    expect(followerList.text()).not.toContain("No public followers yet");
  });

  it("forwards the following loading state so the list shows no false empty state", () => {
    profile.value = { ...SAMPLE_PROFILE };
    followingLoading.value = true;
    const wrapper = mount(ProfilePage, globalConfig);
    const followingList = wrapper.findComponent(ProfileFollowingList);

    expect(followingList.props("loading")).toBe(true);
    expect(wrapper.text()).toContain("Loading following…");
    expect(followingList.find("a.person").exists()).toBe(false);
  });

  it("forwards a following error so the list is replaced by the error", () => {
    profile.value = { ...SAMPLE_PROFILE };
    followingError.value = "Could not load following";
    const wrapper = mount(ProfilePage, globalConfig);
    const followingList = wrapper.findComponent(ProfileFollowingList);

    expect(followingList.props("errorMessage")).toBe(
      "Could not load following",
    );
    expect(followingList.find(".alert-stub").attributes("data-message")).toBe(
      "Could not load following",
    );
    expect(followingList.find("a.person").exists()).toBe(false);
    expect(followingList.text()).not.toContain(
      "Not following anyone publicly yet",
    );
  });

  it("forwards the trips loading state so the list shows no false empty state", () => {
    profile.value = { ...SAMPLE_PROFILE };
    tripsLoading.value = true;
    const wrapper = mount(ProfilePage, globalConfig);

    expect(wrapper.findComponent(ProfileTripList).props("loading")).toBe(true);
    expect(wrapper.text()).toContain("Loading trips…");
    expect(wrapper.find("a.trip").exists()).toBe(false);
  });

  it("forwards a trips error so the list is replaced by the error", () => {
    profile.value = { ...SAMPLE_PROFILE };
    tripsError.value = "Could not load trips";
    const wrapper = mount(ProfilePage, globalConfig);

    expect(wrapper.findComponent(ProfileTripList).props("errorMessage")).toBe(
      "Could not load trips",
    );
    expect(wrapper.find("a.trip").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("No public trips yet");
  });

  it("forwards the guides loading state so the list shows no false empty state", () => {
    profile.value = { ...SAMPLE_PROFILE };
    guidesLoading.value = true;
    const wrapper = mount(ProfilePage, globalConfig);

    expect(wrapper.findComponent(ProfileGuideList).props("loading")).toBe(true);
    expect(wrapper.text()).toContain("Loading guides…");
    expect(wrapper.find("a.guide").exists()).toBe(false);
  });

  it("forwards a guides error so the list is replaced by the error", () => {
    profile.value = { ...SAMPLE_PROFILE };
    guidesError.value = "Could not load guides";
    const wrapper = mount(ProfilePage, globalConfig);

    expect(wrapper.findComponent(ProfileGuideList).props("errorMessage")).toBe(
      "Could not load guides",
    );
    expect(wrapper.find("a.guide").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("No public guides yet");
  });

  it("hides the follow button on your own profile", () => {
    profile.value = { ...SAMPLE_PROFILE, isSelf: true };
    const wrapper = mount(ProfilePage, globalConfig);

    const followButton = wrapper
      .findAll("button")
      .find((button) => button.text().toLowerCase().includes("follow"));
    expect(followButton).toBeUndefined();
  });

  it("toggles follow when the follow button is clicked", async () => {
    profile.value = { ...SAMPLE_PROFILE };
    const wrapper = mount(ProfilePage, globalConfig);

    const followButton = wrapper
      .findAll("button")
      .find((button) => button.text().toLowerCase().includes("follow"));
    await followButton?.trigger("click");

    expect(mockToggleFollow).toHaveBeenCalledWith("user-1");
  });

  function clickFollowButton(
    wrapper: ReturnType<typeof mount>,
  ): Promise<void> | undefined {
    const followButton = wrapper
      .findAll("button")
      .find((button) => button.text().toLowerCase().includes("follow"));
    return followButton?.trigger("click");
  }

  it("optimistically increments the follower count after a successful follow", async () => {
    profile.value = { ...SAMPLE_PROFILE, followerCount: 3 };
    mockToggleFollow.mockImplementation(async (id: string) => {
      followingIds.value = new Set([...followingIds.value, id]);
    });
    const wrapper = mount(ProfilePage, globalConfig);
    mockFetchFollowers.mockClear();

    await clickFollowButton(wrapper);

    expect(profile.value?.followerCount).toBe(4);
    // The followers list must refresh so it agrees with the bumped count.
    expect(mockFetchFollowers).toHaveBeenCalledWith("user-1");
  });

  it("optimistically decrements the follower count after an unfollow", async () => {
    profile.value = { ...SAMPLE_PROFILE, followerCount: 3 };
    followingIds.value = new Set(["user-1"]);
    mockToggleFollow.mockImplementation(async (id: string) => {
      const next = new Set(followingIds.value);
      next.delete(id);
      followingIds.value = next;
    });
    const wrapper = mount(ProfilePage, globalConfig);

    await clickFollowButton(wrapper);

    expect(profile.value?.followerCount).toBe(2);
  });

  it("leaves the follower count untouched when the toggle does not change state", async () => {
    profile.value = { ...SAMPLE_PROFILE, followerCount: 3 };
    // A failed toggle: useFollows.toggleFollow swallows the error and
    // followingIds is unchanged, so the count must not drift.
    mockToggleFollow.mockResolvedValue(undefined);
    const wrapper = mount(ProfilePage, globalConfig);
    mockFetchFollowers.mockClear();

    await clickFollowButton(wrapper);

    expect(profile.value?.followerCount).toBe(3);
    // A no-op toggle must not trigger a wasteful followers refetch.
    expect(mockFetchFollowers).not.toHaveBeenCalled();
  });

  it("does not adjust the count when the viewer navigates away mid-toggle", async () => {
    profile.value = { ...SAMPLE_PROFILE, userId: "user-1", followerCount: 3 };
    // Simulate real navigation: the route param moves to another profile while
    // toggleFollow is still in flight (follower rows link to /u/[id]). The
    // loaded profile stays user-1 because fetchProfile hasn't resolved yet.
    mockToggleFollow.mockImplementation(async (id: string) => {
      followingIds.value = new Set([...followingIds.value, id]);
      routeParams.id = "user-2";
    });
    const wrapper = mount(ProfilePage, globalConfig);
    mockFetchFollowers.mockClear();

    await clickFollowButton(wrapper);

    // The toggle targeted user-1 but the route is now user-2, so the loaded
    // profile's count must not be bumped and onToggleFollow's own guarded
    // refetch (for the stale target, user-1) must not fire. The route change
    // to user-2 does trigger the page's own unrelated navigation reload
    // (including a fresh fetchFollowers("user-2")) via useAsyncData's watch —
    // that is the correct, separate behaviour this test isn't exercising.
    expect(profile.value?.followerCount).toBe(3);
    expect(mockFetchFollowers).not.toHaveBeenCalledWith("user-1");
  });

  describe("Open Graph / Twitter meta (#269)", () => {
    it("emits og/twitter tags built from the loaded profile's bio", () => {
      profile.value = { ...SAMPLE_PROFILE };

      mount(ProfilePage, globalConfig);

      const meta = lastSeoMetaCall(useSeoMetaMock);
      const title = meta.title as () => string;
      const description = meta.description as () => string;
      const ogImage = meta.ogImage as () => string;
      const ogUrl = meta.ogUrl as () => string;

      expect(title()).toBe("Wanderist — Elsa");
      expect((meta.ogTitle as () => string)()).toBe(title());
      expect((meta.twitterTitle as () => string)()).toBe(title());
      expect(description()).toBe("Cold-water swimmer chasing coastlines.");
      expect((meta.ogDescription as () => string)()).toBe(description());
      expect((meta.twitterDescription as () => string)()).toBe(description());
      // No avatar exists on a profile, so the fallback favicon is used —
      // still an absolute URL built from the configured site origin — paired
      // with the small "summary" card rather than "summary_large_image".
      expect(ogImage()).toBe("https://wanderist.test/favicon.ico");
      expect((meta.twitterImage as () => string)()).toBe(ogImage());
      expect(ogUrl()).toBe("https://wanderist.test/u/user-1");
      expect(meta.ogType).toBe("website");
      expect((meta.twitterCard as () => string)()).toBe("summary");
    });

    it("falls back to a follower/place summary when the profile has no bio", () => {
      profile.value = { ...SAMPLE_PROFILE, bio: null };

      mount(ProfilePage, globalConfig);

      const description = lastSeoMetaCall(useSeoMetaMock)
        .description as () => string;
      expect(description()).toBe("Elsa on Wanderist — 3 followers, 8 places.");
    });

    it("singularizes the follower/place summary at a count of exactly one", () => {
      profile.value = {
        ...SAMPLE_PROFILE,
        bio: null,
        followerCount: 1,
        placeCount: 1,
      };

      mount(ProfilePage, globalConfig);

      const description = lastSeoMetaCall(useSeoMetaMock)
        .description as () => string;
      expect(description()).toBe("Elsa on Wanderist — 1 follower, 1 place.");
    });

    it("falls back to a follower/place summary when the bio is only whitespace", () => {
      profile.value = { ...SAMPLE_PROFILE, bio: "   " };

      mount(ProfilePage, globalConfig);

      const description = lastSeoMetaCall(useSeoMetaMock)
        .description as () => string;
      expect(description()).toBe("Elsa on Wanderist — 3 followers, 8 places.");
    });

    it("falls back to a placeholder title/description before a profile has loaded", () => {
      profile.value = null;

      mount(ProfilePage, globalConfig);

      const meta = lastSeoMetaCall(useSeoMetaMock);
      expect((meta.title as () => string)()).toBe("Wanderist — Profile");
      expect((meta.description as () => string)()).toBe(
        "A traveler's profile on Wanderist.",
      );
    });

    it("updates title once the profile loads after mount", async () => {
      profile.value = null;

      mount(ProfilePage, globalConfig);
      const beforeLoad = lastSeoMetaCall(useSeoMetaMock);
      expect((beforeLoad.title as () => string)()).toBe("Wanderist — Profile");

      profile.value = { ...SAMPLE_PROFILE };
      await nextTick();

      const afterLoad = lastSeoMetaCall(useSeoMetaMock);
      expect((afterLoad.title as () => string)()).toBe("Wanderist — Elsa");
    });

    it("updates og:url on navigation to a different profile", async () => {
      profile.value = { ...SAMPLE_PROFILE };

      mount(ProfilePage, globalConfig);
      const ogUrl = lastSeoMetaCall(useSeoMetaMock).ogUrl as () => string;
      expect(ogUrl()).toBe("https://wanderist.test/u/user-1");

      routeParams.id = "user-2";
      await nextTick();

      expect(ogUrl()).toBe("https://wanderist.test/u/user-2");
    });
  });
});
