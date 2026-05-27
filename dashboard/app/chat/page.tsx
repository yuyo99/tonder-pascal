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

// Compact labels shown in the 2-col grid on mobile. Tapping still sends
// the full EXAMPLES[i] prompt — these are display-only so chips don't
// wrap to 3+ lines in a half-viewport-wide tile.
const EXAMPLES_SHORT_LABEL: string[] = [
  "Find payment 3718026",
  "BCGAME rate today",
  "List collections",
  "SPEI schema",
  "BCGAME wd > $5k 7d",
  "Active businesses",
];

/* ─── Citadel-style helpers (v6) ─── */

// Time-aware greeting matching the Citadel reference. Uses the device's
// local time (not CDMX) because the user testing on iPhone is in CDMX
// and we want the greeting to feel local to wherever they are.
function getGreeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  if (h >= 17 && h < 22) return "Good evening";
  return "Late night"; // 22-5
}

// Format the live CDMX clock for the header. "HH:MM:SS" 24h, always in
// America/Mexico_City regardless of viewer's timezone (Tonder ops runs
// on CDMX time).
const CDMX_TIME_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Mexico_City",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
function formatCdmxTime(d: Date = new Date()): string {
  // The formatter produces "HH:MM:SS"; some locales prefix "24:..." for
  // midnight, normalize to "00:...".
  return CDMX_TIME_FMT.format(d).replace(/^24/, "00");
}

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

  // v6: live CDMX clock in the header. Ticks every second. Also drives
  // the time-aware greeting to switch automatically at hour boundaries
  // without a page reload (e.g., "Good evening" → "Late night" at 22:00).
  const [clock, setClock] = useState<string>(() => formatCdmxTime());
  useEffect(() => {
    const id = setInterval(() => setClock(formatCdmxTime()), 1000);
    return () => clearInterval(id);
  }, []);

  // v6: + button in the input bar opens an examples popover (replaces
  // the always-visible chip grid from v5).
  const [examplesOpen, setExamplesOpen] = useState(false);

  // AID-keyboard: track the iOS visualViewport so the chat container
  // shrinks correctly when the keyboard opens. Without this, 100dvh
  // stays at the full max-viewport on iOS Safari, leaving a huge
  // empty space below the input bar when the keyboard is up.
  // Returns null on desktop or before mount (uses fallback Tailwind
  // class height in that case).
  const [containerHeight, setContainerHeight] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => {
      // Desktop (>= lg breakpoint) uses h-screen via class; skip the
      // visualViewport override entirely.
      if (window.innerWidth >= 1024) {
        setContainerHeight(null);
        return;
      }
      const vh = window.visualViewport?.height ?? window.innerHeight;
      // Subtract the bottom tab bar (56px) + home indicator
      // (env(safe-area-inset-bottom)). The visualViewport.height
      // already accounts for the keyboard when it's open.
      setContainerHeight(
        `calc(${vh}px - 56px - env(safe-area-inset-bottom))`
      );
    };
    update();

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", update);
      vv.addEventListener("scroll", update);
    }
    window.addEventListener("resize", update);
    return () => {
      if (vv) {
        vv.removeEventListener("resize", update);
        vv.removeEventListener("scroll", update);
      }
      window.removeEventListener("resize", update);
    };
  }, []);

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
    // Full-bleed layout — LayoutShell special-cases /chat so the
    // outer <main> has no wrapper padding, no bottom spacer, no
    // max-w constraint. This container manages its OWN height:
    //   Mobile: visualViewport.height - tab bar - sab (shrinks with
    //           the iOS keyboard via the useEffect above). Fallback
    //           class is 100dvh-... for SSR / before mount.
    //   Desktop: lg:h-screen (no tab bar to subtract).
    <div
      className="flex flex-col mx-auto max-w-4xl h-[calc(100dvh-56px-env(safe-area-inset-bottom))] lg:h-screen"
      style={containerHeight ? { height: containerHeight } : undefined}
    >
      {/* Header — Citadel-style: small org logo + label on the left,
          live CDMX clock on the right. paddingTop respects iPhone
          Dynamic Island in PWA mode (var(--sat) = 0 in browser tab). */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-gray-100 shrink-0"
        style={{ paddingTop: "calc(0.5rem + var(--sat))" }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/pascal-logo.svg"
            alt="Pascal"
            className="w-7 h-7 rounded-md shrink-0"
          />
          <div className="min-w-0 leading-tight">
            <p className="text-[13px] font-semibold text-gray-900">Pascal</p>
            <p className="text-[10px] text-gray-400">Tonder operations</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Live CDMX clock — matches Citadel's "UTC-6 · CDMX HH:MM:SS"
              header element. Tabular-nums keeps the seconds digit from
              jumping width as it ticks. */}
          <span className="text-[10px] text-gray-400 font-mono tabular-nums hidden sm:inline">
            UTC-6 · CDMX {clock}
          </span>
          <span className="text-[10px] text-gray-400 font-mono tabular-nums sm:hidden">
            {clock}
          </span>
          {items.length > 0 && (
            <button
              onClick={() => {
                setItems([]);
                setChatHistory([]);
              }}
              className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
              aria-label="Clear chat"
              title="Clear chat"
            >
              <svg className="w-[16px] h-[16px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Messages area. min-h-0 is critical: without it, flex children
          refuse to shrink below content min-height, so the messages
          area would force the chat container to grow → causes iOS to
          scroll the document when the keyboard opens. With min-h-0,
          the flex-1 properly shrinks when the container shrinks. */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 py-4 space-y-3">
        {isEmpty && (
          // v7: sparkles + greeting pinned to the TOP of the messages-
          // area (justify-start + pt-10) so the layout feels persistent
          // when the keyboard opens. The greeting stays at a fixed
          // distance from the header; the input bar (at the bottom of
          // the chat container) no longer feels "pulled up" to meet
          // the greeting in the middle. Only the flex-1 gap between
          // them compresses when the viewport shrinks. Matches Citadel.
          <div className="flex flex-col items-center justify-start h-full px-6 text-center pt-10 sm:pt-16">
            <svg
              className="w-7 h-7 text-violet-500 mb-3"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
            >
              {/* Three-point sparkles glyph — one large + two small */}
              <path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2z" />
              <path d="M19 14l.75 2.25L22 17l-2.25.75L19 20l-.75-2.25L16 17l2.25-.75L19 14z" />
              <path d="M5 16l.5 1.5L7 18l-1.5.5L5 20l-.5-1.5L3 18l1.5-.5L5 16z" />
            </svg>
            <p className="text-gray-900 font-semibold text-2xl sm:text-3xl tracking-tight">
              {getGreeting()}
            </p>
          </div>
        )}

        {items.map((item, i) => {
          if (item.kind === "user") {
            return (
              <div key={i} className="flex justify-end">
                {/* max-w 88% on mobile vs 80% on desktop — narrow screens
                    benefit from wider bubbles. */}
                <div className="max-w-[88%] sm:max-w-[80%] px-3.5 sm:px-4 py-2.5 rounded-2xl rounded-br-md bg-violet-600 text-white text-sm leading-relaxed">
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
                <div className="max-w-[92%] sm:max-w-[85%] px-3.5 sm:px-4 py-3 rounded-2xl rounded-bl-md bg-white border border-gray-200 text-sm text-gray-700">
                  {renderMarkdown(item.content || "")}
                </div>
              </div>
            );
          }
          return null;
        })}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-white border border-gray-200">
              <ThinkingDots />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* v6: examples popover — replaces the always-visible chip grid.
          Visible only when the user taps the + button on the input
          bar AND the chat is empty. Sits just above the input bar. */}
      {examplesOpen && isEmpty && (
        <div className="shrink-0 px-3 sm:px-4 pb-2">
          <div className="bg-white border border-gray-200 rounded-2xl p-2 shadow-sm max-w-3xl mx-auto">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-2 py-1">
              Examples
            </p>
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-1.5">
              {EXAMPLES.map((ex, i) => (
                <button
                  key={ex}
                  onClick={() => {
                    sendMessage(ex);
                    setExamplesOpen(false);
                  }}
                  className="text-[12px] sm:text-sm px-3 py-2 rounded-xl hover:bg-violet-50 text-left text-gray-600 hover:text-violet-700 transition-colors leading-snug"
                  title={ex}
                >
                  <span className="sm:hidden">
                    {EXAMPLES_SHORT_LABEL[i] ?? ex}
                  </span>
                  <span className="hidden sm:inline">{ex}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Input bar — Citadel-style pill with + (left) and circular
          send arrow (right). The chat container's outer height
          accounts for the iPhone home indicator via the visualViewport
          hook + interactive-widget meta, so this bar's pb is just the
          visual gap (0.75rem). */}
      <div className="px-3 sm:px-4 py-3 bg-white shrink-0">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
          {/* Pill wrapper holds the + button + textarea + send button.
              focus-within ring traces the whole pill, not just the
              textarea. */}
          <div className="flex items-end gap-1 bg-gray-50 rounded-3xl border border-gray-200 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-500/20 transition-colors px-1.5 py-1.5">
            {/* + button — opens the examples popover. Only meaningful
                while the chat is empty (no point suggesting examples
                mid-conversation). */}
            {isEmpty && (
              <button
                type="button"
                onClick={() => setExamplesOpen((v) => !v)}
                className={`h-9 w-9 rounded-full flex items-center justify-center transition-colors shrink-0 ${
                  examplesOpen
                    ? "text-violet-600 bg-violet-100"
                    : "text-gray-500 hover:text-violet-600 hover:bg-violet-50"
                }`}
                aria-label="Show example prompts"
                aria-expanded={examplesOpen}
              >
                <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            )}
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Chat with Pascal"
              rows={1}
              className="flex-1 resize-none bg-transparent px-2 py-2 text-base sm:text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="h-9 w-9 rounded-full bg-violet-600 text-white flex items-center justify-center hover:bg-violet-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors flex-shrink-0"
              aria-label="Send message"
            >
              {/* Arrow-up icon, ChatGPT/Citadel-style send affordance */}
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
