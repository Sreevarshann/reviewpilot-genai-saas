"use client";

import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "./api";

/** Current user, or null when signed out (401). */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.me();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export const ROLE_RANK = { VIEWER: 0, REVIEWER: 1, ADMIN: 2, OWNER: 3 } as const;
export const atLeast = (role: keyof typeof ROLE_RANK | undefined, min: keyof typeof ROLE_RANK) => role !== undefined && ROLE_RANK[role] >= ROLE_RANK[min];
