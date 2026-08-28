import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import AppNewEntryLocationField from "../AppNewEntryLocationField.vue";

interface PlaceSuggestion {
  id: string;
  name: string;
}

const SUGGESTIONS: PlaceSuggestion[] = [
  { id: "p-1", name: "Old Harbour" },
  { id: "p-2", name: "Lisbon" },
];

const globalConfig = {
  global: {
    stubs: {
      AppIcon: { template: "<svg data-icon />" },
    },
  },
};

function mountField(props: Record<string, unknown> = {}) {
  return mount(AppNewEntryLocationField, {
    ...globalConfig,
    props: {
      modelValue: "",
      suggestions: [],
      willNotSave: false,
      placesUnavailable: false,
      ...props,
    },
  });
}

describe("AppNewEntryLocationField", () => {
  it("renders without crashing and matches snapshot", () => {
    const wrapper = mountField({ modelValue: "Old", suggestions: SUGGESTIONS });
    expect(wrapper.find('[data-test="location-input"]').exists()).toBe(true);
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("relays typed input through update:modelValue", async () => {
    const wrapper = mountField();
    await wrapper.get('[data-test="location-input"]').setValue("Reykjavik");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["Reykjavik"]);
  });

  it("renders a chip per suggestion and hides them when empty", () => {
    expect(mountField({ suggestions: SUGGESTIONS }).findAll(".chip")).toHaveLength(
      2,
    );
    expect(mountField().find(".chip-suggest").exists()).toBe(false);
  });

  it("emits select with the place when a suggestion chip is clicked", async () => {
    const wrapper = mountField({ suggestions: SUGGESTIONS });
    await wrapper.findAll(".chip")[0].trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual([SUGGESTIONS[0]]);
  });

  it("shows the unsaved-place warning only when willNotSave is true", () => {
    expect(
      mountField({ willNotSave: true }).find('[data-test="location-warning"]')
        .exists(),
    ).toBe(true);
    expect(
      mountField().find('[data-test="location-warning"]').exists(),
    ).toBe(false);
  });

  it("shows the load-error warning only when places are unavailable and a location is typed", () => {
    expect(
      mountField({ placesUnavailable: true, modelValue: "Somewhere" })
        .find('[data-test="places-load-error"]')
        .exists(),
    ).toBe(true);
    expect(
      mountField({ placesUnavailable: true, modelValue: "   " })
        .find('[data-test="places-load-error"]')
        .exists(),
    ).toBe(false);
  });
});
