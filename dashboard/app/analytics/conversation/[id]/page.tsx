"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface ConversationDetail {
  id: string;
  merchantName: string;
  platform: string;
  channelId: string;
  userName: string | null;
  question: string;
  answer: string;
  toolCalls: { tool: string; input: Record<string, unknown> }[];
  rounds: number;
  latencyMs: number | null;
  ticketId: string | null;
  error: string | null;
  knowledgeUsed: { id: string; title: string; category: string }[];
  createdAt: string;
}

export default function ConversationDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [conv, setConv] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/analytics/conversations/${id}`)
      .then((r) => {
        if (r.status === 404) {
          setNotFound(true);
          setLoading(false);
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data) {
          setConv(data);
          setLoading(false);
        }
      });
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (notFound || !conv) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-400 text-lg">Conversation not found</p>
        <Link
          href="/analytics"
          className="text-violet-600 hover:text-violet-800 text-sm mt-2 inline-block"
        >
          Back to Analytics
        </Link>
      </div>
    );
  }

  const date = new Date(conv.createdAt);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href={`/analytics/${encodeURIComponent(conv.merchantName)}`}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            Conversation Detail
          </h1>
          <p className="text-sm text-gray-400">
            {conv.merchantName} &middot;{" "}
            {date.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
      </div>

      {/* Metadata */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Platform</p>
            <span
              className={`text-xs px-2 py-1 rounded font-medium uppercase ${
                conv.platform === "slack"
                  ? "bg-purple-100 text-purple-700"
                  : "bg-blue-100 text-blue-700"
              }`}
            >
              {conv.platform}
            </span>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">User</p>
            <p className="text-gray-700">{conv.userName || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Latency</p>
            <p className="text-gray-700">
              {conv.latencyMs ? `${(conv.latencyMs / 1000).toFixed(1)}s` : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Rounds</p>
            <p className="text-gray-700">{conv.rounds}</p>
          </div>
        </div>

        {conv.error && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-xs text-red-500 uppercase tracking-wide font-medium mb-1">Error</p>
            <p className="text-sm text-red-700 font-mono break-all">{conv.error}</p>
          </div>
        )}
      </div>

      {/* Question */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-4">
        <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-2">Question</p>
        <p className="text-gray-800 whitespace-pre-wrap">{conv.question}</p>
      </div>

      {/* Answer */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-4">
        <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-2">Answer</p>
        <p className="text-gray-800 whitespace-pre-wrap text-sm leading-relaxed">{conv.answer}</p>
      </div>

      {/* Knowledge Used */}
      {conv.knowledgeUsed && conv.knowledgeUsed.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-3">
            Knowledge Used ({conv.knowledgeUsed.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {conv.knowledgeUsed.map((k) => (
              <div
                key={k.id}
                className="flex items-center gap-2 border border-violet-200 bg-violet-50 rounded-lg px-3 py-2"
              >
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-200 text-violet-700 font-medium uppercase">
                  {k.category}
                </span>
                <span className="text-sm text-violet-800">{k.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tool Calls */}
      {conv.toolCalls.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-3">
            Tool Calls ({conv.toolCalls.length})
          </p>
          <div className="space-y-3">
            {conv.toolCalls.map((tc, i) => (
              <div key={i} className="border border-gray-100 rounded-lg p-3">
                <p className="text-sm font-medium text-violet-700 mb-1">{tc.tool}</p>
                <pre className="text-xs text-gray-500 bg-gray-50 rounded p-2 overflow-x-auto">
                  {JSON.stringify(tc.input, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
