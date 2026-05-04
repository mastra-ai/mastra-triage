import { useState, useRef, useEffect } from "react";
import { useFavorites, type FavoriteItem } from "../context/FavoritesContext";
import type { GitHubPullRequest } from "../types";
import { computeStaleness, getCommentCount, getReactionCount } from "../utils";

interface Props {
  onClose: () => void;
}

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

function buildItemContext(items: FavoriteItem[]): string {
  return items
    .map((item) => {
      const kind = item._kind === "pr" ? "Pull Request" : "Issue";
      const pr = item._kind === "pr" ? (item as GitHubPullRequest) : null;
      const staleness = computeStaleness(item);
      const comments = getCommentCount(item);
      const reactions = getReactionCount(item);

      let ctx = `## ${kind} #${item.number}: ${item.title}\n`;
      ctx += `- **Author**: @${item.author.login}\n`;
      ctx += `- **State**: ${item.state}\n`;
      ctx += `- **Created**: ${item.createdAt}\n`;
      ctx += `- **Updated**: ${item.updatedAt}\n`;
      ctx += `- **Staleness**: ${staleness}/100\n`;
      ctx += `- **Comments**: ${comments}\n`;
      ctx += `- **Reactions**: ${reactions}\n`;
      ctx += `- **Labels**: ${item.labels.map((l) => l.name).join(", ") || "none"}\n`;
      ctx += `- **Assignees**: ${item.assignees.map((a) => `@${a.login}`).join(", ") || "none"}\n`;
      if (pr) {
        ctx += `- **Branch**: ${pr.headRefName} → ${pr.baseRefName}\n`;
        ctx += `- **Changes**: +${pr.additions} -${pr.deletions} (${pr.changedFiles} files)\n`;
        ctx += `- **Review**: ${pr.reviewDecision || "Pending"}\n`;
        ctx += `- **Mergeable**: ${pr.mergeable || "Unknown"}\n`;
        ctx += `- **Draft**: ${pr.isDraft ? "Yes" : "No"}\n`;
      }
      ctx += `- **URL**: ${item.url}\n`;
      ctx += `\n### Description\n${item.body || "No description."}\n`;

      if (item.comments && item.comments.length > 0) {
        ctx += `\n### Comments\n`;
        for (const c of item.comments.slice(0, 10)) {
          ctx += `- **@${c.author?.login || "unknown"}** (${c.createdAt}): ${c.body?.slice(0, 300)}\n`;
        }
      }

      return ctx;
    })
    .join("\n---\n\n");
}

const SUGGESTED_PROMPTS = [
  "Summarize these items and identify the most urgent ones",
  "What themes or patterns do you see across these issues/PRs?",
  "Which items should we prioritize in the next sprint and why?",
  "Draft a team update summarizing the status of these items",
  "Identify any items that might be related or duplicates",
  "What are the potential risks or blockers across these items?",
];

export function AIChatPanel({ onClose }: Props) {
  const { favorites } = useFavorites();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("mastra-openai-api-key") || "");
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const saveApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem("mastra-openai-api-key", key);
    setShowApiKeyInput(false);
  };

  const sendMessage = async (content: string) => {
    if (!content.trim()) return;
    if (!apiKey) {
      setShowApiKeyInput(true);
      return;
    }

    const userMsg: ChatMessage = { role: "user", content: content.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const systemPrompt = `You are a helpful assistant analyzing GitHub issues and pull requests for the Mastra open-source project. You are helping a developer triage and understand these items. Be concise, actionable, and insightful. Format your responses with markdown.\n\nHere are the items being discussed:\n\n${buildItemContext(favorites)}`;

      const apiMessages = [
        { role: "system" as const, content: systemPrompt },
        ...newMessages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      ];

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o",
          max_tokens: 4096,
          messages: apiMessages,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `API error: ${response.status}`);
      }

      const data = await response.json();
      const assistantContent = data.choices?.[0]?.message?.content || "No response received.";
      setMessages([...newMessages, { role: "assistant", content: assistantContent }]);
    } catch (err) {
      setMessages([
        ...newMessages,
        { role: "assistant", content: `Error: ${err instanceof Error ? err.message : "Failed to get response"}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="w-[900px] max-w-full bg-[#0d1117] border-l border-[#30363d] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#30363d] bg-[#161b22]">
          <div className="flex items-center gap-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#bc8cff" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <div>
              <h2 className="text-lg font-semibold text-white">AI Analysis</h2>
              <p className="text-xs text-[#8b949e]">
                Analyzing {favorites.length} favorited item{favorites.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowApiKeyInput(!showApiKeyInput)}
              className={`text-xs px-2 py-1 rounded border transition-colors ${
                apiKey
                  ? "border-[#238636] text-[#3fb950] hover:bg-[#23863611]"
                  : "border-[#f85149] text-[#f85149] hover:bg-[#f8514911]"
              }`}
            >
              {apiKey ? "API Key Set" : "Set API Key"}
            </button>
            <button onClick={onClose} className="text-[#8b949e] hover:text-white text-xl leading-none ml-2">
              ×
            </button>
          </div>
        </div>

        {/* API Key Input */}
        {showApiKeyInput && (
          <div className="px-6 py-3 bg-[#161b22] border-b border-[#21262d]">
            <label className="text-xs text-[#8b949e] block mb-1">OpenAI API Key</label>
            <div className="flex gap-2">
              <input
                type="password"
                placeholder="sk-..."
                defaultValue={apiKey}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveApiKey(e.currentTarget.value);
                }}
                className="flex-1 bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-1.5 text-sm text-[#e6edf3] placeholder-[#484f58] focus:border-[#58a6ff] focus:outline-none"
              />
              <button
                onClick={(e) => {
                  const input = (e.currentTarget.previousElementSibling as HTMLInputElement);
                  saveApiKey(input.value);
                }}
                className="px-3 py-1.5 text-sm bg-[#238636] text-white rounded-md hover:bg-[#2ea043]"
              >
                Save
              </button>
            </div>
            <p className="text-[10px] text-[#484f58] mt-1">
              Your key is stored locally in your browser and sent directly to the OpenAI API.
            </p>
          </div>
        )}

        {/* Context bar */}
        <div className="px-6 py-2 border-b border-[#21262d] bg-[#0d1117]">
          <div className="flex flex-wrap gap-1.5">
            {favorites.map((f) => (
              <span
                key={`${f._kind}-${f.number}`}
                className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full border ${
                  f._kind === "pr"
                    ? "border-[#58a6ff33] text-[#58a6ff] bg-[#58a6ff11]"
                    : "border-[#3fb95033] text-[#3fb950] bg-[#3fb95011]"
                }`}
              >
                {f._kind === "pr" ? "↗" : "●"} #{f.number}
              </span>
            ))}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="space-y-6">
              <div className="text-center py-8">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1" className="mx-auto mb-3">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <p className="text-[#8b949e] text-sm">Ask questions about your favorited items</p>
                <p className="text-[#484f58] text-xs mt-1">
                  The AI has full context on all {favorites.length} items including descriptions, comments, and metadata
                </p>
              </div>
              <div>
                <p className="text-xs text-[#8b949e] mb-2">Suggested prompts:</p>
                <div className="grid grid-cols-2 gap-2">
                  {SUGGESTED_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => sendMessage(prompt)}
                      className="text-left text-xs text-[#8b949e] p-3 bg-[#161b22] border border-[#21262d] rounded-lg hover:border-[#30363d] hover:text-[#e6edf3] transition-colors"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-lg px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-[#58a6ff22] text-[#e6edf3] border border-[#58a6ff33]"
                    : "bg-[#161b22] text-[#e6edf3] border border-[#21262d]"
                }`}
              >
                {msg.role === "assistant" ? (
                  <div className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap break-words">
                    {msg.content}
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-[#161b22] border border-[#21262d] rounded-lg px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-[#8b949e]">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 bg-[#58a6ff] rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <div className="w-1.5 h-1.5 bg-[#58a6ff] rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <div className="w-1.5 h-1.5 bg-[#58a6ff] rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                  Analyzing...
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-6 py-4 border-t border-[#30363d] bg-[#161b22]">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={apiKey ? "Ask about your favorited items..." : "Set your API key first..."}
              disabled={loading || !apiKey}
              rows={2}
              className="flex-1 bg-[#0d1117] border border-[#30363d] rounded-lg px-4 py-2.5 text-sm text-[#e6edf3] placeholder-[#484f58] focus:border-[#58a6ff] focus:outline-none resize-none disabled:opacity-50"
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={loading || !input.trim() || !apiKey}
              className="self-end px-4 py-2.5 bg-[#238636] text-white text-sm font-medium rounded-lg hover:bg-[#2ea043] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </div>
          <p className="text-[10px] text-[#484f58] mt-1.5">
            Press Enter to send, Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
}
