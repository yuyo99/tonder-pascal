"use client";

import { useState, useEffect } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
        window.location.href = "/";
        return;
      } else {
        setError("Invalid access key");
        setShake(true);
        setTimeout(() => setShake(false), 600);
      }
    } catch {
      setError("Connection error");
      setShake(true);
      setTimeout(() => setShake(false), 600);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-white text-neutral-900">
      {/* ── Animations ── */}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes shakeX {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }
        @keyframes spinnerSpin {
          to { transform: rotate(360deg); }
        }
        .animate-fadeInUp { animation: fadeInUp 0.5s ease-out forwards; }
        .animate-shakeX { animation: shakeX 0.5s ease-in-out; }
        .animate-spinner { animation: spinnerSpin 0.7s linear infinite; }
      `}</style>

      {/* ── Top bar — logo top-left, Zeno-style stacked wordmark ── */}
      <header className="px-6 py-5 border-b border-neutral-200/70">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/pascal-logo.svg"
            alt="Pascal"
            className="h-11 w-11 shrink-0"
          />
          <div className="flex flex-col leading-none">
            <span className="text-[22px] font-bold tracking-tight text-neutral-900">
              pascal
            </span>
            <span className="mt-1.5 text-[10px] font-medium tracking-[0.18em] text-neutral-400 uppercase">
              Tonder AI Agent
            </span>
          </div>
        </div>
      </header>

      {/* ── Main — centered form ── */}
      <main className="flex-1 flex items-center justify-center px-6">
        <div
          className={`w-full max-w-[440px] transition-opacity duration-500 ${
            mounted ? "opacity-100 animate-fadeInUp" : "opacity-0"
          }`}
        >
          <div className="text-center mb-8">
            <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-neutral-900">
              Welcome to Pascal
            </h1>
            <p className="mt-2 text-[14px] text-neutral-500">
              Enter your workspace access key to continue.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div
              className={`flex items-center gap-2 bg-violet-50/60 border border-violet-100 text-neutral-700 text-[13px] rounded-lg px-3 py-2.5 mb-3 ${
                shake ? "animate-shakeX" : ""
              }`}
              role="alert"
            >
              <svg
                className="w-4 h-4 shrink-0 text-violet-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label htmlFor="password" className="sr-only">
                Access key
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Access key (required)"
                autoFocus
                className="w-full h-11 border border-neutral-200 rounded-lg px-3.5 text-[14px] bg-white text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/15 transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !password}
              className="w-full h-11 bg-violet-600 text-white rounded-lg text-[14px] font-medium hover:bg-violet-700 active:bg-violet-700 disabled:bg-violet-300 disabled:cursor-not-allowed transition-colors shadow-sm shadow-violet-600/15"
            >
              {loading ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <svg
                    className="w-4 h-4 animate-spinner"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      opacity="0.25"
                    />
                    <path
                      d="M12 2a10 10 0 0 1 10 10"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                  </svg>
                  Signing in
                </span>
              ) : (
                "Continue"
              )}
            </button>
          </form>

          {/* Need access link */}
          <p className="mt-5 text-[13px] text-neutral-500">
            Need access?{" "}
            <a
              href="mailto:soporte@tonder.io"
              className="text-neutral-900 underline underline-offset-2 decoration-neutral-300 hover:text-violet-700 hover:decoration-violet-300 inline-flex items-center gap-0.5 transition-colors"
            >
              Contact Tonder
              <svg
                className="w-3 h-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M7 17L17 7M17 7H8M17 7v9" />
              </svg>
            </a>
          </p>
        </div>
      </main>

      {/* ── Footer — BUILT BY TONDER ── */}
      <footer className="border-t border-neutral-200/70 bg-neutral-50/60">
        <div className="px-6 py-5 flex items-center justify-center gap-2">
          <span className="text-[10px] font-semibold tracking-[0.18em] text-neutral-400 uppercase">
            Built by
          </span>
          <span className="text-[13px] font-bold tracking-tight text-neutral-700">
            Tonder
          </span>
        </div>
      </footer>
    </div>
  );
}

