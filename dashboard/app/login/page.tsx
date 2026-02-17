"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.push("/");
        router.refresh();
      } else {
        setError("Invalid password");
      }
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 w-full max-w-sm"
      >
        <div className="flex flex-col items-center mb-6">
          {/* Shield logo */}
          <svg viewBox="0 0 48 48" className="h-20 w-20 mb-4">
            <defs>
              <linearGradient id="login-shield-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#8b5cf6" />
                <stop offset="100%" stopColor="#6d28d9" />
              </linearGradient>
              <filter id="login-glow">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <path
              d="M24 3 L42 12 L42 24 C42 34.5 33 42 24 45 C15 42 6 34.5 6 24 L6 12 Z"
              fill="url(#login-shield-grad)"
              filter="url(#login-glow)"
              opacity="0.9"
            />
            <text x="24" y="30" textAnchor="middle" fill="white" fontSize="22" fontWeight="bold" fontFamily="system-ui">P</text>
          </svg>
          <h1 className="text-2xl font-semibold text-gray-900">
            Pascal<span className="text-violet-600">.</span>
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Merchant Configuration Dashboard
          </p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 text-sm rounded-lg p-3 mb-4">
            {error}
          </div>
        )}

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Access key"
          className="w-full border border-gray-200 rounded-lg px-3 py-2.5 mb-4 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-shadow"
          autoFocus
        />

        <button
          type="submit"
          disabled={loading || !password}
          className="w-full bg-violet-600 text-white rounded-lg py-2.5 font-medium hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}
