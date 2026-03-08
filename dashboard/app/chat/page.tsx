"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";

/* ─── Types ─── */

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ToolEvent {
  type: "tool_call" | "tool_result";
  tool: string;
  input?: Record<string, unknown>;
  preview?: string;
}

interface DisplayItem {
  kind: "user" | "assistant" | "tool";
  content?: string;
  events?: ToolEvent[];
}

/* ─── Example question chips ─── */

const EXAMPLES = [
  "Find user_id for payment 3718026",
  "Acceptance rate for BCGAME today",
  "Show me all collections available",
  "Schema of usrv-deposits-spei",
  "BCGAME withdrawals over $5,000 this week",
  "List all active businesses",
];

/* ─── Markdown-lite renderer (bold, bullets, code) ─── */

function renderMarkdown(text: string) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Headers
    if (line.startsWith("### ")) {
      elements.push(
        <h4 key={i} className="font-semibold text-gray-900 mt-3 mb-1 text-sm">
          {line.slice(4)}
        </h4>
      );
      continue;
    }
    if (line.startsWith("## ")) {
      elements.push(
        <h3 key={i} className="font-semibold text-gray-900 mt-3 mb-1">
          {line.slice(3)}
        </h3>
      );
      continue;
    }

    // Bullet points
    if (line.match(/^[-•*]\s/)) {
      elements.push(
        <div key={i} className="flex gap-2 ml-1">
          <span className="text-violet-400 mt-0.5">•</span>
          <span>{inlineFormat(line.slice(2))}</span>
        </div>
      );
      continue;
    }

    // Numbered lists
    const numMatch = line.match(/^(\d+)\.\s/);
    if (numMatch) {
      elements.push(
        <div key={i} className="flex gap-2 ml-1">
          <span className="text-violet-400 font-medium min-w-[1.2rem]">
            {numMatch[1]}.
          </span>
          <span>{inlineFormat(line.slice(numMatch[0].length))}</span>
        </div>
      );
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
      continue;
    }

    // Normal paragraph
    elements.push(
      <p key={i} className="leading-relaxed">
        {inlineFormat(line)}
      </p>
    );
  }

  return <>{elements}</>;
}

function inlineFormat(text: string): React.ReactNode {
  // Split by inline code, then process bold within each segment
  const parts = text.split(/`([^`]+)`/g);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      return (
        <code
          key={i}
          className="bg-gray-100 text-violet-700 px-1.5 py-0.5 rounded text-[0.85em] font-mono"
        >
          {part}
        </code>
      );
    }
    // Handle bold **text**
    const boldParts = part.split(/\*\*([^*]+)\*\*/g);
    return boldParts.map((bp, j) =>
      j % 2 === 1 ? (
        <strong key={`${i}-${j}`} className="font-semibold text-gray-900">
          {bp}
        </strong>
      ) : (
        <span key={`${i}-${j}`}>{bp}</span>
      )
    );
  });
}

/* ─── Tool Call Card ─── */

function ToolCard({ events }: { events: ToolEvent[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-2">
      {events.map((ev, i) => {
        if (ev.type === "tool_call") {
          return (
            <button
              key={i}
              onClick={() => setExpanded(!expanded)}
              className="w-full text-left border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-violet-500">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
                    </svg>
                  </span>
                  <span className="text-sm font-medium text-gray-700">
                    {ev.tool}
                  </span>
                  {ev.input?.collection ? (
                    <span className="text-xs text-gray-400">
                      → {String(ev.input.collection)}
                    </span>
                  ) : null}
                </div>
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
              {expanded && ev.input && (
                <pre className="mt-2 text-xs text-gray-500 bg-white rounded p-2 overflow-x-auto border border-gray-100">
                  {JSON.stringify(ev.input, null, 2)}
                </pre>
              )}
            </button>
          );
        }
        if (ev.type === "tool_result" && expanded) {
          return (
            <div
              key={i}
              className="border-x border-b border-gray-200 rounded-b-lg px-3 py-2 bg-white"
            >
              <pre className="text-xs text-gray-500 overflow-x-auto whitespace-pre-wrap">
                {ev.preview}
              </pre>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

/* ─── Thinking Indicator ─── */

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      <div className="flex gap-1">
        <span className="w-2 h-2 bg-violet-400 rounded-full animate-bounce [animation-delay:0ms]" />
        <span className="w-2 h-2 bg-violet-400 rounded-full animate-bounce [animation-delay:150ms]" />
        <span className="w-2 h-2 bg-violet-400 rounded-full animate-bounce [animation-delay:300ms]" />
      </div>
      <span className="text-sm text-gray-400 ml-2">Thinking...</span>
    </div>
  );
}

/* ─── Main Chat Page ─── */

export default function ChatPage() {
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new items
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items, loading]);

  // Auto-resize textarea
  const handleInputChange = (val: string) => {
    setInput(val);
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + "px";
    }
  };

  const sendMessage = async (text?: string) => {
    const question = (text || input).trim();
    if (!question || loading) return;

    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";

    // Add user message to display
    setItems((prev) => [...prev, { kind: "user", content: question }]);

    // Build message history for Claude
    const newHistory: ChatMessage[] = [
      ...chatHistory,
      { role: "user" as const, content: question },
    ];
    setChatHistory(newHistory);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newHistory }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Request failed" }));
        setItems((prev) => [
          ...prev,
          { kind: "assistant", content: `Error: ${errBody.error || res.statusText}` },
        ]);
        setLoading(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setItems((prev) => [
          ...prev,
          { kind: "assistant", content: "Error: No response stream" },
        ]);
        setLoading(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let currentToolEvents: ToolEvent[] = [];
      let assistantText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr);

            if (event.type === "tool_call") {
              currentToolEvents.push({
                type: "tool_call",
                tool: event.tool,
                input: event.input,
              });
              // Add tool card immediately
              const captured = [...currentToolEvents];
              setItems((prev) => {
                // Replace existing tool item or add new one
                const lastItem = prev[prev.length - 1];
                if (lastItem?.kind === "tool") {
                  return [
                    ...prev.slice(0, -1),
                    { kind: "tool", events: captured },
                  ];
                }
                return [...prev, { kind: "tool", events: captured }];
              });
            }

            if (event.type === "tool_result") {
              currentToolEvents.push({
                type: "tool_result",
                tool: event.tool,
                preview: event.preview,
              });
              const captured = [...currentToolEvents];
              setItems((prev) => {
                const lastItem = prev[prev.length - 1];
                if (lastItem?.kind === "tool") {
                  return [
                    ...prev.slice(0, -1),
                    { kind: "tool", events: captured },
                  ];
                }
                return [...prev, { kind: "tool", events: captured }];
              });
            }

            if (event.type === "text") {
              assistantText = event.content;
              // Reset tool events for next round
              currentToolEvents = [];
              setItems((prev) => [
                ...prev,
                { kind: "assistant", content: assistantText },
              ]);
              // Update chat history with assistant response
              setChatHistory((prev) => [
                ...prev,
                { role: "assistant" as const, content: assistantText },
              ]);
            }

            if (event.type === "error") {
              setItems((prev) => [
                ...prev,
                {
                  kind: "assistant",
                  content: `Error: ${event.message}`,
                },
              ]);
            }
          } catch {
            // skip malformed events
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setItems((prev) => [
        ...prev,
        { kind: "assistant", content: `Connection error: ${msg}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    sendMessage();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const isEmpty = items.length === 0;

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100">
        <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center">
          <svg className="w-5 h-5 text-violet-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            <path d="M8 10h.01M12 10h.01M16 10h.01" />
          </svg>
        </div>
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Pascal Chat</h1>
          <p className="text-xs text-gray-400">
            Ask anything about your payment data
          </p>
        </div>
        {items.length > 0 && (
          <button
            onClick={() => {
              setItems([]);
              setChatHistory([]);
            }}
            className="ml-auto text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded hover:bg-gray-50 transition-colors"
          >
            Clear chat
          </button>
        )}
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {isEmpty && (
          <div className="flex flex-col items-center justify-center h-full gap-6">
            <div className="w-16 h-16 rounded-2xl bg-violet-50 flex items-center justify-center">
              <svg className="w-8 h-8 text-violet-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="11" y1="8" x2="11" y2="14" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-gray-900 font-medium">
                What do you want to know?
              </p>
              <p className="text-sm text-gray-400 mt-1">
                Query MongoDB, check acceptance rates, look up payments
              </p>
            </div>
            <div className="flex flex-wrap gap-2 max-w-lg justify-center">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => sendMessage(ex)}
                  className="text-sm px-3 py-1.5 rounded-full border border-gray-200 text-gray-600 hover:border-violet-300 hover:text-violet-700 hover:bg-violet-50 transition-colors"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {items.map((item, i) => {
          if (item.kind === "user") {
            return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-br-md bg-violet-600 text-white text-sm leading-relaxed">
                  {item.content}
                </div>
              </div>
            );
          }
          if (item.kind === "tool") {
            return <ToolCard key={i} events={item.events || []} />;
          }
          if (item.kind === "assistant") {
            return (
              <div key={i} className="flex justify-start">
                <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-bl-md bg-white border border-gray-200 text-sm text-gray-700 shadow-sm">
                  {renderMarkdown(item.content || "")}
                </div>
              </div>
            );
          }
          return null;
        })}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-white border border-gray-200 shadow-sm">
              <ThinkingDots />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="border-t border-gray-100 px-4 py-3 bg-white">
        <form onSubmit={handleSubmit} className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything about your data..."
            rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 transition-colors"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="h-10 w-10 rounded-xl bg-violet-600 text-white flex items-center justify-center hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
