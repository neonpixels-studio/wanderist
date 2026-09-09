import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ProfileGuideList from "../ProfileGuideList.vue";
import type { ProfileGuide } from "~/composables/useProfile";

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

const GUIDES: ProfileGuide[] = [
  { id: "guide-1", title: "Tokyo on foot", readTimeMinutes: 8, likeCount: 3 },
  { id: "guide-2", title: "Andes by bus", readTimeMinutes: 12, likeCount: 0 },
];

describe("ProfileGuideList", () => {
  it("renders each guide linked to its detail page and matches snapshot", () => {
    const wrapper = mount(ProfileGuideList, {
      ...globalConfig,
      props: { guides: GUIDES },
    });

    const links = wrapper.findAll("a.guide");
    expect(links).toHaveLength(2);
    expect(links[0].attributes("href")).toBe("/guides/guide-1");
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("shows the read time and like count for each guide", () => {
    const wrapper = mount(ProfileGuideList, {
      ...globalConfig,
      props: { guides: GUIDES },
    });

    const readTimes = wrapper
      .findAll(".guide__body span")
      .map((node) => node.text());
    expect(readTimes).toEqual(["8 min read", "12 min read"]);

    const likes = wrapper.findAll(".guide__likes").map((node) => node.text());
    expect(likes[0]).toContain("3");
  });

  it("shows an empty note when there are no public guides", () => {
    const wrapper = mount(ProfileGuideList, {
      ...globalConfig,
      props: { guides: [] },
    });

    expect(wrapper.find(".empty-note").text()).toBe("No public guides yet.");
    expect(wrapper.find("a.guide").exists()).toBe(false);
  });

  it("signals truncation when there are more guides than the page", () => {
    const wrapper = mount(ProfileGuideList, {
      ...globalConfig,
      props: { guides: GUIDES, hasMore: true },
    });

    expect(wrapper.find(".guides-more").text()).toBe(
      "Showing the 2 most recent public guides.",
    );
  });

  it("omits the truncation note when the full list fits", () => {
    const wrapper = mount(ProfileGuideList, {
      ...globalConfig,
      props: { guides: GUIDES, hasMore: false },
    });

    expect(wrapper.find(".guides-more").exists()).toBe(false);
  });

  it("shows a loading note (not the empty state) while guides load", () => {
    const wrapper = mount(ProfileGuideList, {
      ...globalConfig,
      props: { guides: [], loading: true },
    });

    expect(wrapper.find(".empty-note").text()).toBe("Loading guides…");
    expect(wrapper.find("a.guide").exists()).toBe(false);
  });

  it("keeps the existing list visible during a refresh (no loading flash)", () => {
    const wrapper = mount(ProfileGuideList, {
      ...globalConfig,
      props: { guides: GUIDES, loading: true },
    });

    expect(wrapper.findAll("a.guide")).toHaveLength(2);
    expect(wrapper.text()).not.toContain("Loading guides…");
  });

  it("shows an error (not the empty state) and no list when the fetch failed", () => {
    const wrapper = mount(ProfileGuideList, {
      ...globalConfig,
      props: {
        guides: [],
        errorMessage: "Could not load guides",
      },
    });

    expect(wrapper.find(".alert-stub").attributes("data-message")).toBe(
      "Could not load guides",
    );
    expect(wrapper.find("a.guide").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("No public guides yet");
  });
});
