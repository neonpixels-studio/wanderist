/**
 * Unit tests for the Instagram API client module.
 * Network calls are mocked with vi.stubGlobal on fetch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildInstagramAuthUrl,
  exchangeInstagramCode,
  exchangeForLongLivedToken,
  refreshLongLivedToken,
  fetchInstagramUser,
  fetchInstagramMedia,
  filterGeotaggedMedia,
  parseMetaError,
  InstagramApiError,
  INSTAGRAM_OAUTH_AUTHORIZE_URL,
  INSTAGRAM_SCOPES,
  INSTAGRAM_MAX_MEDIA_PAGES,
  type InstagramMediaItem,
} from "../../../server/utils/instagramClient";

function makeMediaItem(id: string): InstagramMediaItem {
  return {
    id,
    media_type: "IMAGE",
    media_url: `https://cdn.ig.com/${id}.jpg`,
    timestamp: "2024-01-01T00:00:00Z",
    permalink: `https://ig.com/p/${id}`,
  };
}

function makeFetchResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

// A response whose body is returned verbatim (not JSON-encoded) — for asserting
// how a genuinely non-JSON error body (an HTML gateway page) is handled.
function makeRawTextResponse(rawBody: string, status: number): Response {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(rawBody),
    json: () => Promise.reject(new Error("not json")),
  } as unknown as Response;
}

describe("buildInstagramAuthUrl", () => {
  it("includes the client_id, redirect_uri, scope, and state", () => {
    const url = buildInstagramAuthUrl({
      clientId: "client-123",
      redirectUri: "https://example.com/callback",
      state: "state-abc",
    });

    expect(url).toContain(INSTAGRAM_OAUTH_AUTHORIZE_URL);
    expect(url).toContain("client_id=client-123");
    expect(url).toContain("redirect_uri=");
    expect(url).toContain("state=state-abc");
    expect(url).toContain(
      encodeURIComponent(INSTAGRAM_SCOPES)
        .replaceAll("%2C", ",")
        .split(",")[0]!,
    );
  });

  it("sets response_type=code", () => {
    const url = buildInstagramAuthUrl({
      clientId: "c",
      redirectUri: "https://r.com",
      state: "s",
    });
    expect(url).toContain("response_type=code");
  });
});

describe("exchangeInstagramCode", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("POSTs to the token URL and returns the token response", async () => {
    const tokenResponse = { access_token: "short-token", token_type: "bearer" };
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(tokenResponse));

    const result = await exchangeInstagramCode({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "https://example.com/callback",
      code: "auth-code",
    });

    expect(result.access_token).toBe("short-token");
    const [url, options] = vi.mocked(fetch).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toContain("instagram.com");
    expect((options.method as string).toUpperCase()).toBe("POST");
  });

  it("throws when the API returns a non-OK status", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeFetchResponse({ error: "bad" }, false, 400),
    );

    await expect(
      exchangeInstagramCode({
        clientId: "c",
        clientSecret: "s",
        redirectUri: "r",
        code: "code",
      }),
    ).rejects.toThrow();
  });
});

describe("exchangeForLongLivedToken", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("returns a long-lived token response", async () => {
    const longResponse = {
      access_token: "long-token",
      token_type: "bearer",
      expires_in: 5183944,
    };
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(longResponse));

    const result = await exchangeForLongLivedToken({
      clientSecret: "secret",
      shortLivedToken: "short-token",
    });

    expect(result.access_token).toBe("long-token");
    expect(result.expires_in).toBeGreaterThan(0);
  });

  it("throws when the API returns a non-OK status", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeFetchResponse({ error: "bad" }, false, 401),
    );

    await expect(
      exchangeForLongLivedToken({ clientSecret: "s", shortLivedToken: "t" }),
    ).rejects.toThrow();
  });
});

describe("refreshLongLivedToken", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("calls the refresh endpoint with ig_refresh_token and returns the new token", async () => {
    const refreshResponse = {
      access_token: "refreshed-token",
      token_type: "bearer",
      expires_in: 5183944,
    };
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(refreshResponse));

    const result = await refreshLongLivedToken({ accessToken: "old-token" });

    expect(result.access_token).toBe("refreshed-token");
    expect(result.expires_in).toBeGreaterThan(0);
    const [url] = vi.mocked(fetch).mock.calls[0] as [string];
    expect(url).toContain("refresh_access_token");
    expect(url).toContain("grant_type=ig_refresh_token");
    expect(url).toContain("access_token=old-token");
  });

  it("throws an InstagramApiError carrying the parsed Meta code on a genuine revocation", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeFetchResponse(
        {
          error: {
            message: "Error validating access token: Session has expired",
            type: "OAuthException",
            code: 190,
            error_subcode: 463,
          },
        },
        false,
        400,
      ),
    );

    const error = await refreshLongLivedToken({
      accessToken: "dead-token",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InstagramApiError);
    expect((error as InstagramApiError).status).toBe(400);
    expect((error as InstagramApiError).metaError).toEqual({
      type: "OAuthException",
      code: 190,
      subcode: 463,
    });
  });

  it("throws with an undefined metaError when the 400 body is a non-JSON gateway page", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeRawTextResponse("<html>502 Bad Gateway</html>", 400),
    );

    const error = await refreshLongLivedToken({
      accessToken: "token",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InstagramApiError);
    expect((error as InstagramApiError).metaError).toBeUndefined();
  });
});

describe("parseMetaError", () => {
  it("extracts type, code, and error_subcode from a Meta error envelope", () => {
    const body = JSON.stringify({
      error: {
        message: "Error validating access token",
        type: "OAuthException",
        code: 190,
        error_subcode: 460,
      },
    });

    expect(parseMetaError(body)).toEqual({
      type: "OAuthException",
      code: 190,
      subcode: 460,
    });
  });

  it("returns present fields and leaves absent ones undefined", () => {
    const body = JSON.stringify({ error: { type: "OAuthException", code: 4 } });

    expect(parseMetaError(body)).toEqual({
      type: "OAuthException",
      code: 4,
      subcode: undefined,
    });
  });

  it("returns undefined for a non-JSON body", () => {
    expect(parseMetaError("<html>502 Bad Gateway</html>")).toBeUndefined();
  });

  it("returns undefined when there is no error object", () => {
    expect(parseMetaError(JSON.stringify({ ok: true }))).toBeUndefined();
  });

  it("returns undefined for an array or null error, not just a missing one", () => {
    expect(parseMetaError(JSON.stringify({ error: [] }))).toBeUndefined();
    expect(parseMetaError(JSON.stringify({ error: null }))).toBeUndefined();
  });

  it("returns undefined for a JSON array body", () => {
    expect(parseMetaError(JSON.stringify([1, 2, 3]))).toBeUndefined();
  });

  it("returns undefined when the error object carries no field of the right type", () => {
    const body = JSON.stringify({
      error: { type: 190, code: "190", error_subcode: "463" },
    });

    expect(parseMetaError(body)).toBeUndefined();
  });

  it("keeps a usable field even when another is the wrong type", () => {
    const body = JSON.stringify({
      error: { type: "OAuthException", code: "190" },
    });

    expect(parseMetaError(body)).toEqual({
      type: "OAuthException",
      code: undefined,
      subcode: undefined,
    });
  });
});

describe("fetchInstagramUser", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("returns the user's id and username", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeFetchResponse({ id: "ig-123", username: "testuser" }),
    );

    const user = await fetchInstagramUser("access-token");

    expect(user.id).toBe("ig-123");
    expect(user.username).toBe("testuser");
  });

  it("passes the access_token in the query string", async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse({ id: "ig-123" }));

    await fetchInstagramUser("my-token");

    const [url] = vi.mocked(fetch).mock.calls[0] as [string];
    expect(url).toContain("access_token=my-token");
  });

  it("throws when the API returns a non-OK status", async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse({}, false, 401));

    await expect(fetchInstagramUser("bad-token")).rejects.toThrow();
  });
});

describe("fetchInstagramMedia", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    // The walk warns on truncation / off-host cursors — silence expected noise.
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns the media response with a data array", async () => {
    const mediaResponse = {
      data: [
        {
          id: "m1",
          media_type: "IMAGE",
          media_url: "https://cdn.ig.com/m1.jpg",
          timestamp: "2024-01-01T00:00:00Z",
          permalink: "https://ig.com/p/m1",
        },
      ],
    };
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(mediaResponse));

    const result = await fetchInstagramMedia("access-token");

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.id).toBe("m1");
  });

  it("throws when the API returns a non-OK status", async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse({}, false, 400));

    await expect(fetchInstagramMedia("bad-token")).rejects.toThrow();
  });

  it("follows paging.next and concatenates items across pages", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        makeFetchResponse({
          data: [makeMediaItem("p1a"), makeMediaItem("p1b")],
          paging: {
            next: "https://graph.instagram.com/me/media?after=cursor1",
          },
        }),
      )
      .mockResolvedValueOnce(
        makeFetchResponse({
          data: [makeMediaItem("p2a")],
          paging: {
            next: "https://graph.instagram.com/me/media?after=cursor2",
          },
        }),
      )
      .mockResolvedValueOnce(
        makeFetchResponse({
          data: [makeMediaItem("p3a")],
          // No paging.next — the walk stops here.
        }),
      );

    const result = await fetchInstagramMedia("access-token");

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
    expect(result.data.map((item) => item.id)).toEqual([
      "p1a",
      "p1b",
      "p2a",
      "p3a",
    ]);
  });

  it("requests each paging.next URL verbatim", async () => {
    const nextUrl = "https://graph.instagram.com/me/media?after=opaque-cursor";
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        makeFetchResponse({
          data: [makeMediaItem("a")],
          paging: { next: nextUrl },
        }),
      )
      .mockResolvedValueOnce(makeFetchResponse({ data: [makeMediaItem("b")] }));

    await fetchInstagramMedia("access-token");

    const secondCallUrl = vi.mocked(fetch).mock.calls[1]![0] as string;
    expect(secondCallUrl).toBe(nextUrl);
  });

  it("stops after INSTAGRAM_MAX_MEDIA_PAGES even when paging.next persists", async () => {
    // Every page reports another next cursor; the bound must cut the walk off.
    // Each page carries a unique id so the item count reflects pages fetched.
    let pageIndex = 0;
    vi.mocked(fetch).mockImplementation(() => {
      pageIndex += 1;
      return Promise.resolve(
        makeFetchResponse({
          data: [makeMediaItem(`x${pageIndex}`)],
          paging: {
            next: "https://graph.instagram.com/me/media?after=endless",
          },
        }),
      );
    });

    const result = await fetchInstagramMedia("access-token");

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(INSTAGRAM_MAX_MEDIA_PAGES);
    expect(result.data).toHaveLength(INSTAGRAM_MAX_MEDIA_PAGES);
  });

  it("makes a single request when the first page has no paging.next", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeFetchResponse({ data: [makeMediaItem("only")] }),
    );

    const result = await fetchInstagramMedia("access-token");

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(result.data).toHaveLength(1);
  });

  it("does not follow a paging.next that points off the Instagram host", async () => {
    const evilUrl = "https://evil.example.com/steal?token=leak";
    vi.mocked(fetch).mockResolvedValueOnce(
      makeFetchResponse({
        data: [makeMediaItem("a")],
        paging: { next: evilUrl },
      }),
    );

    const result = await fetchInstagramMedia("access-token");

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(result.data.map((item) => item.id)).toEqual(["a"]);
    const fetchedUrls = vi
      .mocked(fetch)
      .mock.calls.map((call) => String(call[0]));
    expect(fetchedUrls).not.toContain(evilUrl);
  });

  it("stops on a null paging.next without throwing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeFetchResponse({
        data: [makeMediaItem("a")],
        paging: { next: null },
      }),
    );

    const result = await fetchInstagramMedia("access-token");

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(result.data.map((item) => item.id)).toEqual(["a"]);
  });

  it("keeps earlier pages when a later page fetch fails", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        makeFetchResponse({
          data: [makeMediaItem("p1")],
          paging: {
            next: "https://graph.instagram.com/me/media?after=cursor1",
          },
        }),
      )
      .mockResolvedValueOnce(makeFetchResponse({}, false, 429));

    const result = await fetchInstagramMedia("access-token");

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(result.data.map((item) => item.id)).toEqual(["p1"]);
  });

  it("throws when the first page fails even after retriable pages", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeFetchResponse({}, false, 429));

    await expect(fetchInstagramMedia("access-token")).rejects.toThrow();
  });

  it("deduplicates items that repeat across pages by id", async () => {
    // A media item can appear on two pages when the account changes mid-walk;
    // the aggregated result must contain one entry per id.
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        makeFetchResponse({
          data: [makeMediaItem("dup"), makeMediaItem("p1")],
          paging: {
            next: "https://graph.instagram.com/me/media?after=cursor1",
          },
        }),
      )
      .mockResolvedValueOnce(
        makeFetchResponse({
          data: [makeMediaItem("dup"), makeMediaItem("p2")],
        }),
      );

    const result = await fetchInstagramMedia("access-token");

    expect(result.data.map((item) => item.id)).toEqual(["dup", "p1", "p2"]);
  });

  it("tolerates a page whose body omits the data array", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        makeFetchResponse({
          data: [makeMediaItem("a")],
          paging: {
            next: "https://graph.instagram.com/me/media?after=cursor1",
          },
        }),
      )
      .mockResolvedValueOnce(makeFetchResponse({ paging: {} }));

    const result = await fetchInstagramMedia("access-token");

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(result.data.map((item) => item.id)).toEqual(["a"]);
  });
});

describe("filterGeotaggedMedia", () => {
  it("returns only IMAGE items with a location that has coordinates", () => {
    const items: InstagramMediaItem[] = [
      {
        id: "1",
        media_type: "IMAGE",
        media_url: "https://cdn.ig.com/1.jpg",
        timestamp: "2024-01-01T00:00:00Z",
        permalink: "https://ig.com/1",
        location: { name: "Paris", latitude: 48.8566, longitude: 2.3522 },
      },
      {
        id: "2",
        media_type: "IMAGE",
        media_url: "https://cdn.ig.com/2.jpg",
        timestamp: "2024-01-02T00:00:00Z",
        permalink: "https://ig.com/2",
        // No location — should be filtered out.
      },
      {
        id: "3",
        media_type: "VIDEO",
        media_url: "https://cdn.ig.com/3.mp4",
        timestamp: "2024-01-03T00:00:00Z",
        permalink: "https://ig.com/3",
        location: { name: "Rome", latitude: 41.9028, longitude: 12.4964 },
        // VIDEO type — should be filtered out.
      },
    ];

    const result = filterGeotaggedMedia(items);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("1");
  });

  it("returns an empty array when no items have a location", () => {
    const items: InstagramMediaItem[] = [
      {
        id: "1",
        media_type: "IMAGE",
        media_url: "https://cdn.ig.com/1.jpg",
        timestamp: "2024-01-01T00:00:00Z",
        permalink: "https://ig.com/1",
      },
    ];
    expect(filterGeotaggedMedia(items)).toHaveLength(0);
  });

  it("includes CAROUSEL_ALBUM items that have a location with lat/lon", () => {
    const items: InstagramMediaItem[] = [
      {
        id: "1",
        media_type: "CAROUSEL_ALBUM",
        media_url: "https://cdn.ig.com/carousel.jpg",
        timestamp: "2024-01-01T00:00:00Z",
        permalink: "https://ig.com/1",
        location: { name: "Tokyo", latitude: 35.6762, longitude: 139.6503 },
      },
    ];
    expect(filterGeotaggedMedia(items)).toHaveLength(1);
  });

  it("excludes items whose location has coordinates but an empty name", () => {
    const items: InstagramMediaItem[] = [
      {
        id: "1",
        media_type: "IMAGE",
        media_url: "https://cdn.ig.com/1.jpg",
        timestamp: "2024-01-01T00:00:00Z",
        permalink: "https://ig.com/1",
        location: { name: "", latitude: 48.8566, longitude: 2.3522 },
      },
    ];
    expect(filterGeotaggedMedia(items)).toHaveLength(0);
  });

  it("excludes items whose location name is not a string", () => {
    const items = [
      {
        id: "1",
        media_type: "IMAGE",
        media_url: "https://cdn.ig.com/1.jpg",
        timestamp: "2024-01-01T00:00:00Z",
        permalink: "https://ig.com/1",
        location: { name: null, latitude: 48.8566, longitude: 2.3522 },
      },
    ] as unknown as InstagramMediaItem[];
    expect(filterGeotaggedMedia(items)).toHaveLength(0);
  });
});
