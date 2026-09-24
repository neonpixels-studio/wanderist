import { describe, it, expect, vi, beforeEach } from "vitest";
import type { H3Event } from "h3";
import { stubNitroGlobals } from "../test-utils";

stubNitroGlobals();

// getHeader is a Nitro auto-import; stub it to read from the fake event's
// headers map so the middleware's bearer-token extraction works under test.
vi.stubGlobal("getHeader", (event: FakeEvent, name: string) => {
  return event.headers[name.toLowerCase()];
});

vi.mock("../../../server/utils/clerk", () => ({
  requireClerkSecretKey: vi.fn(() => "sk-test"),
  verifyClerkToken: vi.fn(),
}));

import { verifyClerkToken } from "../../../server/utils/clerk";

const mockVerifyClerkToken = vi.mocked(verifyClerkToken);

const middleware = await import("../../../server/middleware/auth");

type FakeEvent = {
  path: string;
  method: string;
  headers: Record<string, string>;
  context: { userId?: string };
};

function makeEvent(overrides: Partial<FakeEvent>): FakeEvent {
  return {
    path: "/api/guides/guide-1",
    method: "GET",
    headers: {},
    context: {},
    ...overrides,
  };
}

function runMiddleware(event: FakeEvent) {
  return (middleware.default as (event: unknown) => Promise<void>)(
    event as unknown as H3Event,
  );
}

const RESOLVED_USER = "user-123";

describe("auth middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets an anonymous GET on a single guide through without verifying a token", async () => {
    const event = makeEvent({ headers: {} });

    await runMiddleware(event);

    expect(event.context.userId).toBeUndefined();
    expect(mockVerifyClerkToken).not.toHaveBeenCalled();
  });

  it("identifies the owner on a single-guide GET when a valid token is present", async () => {
    mockVerifyClerkToken.mockResolvedValue(RESOLVED_USER);
    const event = makeEvent({ headers: { authorization: "Bearer good" } });

    await runMiddleware(event);

    expect(event.context.userId).toBe(RESOLVED_USER);
  });

  it("rejects a present-but-invalid token on a single-guide GET with 401 (not anonymous)", async () => {
    // A caller that sends a token believes it has a session; a bad token is an
    // error, so it must 401 rather than silently downgrade to anonymous.
    mockVerifyClerkToken.mockRejectedValue(new Error("bad token"));
    const event = makeEvent({ headers: { authorization: "Bearer bad" } });

    await expect(runMiddleware(event)).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(event.context.userId).toBeUndefined();
  });

  it("still requires a token on the owner-only guides collection", async () => {
    const event = makeEvent({ path: "/api/guides", headers: {} });

    await expect(runMiddleware(event)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("still requires a token on a guide sub-resource like /like", async () => {
    const event = makeEvent({
      path: "/api/guides/guide-1/like",
      method: "POST",
      headers: {},
    });

    await expect(runMiddleware(event)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("still requires a token for a non-GET method on a single guide", async () => {
    const event = makeEvent({ method: "PATCH", headers: {} });

    await expect(runMiddleware(event)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("lets an anonymous GET on a single trip through without verifying a token", async () => {
    const event = makeEvent({ path: "/api/trips/trip-1", headers: {} });

    await runMiddleware(event);

    expect(event.context.userId).toBeUndefined();
    expect(mockVerifyClerkToken).not.toHaveBeenCalled();
  });

  it("identifies the owner on a single-trip GET when a valid token is present", async () => {
    mockVerifyClerkToken.mockResolvedValue(RESOLVED_USER);
    const event = makeEvent({
      path: "/api/trips/trip-1",
      headers: { authorization: "Bearer good" },
    });

    await runMiddleware(event);

    expect(event.context.userId).toBe(RESOLVED_USER);
  });

  it("rejects a present-but-invalid token on a single-trip GET with 401", async () => {
    mockVerifyClerkToken.mockRejectedValue(new Error("bad token"));
    const event = makeEvent({
      path: "/api/trips/trip-1",
      headers: { authorization: "Bearer bad" },
    });

    await expect(runMiddleware(event)).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(event.context.userId).toBeUndefined();
  });

  it("still requires a token on the owner-only trips collection", async () => {
    const event = makeEvent({ path: "/api/trips", headers: {} });

    await expect(runMiddleware(event)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("still requires a token on a trip sub-resource like /stops", async () => {
    const event = makeEvent({
      path: "/api/trips/trip-1/stops",
      method: "POST",
      headers: {},
    });

    await expect(runMiddleware(event)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("still requires a token for a non-GET method on a single trip", async () => {
    const event = makeEvent({
      path: "/api/trips/trip-1",
      method: "PATCH",
      headers: {},
    });

    await expect(runMiddleware(event)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("matches the optional-auth trip route even with a trailing slash", async () => {
    const event = makeEvent({ path: "/api/trips/trip-1/", headers: {} });

    await runMiddleware(event);

    expect(event.context.userId).toBeUndefined();
    expect(mockVerifyClerkToken).not.toHaveBeenCalled();
  });

  it("matches the optional-auth route even with a query string", async () => {
    const event = makeEvent({
      path: "/api/guides/guide-1?foo=bar",
      headers: {},
    });

    await runMiddleware(event);

    expect(event.context.userId).toBeUndefined();
    expect(mockVerifyClerkToken).not.toHaveBeenCalled();
  });

  it("matches the optional-auth route even with a trailing slash", async () => {
    const event = makeEvent({ path: "/api/guides/guide-1/", headers: {} });

    await runMiddleware(event);

    expect(event.context.userId).toBeUndefined();
    expect(mockVerifyClerkToken).not.toHaveBeenCalled();
  });

  // #279: a shared profile link must open for an anonymous visitor so its
  // og/twitter meta can unfurl. Mirrors the single-guide/single-trip coverage
  // above — this is the regression the code review for #279 caught: the route
  // handler alone (requireViewableProfile) is unreachable by an anonymous
  // request unless this middleware also lets it through.
  it("lets an anonymous GET on a single profile through without verifying a token", async () => {
    const event = makeEvent({ path: "/api/users/user-1", headers: {} });

    await runMiddleware(event);

    expect(event.context.userId).toBeUndefined();
    expect(mockVerifyClerkToken).not.toHaveBeenCalled();
  });

  it("identifies the viewer on a single-profile GET when a valid token is present", async () => {
    mockVerifyClerkToken.mockResolvedValue(RESOLVED_USER);
    const event = makeEvent({
      path: "/api/users/user-1",
      headers: { authorization: "Bearer good" },
    });

    await runMiddleware(event);

    expect(event.context.userId).toBe(RESOLVED_USER);
  });

  it("rejects a present-but-invalid token on a single-profile GET with 401", async () => {
    mockVerifyClerkToken.mockRejectedValue(new Error("bad token"));
    const event = makeEvent({
      path: "/api/users/user-1",
      headers: { authorization: "Bearer bad" },
    });

    await expect(runMiddleware(event)).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(event.context.userId).toBeUndefined();
  });

  it("still requires a token for a non-GET method on a single profile", async () => {
    const event = makeEvent({
      path: "/api/users/user-1",
      method: "PATCH",
      headers: {},
    });

    await expect(runMiddleware(event)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it.each(["followers", "following", "trips", "guides"])(
    "lets an anonymous GET on the /%s profile sub-resource through without verifying a token",
    async (subResource) => {
      const event = makeEvent({
        path: `/api/users/user-1/${subResource}`,
        headers: {},
      });

      await runMiddleware(event);

      expect(event.context.userId).toBeUndefined();
      expect(mockVerifyClerkToken).not.toHaveBeenCalled();
    },
  );

  it("still requires a token on an unrecognized profile sub-resource", async () => {
    const event = makeEvent({
      path: "/api/users/user-1/settings",
      headers: {},
    });

    await expect(runMiddleware(event)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("still requires a token for a non-GET method on a profile sub-resource", async () => {
    const event = makeEvent({
      path: "/api/users/user-1/followers",
      method: "POST",
      headers: {},
    });

    await expect(runMiddleware(event)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("matches the optional-auth profile route even with a trailing slash and a query string", async () => {
    const event = makeEvent({
      path: "/api/users/user-1/followers/?foo=bar",
      headers: {},
    });

    await runMiddleware(event);

    expect(event.context.userId).toBeUndefined();
    expect(mockVerifyClerkToken).not.toHaveBeenCalled();
  });
});
