import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, readonly } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import SettingsPage from "../settings.vue";
import type { UserSubscriptionDto } from "~/composables/useBilling";
import { useTripsStore } from "~/stores/trips";
import type { Trip } from "~/stores/trips";

const DEFAULT_STATS_DATA = {
  placesCount: 34,
  countriesCount: 9,
  totalDistanceMi: 48218,
  totalDistanceKm: 77600,
  currentStreak: 14,
  placesThisWeek: 6,
  distanceMiThisWeek: 1400,
  distanceKmThisWeek: 2254,
  distanceUnit: "mi" as const,
};

const mockStats = ref({ ...DEFAULT_STATS_DATA });
const mockFetchStats = vi.fn().mockResolvedValue(undefined);

vi.mock("~/composables/useStats", () => ({
  useStats: vi.fn(() => ({
    stats: mockStats,
    fetchStats: mockFetchStats,
  })),
}));

const DEFAULT_TRIPS: Trip[] = [
  {
    id: "trip-1",
    userId: "user-1",
    name: "Iceland, the ring road",
    status: "past",
    startDate: "2025-06-20T00:00:00.000Z",
    endDate: "2025-06-29T00:00:00.000Z",
    coverImageId: null,
    distanceKm: 892,
    visibility: "private",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  },
  {
    id: "trip-2",
    userId: "user-1",
    name: "Portugal, coast to coast",
    status: "upcoming",
    startDate: "2026-07-01T00:00:00.000Z",
    endDate: "2026-07-10T00:00:00.000Z",
    coverImageId: null,
    distanceKm: null,
    visibility: "private",
    createdAt: "2025-01-02T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
  },
  {
    id: "trip-3",
    userId: "user-1",
    name: "Norway in winter",
    status: "upcoming",
    startDate: null,
    endDate: null,
    coverImageId: null,
    distanceKm: null,
    visibility: "private",
    createdAt: "2025-01-03T00:00:00.000Z",
    updatedAt: "2025-01-03T00:00:00.000Z",
  },
];

const mockChangePassword = vi.fn().mockResolvedValue(true);
const mockUploadAvatar = vi.fn().mockResolvedValue(null);
const mockRemoveAvatar = vi.fn().mockResolvedValue(true);
const mockDeleteAccount = vi.fn().mockResolvedValue(true);
const mockAccountIsLoading = ref(false);
const mockPasswordError = ref<string | null>(null);
const mockAvatarError = ref<string | null>(null);
const mockDeleteError = ref<string | null>(null);

vi.mock("~/composables/useAccountActions", () => ({
  useAccountActions: vi.fn(() => ({
    isLoading: readonly(mockAccountIsLoading),
    passwordError: readonly(mockPasswordError),
    avatarError: readonly(mockAvatarError),
    deleteError: readonly(mockDeleteError),
    changePassword: mockChangePassword,
    uploadAvatar: mockUploadAvatar,
    removeAvatar: mockRemoveAvatar,
    deleteAccount: mockDeleteAccount,
  })),
}));

const defaultPreferencesData = {
  distanceUnit: "mi" as const,
  defaultMapStyle: "outdoors",
  publicProfile: true,
  preciseLocation: false,
  showOnExplore: true,
  displayName: "Dan H.",
  handle: "danh",
  homeBase: "St. Louis, USA",
  bio: "Chasing cold coffee and warm light.",
};

function makePreferencesMock(
  overrides: {
    savePreferences?: ReturnType<typeof vi.fn>;
    saveError?: string | null;
    loadError?: string | null;
    preferences?: typeof defaultPreferencesData;
  } = {},
) {
  return {
    preferences: ref(overrides.preferences ?? defaultPreferencesData),
    isLoading: readonly(ref(false)),
    loadError: readonly(ref(overrides.loadError ?? null)),
    saveError: readonly(ref(overrides.saveError ?? null)),
    fetchPreferences: vi.fn().mockResolvedValue(undefined),
    savePreferences:
      overrides.savePreferences ?? vi.fn().mockResolvedValue(true),
  };
}

vi.mock("~/composables/usePreferences", () => {
  const { ref: vueRef, readonly: vueReadonly } = require("vue");

  const defaultData = {
    distanceUnit: "mi",
    defaultMapStyle: "outdoors",
    publicProfile: true,
    preciseLocation: false,
    showOnExplore: true,
    displayName: "Dan H.",
    handle: "danh",
    homeBase: "St. Louis, USA",
    bio: "Chasing cold coffee and warm light.",
  };

  return {
    usePreferences: vi.fn(() => ({
      preferences: vueRef(defaultData),
      isLoading: vueReadonly(vueRef(false)),
      loadError: vueReadonly(vueRef(null)),
      saveError: vueReadonly(vueRef(null)),
      fetchPreferences: vi.fn().mockResolvedValue(undefined),
      savePreferences: vi.fn().mockResolvedValue(true),
    })),
    PREFERENCES_DEFAULTS: {
      distanceUnit: "mi",
      defaultMapStyle: "outdoors",
      publicProfile: false,
      preciseLocation: false,
      showOnExplore: true,
      displayName: null,
      handle: null,
      homeBase: null,
      bio: null,
    },
  };
});

vi.mock("~/composables/useApiClient", () => ({
  useApiClient: vi.fn(() => ({
    apiFetch: vi.fn(),
  })),
}));

const defaultSubscriptionData: UserSubscriptionDto = {
  plan: "drifter",
  status: "active",
  billingCycle: null,
  trialEndsAt: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

function makeBillingMock(
  overrides: { subscription?: UserSubscriptionDto } = {},
) {
  return {
    subscription: ref(overrides.subscription ?? defaultSubscriptionData),
    isLoading: readonly(ref(false)),
    loadError: readonly(ref(null)),
    fetchSubscription: vi.fn().mockResolvedValue(undefined),
  };
}

vi.mock("~/composables/useBilling", () => ({
  useBilling: vi.fn(() => makeBillingMock()),
}));

vi.mock("~/composables/useConnections", () => {
  const { ref: vueRef, readonly: vueReadonly } = require("vue");

  const defaultConnections = {
    instagram: { connected: false },
    google: { connected: false, emailAddress: null, identificationId: null },
  };

  return {
    useConnections: vi.fn(() => ({
      connections: vueReadonly(vueRef(defaultConnections)),
      isLoading: vueReadonly(vueRef(false)),
      loadError: vueReadonly(vueRef(null)),
      actionError: vueReadonly(vueRef(null)),
      importResult: vueReadonly(vueRef(null)),
      fetchConnections: vi.fn().mockResolvedValue(undefined),
      startInstagramConnect: vi.fn(),
      disconnectInstagram: vi.fn().mockResolvedValue(true),
      disconnectGoogle: vi.fn().mockResolvedValue(true),
      importInstagramPhotos: vi.fn().mockResolvedValue(true),
    })),
  };
});

const iconStub = { template: "<svg data-icon />" };
const inputStub = {
  template: "<input />",
  props: [
    "modelValue",
    "label",
    "type",
    "placeholder",
    "state",
    "hint",
    "icon",
    "required",
  ],
};
const textareaStub = {
  template: "<textarea />",
  props: ["modelValue", "label", "placeholder", "rows"],
};
const alertStub = {
  template: '<div class="alert" />',
  props: ["intent", "title"],
};
const topbarStub = {
  template: '<header class="topbar"><slot /></header>',
  props: ["title", "crumb"],
};
const planManageButtonStub = {
  template: '<button class="plan-manage-btn"><slot /></button>',
};

const globalConfig: {
  global: {
    plugins: unknown[];
    stubs: Record<string, unknown>;
  };
} = {
  global: {
    plugins: [],
    stubs: {
      AppIcon: iconStub,
      AppTopbar: topbarStub,
      InputText: inputStub,
      InputTextarea: textareaStub,
      AppAlert: alertStub,
      PlanManageButton: planManageButtonStub,
      NuxtLink: { template: "<a><slot /></a>", props: ["to"] },
    },
  },
};

describe("Settings page (/settings)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStats.value = { ...DEFAULT_STATS_DATA };
    mockFetchStats.mockResolvedValue(undefined);

    const pinia = createPinia();
    setActivePinia(pinia);
    globalConfig.global.plugins = [pinia];

    const tripsStore = useTripsStore();
    tripsStore.tripList = [...DEFAULT_TRIPS];
    vi.spyOn(tripsStore, "fetchTrips").mockResolvedValue();
  });

  it("renders without crashing and matches snapshot", async () => {
    const wrapper = mount(SettingsPage, globalConfig);
    await flushPromises();
    expect(wrapper.find(".set-layout").exists()).toBe(true);
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("renders the side navigation with all 7 sections", () => {
    const wrapper = mount(SettingsPage, globalConfig);
    expect(wrapper.findAll(".set-nav a")).toHaveLength(7);
  });

  it("renders all 7 settings sections", () => {
    const wrapper = mount(SettingsPage, globalConfig);
    expect(wrapper.findAll(".sect")).toHaveLength(7);
  });

  it("shows an upgrade CTA on the free Drifter plan", () => {
    const wrapper = mount(SettingsPage, globalConfig);
    const billingSection = wrapper.find("#billing");
    expect(billingSection.text()).toContain("Drifter plan");
    expect(billingSection.find(".plan-manage-btn").exists()).toBe(false);
    expect(billingSection.text()).toContain("view plans");
  });

  it("shows a manage-subscription button on a paid plan", async () => {
    const { useBilling } = await import("~/composables/useBilling");
    vi.mocked(useBilling).mockReturnValueOnce(
      makeBillingMock({
        subscription: {
          plan: "wanderer",
          status: "active",
          billingCycle: "monthly",
          trialEndsAt: null,
          currentPeriodEnd: "2026-08-01T00:00:00.000Z",
          cancelAtPeriodEnd: false,
        },
      }),
    );

    const wrapper = mount(SettingsPage, globalConfig);
    const billingSection = wrapper.find("#billing");
    expect(billingSection.text()).toContain("Wanderer plan");
    expect(billingSection.find(".plan-manage-btn").exists()).toBe(true);
    expect(billingSection.text()).toContain("Renews");
  });

  it("shows the trial-ends message when a trial is active", async () => {
    const { useBilling } = await import("~/composables/useBilling");
    // Trial must end in the future for it to count as active, so derive the
    // date from now rather than hardcoding one that silently expires.
    const trialEndsAt = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    vi.mocked(useBilling).mockReturnValueOnce(
      makeBillingMock({
        subscription: {
          plan: "nomad",
          status: "active",
          billingCycle: "yearly",
          trialEndsAt,
          currentPeriodEnd: trialEndsAt,
          cancelAtPeriodEnd: false,
        },
      }),
    );

    const wrapper = mount(SettingsPage, globalConfig);
    expect(wrapper.find("#billing").text()).toContain("Trial ends");
  });

  it("shows the renewal message (not a stale trial message) once a past trial has converted", async () => {
    const { useBilling } = await import("~/composables/useBilling");
    vi.mocked(useBilling).mockReturnValueOnce(
      makeBillingMock({
        subscription: {
          plan: "nomad",
          status: "active",
          billingCycle: "yearly",
          // Trial ended in the past — the row hasn't necessarily had
          // trialEndsAt cleared (see server/utils/subscriptions.ts), so the
          // UI must not keep showing "Trial ends" once the date has passed.
          trialEndsAt: "2020-01-01T00:00:00.000Z",
          currentPeriodEnd: "2026-08-01T00:00:00.000Z",
          cancelAtPeriodEnd: false,
        },
      }),
    );

    const wrapper = mount(SettingsPage, globalConfig);
    const billingText = wrapper.find("#billing").text();
    expect(billingText).not.toContain("Trial ends");
    expect(billingText).toContain("Renews");
  });

  it("shows a manage-subscription button for a past_due paid plan (not the free-tier upgrade CTA)", async () => {
    const { useBilling } = await import("~/composables/useBilling");
    vi.mocked(useBilling).mockReturnValueOnce(
      makeBillingMock({
        subscription: {
          plan: "wanderer",
          status: "past_due",
          billingCycle: "monthly",
          trialEndsAt: null,
          currentPeriodEnd: "2026-07-15T00:00:00.000Z",
          cancelAtPeriodEnd: false,
        },
      }),
    );

    const wrapper = mount(SettingsPage, globalConfig);
    const billingSection = wrapper.find("#billing");
    expect(billingSection.find(".plan-manage-btn").exists()).toBe(true);
    expect(billingSection.text()).toContain("Wanderer plan");
    expect(billingSection.text()).toContain("Payment issue");
    expect(billingSection.text()).not.toContain("Renews");
  });

  it("shows an access-ends message (not 'Renews') for a canceled subscription", async () => {
    const { useBilling } = await import("~/composables/useBilling");
    vi.mocked(useBilling).mockReturnValueOnce(
      makeBillingMock({
        subscription: {
          plan: "nomad",
          status: "canceled",
          billingCycle: "yearly",
          trialEndsAt: null,
          currentPeriodEnd: "2026-07-20T00:00:00.000Z",
          cancelAtPeriodEnd: false,
        },
      }),
    );

    const wrapper = mount(SettingsPage, globalConfig);
    const billingText = wrapper.find("#billing").text();
    expect(billingText).toContain("Access ends");
    expect(billingText).not.toContain("Renews");
    expect(billingText).not.toContain("Payment issue");
  });

  it("shows an access-ends message (not 'Renews') for a still-active subscription scheduled to cancel", async () => {
    const { useBilling } = await import("~/composables/useBilling");
    vi.mocked(useBilling).mockReturnValueOnce(
      makeBillingMock({
        subscription: {
          plan: "nomad",
          status: "active",
          billingCycle: "yearly",
          trialEndsAt: null,
          currentPeriodEnd: "2026-07-20T00:00:00.000Z",
          cancelAtPeriodEnd: true,
        },
      }),
    );

    const wrapper = mount(SettingsPage, globalConfig);
    const billingSection = wrapper.find("#billing");
    const billingText = billingSection.text();
    expect(billingSection.find(".plan-manage-btn").exists()).toBe(true);
    expect(billingText).toContain("Access ends");
    expect(billingText).not.toContain("Renews");
  });

  it("renders the 6 map style options", () => {
    const wrapper = mount(SettingsPage, globalConfig);
    expect(wrapper.findAll(".map-style")).toHaveLength(6);
  });

  it("toggles map style selection", async () => {
    const wrapper = mount(SettingsPage, globalConfig);
    const styles = wrapper.findAll(".map-style");
    await styles[1].trigger("click");
    expect(styles[1].classes()).toContain("is-active");
    expect(styles[0].classes()).not.toContain("is-active");
  });

  it("toggles unit selection", async () => {
    const wrapper = mount(SettingsPage, globalConfig);
    const buttons = wrapper.findAll(".segmented button");
    await buttons[1].trigger("click");
    expect(buttons[1].classes()).toContain("is-active");
    expect(buttons[0].classes()).not.toContain("is-active");
  });

  it("shows delete confirmation modal when delete button is clicked", async () => {
    const wrapper = mount(SettingsPage, globalConfig);
    expect(wrapper.find(".modal-scrim").classes()).not.toContain("is-open");
    await wrapper.find(".danger .btn").trigger("click");
    expect(wrapper.find(".modal-scrim").classes()).toContain("is-open");
  });

  it("closes delete modal when cancel is clicked", async () => {
    const wrapper = mount(SettingsPage, globalConfig);
    await wrapper.find(".danger .btn").trigger("click");
    await wrapper.find(".modal .btn--ghost").trigger("click");
    expect(wrapper.find(".modal-scrim").classes()).not.toContain("is-open");
  });

  it("shows a generic message (no fabricated zero count) while counts are still loading", async () => {
    // A deferred fetchStats that we control explicitly, rather than relying
    // on how many microtask hops onMounted happens to take — flushPromises()
    // only drains what's already pending, so this stays pending until we
    // resolve it below regardless of the fetch chain's shape.
    let resolveFetchStats: () => void = () => {};
    mockFetchStats.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFetchStats = resolve;
        }),
    );

    const wrapper = mount(SettingsPage, globalConfig);
    await flushPromises();
    await wrapper.find(".danger .btn").trigger("click");

    const modalText = wrapper.find(".modal").text();
    expect(modalText).not.toContain("0 places");
    expect(modalText).not.toContain("0 trips");
    expect(modalText).toContain(
      "This removes all your places, trips and photos.",
    );

    resolveFetchStats();
    await flushPromises();
  });

  it("shows the user's real place and trip counts in the delete confirmation, not hardcoded values", async () => {
    const wrapper = mount(SettingsPage, globalConfig);
    await flushPromises();
    await wrapper.find(".danger .btn").trigger("click");

    const modalText = wrapper.find(".modal").text();
    expect(modalText).toContain("34 places");
    expect(modalText).toContain("3 trips");
  });

  it("follows the real data when place/trip counts differ from the default mock, proving the counts are dynamic", async () => {
    mockStats.value = { ...DEFAULT_STATS_DATA, placesCount: 200 };
    const tripsStore = useTripsStore();
    tripsStore.tripList = [
      ...DEFAULT_TRIPS,
      { ...DEFAULT_TRIPS[0], id: "trip-4" },
      { ...DEFAULT_TRIPS[1], id: "trip-5" },
    ];

    const wrapper = mount(SettingsPage, globalConfig);
    await flushPromises();
    await wrapper.find(".danger .btn").trigger("click");

    const modalText = wrapper.find(".modal").text();
    expect(modalText).toContain("200 places");
    expect(modalText).toContain("5 trips");
  });

  it("falls back to generic wording (no fabricated zero count) when stats fail to load", async () => {
    mockFetchStats.mockRejectedValueOnce(new Error("Failed to load stats"));

    const wrapper = mount(SettingsPage, globalConfig);
    await flushPromises();
    await wrapper.find(".danger .btn").trigger("click");

    const modalText = wrapper.find(".modal").text();
    expect(modalText).not.toContain("0 places");
    expect(modalText).not.toContain("0 trips");
    expect(modalText).toContain(
      "This removes all your places, trips and photos.",
    );
  });

  it("falls back to generic wording (no fabricated zero count) when the trips list fails to load", async () => {
    const tripsStore = useTripsStore();
    vi.spyOn(tripsStore, "fetchTrips").mockRejectedValue(
      new Error("Failed to load trips"),
    );

    const wrapper = mount(SettingsPage, globalConfig);
    await flushPromises();
    await wrapper.find(".danger .btn").trigger("click");

    const modalText = wrapper.find(".modal").text();
    expect(modalText).not.toContain("0 places");
    expect(modalText).not.toContain("0 trips");
    expect(modalText).toContain(
      "This removes all your places, trips and photos.",
    );
  });

  it("uses singular wording for exactly one place and one trip", async () => {
    mockStats.value = { ...DEFAULT_STATS_DATA, placesCount: 1 };
    const tripsStore = useTripsStore();
    tripsStore.tripList = [DEFAULT_TRIPS[0]];

    const wrapper = mount(SettingsPage, globalConfig);
    await flushPromises();
    await wrapper.find(".danger .btn").trigger("click");

    const modalText = wrapper.find(".modal").text();
    expect(modalText).toContain("1 place");
    expect(modalText).not.toContain("1 places");
    expect(modalText).toContain("1 trip");
    expect(modalText).not.toContain("1 trips");
  });

  it("shows saved toast after a successful save", async () => {
    const wrapper = mount(SettingsPage, globalConfig);
    expect(wrapper.find(".saved-bar").classes()).not.toContain("show");
    await wrapper.find(".btn--primary").trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".saved-bar").classes()).toContain("show");
  });

  it("save button calls savePreferences with the correct payload", async () => {
    const { usePreferences } = await import("~/composables/usePreferences");
    const savePreferencesMock = vi.fn().mockResolvedValue(true);
    vi.mocked(usePreferences).mockReturnValueOnce(
      makePreferencesMock({ savePreferences: savePreferencesMock }),
    );

    const wrapper = mount(SettingsPage, globalConfig);
    await wrapper.find(".btn--primary").trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(savePreferencesMock).toHaveBeenCalledTimes(1);
    const payload = savePreferencesMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // Verify key fields are sent; name comes from the mock ("Dan H.") which
    // is not null so should be sent as-is after nullableString trims it.
    expect(payload).toMatchObject({
      distanceUnit: "mi",
      defaultMapStyle: "outdoors",
      publicProfile: true,
      preciseLocation: false,
      showOnExplore: true,
    });
  });

  it("does not call savePreferences when loadError is set", async () => {
    const { usePreferences } = await import("~/composables/usePreferences");
    const savePreferencesMock = vi.fn().mockResolvedValue(true);
    vi.mocked(usePreferences).mockReturnValueOnce(
      makePreferencesMock({
        savePreferences: savePreferencesMock,
        loadError: "Failed to load preferences",
      }),
    );

    const wrapper = mount(SettingsPage, globalConfig);
    await wrapper.find(".btn--primary").trigger("click");
    await wrapper.vm.$nextTick();

    expect(savePreferencesMock).not.toHaveBeenCalled();
  });

  it("shows password error when passwords do not match", async () => {
    const wrapper = mount(SettingsPage, globalConfig);

    // Open password fields
    const changePasswordBtn = wrapper
      .findAll(".opt-row .btn--outline")
      .find((btn) => btn.text().includes("change password"));
    await changePasswordBtn?.trigger("click");
    await wrapper.vm.$nextTick();

    // In Vue 3 with <script setup>, the component proxy auto-unwraps refs on
    // assignment — setting vm.foo = "bar" writes through to the underlying ref.
    const vm = wrapper.vm as unknown as Record<string, string>;
    vm.passwordNew = "newpassword1";
    vm.passwordConfirm = "different123";

    const updatePasswordBtn = wrapper
      .findAll(".btn--primary")
      .find((btn) => btn.text().includes("update password"));
    await updatePasswordBtn?.trigger("click");
    await wrapper.vm.$nextTick();

    expect(mockChangePassword).not.toHaveBeenCalled();
    expect(wrapper.find(".account-field-error").exists()).toBe(true);
  });

  it("calls changePassword with correct value and hides fields on success", async () => {
    const wrapper = mount(SettingsPage, globalConfig);

    const changePasswordBtn = wrapper
      .findAll(".opt-row .btn--outline")
      .find((btn) => btn.text().includes("change password"));
    await changePasswordBtn?.trigger("click");
    await wrapper.vm.$nextTick();

    const vm = wrapper.vm as unknown as Record<string, string>;
    vm.passwordNew = "validpassword";
    vm.passwordConfirm = "validpassword";

    const updatePasswordBtn = wrapper
      .findAll(".btn--primary")
      .find((btn) => btn.text().includes("update password"));
    await updatePasswordBtn?.trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(mockChangePassword).toHaveBeenCalledWith("validpassword");
  });

  it("calls deleteAccount when delete forever is clicked with DELETE typed", async () => {
    const wrapper = mount(SettingsPage, globalConfig);

    // Open delete modal
    await wrapper.find(".danger .btn").trigger("click");
    await wrapper.vm.$nextTick();

    // Set deleteConfirm via the component proxy (ref is auto-unwrapped on set)
    const vm = wrapper.vm as unknown as Record<string, string>;
    vm.deleteConfirm = "DELETE";
    await wrapper.vm.$nextTick();

    const deleteBtn = wrapper
      .findAll(".modal .btn")
      .find((btn) => btn.text().includes("delete forever"));
    await deleteBtn?.trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
  });

  it("shows error toast (not success toast) when save fails", async () => {
    const { usePreferences } = await import("~/composables/usePreferences");
    const savePreferencesMock = vi.fn().mockResolvedValue(false);
    vi.mocked(usePreferences).mockReturnValueOnce(
      makePreferencesMock({
        savePreferences: savePreferencesMock,
        saveError: null,
      }),
    );

    const wrapper = mount(SettingsPage, globalConfig);
    await wrapper.find(".btn--primary").trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    // The error bar has show class; the success bar is hidden via v-else
    const allSavedBars = wrapper.findAll(".saved-bar");
    expect(allSavedBars[0].classes()).toContain("show");
    // Only one bar is rendered at a time (v-if / v-else)
    expect(allSavedBars).toHaveLength(1);
  });
});
