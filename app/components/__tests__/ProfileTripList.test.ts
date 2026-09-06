import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ProfileTripList from "../ProfileTripList.vue";
import type { ProfileTrip } from "~/composables/useProfile";

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

const TRIPS: ProfileTrip[] = [
  {
    id: "trip-1",
    name: "Iceland Ring Road",
    status: "past",
    startDate: "2024-06-01T00:00:00.000Z",
    endDate: "2024-06-14T00:00:00.000Z",
    distanceKm: 1300,
    stopCount: 5,
  },
  {
    id: "trip-2",
    name: "Patagonia",
    status: "upcoming",
    startDate: null,
    endDate: null,
    distanceKm: null,
    stopCount: 0,
  },
];

describe("ProfileTripList", () => {
  it("renders each trip linked to its detail page and matches snapshot", () => {
    const wrapper = mount(ProfileTripList, {
      ...globalConfig,
      props: { trips: TRIPS },
    });

    const links = wrapper.findAll("a.trip");
    expect(links).toHaveLength(2);
    expect(links[0].attributes("href")).toBe("/trips/trip-1");
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("shows dates TBD when a trip has no start date", () => {
    const wrapper = mount(ProfileTripList, {
      ...globalConfig,
      props: { trips: TRIPS },
    });

    const dates = wrapper
      .findAll(".trip__body span")
      .map((node) => node.text());
    expect(dates[1]).toBe("dates TBD");
  });

  it("shows an empty note when there are no public trips", () => {
    const wrapper = mount(ProfileTripList, {
      ...globalConfig,
      props: { trips: [] },
    });

    expect(wrapper.find(".empty-note").text()).toBe("No public trips yet.");
    expect(wrapper.find("a.trip").exists()).toBe(false);
  });

  it("signals truncation when there are more trips than the page", () => {
    const wrapper = mount(ProfileTripList, {
      ...globalConfig,
      props: { trips: TRIPS, hasMore: true },
    });

    expect(wrapper.find(".trips-more").text()).toBe(
      "Showing the 2 most recent public trips.",
    );
  });

  it("omits the truncation note when the full list fits", () => {
    const wrapper = mount(ProfileTripList, {
      ...globalConfig,
      props: { trips: TRIPS, hasMore: false },
    });

    expect(wrapper.find(".trips-more").exists()).toBe(false);
  });

  it("shows a loading note (not the empty state) while trips load", () => {
    const wrapper = mount(ProfileTripList, {
      ...globalConfig,
      props: { trips: [], loading: true },
    });

    expect(wrapper.find(".empty-note").text()).toBe("Loading trips…");
    expect(wrapper.find("a.trip").exists()).toBe(false);
  });

  it("keeps the existing list visible during a refresh (no loading flash)", () => {
    const wrapper = mount(ProfileTripList, {
      ...globalConfig,
      props: { trips: TRIPS, loading: true },
    });

    expect(wrapper.findAll("a.trip")).toHaveLength(2);
    expect(wrapper.text()).not.toContain("Loading trips…");
  });

  it("shows an error (not the empty state) and no list when the fetch failed", () => {
    const wrapper = mount(ProfileTripList, {
      ...globalConfig,
      props: {
        trips: [],
        errorMessage: "Could not load trips",
      },
    });

    expect(wrapper.find(".alert-stub").attributes("data-message")).toBe(
      "Could not load trips",
    );
    expect(wrapper.find("a.trip").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("No public trips yet");
  });
});
