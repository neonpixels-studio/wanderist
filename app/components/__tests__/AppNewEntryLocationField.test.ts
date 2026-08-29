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
      canCreatePlace: false,
      isCreatingPlace: false,
      createPlaceError: null,
      placesLoadFailed: false,
      canonicalLocation: "",
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
    expect(
      mountField({ suggestions: SUGGESTIONS }).findAll(".chip"),
    ).toHaveLength(2);
    expect(mountField().find(".chip-suggest").exists()).toBe(false);
  });

  it("emits select with the place when a suggestion chip is clicked", async () => {
    const wrapper = mountField({ suggestions: SUGGESTIONS });
    await wrapper.findAll(".chip")[0].trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual([SUGGESTIONS[0]]);
  });

  it("shows the create-place affordance only when canCreatePlace is true", () => {
    expect(
      mountField({ canCreatePlace: true, canonicalLocation: "Elsewhere" })
        .find(".location-create")
        .exists(),
    ).toBe(true);
    expect(mountField().find(".location-create").exists()).toBe(false);
  });

  it("labels the create button with the canonical location and emits create when clicked", async () => {
    const wrapper = mountField({
      canCreatePlace: true,
      canonicalLocation: "Blue Lagoon",
    });
    expect(wrapper.find(".location-create__btn").text()).toContain(
      "Blue Lagoon",
    );
    await wrapper.find(".location-create__btn").trigger("click");
    expect(wrapper.emitted("create")).toHaveLength(1);
  });

  it("disables the create button and shows a creating label while a create is in flight", () => {
    const wrapper = mountField({
      canCreatePlace: true,
      isCreatingPlace: true,
      canonicalLocation: "Blue Lagoon",
    });
    const button = wrapper.find(".location-create__btn");
    expect(button.attributes("disabled")).toBeDefined();
    expect(button.text()).toContain("creating…");
  });

  it("shows the create-place error only when one is present", () => {
    expect(
      mountField({ createPlaceError: "Place limit reached" })
        .find(".location-create__error")
        .text(),
    ).toContain("Place limit reached");
    expect(mountField().find(".location-create__error").exists()).toBe(false);
  });

  it("shows the load-failure warning only when placesLoadFailed is true", () => {
    expect(
      mountField({ placesLoadFailed: true })
        .find(".places-load__error")
        .exists(),
    ).toBe(true);
    expect(mountField().find(".places-load__error").exists()).toBe(false);
  });
});
