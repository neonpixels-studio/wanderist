import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { reactive, ref } from "vue";
import ProfilePage from "../u/[id].vue";
import ProfileHeader from "~/components/ProfileHeader.vue";
import ProfileFollowerList from "~/components/ProfileFollowerList.vue";
import type { ProfileUser, ProfileFollower } from "~/composables/useProfile";

// The profile route is keyed by the target user's id. Reactive so a test can
// simulate the viewer navigating to another profile mid-interaction.
const routeParams = reactive({ id: "user-1" });
vi.stubGlobal("useRoute", () => ({ params: routeParams, query: {} }));

// The page loads via useAsyncData; the global stub ignores the handler, so
// invoke it here to exercise the mount-time fetches and record the call so the
// wiring (key + watch on the route param) can be asserted. Re-running on param
// change is Nuxt's own behaviour, not under test.
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
const isLoading = ref(false);
const followersLoading = ref(false);
const notFound = ref(false);
const profileError = ref<string | null>(null);
const followersError = ref<string | null>(null);
const mockFetchProfile = vi.fn();
const mockFetchFollowers = vi.fn();

vi.stubGlobal("useProfile", () => ({
  profile,
  followers,
  hasMoreFollowers,
  isLoading,
  followersLoading,
  notFound,
  error: profileError,
  followersError,
  fetchProfile: mockFetchProfile,
  fetchFollowers: mockFetchFollowers,
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
    components: { ProfileHeader, ProfileFollowerList },
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
    isLoading.value = false;
    followersLoading.value = false;
    notFound.value = false;
    profileError.value = null;
    followersError.value = null;
    followingIds.value = new Set();
    pendingUserIds.value = new Set();
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

  it("fetches the profile, followers, and follow state on mount", () => {
    profile.value = { ...SAMPLE_PROFILE };
    mount(ProfilePage, globalConfig);

    expect(mockFetchProfile).toHaveBeenCalledWith("user-1");
    expect(mockFetchFollowers).toHaveBeenCalledWith("user-1");
    expect(mockFetchFollowing).toHaveBeenCalled();
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

    expect(wrapper.findComponent(ProfileFollowerList).props("loading")).toBe(
      true,
    );
    expect(wrapper.text()).toContain("Loading followers…");
    expect(wrapper.find("a.person").exists()).toBe(false);
  });

  it("forwards a followers error so the list is replaced by the error", () => {
    profile.value = { ...SAMPLE_PROFILE };
    followersError.value = "Could not load followers";
    const wrapper = mount(ProfilePage, globalConfig);

    expect(
      wrapper.findComponent(ProfileFollowerList).props("errorMessage"),
    ).toBe("Could not load followers");
    expect(wrapper.find(".alert-stub").attributes("data-message")).toBe(
      "Could not load followers",
    );
    expect(wrapper.find("a.person").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("No public followers yet");
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
    // profile's count must not be bumped and no followers refetch should fire.
    expect(profile.value?.followerCount).toBe(3);
    expect(mockFetchFollowers).not.toHaveBeenCalled();
  });
});
