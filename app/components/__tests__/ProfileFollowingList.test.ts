import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ProfileFollowingList from "../ProfileFollowingList.vue";
import type { ProfileFollowee } from "~/composables/useProfile";

const globalConfig = {
  global: {
    stubs: {
      AppIcon: { template: "<svg data-icon />" },
      NuxtLink: { template: '<a :href="to"><slot /></a>', props: ["to"] },
      AppAlert: {
        template: '<div class="alert-stub" :data-message="message" />',
        props: ["intent", "message", "dismissible"],
      },
    },
  },
};

const FOLLOWING: ProfileFollowee[] = [
  { userId: "user-2", displayName: "Marco", handle: "marco" },
  { userId: "user-3", displayName: null, handle: "nina" },
  { userId: "user-4", displayName: null, handle: null },
];

describe("ProfileFollowingList", () => {
  it("renders each followee linked to their profile and matches snapshot", () => {
    const wrapper = mount(ProfileFollowingList, {
      ...globalConfig,
      props: { following: FOLLOWING },
    });

    const links = wrapper.findAll("a.person");
    expect(links).toHaveLength(3);
    expect(links[0].attributes("href")).toBe("/u/user-2");
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("falls back to the handle then a generic name when displayName is missing", () => {
    const wrapper = mount(ProfileFollowingList, {
      ...globalConfig,
      props: { following: FOLLOWING },
    });

    const names = wrapper.findAll(".person__name b").map((node) => node.text());
    expect(names).toEqual(["Marco", "nina", "Wanderist traveler"]);
  });

  it("shows an empty note when following nobody", () => {
    const wrapper = mount(ProfileFollowingList, {
      ...globalConfig,
      props: { following: [] },
    });

    expect(wrapper.find(".empty-note").text()).toBe(
      "Not following anyone publicly yet.",
    );
    expect(wrapper.find("a.person").exists()).toBe(false);
  });

  it("signals truncation when there are more followees than the page", () => {
    const wrapper = mount(ProfileFollowingList, {
      ...globalConfig,
      props: { following: FOLLOWING, hasMore: true },
    });

    expect(wrapper.find(".following-more").text()).toBe(
      "Showing the 3 most recently followed travelers.",
    );
  });

  it("omits the truncation note when the full list fits", () => {
    const wrapper = mount(ProfileFollowingList, {
      ...globalConfig,
      props: { following: FOLLOWING, hasMore: false },
    });

    expect(wrapper.find(".following-more").exists()).toBe(false);
  });

  it("shows a loading note (not the empty state) while following loads", () => {
    const wrapper = mount(ProfileFollowingList, {
      ...globalConfig,
      props: { following: [], loading: true },
    });

    expect(wrapper.find(".empty-note").text()).toBe("Loading following…");
    expect(wrapper.find("a.person").exists()).toBe(false);
  });

  it("keeps the existing list visible during a refresh (no loading flash)", () => {
    const wrapper = mount(ProfileFollowingList, {
      ...globalConfig,
      props: { following: FOLLOWING, loading: true },
    });

    expect(wrapper.findAll("a.person")).toHaveLength(3);
    expect(wrapper.text()).not.toContain("Loading following…");
  });

  it("shows an error (not the empty state) and no list when the fetch failed", () => {
    const wrapper = mount(ProfileFollowingList, {
      ...globalConfig,
      props: {
        following: [],
        errorMessage: "Could not load following",
      },
    });

    expect(wrapper.find(".alert-stub").attributes("data-message")).toBe(
      "Could not load following",
    );
    expect(wrapper.find("a.person").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Not following anyone publicly yet");
  });
});
