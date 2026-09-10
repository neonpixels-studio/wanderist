import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import GuideCard from "../GuideCard.vue";
import { nuxtLinkStub } from "./input-stubs";
import type { Guide } from "~/stores/guides";

const SAMPLE_GUIDE: Guide = {
  id: "g-1",
  userId: "user-1",
  title: "Tokyo on foot",
  body: "Start in Yanaka at sunrise.",
  readTimeMinutes: 8,
  likeCount: 12,
  visibility: "public",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const globalConfig = {
  global: {
    stubs: {
      AppIcon: { template: "<svg data-icon />" },
      NuxtLink: nuxtLinkStub,
    },
  },
};

describe("GuideCard", () => {
  it("renders without crashing and matches snapshot", () => {
    const wrapper = mount(GuideCard, {
      ...globalConfig,
      props: { guide: SAMPLE_GUIDE },
    });
    expect(wrapper.find(".gcard").exists()).toBe(true);
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("shows the guide's title, read time, and like count", () => {
    const wrapper = mount(GuideCard, {
      ...globalConfig,
      props: { guide: SAMPLE_GUIDE },
    });
    expect(wrapper.find(".gcard__name").text()).toBe("Tokyo on foot");
    expect(wrapper.text()).toContain("8 min read");
    expect(wrapper.text()).toContain("12");
  });

  it("links the title to the guide's detail page", () => {
    const wrapper = mount(GuideCard, {
      ...globalConfig,
      props: { guide: SAMPLE_GUIDE },
    });
    expect(wrapper.find(".gcard__name").attributes("href")).toBe("/guides/g-1");
  });

  it("tags a public guide with the ongoing style", () => {
    const wrapper = mount(GuideCard, {
      ...globalConfig,
      props: { guide: SAMPLE_GUIDE },
    });
    expect(wrapper.find(".tag--ongoing").exists()).toBe(true);
  });

  it("tags a private guide with the past style", () => {
    const wrapper = mount(GuideCard, {
      ...globalConfig,
      props: { guide: { ...SAMPLE_GUIDE, visibility: "private" } },
    });
    expect(wrapper.find(".tag--past").exists()).toBe(true);
  });

  it("emits toggle-like with the guide when the like button is clicked", async () => {
    const wrapper = mount(GuideCard, {
      ...globalConfig,
      props: { guide: SAMPLE_GUIDE },
    });

    await wrapper.find(".gcard__like").trigger("click");

    expect(wrapper.emitted("toggle-like")?.[0]).toEqual([SAMPLE_GUIDE]);
  });

  it("applies the liked class and 'Unlike guide' label when isLiked is true", () => {
    const wrapper = mount(GuideCard, {
      ...globalConfig,
      props: { guide: SAMPLE_GUIDE, isLiked: true },
    });

    const likeButton = wrapper.find(".gcard__like");
    expect(likeButton.classes()).toContain("liked");
    expect(likeButton.attributes("aria-label")).toBe("Unlike guide");
  });

  it("shows no liked class and a 'Like guide' label by default", () => {
    const wrapper = mount(GuideCard, {
      ...globalConfig,
      props: { guide: SAMPLE_GUIDE },
    });

    const likeButton = wrapper.find(".gcard__like");
    expect(likeButton.classes()).not.toContain("liked");
    expect(likeButton.attributes("aria-label")).toBe("Like guide");
  });

  it("emits edit with the guide when edit is clicked", async () => {
    const wrapper = mount(GuideCard, {
      ...globalConfig,
      props: { guide: SAMPLE_GUIDE },
    });

    await wrapper
      .findAll(".gcard__acts button")
      .find((button) => button.text() === "edit")
      ?.trigger("click");

    expect(wrapper.emitted("edit")?.[0]).toEqual([SAMPLE_GUIDE]);
  });

  it("requires a confirm click before emitting delete", async () => {
    const wrapper = mount(GuideCard, {
      ...globalConfig,
      props: { guide: SAMPLE_GUIDE },
    });

    await wrapper
      .findAll(".gcard__acts button")
      .find((button) => button.text() === "delete")
      ?.trigger("click");

    expect(wrapper.emitted("delete")).toBeFalsy();
    expect(
      wrapper
        .findAll(".gcard__acts button")
        .some((button) => button.text() === "confirm delete"),
    ).toBe(true);
  });

  it("emits delete with the guide once confirmed", async () => {
    const wrapper = mount(GuideCard, {
      ...globalConfig,
      props: { guide: SAMPLE_GUIDE },
    });

    await wrapper
      .findAll(".gcard__acts button")
      .find((button) => button.text() === "delete")
      ?.trigger("click");
    await wrapper
      .findAll(".gcard__acts button")
      .find((button) => button.text() === "confirm delete")
      ?.trigger("click");

    expect(wrapper.emitted("delete")?.[0]).toEqual([SAMPLE_GUIDE]);
  });

  it("cancelling the confirm step returns to the edit/delete buttons", async () => {
    const wrapper = mount(GuideCard, {
      ...globalConfig,
      props: { guide: SAMPLE_GUIDE },
    });

    await wrapper
      .findAll(".gcard__acts button")
      .find((button) => button.text() === "delete")
      ?.trigger("click");
    await wrapper
      .findAll(".gcard__acts button")
      .find((button) => button.text() === "cancel")
      ?.trigger("click");

    expect(
      wrapper
        .findAll(".gcard__acts button")
        .some((button) => button.text() === "delete"),
    ).toBe(true);
  });

  it("disables and relabels the confirm button while deleting", async () => {
    const wrapper = mount(GuideCard, {
      ...globalConfig,
      props: { guide: SAMPLE_GUIDE, deleting: true },
    });

    await wrapper
      .findAll(".gcard__acts button")
      .find((button) => button.text() === "delete")
      ?.trigger("click");

    const confirmButton = wrapper
      .findAll(".gcard__acts button")
      .find((button) => button.text() === "deleting…");
    expect(confirmButton?.attributes("disabled")).toBeDefined();
  });
});
