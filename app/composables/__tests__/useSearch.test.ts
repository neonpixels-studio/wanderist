import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockApiFetch = vi.fn();

vi.stubGlobal("useApiClient", () => ({ apiFetch: mockApiFetch }));

// useSearch uses setTimeout for debouncing; use fake timers so tests don't wait.
vi.useFakeTimers();

const { useSearch } = await import("../useSearch");

const EMPTY_GROUPS = {
  places: [],
  trips: [],
  entries: [],
  guides: [],
  people: [],
};
const DEBOUNCE_MS = 250;

const SAMPLE_API_RESPONSE = {
  places: [
    {
      id: "p-1",
      name: "Reykjavík",
      subtitle: "Capital",
      country: "Iceland",
      category: "city",
    },
  ],
  trips: [{ id: "t-1", name: "Iceland Ring Road", status: "past" }],
  entries: [{ id: "e-1", title: "Harbor at 4am" }],
  guides: [{ id: "g-1", title: "48 hours in Kyoto" }],
  people: [
    {
      id: "u-2",
      displayName: "Elsa Far",
      handle: "elsa_far",
    },
  ],
};

async function searchAndFlush(
  search: (q: string) => void,
  query: string,
): Promise<void> {
  search(query);
  vi.advanceTimersByTime(DEBOUNCE_MS);
  // Allow the async executeSearch to run
  await vi.runAllTimersAsync();
}

describe("useSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Error-path tests exercise the catch block, which logs via console.error.
    // Silence it so the expected log doesn't pollute test output. console.warn
    // is silenced too: useSearch registers onScopeDispose, and calling the
    // composable directly (outside a component) makes Vue warn about the
    // missing effect scope on every instantiation.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  it("initializes with empty results and no loading or error state", () => {
    const { results, isLoading, error } = useSearch();

    expect(results.value).toEqual(EMPTY_GROUPS);
    expect(isLoading.value).toBe(false);
    expect(error.value).toBeNull();
  });

  it("returns empty groups when search is called with an empty string (no fetch)", () => {
    const { search, results } = useSearch();

    search("");

    expect(results.value).toEqual(EMPTY_GROUPS);
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("returns empty groups when search is called with whitespace only (no fetch)", () => {
    const { search, results } = useSearch();

    search("   ");

    expect(results.value).toEqual(EMPTY_GROUPS);
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("calls /api/search with the encoded query after the debounce interval", async () => {
    mockApiFetch.mockResolvedValue(SAMPLE_API_RESPONSE);
    const { search } = useSearch();

    await searchAndFlush(search, "reyk");

    expect(mockApiFetch).toHaveBeenCalledWith("/api/search?q=reyk");
  });

  it("does not call apiFetch before the debounce interval elapses", () => {
    mockApiFetch.mockResolvedValue(SAMPLE_API_RESPONSE);
    const { search } = useSearch();

    search("reyk");
    // Timer not fired yet
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("only fires one request when called rapidly (debouncing)", async () => {
    mockApiFetch.mockResolvedValue(SAMPLE_API_RESPONSE);
    const { search } = useSearch();

    search("r");
    search("re");
    search("rey");
    search("reyk");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    await vi.runAllTimersAsync();

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(mockApiFetch).toHaveBeenCalledWith("/api/search?q=reyk");
  });

  it("encodes special characters in the query string", async () => {
    mockApiFetch.mockResolvedValue(SAMPLE_API_RESPONSE);
    const { search } = useSearch();

    await searchAndFlush(search, "north & east");

    expect(mockApiFetch).toHaveBeenCalledWith(
      `/api/search?q=${encodeURIComponent("north & east")}`,
    );
  });

  it("trims whitespace from the query before encoding", async () => {
    mockApiFetch.mockResolvedValue(SAMPLE_API_RESPONSE);
    const { search } = useSearch();

    await searchAndFlush(search, "  reyk  ");

    expect(mockApiFetch).toHaveBeenCalledWith("/api/search?q=reyk");
  });

  it("truncates queries longer than 100 characters to prevent unbounded scans", async () => {
    mockApiFetch.mockResolvedValue(SAMPLE_API_RESPONSE);
    const { search } = useSearch();
    const longQuery = "a".repeat(200);

    await searchAndFlush(search, longQuery);

    const calledUrl = mockApiFetch.mock.calls[0][0] as string;
    const decoded = decodeURIComponent(calledUrl.replace("/api/search?q=", ""));
    expect(decoded.length).toBe(100);
  });

  it("maps places to SearchItems with pin icon and /map href", async () => {
    mockApiFetch.mockResolvedValue(SAMPLE_API_RESPONSE);
    const { search, results } = useSearch();

    await searchAndFlush(search, "reyk");

    const place = results.value.places[0];
    expect(place.id).toBe("p-1");
    expect(place.title).toBe("Reykjavík");
    expect(place.icon).toBe("pin");
    expect(place.href).toBe("/map");
  });

  it("combines place subtitle and country into a single subtitle string", async () => {
    mockApiFetch.mockResolvedValue(SAMPLE_API_RESPONSE);
    const { search, results } = useSearch();

    await searchAndFlush(search, "reyk");

    const place = results.value.places[0];
    expect(place.subtitle).toBe("Capital · Iceland");
  });

  it("maps trips to SearchItems with route icon and /trips/:id href", async () => {
    mockApiFetch.mockResolvedValue(SAMPLE_API_RESPONSE);
    const { search, results } = useSearch();

    await searchAndFlush(search, "iceland");

    const trip = results.value.trips[0];
    expect(trip.id).toBe("t-1");
    expect(trip.title).toBe("Iceland Ring Road");
    expect(trip.icon).toBe("route");
    expect(trip.href).toBe("/trips/t-1");
  });

  it("maps entries to SearchItems with journal icon and /journal href", async () => {
    mockApiFetch.mockResolvedValue(SAMPLE_API_RESPONSE);
    const { search, results } = useSearch();

    await searchAndFlush(search, "harbor");

    const entry = results.value.entries[0];
    expect(entry.id).toBe("e-1");
    expect(entry.title).toBe("Harbor at 4am");
    expect(entry.icon).toBe("journal");
    expect(entry.href).toBe("/journal");
  });

  it("maps guides to SearchItems with layers icon and /guides href", async () => {
    mockApiFetch.mockResolvedValue(SAMPLE_API_RESPONSE);
    const { search, results } = useSearch();

    await searchAndFlush(search, "kyoto");

    const guide = results.value.guides[0];
    expect(guide.id).toBe("g-1");
    expect(guide.title).toBe("48 hours in Kyoto");
    expect(guide.icon).toBe("layers");
    expect(guide.href).toBe("/guides");
  });

  it("maps people to SearchItems with user icon, @handle title, and profile href", async () => {
    mockApiFetch.mockResolvedValue(SAMPLE_API_RESPONSE);
    const { search, results } = useSearch();

    await searchAndFlush(search, "elsa");

    const person = results.value.people[0];
    expect(person.id).toBe("u-2");
    expect(person.title).toBe("@elsa_far");
    expect(person.icon).toBe("user");
    expect(person.href).toBe("/u/u-2");
  });

  it("falls back to displayName as people title when handle is null", async () => {
    mockApiFetch.mockResolvedValue({
      ...SAMPLE_API_RESPONSE,
      people: [{ id: "u-3", displayName: "Marco Reis", handle: null }],
    });
    const { search, results } = useSearch();

    await searchAndFlush(search, "marco");

    expect(results.value.people[0].title).toBe("Marco Reis");
  });

  it("falls back to 'Wanderist traveler' when both handle and displayName are null", async () => {
    mockApiFetch.mockResolvedValue({
      ...SAMPLE_API_RESPONSE,
      people: [{ id: "u-4", displayName: null, handle: null }],
    });
    const { search, results } = useSearch();

    await searchAndFlush(search, "traveler");

    expect(results.value.people[0].title).toBe("Wanderist traveler");
  });

  it("people results never include an email address in the SearchItem", async () => {
    mockApiFetch.mockResolvedValue(SAMPLE_API_RESPONSE);
    const { search, results } = useSearch();

    await searchAndFlush(search, "elsa");

    const person = results.value.people[0];
    // The SearchItem type does not have an email field; double-check at runtime
    expect((person as Record<string, unknown>).email).toBeUndefined();
  });

  it("discards a stale response when a newer search supersedes it", async () => {
    let resolveFirst!: (value: typeof SAMPLE_API_RESPONSE) => void;
    const firstPending = new Promise<typeof SAMPLE_API_RESPONSE>((resolve) => {
      resolveFirst = resolve;
    });
    const secondResponse = {
      ...SAMPLE_API_RESPONSE,
      places: [
        {
          id: "p-2",
          name: "Tokyo",
          subtitle: null,
          country: "Japan",
          category: "city",
        },
      ],
    };
    mockApiFetch
      .mockReturnValueOnce(firstPending)
      .mockResolvedValue(secondResponse);

    const { search, results } = useSearch();

    // Fire first search and let its debounce fire
    search("reyk");
    vi.advanceTimersByTime(DEBOUNCE_MS);

    // Fire second search and let its debounce fire
    search("tokyo");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    await vi.runAllTimersAsync();

    // The second response resolved. Now resolve the first (stale) response.
    resolveFirst(SAMPLE_API_RESPONSE);
    await vi.runAllTimersAsync();

    // Only the second (newer) response should be applied
    expect(results.value.places[0].title).toBe("Tokyo");
  });

  it("sets error when the fetch fails and resets results to empty", async () => {
    mockApiFetch.mockRejectedValue(new Error("Network error"));
    const { search, error, results } = useSearch();

    await searchAndFlush(search, "reyk");

    expect(error.value).toBeTruthy();
    expect(results.value).toEqual(EMPTY_GROUPS);
  });

  it("clears error at the start of a successful fetch after a prior failure", async () => {
    mockApiFetch.mockRejectedValueOnce(new Error("Network error"));
    const { search, error } = useSearch();
    await searchAndFlush(search, "reyk");
    expect(error.value).toBeTruthy();

    mockApiFetch.mockResolvedValue(SAMPLE_API_RESPONSE);
    await searchAndFlush(search, "tokyo");
    expect(error.value).toBeNull();
  });

  it("exposes a reactive query ref that is initially empty", () => {
    const { query } = useSearch();
    expect(query.value).toBe("");
  });

  it("sets isLoading synchronously when a non-empty query is received (before debounce fires)", () => {
    mockApiFetch.mockResolvedValue(SAMPLE_API_RESPONSE);
    const { search, isLoading } = useSearch();

    search("reyk");

    // Timer not yet fired — loading should already be true
    expect(isLoading.value).toBe(true);
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("clears stale error synchronously when a new search starts", async () => {
    mockApiFetch.mockRejectedValueOnce(new Error("Network error"));
    const { search, error } = useSearch();
    await searchAndFlush(search, "reyk");
    expect(error.value).toBeTruthy();

    // Start a new search — error should clear before the debounce fires
    mockApiFetch.mockResolvedValue(SAMPLE_API_RESPONSE);
    search("tokyo");
    expect(error.value).toBeNull();
  });

  it("does not set isLoading when search is called with an empty string", () => {
    const { search, isLoading } = useSearch();

    search("");

    expect(isLoading.value).toBe(false);
  });
});
