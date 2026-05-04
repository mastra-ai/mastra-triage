import { useFavorites } from "../context/FavoritesContext";

interface Props {
  onOpen: () => void;
}

export function FavoritesBar({ onOpen }: Props) {
  const { favorites } = useFavorites();

  if (favorites.length === 0) return null;

  const issueCount = favorites.filter((f) => f._kind === "issue").length;
  const prCount = favorites.filter((f) => f._kind === "pr").length;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
      <button
        onClick={onOpen}
        className="flex items-center gap-3 px-5 py-3 bg-[#161b22] border border-[#30363d] rounded-full shadow-2xl shadow-black/50 hover:border-[#58a6ff] hover:bg-[#1c2129] transition-all group"
      >
        <div className="flex items-center gap-1.5">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="#58a6ff" stroke="none">
            <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
          </svg>
          <span className="text-sm font-semibold text-[#e6edf3]">
            {favorites.length} Favorite{favorites.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="h-4 w-px bg-[#30363d]" />
        <div className="flex items-center gap-2 text-xs text-[#8b949e]">
          {issueCount > 0 && (
            <span className="flex items-center gap-1">
              <span className="text-[#3fb950]">●</span> {issueCount} issue{issueCount !== 1 ? "s" : ""}
            </span>
          )}
          {prCount > 0 && (
            <span className="flex items-center gap-1">
              <span className="text-[#58a6ff]">↗</span> {prCount} PR{prCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="h-4 w-px bg-[#30363d]" />
        <span className="text-xs text-[#58a6ff] group-hover:text-[#79c0ff] transition-colors">
          Open
        </span>
      </button>
    </div>
  );
}
