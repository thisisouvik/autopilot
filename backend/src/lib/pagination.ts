// @ts-nocheck
export interface PaginationQuery {
  cursor?: string;
  page?: string | number;
  limit?: string | number;
}

export interface DateRangeQuery {
  from?: string;
  to?: string;
}

interface CursorValue {
  createdAt: string;
  id: string;
}

export type ParsedPagination =
  | {
      ok: true;
      limit: number;
      page: number;
      offset: number;
      cursor: CursorValue | null;
    }
  | { ok: false; error: string };

export interface PaginationMeta {
  limit: number;
  page: number;
  hasMore: boolean;
  nextCursor: string | null;
}

function parsePositiveInteger(value: string | number | undefined, fallback: number) {
  if (value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function decodeCursor(value: string): CursorValue | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (
      typeof parsed?.id !== "string" ||
      !uuidPattern.test(parsed.id) ||
      typeof parsed?.createdAt !== "string" ||
      Number.isNaN(Date.parse(parsed.createdAt))
    ) {
      return null;
    }
    return { id: parsed.id, createdAt: parsed.createdAt };
  } catch {
    return null;
  }
}

export function parsePagination(
  query: PaginationQuery,
  options: { defaultLimit?: number; maxLimit?: number } = {},
): ParsedPagination {
  const defaultLimit = options.defaultLimit ?? 20;
  const maxLimit = options.maxLimit ?? 100;
  const requestedLimit = parsePositiveInteger(query.limit, defaultLimit);
  const page = parsePositiveInteger(query.page, 1);

  if (requestedLimit === null || requestedLimit > maxLimit) {
    return { ok: false, error: `limit must be an integer between 1 and ${maxLimit}` };
  }
  if (page === null) {
    return { ok: false, error: "page must be a positive integer" };
  }

  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (query.cursor && !cursor) {
    return { ok: false, error: "cursor is invalid" };
  }

  return {
    ok: true,
    limit: requestedLimit,
    page,
    offset: cursor ? 0 : (page - 1) * requestedLimit,
    cursor,
  };
}

export function buildPage<T extends { id: unknown; createdAt: unknown }>(
  rows: T[],
  pagination: Extract<ParsedPagination, { ok: true }>,
): { items: T[]; pagination: PaginationMeta } {
  const hasMore = rows.length > pagination.limit;
  const items = hasMore ? rows.slice(0, pagination.limit) : rows;
  const last = items.at(-1);
  const nextCursor = hasMore && last
    ? Buffer.from(
        JSON.stringify({
          id: String(last.id),
          createdAt: new Date(last.createdAt as string | number | Date).toISOString(),
        }),
      ).toString("base64url")
    : null;

  return {
    items,
    pagination: {
      limit: pagination.limit,
      page: pagination.page,
      hasMore,
      nextCursor,
    },
  };
}

export function readConfiguredLimit(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function parseDateRange(query: DateRangeQuery):
  | { ok: true; from: string | null; to: string | null }
  | { ok: false; error: string } {
  const from = query.from ? new Date(query.from) : null;
  const to = query.to ? new Date(query.to) : null;

  if (from && Number.isNaN(from.getTime())) {
    return { ok: false, error: "from must be a valid ISO-8601 date" };
  }
  if (to && Number.isNaN(to.getTime())) {
    return { ok: false, error: "to must be a valid ISO-8601 date" };
  }
  if (from && to && from > to) {
    return { ok: false, error: "from must be earlier than or equal to to" };
  }

  return {
    ok: true,
    from: from?.toISOString() ?? null,
    to: to?.toISOString() ?? null,
  };
}
