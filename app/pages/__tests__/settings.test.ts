import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, readonly } from "vue";
import { mount } from "@vue/test-utils";
import SettingsPage from "../settings.vue";
import type { UserSubscriptionDto } from "~/composables/useBilling";
import { DELETION_GRACE_PERIOD_DAYS } from "~/utils/accountDeletion";

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

const globalConfig = {
  global: {
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
  });

  it("renders without crashing and matches snapshot", () => {
    const wrapper = mount(SettingsPage, globalConfig);
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

  it("does not promise a change-of-mind window for account deletion", () => {
    const wrapper = mount(SettingsPage, globalConfig);
    const copy = wrapper.find(".danger .opt-row .lbl p").text();
    expect(copy).not.toMatch(/change your mind/i);
    expect(copy).toMatch(/right away/i);
    expect(copy).toMatch(/can't be undone/i);
    expect(copy).toContain(`${DELETION_GRACE_PERIOD_DAYS} days later`);
  });

  it("does not promise a change-of-mind window in the delete confirmation modal", async () => {
    const wrapper = mount(SettingsPage, globalConfig);
    await wrapper.find(".danger .btn").trigger("click");
    const modalCopy = wrapper.find(".modal p").text();
    expect(modalCopy).not.toMatch(/change your mind/i);
    expect(modalCopy).toMatch(/right away/i);
    expect(modalCopy).toContain(`${DELETION_GRACE_PERIOD_DAYS} days later`);
  });

  it("closes delete modal when cancel is clicked", async () => {
    const wrapper = mount(SettingsPage, globalConfig);
    await wrapper.find(".danger .btn").trigger("click");
    await wrapper.find(".modal .btn--ghost").trigger("click");
    expect(wrapper.find(".modal-scrim").classes()).not.toContain("is-open");
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
