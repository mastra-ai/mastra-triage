import { useState, useEffect, useCallback } from "react";
import type {
  GitHubIssue,
  GitHubPullRequest,
  FetchMetadata,
  AnalysisResult,
  TriageResult,
} from "../types";

interface TriageData {
  issues: GitHubIssue[];
  pullRequests: GitHubPullRequest[];
  metadata: FetchMetadata | null;
  analysis: AnalysisResult | null;
  triage: TriageResult | null;
  loading: boolean;
  error: string | null;
}

export interface TriageDataWithActions extends TriageData {
  setHidden: (kind: "issue" | "pr", number: number, hidden: boolean) => Promise<void>;
}

export function useTriageData(): TriageDataWithActions {
  const [data, setData] = useState<TriageData>({
    issues: [],
    pullRequests: [],
    metadata: null,
    analysis: null,
    triage: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    async function load() {
      try {
        const [issuesRes, prsRes, metaRes] = await Promise.all([
          fetch("/data/issues.json"),
          fetch("/data/pull-requests.json"),
          fetch("/data/metadata.json"),
        ]);

        if (!issuesRes.ok || !prsRes.ok) {
          throw new Error(
            "Data files not found. Run `npm run fetch` first to pull GitHub data."
          );
        }

        const [issues, pullRequests, metadata] = await Promise.all([
          issuesRes.json() as Promise<GitHubIssue[]>,
          prsRes.json() as Promise<GitHubPullRequest[]>,
          metaRes.json() as Promise<FetchMetadata>,
        ]);

        // Try to load analysis and triage (optional)
        let analysis: AnalysisResult | null = null;
        let triage: TriageResult | null = null;
        try {
          const analysisRes = await fetch("/data/analysis.json");
          if (analysisRes.ok) {
            analysis = await analysisRes.json();
          }
        } catch {
          // Analysis not available yet
        }
        try {
          const triageRes = await fetch("/data/triage.json");
          if (triageRes.ok) {
            triage = await triageRes.json();
          }
        } catch {
          // Triage not available yet
        }

        setData({
          issues,
          pullRequests,
          metadata,
          analysis,
          triage,
          loading: false,
          error: null,
        });
      } catch (err) {
        setData((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load data",
        }));
      }
    }
    load();
  }, []);

  const setHidden = useCallback(
    async (kind: "issue" | "pr", number: number, hidden: boolean) => {
      setData((prev) => {
        if (kind === "issue") {
          return {
            ...prev,
            issues: prev.issues.map((i) =>
              i.number === number ? { ...i, hidden: hidden || undefined } : i
            ),
          };
        }
        return {
          ...prev,
          pullRequests: prev.pullRequests.map((p) =>
            p.number === number ? { ...p, hidden: hidden || undefined } : p
          ),
        };
      });

      try {
        const res = await fetch("/api/hide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, number, hidden }),
        });
        if (!res.ok) throw new Error(`Hide API returned ${res.status}`);
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "Hide API failed");
      } catch (err) {
        // Revert on failure
        setData((prev) => {
          if (kind === "issue") {
            return {
              ...prev,
              issues: prev.issues.map((i) =>
                i.number === number ? { ...i, hidden: !hidden || undefined } : i
              ),
            };
          }
          return {
            ...prev,
            pullRequests: prev.pullRequests.map((p) =>
              p.number === number ? { ...p, hidden: !hidden || undefined } : p
            ),
          };
        });
        console.error("Failed to persist hide state:", err);
      }
    },
    []
  );

  return { ...data, setHidden };
}
