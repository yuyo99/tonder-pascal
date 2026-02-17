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
          {/* Robot logo */}
          <svg viewBox="0 0 120 120" className="h-20 w-20 mb-4" fill="none">
            <circle cx="60" cy="60" r="58" fill="#1e1b4b" />
            <circle cx="60" cy="60" r="58" stroke="#312e81" strokeWidth="2" />
            <rect x="30" y="32" width="60" height="56" rx="12" fill="#1e1b4b" stroke="#312e81" strokeWidth="1.5" />
            <rect x="36" y="36" width="48" height="14" rx="4" fill="#0f0a2e" stroke="#312e81" strokeWidth="0.5" />
            {/* Left eye */}
            <ellipse cx="44" cy="62" rx="8" ry="7" fill="#6d28d9" opacity="0.3" />
            <ellipse cx="44" cy="62" rx="6" ry="5.5" fill="#6d28d9" opacity="0.5" />
            <ellipse cx="44" cy="62" rx="4" ry="3.5" fill="#8b5cf6" />
            <ellipse cx="44" cy="61" rx="2" ry="1.5" fill="#ede9fe" />
            {/* Right eye */}
            <ellipse cx="76" cy="62" rx="8" ry="7" fill="#6d28d9" opacity="0.3" />
            <ellipse cx="76" cy="62" rx="6" ry="5.5" fill="#6d28d9" opacity="0.5" />
            <ellipse cx="76" cy="62" rx="4" ry="3.5" fill="#8b5cf6" />
            <ellipse cx="76" cy="61" rx="2" ry="1.5" fill="#ede9fe" />
            {/* Mouth grill */}
            <rect x="42" y="74" width="36" height="8" rx="3" fill="#0f0a2e" stroke="#312e81" strokeWidth="0.5" />
            <line x1="50" y1="74" x2="50" y2="82" stroke="#312e81" strokeWidth="0.5" />
            <line x1="58" y1="74" x2="58" y2="82" stroke="#312e81" strokeWidth="0.5" />
            <line x1="66" y1="74" x2="66" y2="82" stroke="#312e81" strokeWidth="0.5" />
            <line x1="74" y1="74" x2="74" y2="82" stroke="#312e81" strokeWidth="0.5" />
            {/* Antenna */}
            <line x1="60" y1="32" x2="60" y2="20" stroke="#312e81" strokeWidth="2" />
            <circle cx="60" cy="18" r="4" fill="#6d28d9" opacity="0.8" />
            <circle cx="60" cy="18" r="2" fill="#8b5cf6" />
            {/* Ear pieces */}
            <rect x="22" y="52" width="8" height="20" rx="3" fill="#1e1b4b" stroke="#312e81" strokeWidth="1" />
            <rect x="90" y="52" width="8" height="20" rx="3" fill="#1e1b4b" stroke="#312e81" strokeWidth="1" />
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
