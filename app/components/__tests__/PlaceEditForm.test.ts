import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import PlaceEditForm from "../PlaceEditForm.vue";
import type { Place } from "~/stores/places";
import { inputStub } from "./input-stubs";

const globalConfig = {
  global: {
    stubs: {
      AppIcon: { template: "<svg data-icon />" },
      InputText: inputStub,
    },
  },
};

const SAMPLE_PLACE: Place = {
  id: "p-1",
  userId: "user-1",
  name: "Tokyo",
  subtitle: "Japan",
  country: "Japan",
  latitude: 35.6762,
  longitude: 139.6503,
  category: "city",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function mountForm(place: Place = SAMPLE_PLACE) {
  return mount(PlaceEditForm, {
    ...globalConfig,
    props: { place },
  });
}

describe("PlaceEditForm", () => {
  it("renders without crashing and matches snapshot", () => {
    const wrapper = mountForm();
    expect(wrapper.find(".place-edit-form").exists()).toBe(true);
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("pre-fills the name and category from the place", () => {
    const wrapper = mountForm();

    const nameInput = wrapper.find('input[placeholder="Place name…"]')
      .element as HTMLInputElement;
    expect(nameInput.value).toBe("Tokyo");
    expect(
      (wrapper.find(".place-edit-form__select").element as HTMLSelectElement)
        .value,
    ).toBe("city");
  });

  it("defaults the category to Uncategorized when the place has none", () => {
    const wrapper = mountForm({ ...SAMPLE_PLACE, category: null });

    expect(
      (wrapper.find(".place-edit-form__select").element as HTMLSelectElement)
        .value,
    ).toBe("");
  });

  it("keeps an off-list category selectable instead of falling back to Uncategorized", () => {
    const wrapper = mountForm({ ...SAMPLE_PLACE, category: "beach" });

    const select = wrapper.find(".place-edit-form__select")
      .element as HTMLSelectElement;
    expect(select.value).toBe("beach");
    expect(
      wrapper.findAll(".place-edit-form__select option").map((o) => o.text()),
    ).toContain("beach");
  });

  it("resyncs the fields when a different place is passed in", async () => {
    const wrapper = mountForm();

    await wrapper.setProps({
      place: { ...SAMPLE_PLACE, id: "p-2", name: "Osaka", category: "food" },
    });

    expect(
      (
        wrapper.find('input[placeholder="Place name…"]')
          .element as HTMLInputElement
      ).value,
    ).toBe("Osaka");
    expect(
      (wrapper.find(".place-edit-form__select").element as HTMLSelectElement)
        .value,
    ).toBe("food");
  });

  it("emits submit with only the changed fields", async () => {
    const wrapper = mountForm();

    await wrapper.find('input[placeholder="Place name…"]').setValue("Osaka");
    await wrapper.find(".place-edit-form__select").setValue("nature");
    await wrapper.find("form").trigger("submit");

    expect(wrapper.emitted("submit")?.[0][0]).toEqual({
      name: "Osaka",
      category: "nature",
    });
  });

  it("emits submit with only the name when the category is unchanged", async () => {
    const wrapper = mountForm();

    await wrapper.find('input[placeholder="Place name…"]').setValue("Osaka");
    await wrapper.find("form").trigger("submit");

    expect(wrapper.emitted("submit")?.[0][0]).toEqual({ name: "Osaka" });
  });

  it("emits a cleared category as an empty string", async () => {
    const wrapper = mountForm();

    await wrapper.find(".place-edit-form__select").setValue("");
    await wrapper.find("form").trigger("submit");

    expect(wrapper.emitted("submit")?.[0][0]).toEqual({ category: "" });
  });

  it("emits cancel instead of submit when nothing changed", async () => {
    const wrapper = mountForm();

    await wrapper.find("form").trigger("submit");

    expect(wrapper.emitted("submit")).toBeFalsy();
    expect(wrapper.emitted("cancel")).toBeTruthy();
  });

  it("does not emit submit when the name is only whitespace", async () => {
    const wrapper = mountForm();

    await wrapper.find('input[placeholder="Place name…"]').setValue("   ");
    await wrapper.find("form").trigger("submit");

    expect(wrapper.emitted("submit")).toBeFalsy();
  });

  it("disables the submit button when the name is blank", async () => {
    const wrapper = mountForm();

    await wrapper.find('input[placeholder="Place name…"]').setValue("");

    expect(
      wrapper.find('button[type="submit"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("emits cancel when the cancel button is clicked", async () => {
    const wrapper = mountForm();

    await wrapper.find('button[type="button"]').trigger("click");

    expect(wrapper.emitted("cancel")).toBeTruthy();
  });

  it("shows a saving state and disables submit while pending", () => {
    const wrapper = mount(PlaceEditForm, {
      ...globalConfig,
      props: { place: SAMPLE_PLACE, pending: true },
    });

    expect(wrapper.find('button[type="submit"]').text()).toContain("saving…");
    expect(
      wrapper.find('button[type="submit"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("disables the name field, category select, and cancel button while pending", () => {
    const wrapper = mount(PlaceEditForm, {
      ...globalConfig,
      props: { place: SAMPLE_PLACE, pending: true },
    });

    expect(
      wrapper.find('input[placeholder="Place name…"]').attributes("disabled"),
    ).toBeDefined();
    expect(
      wrapper.find('button[type="button"]').attributes("disabled"),
    ).toBeDefined();
    expect(
      wrapper.find(".place-edit-form__select").attributes("disabled"),
    ).toBeDefined();
  });

  it("trims surrounding whitespace from the submitted name", async () => {
    const wrapper = mountForm();

    await wrapper
      .find('input[placeholder="Place name…"]')
      .setValue("  Osaka  ");
    await wrapper.find("form").trigger("submit");

    expect(wrapper.emitted("submit")?.[0][0]).toEqual({ name: "Osaka" });
  });

  it("treats a name that only differs by whitespace as unchanged", async () => {
    const wrapper = mountForm();

    await wrapper.find('input[placeholder="Place name…"]').setValue("Tokyo ");
    await wrapper.find("form").trigger("submit");

    expect(wrapper.emitted("submit")).toBeFalsy();
    expect(wrapper.emitted("cancel")).toBeTruthy();
  });

  it("shows the error message when provided", () => {
    const wrapper = mount(PlaceEditForm, {
      ...globalConfig,
      props: { place: SAMPLE_PLACE, error: "Failed to update place" },
    });

    expect(wrapper.find(".place-edit-form__error").text()).toBe(
      "Failed to update place",
    );
  });
});
