import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ProfileFollowerList from "../ProfileFollowerList.vue";
import type { ProfileFollower } from "~/composables/useProfile";

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

const FOLLOWERS: ProfileFollower[] = [
  { userId: "user-2", displayName: "Marco", handle: "marco" },
  { userId: "user-3", displayName: null, handle: "nina" },
  { userId: "user-4", displayName: null, handle: null },
];

describe("ProfileFollowerList", () => {
  it("renders each follower linked to their profile and matches snapshot", () => {
    const wrapper = mount(ProfileFollowerList, {
      ...globalConfig,
      props: { followers: FOLLOWERS },
    });

    const links = wrapper.findAll("a.person");
    expect(links).toHaveLength(3);
    expect(links[0].attributes("href")).toBe("/u/user-2");
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("falls back to the handle then a generic name when displayName is missing", () => {
    const wrapper = mount(ProfileFollowerList, {
      ...globalConfig,
      props: { followers: FOLLOWERS },
    });

    const names = wrapper.findAll(".person__name b").map((node) => node.text());
    expect(names).toEqual(["Marco", "nina", "Wanderist traveler"]);
  });

  it("shows an empty note when there are no followers", () => {
    const wrapper = mount(ProfileFollowerList, {
      ...globalConfig,
      props: { followers: [] },
    });

    expect(wrapper.find(".empty-note").text()).toBe("No public followers yet.");
    expect(wrapper.find("a.person").exists()).toBe(false);
  });

  it("signals truncation when there are more followers than the page", () => {
    const wrapper = mount(ProfileFollowerList, {
      ...globalConfig,
      props: { followers: FOLLOWERS, hasMore: true },
    });

    expect(wrapper.find(".followers-more").text()).toBe(
      "Showing the 3 most recent followers.",
    );
  });

  it("omits the truncation note when the full list fits", () => {
    const wrapper = mount(ProfileFollowerList, {
      ...globalConfig,
      props: { followers: FOLLOWERS, hasMore: false },
    });

    expect(wrapper.find(".followers-more").exists()).toBe(false);
  });

  it("shows a loading note (not the empty state) while followers load", () => {
    const wrapper = mount(ProfileFollowerList, {
      ...globalConfig,
      props: { followers: [], loading: true },
    });

    expect(wrapper.find(".empty-note").text()).toBe("Loading followers…");
    expect(wrapper.find("a.person").exists()).toBe(false);
  });

  it("keeps the existing list visible during a refresh (no loading flash)", () => {
    const wrapper = mount(ProfileFollowerList, {
      ...globalConfig,
      props: { followers: FOLLOWERS, loading: true },
    });

    expect(wrapper.findAll("a.person")).toHaveLength(3);
    expect(wrapper.text()).not.toContain("Loading followers…");
  });

  it("shows an error (not the empty state) and no list when the fetch failed", () => {
    const wrapper = mount(ProfileFollowerList, {
      ...globalConfig,
      props: {
        followers: [],
        errorMessage: "Could not load followers",
      },
    });

    expect(wrapper.find(".alert-stub").attributes("data-message")).toBe(
      "Could not load followers",
    );
    expect(wrapper.find("a.person").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("No public followers yet");
  });
});
