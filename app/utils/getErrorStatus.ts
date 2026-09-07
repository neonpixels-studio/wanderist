/**
 * Reads an HTTP status code off a thrown fetch error, regardless of which
 * shape carries it.
 *
 * ofetch's FetchError exposes statusCode, but this stays defensive about
 * wrappers that only preserve response.status or a nested data.statusCode.
 * Shared by isNotFoundError and isUnauthorizedError so both predicates agree
 * on how a status is extracted.
 */
export function getErrorStatus(error: unknown): number | undefined {
  const candidate = error as {
    statusCode?: number;
    response?: { status?: number };
    data?: { statusCode?: number };
  };
  return (
    candidate?.statusCode ??
    candidate?.response?.status ??
    candidate?.data?.statusCode
  );
}
