"use client";

/**
 * Data loading for screens: runs `load` with the identity-bound API client
 * and reports loading / error / ready. It reloads whenever the role
 * switcher changes the user or `key` changes, and `retry()` reloads on
 * demand. Pass `key = null` to hold off loading.
 *
 * Results are tagged with the client and key they were loaded for, so a
 * stale response (from a previous role or key) is never shown.
 */

import { useCallback, useEffect, useEffectEvent, useState } from "react";
import type { Page } from "@/lib/contracts/api";
import { ApiError, type ApiClient } from "@/lib/api/client";
import { useIdentity } from "@/lib/identity";

export type QueryState<T> =
  | { status: "loading" }
  | { status: "error"; error: ApiError }
  | { status: "ready"; data: T };

type Tagged<T> = { api: ApiClient; requestKey: string; state: QueryState<T> };

const LOADING = { status: "loading" } as const;

function toApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError(0, { code: "unexpected_error", message: String(error) });
}

export function useApiQuery<T>(
  key: string | null,
  load: (api: ApiClient) => Promise<T>
): QueryState<T> & { retry: () => void } {
  const { api, users, retryUsers } = useIdentity();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Tagged<T> | null>(null);
  const requestKey = key === null ? null : `${key}#${attempt}`;
  const run = useEffectEvent(load);

  useEffect(() => {
    if (!api || requestKey === null) return;
    let cancelled = false;
    run(api).then(
      (data) => {
        if (!cancelled) setResult({ api, requestKey, state: { status: "ready", data } });
      },
      (error: unknown) => {
        if (!cancelled) {
          setResult({ api, requestKey, state: { status: "error", error: toApiError(error) } });
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [api, requestKey]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (users.status === "error") {
    return { status: "error", error: users.error, retry: retryUsers };
  }
  const state =
    result && result.api === api && result.requestKey === requestKey ? result.state : LOADING;
  return { ...state, retry } as QueryState<T> & { retry: () => void };
}

export interface PagedQuery<T> {
  state: QueryState<T[]>;
  retry: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: ApiError | null;
  loadMore: () => void;
}

/** `useApiQuery` for a cursor-paged list, with "load more". */
export function usePagedQuery<T>(
  key: string | null,
  loadPage: (api: ApiClient, cursor: string | null) => Promise<Page<T>>
): PagedQuery<T> {
  const { api } = useIdentity();
  const first = useApiQuery(key, (client) => loadPage(client, null));
  const firstPage = first.status === "ready" ? first.data : null;

  // Pages after the first, tied to the first page they continue.
  const [more, setMore] = useState<{ base: Page<T>; pages: Page<T>[] } | null>(null);
  const [pending, setPending] = useState<{ base: Page<T>; error: ApiError | null } | null>(
    null
  );
  const extra = more && more.base === firstPage ? more.pages : [];
  const status = pending && pending.base === firstPage ? pending : null;

  const last = extra.length > 0 ? extra[extra.length - 1] : firstPage;
  const nextCursor = last?.next_cursor ?? null;

  const loadMore = useCallback(() => {
    if (!api || !firstPage || !nextCursor) return;
    const base = firstPage;
    setPending({ base, error: null });
    loadPage(api, nextCursor).then(
      (page) => {
        setMore((prev) => ({
          base,
          pages: [...(prev && prev.base === base ? prev.pages : []), page],
        }));
        setPending(null);
      },
      (error: unknown) => setPending({ base, error: toApiError(error) })
    );
  }, [api, firstPage, nextCursor, loadPage]);

  const state: QueryState<T[]> =
    first.status === "ready"
      ? { status: "ready", data: [first.data, ...extra].flatMap((p) => p.items) }
      : first;

  return {
    state,
    retry: first.retry,
    hasMore: nextCursor !== null,
    loadingMore: status !== null && status.error === null,
    loadMoreError: status?.error ?? null,
    loadMore,
  };
}
