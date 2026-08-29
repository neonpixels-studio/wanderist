import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import JournalEntry from "../JournalEntry.vue";
import type { Entry } from "~/stores/entries";

const SAMPLE_ENTRY: Entry = {
  id: "entry-1",
  userId: "user-1",
  tripId: null,
  placeId: null,
  title: "Harbor at 4am",
  body: "Cold morning, the whole harbor still asleep.",
  occurredAt: "2026-06-12T04:12:00.000Z",
  visibility: "private",
  weather: null,
  likeCount: 24,
  createdAt: "2026-06-12T04:12:00.000Z",
  updatedAt: "2026-06-12T04:12:00.000Z",
  photos: [],
  tags: [{ id: "tag-1", name: "iceland" }],
};

const ENTRY_WITH_PHOTOS: Entry = {
  ...SAMPLE_ENTRY,
  id: "entry-2",
  photos: [
    { id: "photo-1", entryId: "entry-2", mediaId: "media-1", sortOrder: 0 },
    { id: "photo-2", entryId: "entry-2", mediaId: "media-2", sortOrder: 1 },
  ],
};

const globalConfig = {
  global: {
    stubs: {
      AppIcon: { template: "<svg data-icon />" },
    },
  },
};

describe("JournalEntry component", () => {
  it("renders without crashing and matches snapshot", () => {
    const wrapper = mount(JournalEntry, {
      ...globalConfig,
      props: { entry: SAMPLE_ENTRY },
    });
    expect(wrapper.find("article.post").exists()).toBe(true);
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("renders the entry title", () => {
    const wrapper = mount(JournalEntry, {
      ...globalConfig,
      props: { entry: SAMPLE_ENTRY },
    });
    expect(wrapper.find(".post__title").text()).toBe("Harbor at 4am");
  });

  it("renders the entry body", () => {
    const wrapper = mount(JournalEntry, {
      ...globalConfig,
      props: { entry: SAMPLE_ENTRY },
    });
    expect(wrapper.find(".post__text").text()).toContain("Cold morning");
  });

  it("hides body element when body is null", () => {
    const entry = { ...SAMPLE_ENTRY, body: null };
    const wrapper = mount(JournalEntry, {
      ...globalConfig,
      props: { entry },
    });
    expect(wrapper.find(".post__text").exists()).toBe(false);
  });

  it("renders the likeCount from the entry", () => {
    const wrapper = mount(JournalEntry, {
      ...globalConfig,
      props: { entry: SAMPLE_ENTRY },
    });
    expect(wrapper.find(".cnt").text()).toBe("24");
  });

  it("applies liked class when isLiked is true", () => {
    const wrapper = mount(JournalEntry, {
      ...globalConfig,
      props: { entry: SAMPLE_ENTRY, isLiked: true },
    });
    expect(wrapper.find(".like").classes()).toContain("liked");
  });

  it("does not apply liked class by default", () => {
    const wrapper = mount(JournalEntry, {
      ...globalConfig,
      props: { entry: SAMPLE_ENTRY },
    });
    expect(wrapper.find(".like").classes()).not.toContain("liked");
  });

  it("emits toggle-like with the entry when like button is clicked", async () => {
    const wrapper = mount(JournalEntry, {
      ...globalConfig,
      props: { entry: SAMPLE_ENTRY },
    });
    await wrapper.find(".like").trigger("click");
    expect(wrapper.emitted("toggle-like")).toHaveLength(1);
    expect(wrapper.emitted("toggle-like")![0]).toEqual([SAMPLE_ENTRY]);
  });

  it("emits edit with the entry when the edit button is clicked", async () => {
    const wrapper = mount(JournalEntry, {
      ...globalConfig,
      props: { entry: SAMPLE_ENTRY },
    });
    await wrapper.find('button[aria-label="Edit entry"]').trigger("click");
    expect(wrapper.emitted("edit")).toHaveLength(1);
    expect(wrapper.emitted("edit")![0]).toEqual([SAMPLE_ENTRY]);
  });

  it("renders tags from the entry", () => {
    const wrapper = mount(JournalEntry, {
      ...globalConfig,
      props: { entry: SAMPLE_ENTRY },
    });
    expect(wrapper.find(".tag-row").text()).toContain("iceland");
  });

  it("hides tags section when entry has no tags", () => {
    const entry = { ...SAMPLE_ENTRY, tags: [] };
    const wrapper = mount(JournalEntry, {
      ...globalConfig,
      props: { entry },
    });
    expect(wrapper.find(".tag-row").exists()).toBe(false);
  });

  it("renders photo media section when entry has photos", () => {
    const wrapper = mount(JournalEntry, {
      ...globalConfig,
      props: { entry: ENTRY_WITH_PHOTOS },
    });
    expect(wrapper.find(".post__media").exists()).toBe(true);
  });

  it("hides photo media section when entry has no photos", () => {
    const wrapper = mount(JournalEntry, {
      ...globalConfig,
      props: { entry: SAMPLE_ENTRY },
    });
    expect(wrapper.find(".post__media").exists()).toBe(false);
  });

  it("uses single layout class for one photo", () => {
    const entry = {
      ...SAMPLE_ENTRY,
      photos: [{ id: "p-1", entryId: "entry-1", mediaId: "m-1", sortOrder: 0 }],
    };
    const wrapper = mount(JournalEntry, {
      ...globalConfig,
      props: { entry },
    });
    expect(wrapper.find(".post__media").classes()).toContain("single");
  });

  it("uses grid layout class for multiple photos", () => {
    const wrapper = mount(JournalEntry, {
      ...globalConfig,
      props: { entry: ENTRY_WITH_PHOTOS },
    });
    expect(wrapper.find(".post__media").classes()).toContain("grid");
  });

  it("shows a +N more badge on the last visible photo when there are more than 3", () => {
    const entry: Entry = {
      ...SAMPLE_ENTRY,
      id: "entry-5photos",
      photos: [
        { id: "p-1", entryId: "entry-5photos", mediaId: "m-1", sortOrder: 0 },
        { id: "p-2", entryId: "entry-5photos", mediaId: "m-2", sortOrder: 1 },
        { id: "p-3", entryId: "entry-5photos", mediaId: "m-3", sortOrder: 2 },
        { id: "p-4", entryId: "entry-5photos", mediaId: "m-4", sortOrder: 3 },
        { id: "p-5", entryId: "entry-5photos", mediaId: "m-5", sortOrder: 4 },
      ],
    };
    const wrapper = mount(JournalEntry, {
      ...globalConfig,
      props: { entry },
    });
    const badge = wrapper.find(".more-badge");
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe("+2");
  });
});
