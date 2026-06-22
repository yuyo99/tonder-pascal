"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const EXAMPLES = [
  "What's my Cards acceptance rate today?",
  "Top decline reasons this week",
  "Volume processed yesterday",
  "Find payment 5373067",
  "Any failed payouts in the last hour?",
  "SPEI conversion rate this week",
];

const EXAMPLES_SHORT_LABEL: string[] = [
  "Cards rate today",
  "Top declines",
  "Volume yesterday",
  "Find payment",
  "Failed payouts",
  "SPEI rate",
];

function getGreeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  if (h >= 17 && h < 22) return "Good evening";
  return "Late night";
}

const CDMX_TIME_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Mexico_City",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
function formatCdmxTime(d: Date = new Date()): string {
  return CDMX_TIME_FMT.format(d).replace(/^24/, "00");
}

function inlineFormat(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-gray-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-gray-100 px-1 py-0.5 text-[12px] font-mono text-violet-700">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("### ")) {
      elements.push(
        <h4 key={i} className="mt-3 mb-1 text-sm font-semibold text-gray-900">
          {line.slice(4)}
        </h4>,
      );
      continue;
    }
    if (line.startsWith("## ")) {
      elements.push(
        <h3 key={i} className="mt-3 mb-1 font-semibold text-gray-900">
          {line.slice(3)}
        </h3>,
      );
      continue;
    }
    if (line.match(/^[-•*]\s/)) {
      elements.push(
        <div key={i} className="ml-1 flex gap-2">
          <span className="mt-0.5 text-violet-400">•</span>
          <span>{inlineFormat(line.slice(2))}</span>
        </div>,
      );
      continue;
    }
    if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
      continue;
    }
    elements.push(
      <p key={i} className="leading-relaxed">
        {inlineFormat(line)}
      </p>,
    );
  }
  return elements;
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      <div className="flex gap-1">
        <span className="h-2 w-2 animate-bounce rounded-full bg-violet-400 [animation-delay:0ms]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-violet-400 [animation-delay:150ms]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-violet-400 [animation-delay:300ms]" />
      </div>
      <span className="ml-2 text-sm text-gray-400">Thinking…</span>
    </div>
  );
}

export default function ConciergePage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [clock, setClock] = useState<string>(() => formatCdmxTime());
  useEffect(() => {
    const id = setInterval(() => setClock(formatCdmxTime()), 1000);
    return () => clearInterval(id);
  }, []);

  const [containerHeight, setContainerHeight] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => {
      if (window.innerWidth >= 1024) {
        setContainerHeight(null);
        return;
      }
      const vh = window.visualViewport?.height ?? window.innerHeight;
      setContainerHeight(`calc(${vh}px - 56px - env(safe-area-inset-bottom))`);
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleInputChange = (val: string) => {
    setInput(val);
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + "px";
    }
  };

  const sendMessage = async (text?: string) => {
    const question = (text ?? input).trim();
    if (!question || loading) return;
    setInput("");
    setExamplesOpen(false);
    if (inputRef.current) inputRef.current.style.height = "auto";

    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: question }),
      });
      const body = await res.json().catch(() => ({ error: "Bad response" }));
      const assistantText = res.ok
        ? typeof body.text === "string"
          ? body.text
          : "(empty response)"
        : `⚠️ ${body.error ?? "Request failed"}`;
      setMessages((prev) => [...prev, { role: "assistant", content: assistantText }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "⚠️ Couldn't reach Pascal. Check connection." },
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

  const isEmpty = messages.length === 0;

  return (
    <div
      className="mx-auto flex max-w-4xl flex-col h-[calc(100dvh-56px-env(safe-area-inset-bottom))] lg:h-screen"
      style={containerHeight ? { height: containerHeight } : undefined}
    >
      <div
        className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-4 py-2.5"
        style={{ paddingTop: "calc(0.5rem + var(--sat))" }}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/pascal-logo.svg" alt="Pascal" className="h-7 w-7 shrink-0 rounded-md" />
          <div className="min-w-0 leading-tight">
            <p className="text-[13px] font-semibold text-gray-900">Pascal Concierge</p>
            <p className="text-[10px] text-gray-400">Your payment ops AI</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden font-mono text-[10px] tabular-nums text-gray-400 sm:inline">
            UTC-6 · CDMX {clock}
          </span>
          <span className="font-mono text-[10px] tabular-nums text-gray-400 sm:hidden">{clock}</span>
          {messages.length > 0 && (
            <button
              onClick={() => setMessages([])}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600"
              aria-label="Clear chat"
              title="Clear chat"
            >
              <svg className="h-[16px] w-[16px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 space-y-3 overflow-y-auto px-3 py-4 sm:px-4">
        {isEmpty && (
          <div className="flex h-full flex-col items-center justify-start px-6 pt-10 text-center sm:pt-16">
            <svg className="mb-3 h-7 w-7 text-violet-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2z" />
              <path d="M19 14l.75 2.25L22 17l-2.25.75L19 20l-.75-2.25L16 17l2.25-.75L19 14z" />
              <path d="M5 16l.5 1.5L7 18l-1.5.5L5 20l-.5-1.5L3 18l1.5-.5L5 16z" />
            </svg>
            <p className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
              {getGreeting()}
            </p>
            <p className="mt-2 max-w-xs text-sm text-gray-400">
              Ask Pascal about your payments — acceptance rates, declines, withdrawals, transactions.
            </p>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[88%] rounded-2xl rounded-br-md bg-violet-600 px-3.5 py-2.5 text-sm leading-relaxed text-white sm:max-w-[80%] sm:px-4">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-gray-200 bg-white px-3.5 py-3 text-sm text-gray-700 sm:max-w-[85%] sm:px-4">
                {renderMarkdown(m.content)}
              </div>
            </div>
          ),
        )}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md border border-gray-200 bg-white">
              <ThinkingDots />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {examplesOpen && isEmpty && (
        <div className="shrink-0 px-3 pb-2 sm:px-4">
          <div className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white p-2 shadow-sm">
            <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Try asking
            </p>
            <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap">
              {EXAMPLES.map((ex, i) => (
                <button
                  key={ex}
                  onClick={() => {
                    sendMessage(ex);
                    setExamplesOpen(false);
                  }}
                  className="rounded-xl px-3 py-2 text-left text-[12px] leading-snug text-gray-600 transition-colors hover:bg-violet-50 hover:text-violet-700 sm:text-sm"
                  title={ex}
                >
                  <span className="sm:hidden">{EXAMPLES_SHORT_LABEL[i] ?? ex}</span>
                  <span className="hidden sm:inline">{ex}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="shrink-0 bg-white px-3 py-3 sm:px-4">
        <form onSubmit={handleSubmit} className="mx-auto max-w-3xl">
          <div className="flex items-end gap-1 rounded-3xl border border-gray-200 bg-gray-50 px-1.5 py-1.5 transition-colors focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-500/20">
            {isEmpty && (
              <button
                type="button"
                onClick={() => setExamplesOpen((v) => !v)}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${
                  examplesOpen
                    ? "bg-violet-100 text-violet-600"
                    : "text-gray-500 hover:bg-violet-50 hover:text-violet-600"
                }`}
                aria-label="Show example prompts"
                aria-expanded={examplesOpen}
              >
                <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
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
              placeholder="Ask Pascal anything…"
              rows={1}
              className="flex-1 resize-none bg-transparent px-2 py-2 text-base text-gray-900 placeholder:text-gray-400 focus:outline-none sm:text-sm"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-violet-600 text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
              aria-label="Send message"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
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
