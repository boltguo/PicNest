import { create } from "zustand";
import { persist } from "zustand/middleware";

/** File sort orders offered in the toolbar. */
export const SORT_KEYS = [
  "newest",
  "oldest",
  "nameAsc",
  "nameDesc",
  "largest",
  "smallest",
] as const;

export type SortKey = (typeof SORT_KEYS)[number];

interface PrefsState {
  sort: SortKey;
  linkFormat: "url" | "markdown" | "html";
  setLinkFormat: (linkFormat: "url" | "markdown" | "html") => void;
  setSort: (sort: SortKey) => void;
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      sort: "newest",
      linkFormat: "url",
      setLinkFormat: (linkFormat) => set({ linkFormat }),
      setSort: (sort) => set({ sort }),
    }),
    { name: "picnest-prefs" },
  ),
);
