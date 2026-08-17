import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import AppLoadMoreButton from "../AppLoadMoreButton.vue";

describe("AppLoadMoreButton", () => {
  it("is visible and reads 'Load more' when there are more pages and it is idle", () => {
    const wrapper = mount(AppLoadMoreButton, {
      props: { hasMore: true, loading: false },
    });

    const button = wrapper.find(".load-more");
    expect(button.attributes("style") ?? "").not.toContain("display: none");
    expect(button.text()).toBe("Load more");
    expect(button.attributes("disabled")).toBeUndefined();
  });

  it("is hidden when there are no further pages", () => {
    const wrapper = mount(AppLoadMoreButton, {
      props: { hasMore: false, loading: false },
    });

    expect(wrapper.find(".load-more").attributes("style")).toContain(
      "display: none",
    );
  });

  it("shows a loading label and disables itself while loading", () => {
    const wrapper = mount(AppLoadMoreButton, {
      props: { hasMore: true, loading: true },
    });

    const button = wrapper.find(".load-more");
    expect(button.text()).toBe("Loading…");
    expect(button.attributes("disabled")).toBeDefined();
  });

  it("emits load when clicked", async () => {
    const wrapper = mount(AppLoadMoreButton, {
      props: { hasMore: true, loading: false },
    });

    await wrapper.find(".load-more").trigger("click");
    expect(wrapper.emitted("load")).toHaveLength(1);
  });
});
