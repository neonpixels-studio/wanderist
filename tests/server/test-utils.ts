import { vi } from "vitest";

/**
 * Stubs the Nitro auto-imports `defineEventHandler` and `createError` so
 * server handler modules can be imported and tested outside the Nuxt runtime.
 *
 * Call this at the top of each server handler test file — before any imports
 * that depend on these globals.
 */
export function stubNitroGlobals() {
  vi.stubGlobal(
    "defineEventHandler",
    (handler: (event: unknown) => unknown) => handler,
  );
  vi.stubGlobal(
    "createError",
    (options: { statusCode: number; statusMessage: string }) => {
      const error = new Error(options.statusMessage) as Error & {
        statusCode: number;
        statusMessage: string;
      };
      error.statusCode = options.statusCode;
      error.statusMessage = options.statusMessage;
      return error;
    },
  );
  vi.stubGlobal(
    "getQuery",
    (event: { query?: Record<string, unknown> } | undefined) =>
      event?.query ?? {},
  );
}
