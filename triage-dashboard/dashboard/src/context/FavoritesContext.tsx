import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import type { GitHubIssue, GitHubPullRequest } from "../types";

export type FavoriteItem = (GitHubIssue | GitHubPullRequest) & { _kind: "issue" | "pr" };

interface FavoritesContextValue {
  favorites: FavoriteItem[];
  addFavorite: (item: FavoriteItem) => void;
  removeFavorite: (kind: "issue" | "pr", number: number) => void;
  toggleFavorite: (item: FavoriteItem) => void;
  isFavorite: (kind: "issue" | "pr", number: number) => boolean;
  clearFavorites: () => void;
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

const STORAGE_KEY = "mastra-triage-favorites";

function loadFavorites(): FavoriteItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // corrupted storage
  }
  return [];
}

function saveFavorites(items: FavoriteItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<FavoriteItem[]>(loadFavorites);

  useEffect(() => {
    saveFavorites(favorites);
  }, [favorites]);

  const addFavorite = useCallback((item: FavoriteItem) => {
    setFavorites((prev) => {
      if (prev.some((f) => f._kind === item._kind && f.number === item.number)) return prev;
      return [...prev, item];
    });
  }, []);

  const removeFavorite = useCallback((kind: "issue" | "pr", number: number) => {
    setFavorites((prev) => prev.filter((f) => !(f._kind === kind && f.number === number)));
  }, []);

  const toggleFavorite = useCallback((item: FavoriteItem) => {
    setFavorites((prev) => {
      const exists = prev.some((f) => f._kind === item._kind && f.number === item.number);
      if (exists) return prev.filter((f) => !(f._kind === item._kind && f.number === item.number));
      return [...prev, item];
    });
  }, []);

  const isFavorite = useCallback(
    (kind: "issue" | "pr", number: number) => {
      return favorites.some((f) => f._kind === kind && f.number === number);
    },
    [favorites]
  );

  const clearFavorites = useCallback(() => {
    setFavorites([]);
  }, []);

  return (
    <FavoritesContext.Provider value={{ favorites, addFavorite, removeFavorite, toggleFavorite, isFavorite, clearFavorites }}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites(): FavoritesContextValue {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error("useFavorites must be used within FavoritesProvider");
  return ctx;
}
