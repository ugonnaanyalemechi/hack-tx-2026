"use client";

/**
 * Identity for the role switcher. There is no login: the caller is a
 * seeded user, named in the identity header on every API request. Picking
 * a role in the switcher picks the first seeded user with that role and
 * rebinds the API client, so every screen refetches as that user.
 *
 * The choice is kept in localStorage so it survives reloads and tabs.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Role, UserPublic } from "@/lib/contracts/api";
import { ApiError, type ApiClient } from "@/lib/api/client";
import {
  API_BASE_URL,
  IDENTITY_HEADER_NAME,
  resolveApiMode,
  type ApiMode,
} from "@/lib/api/config";
import { createLiveClient } from "@/lib/api/live";
import { createMockClient, type MockScenario } from "@/lib/api/mock";

export const ROLES: { role: Role; label: string }[] = [
  { role: "admin", label: "Admin" },
  { role: "builder", label: "Builder" },
  { role: "end_user", label: "End user" },
];

/** Least privilege until someone picks a role. */
const DEFAULT_ROLE: Role = "end_user";
const STORAGE_KEY = "foundry.identity";
const CHANGE_EVENT = "foundry:identity-change";

interface StoredIdentity {
  userId: string;
  role: Role;
}

/** Used when localStorage is blocked, so a choice still lasts for the page. */
let memoryStored: string | null = null;

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return memoryStored;
  }
}

function writeStored(value: string) {
  memoryStored = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Blocked storage: readStored falls back to memoryStored.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function parseStored(raw: string | null): StoredIdentity | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredIdentity>;
    if (typeof value.userId === "string" && typeof value.role === "string") {
      return { userId: value.userId, role: value.role };
    }
  } catch {
    // Ignore a corrupt value and fall back to the default role.
  }
  return null;
}

function mockScenario(): MockScenario {
  const value = new URLSearchParams(window.location.search).get("mock");
  return value === "loading" || value === "empty" || value === "error" ? value : null;
}

function makeClient(mode: ApiMode, userId: string | null): ApiClient {
  return mode === "live"
    ? createLiveClient({
        baseUrl: API_BASE_URL,
        identityHeaderName: IDENTITY_HEADER_NAME,
        userId,
      })
    : createMockClient({ userId, getScenario: mockScenario });
}

export type UsersState =
  | { status: "loading" }
  | { status: "error"; error: ApiError }
  | { status: "ready"; users: UserPublic[] };

interface IdentityContextValue {
  users: UsersState;
  /** The selected role, known straight away from storage. */
  role: Role;
  /** The seeded user acting now; null until the users list loads. */
  currentUser: UserPublic | null;
  selectRole: (role: Role) => void;
  retryUsers: () => void;
  /** Client bound to `currentUser`; null until it is known. */
  api: ApiClient | null;
}

const USERS_LOADING: UsersState = { status: "loading" };

const IdentityContext = createContext<IdentityContextValue | null>(null);

function toApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError(0, { code: "unexpected_error", message: String(error) });
}

export function IdentityProvider({ children }: { children: ReactNode }) {
  // Resolved on the client during hydration; the server value is never used
  // because every request is made from an effect.
  const [mode] = useState<ApiMode>(resolveApiMode);
  const raw = useSyncExternalStore(subscribe, readStored, () => null);
  const stored = useMemo(() => parseStored(raw), [raw]);

  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; state: UsersState } | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    makeClient(mode, null)
      .listUsers()
      .then(
        (users) => {
          if (!cancelled) setResult({ attempt, state: { status: "ready", users } });
        },
        (error: unknown) => {
          if (!cancelled) {
            setResult({ attempt, state: { status: "error", error: toApiError(error) } });
          }
        }
      );
    return () => {
      cancelled = true;
    };
  }, [mode, attempt]);

  const users: UsersState =
    result && result.attempt === attempt ? result.state : USERS_LOADING;
  const list = users.status === "ready" ? users.users : null;

  const currentUser = useMemo(() => {
    if (!list) return null;
    return (
      list.find((u) => u.id === stored?.userId) ??
      list.find((u) => u.role === (stored?.role ?? DEFAULT_ROLE)) ??
      list.find((u) => u.role === DEFAULT_ROLE) ??
      list[0] ??
      null
    );
  }, [list, stored]);

  const role: Role = (currentUser?.role as Role | undefined) ?? stored?.role ?? DEFAULT_ROLE;
  const currentUserId = currentUser?.id ?? null;
  const api = useMemo(
    () => (currentUserId ? makeClient(mode, currentUserId) : null),
    [mode, currentUserId]
  );

  const selectRole = useCallback(
    (next: Role) => {
      const user = list?.find((u) => u.role === next);
      if (!user) return;
      writeStored(JSON.stringify({ userId: user.id, role: next } satisfies StoredIdentity));
    },
    [list]
  );

  const retryUsers = useCallback(() => setAttempt((n) => n + 1), []);

  const value = useMemo<IdentityContextValue>(
    () => ({ users, role, currentUser, selectRole, retryUsers, api }),
    [users, role, currentUser, selectRole, retryUsers, api]
  );

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity(): IdentityContextValue {
  const value = useContext(IdentityContext);
  if (!value) throw new Error("useIdentity must be used inside <IdentityProvider>");
  return value;
}

/** Whether a role may open the admin views (run log, usage). */
export function canOpenAdmin(role: Role): boolean {
  return role === "admin" || role === "builder";
}
