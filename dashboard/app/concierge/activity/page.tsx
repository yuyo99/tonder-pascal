"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";

interface Conversation {
  id: string;
  question: string;
  answer: string;
  latency_ms: number | null;
  rounds: number;
  tool_calls: { tool: string }[];
  created_at: string;
}

function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime();
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export default function ActivityPage() {
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/concierge/activity")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setConversations(data.conversations ?? []);
      })
      .catch(() => setError("Failed to load"));
  }, []);

  return (
    <>
      <PageHeader
        title="Activity"
        subtitle="Your conversations with Pascal."
      />

      {error && (
        <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!error && conversations === null && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl border border-gray-200 bg-white" />
          ))}
        </div>
      )}

      {conversations && conversations.length === 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white px-6 py-12 text-center text-sm text-gray-500">
          No conversations yet. Start a chat in the Concierge tab.
        </div>
      )}

      {conversations && conversations.length > 0 && (
        <div className="space-y-3">
          {conversations.map((c) => (
            <article
              key={c.id}
              className="rounded-2xl border border-gray-200 bg-white px-5 py-4 transition-colors hover:border-violet-200"
            >
              <header className="mb-2 flex items-center justify-between gap-3">
                <span className="text-xs text-gray-400">{formatRelative(c.created_at)}</span>
                <span className="text-xs text-gray-400">
                  {c.latency_ms != null ? `${Math.round(c.latency_ms / 100) / 10}s` : null}
                  {c.tool_calls.length > 0 ? ` · ${c.tool_calls.length} tool${c.tool_calls.length === 1 ? "" : "s"}` : null}
                </span>
              </header>
              <p className="mb-2 text-sm font-medium text-gray-900">{c.question}</p>
              <p className="line-clamp-3 text-sm leading-relaxed text-gray-500">{c.answer}</p>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
