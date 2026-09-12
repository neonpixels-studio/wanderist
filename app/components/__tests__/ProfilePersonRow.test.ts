import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ProfilePersonRow from "../ProfilePersonRow.vue";
import type { ProfileFollower } from "~/composables/useProfile";

const globalConfig = {
  global: {
    stubs: {
      AppIcon: { template: "<svg data-icon />" },
      NuxtLink: { template: '<a :href="to"><slot /></a>', props: ["to"] },
    },
  },
};

describe("ProfilePersonRow", () => {
  it("links to the person's profile", () => {
    const person: ProfileFollower = {
      userId: "user-2",
      displayName: "Marco",
      handle: "marco",
    };
    const wrapper = mount(ProfilePersonRow, {
      ...globalConfig,
      props: { person },
    });

    expect(wrapper.find("a.person").attributes("href")).toBe("/u/user-2");
  });

  // ProfilePersonRow is the single shared path every follower/followee link
  // renders through — an id containing URL-meaningful characters must still
  // produce a valid route, not a silently broken one.
  it("encodes a user ID containing URL-meaningful characters in the link target", () => {
    const person: ProfileFollower = {
      userId: "user/with space",
      displayName: null,
      handle: null,
    };
    const wrapper = mount(ProfilePersonRow, {
      ...globalConfig,
      props: { person },
    });

    expect(wrapper.find("a.person").attributes("href")).toBe(
      "/u/user%2Fwith%20space",
    );
  });

  it("falls back to the handle then a generic name when displayName is missing", () => {
    const wrapper = mount(ProfilePersonRow, {
      ...globalConfig,
      props: {
        person: { userId: "user-3", displayName: null, handle: "nina" },
      },
    });

    expect(wrapper.find("b").text()).toBe("nina");
  });

  it("falls back to a generic traveler name when neither displayName nor handle is set", () => {
    const wrapper = mount(ProfilePersonRow, {
      ...globalConfig,
      props: {
        person: { userId: "user-4", displayName: null, handle: null },
      },
    });

    expect(wrapper.find("b").text()).toBe("Wanderist traveler");
    expect(wrapper.find(".person__name span").exists()).toBe(false);
  });
});
