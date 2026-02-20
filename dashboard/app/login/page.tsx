"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

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
        router.push("/");
        router.refresh();
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
    <div className="flex min-h-screen">
      {/* ── Inline keyframes for animations ── */}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes shakeX {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
        @keyframes eyeGlow {
          0%, 100% { opacity: 0.7; }
          50% { opacity: 1; }
        }
        @keyframes orbFloat {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(12px, -18px) scale(1.05); }
          66% { transform: translate(-8px, 10px) scale(0.95); }
        }
        @keyframes orbFloat2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(-15px, 12px) scale(1.08); }
          66% { transform: translate(10px, -14px) scale(0.92); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
        @keyframes spinnerSpin {
          to { transform: rotate(360deg); }
        }
        .animate-fadeInUp {
          animation: fadeInUp 0.6s ease-out forwards;
        }
        .animate-shakeX {
          animation: shakeX 0.5s ease-in-out;
        }
        .animate-eyeGlow {
          animation: eyeGlow 3s ease-in-out infinite;
        }
        .animate-orbFloat {
          animation: orbFloat 8s ease-in-out infinite;
        }
        .animate-orbFloat2 {
          animation: orbFloat2 10s ease-in-out infinite;
        }
        .animate-pulse-slow {
          animation: pulse 4s ease-in-out infinite;
        }
        .animate-spinner {
          animation: spinnerSpin 0.7s linear infinite;
        }
      `}</style>

      {/* ── Left Panel — Brand / Hero ── */}
      <div className="hidden lg:flex lg:w-[480px] xl:w-[520px] relative overflow-hidden flex-col items-center justify-center"
           style={{ background: "linear-gradient(160deg, #0f1629 0%, #1a1145 50%, #1e1b4b 100%)" }}>

        {/* Floating gradient orbs */}
        <div className="absolute top-20 left-12 w-64 h-64 rounded-full animate-orbFloat"
             style={{ background: "radial-gradient(circle, rgba(139,92,246,0.15) 0%, transparent 70%)" }} />
        <div className="absolute bottom-32 right-8 w-80 h-80 rounded-full animate-orbFloat2"
             style={{ background: "radial-gradient(circle, rgba(109,40,217,0.12) 0%, transparent 70%)" }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full animate-pulse-slow"
             style={{ background: "radial-gradient(circle, rgba(139,92,246,0.08) 0%, transparent 60%)" }} />

        {/* Subtle dot grid overlay */}
        <div className="absolute inset-0 opacity-[0.04]"
             style={{
               backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)",
               backgroundSize: "24px 24px",
             }} />

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center px-12 text-center">
          {/* Large robot logo */}
          <div className="mb-8">
            <svg viewBox="0 0 120 120" className="h-32 w-32" fill="none">
              {/* Glow behind robot */}
              <circle cx="60" cy="60" r="58" fill="#1e1b4b" />
              <circle cx="60" cy="60" r="58" stroke="#312e81" strokeWidth="2" opacity="0.6" />
              {/* Body */}
              <rect x="30" y="32" width="60" height="56" rx="12" fill="#1e1b4b" stroke="#312e81" strokeWidth="1.5" />
              <rect x="36" y="36" width="48" height="14" rx="4" fill="#0f0a2e" stroke="#312e81" strokeWidth="0.5" />
              {/* Left eye */}
              <ellipse cx="44" cy="62" rx="8" ry="7" fill="#6d28d9" opacity="0.3" className="animate-eyeGlow" />
              <ellipse cx="44" cy="62" rx="6" ry="5.5" fill="#6d28d9" opacity="0.5" className="animate-eyeGlow" />
              <ellipse cx="44" cy="62" rx="4" ry="3.5" fill="#8b5cf6" />
              <ellipse cx="44" cy="61" rx="2" ry="1.5" fill="#ede9fe" />
              {/* Right eye */}
              <ellipse cx="76" cy="62" rx="8" ry="7" fill="#6d28d9" opacity="0.3" className="animate-eyeGlow" />
              <ellipse cx="76" cy="62" rx="6" ry="5.5" fill="#6d28d9" opacity="0.5" className="animate-eyeGlow" />
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
              <circle cx="60" cy="18" r="4" fill="#6d28d9" opacity="0.8" className="animate-eyeGlow" />
              <circle cx="60" cy="18" r="2" fill="#8b5cf6" />
              {/* Ear pieces */}
              <rect x="22" y="52" width="8" height="20" rx="3" fill="#1e1b4b" stroke="#312e81" strokeWidth="1" />
              <rect x="90" y="52" width="8" height="20" rx="3" fill="#1e1b4b" stroke="#312e81" strokeWidth="1" />
            </svg>
          </div>

          <h1 className="text-3xl font-bold text-white tracking-tight">
            Pascal<span className="text-violet-400">.</span>
          </h1>
          <p className="text-violet-300/60 text-sm mt-2 max-w-[240px] leading-relaxed">
            AI-powered payment intelligence for your merchant operations
          </p>

          {/* Feature pills */}
          <div className="flex flex-wrap justify-center gap-2 mt-8">
            {["Analytics", "Integrations", "Knowledge Base", "Alerts"].map((f) => (
              <span key={f} className="text-[11px] font-medium text-violet-300/50 border border-violet-400/15 rounded-full px-3 py-1">
                {f}
              </span>
            ))}
          </div>
        </div>

        {/* Bottom attribution */}
        <div className="absolute bottom-6 flex items-center gap-1.5 text-[11px] text-gray-500">
          <span>Powered by</span>
          <span className="font-semibold text-gray-400">Tonder</span>
        </div>
      </div>

      {/* ── Right Panel — Login Form ── */}
      <div className="flex-1 flex items-center justify-center bg-white relative px-6">
        <div
          className={`w-full max-w-[360px] transition-opacity duration-500 ${mounted ? "opacity-100" : "opacity-0"}`}
          style={mounted ? { animation: "fadeInUp 0.6s ease-out" } : undefined}
        >
          {/* Mobile-only logo */}
          <div className="flex flex-col items-center mb-10 lg:hidden">
            <svg viewBox="0 0 120 120" className="h-16 w-16 mb-3" fill="none">
              <circle cx="60" cy="60" r="58" fill="#1e1b4b" />
              <circle cx="60" cy="60" r="58" stroke="#312e81" strokeWidth="2" />
              <rect x="30" y="32" width="60" height="56" rx="12" fill="#1e1b4b" stroke="#312e81" strokeWidth="1.5" />
              <rect x="36" y="36" width="48" height="14" rx="4" fill="#0f0a2e" stroke="#312e81" strokeWidth="0.5" />
              <ellipse cx="44" cy="62" rx="6" ry="5.5" fill="#6d28d9" opacity="0.5" />
              <ellipse cx="44" cy="62" rx="4" ry="3.5" fill="#8b5cf6" />
              <ellipse cx="44" cy="61" rx="2" ry="1.5" fill="#ede9fe" />
              <ellipse cx="76" cy="62" rx="6" ry="5.5" fill="#6d28d9" opacity="0.5" />
              <ellipse cx="76" cy="62" rx="4" ry="3.5" fill="#8b5cf6" />
              <ellipse cx="76" cy="61" rx="2" ry="1.5" fill="#ede9fe" />
              <rect x="42" y="74" width="36" height="8" rx="3" fill="#0f0a2e" stroke="#312e81" strokeWidth="0.5" />
              <line x1="60" y1="32" x2="60" y2="20" stroke="#312e81" strokeWidth="2" />
              <circle cx="60" cy="18" r="4" fill="#6d28d9" opacity="0.8" />
              <circle cx="60" cy="18" r="2" fill="#8b5cf6" />
              <rect x="22" y="52" width="8" height="20" rx="3" fill="#1e1b4b" stroke="#312e81" strokeWidth="1" />
              <rect x="90" y="52" width="8" height="20" rx="3" fill="#1e1b4b" stroke="#312e81" strokeWidth="1" />
            </svg>
            <h1 className="text-2xl font-bold text-gray-900">
              Pascal<span className="text-violet-600">.</span>
            </h1>
          </div>

          {/* Desktop heading */}
          <div className="hidden lg:block mb-8">
            <h2 className="text-2xl font-bold text-gray-900">Welcome back</h2>
            <p className="text-gray-400 text-sm mt-1">Enter your access key to continue</p>
          </div>

          {/* Error message */}
          {error && (
            <div className={`flex items-center gap-2 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl p-3.5 mb-5 ${shake ? "animate-shakeX" : ""}`}>
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1.5">
                Access Key
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your access key"
                  className="w-full border border-gray-200 rounded-xl pl-10 pr-4 py-3 text-sm bg-gray-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all placeholder:text-gray-300"
                  autoFocus
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !password}
              className="w-full bg-violet-600 text-white rounded-xl py-3 font-medium text-sm hover:bg-violet-700 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 transition-all shadow-sm shadow-violet-600/20 hover:shadow-md hover:shadow-violet-600/25"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spinner" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.25" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  Signing in...
                </span>
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          {/* Hint */}
          <p className="text-center text-[11px] text-gray-300 mt-4">
            Press <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-[10px] font-mono text-gray-400">Enter</kbd> to sign in
          </p>

          {/* Mobile footer */}
          <div className="flex items-center justify-center gap-1.5 mt-12 text-[11px] text-gray-300 lg:hidden">
            <span>Powered by</span>
            <span className="font-semibold text-gray-400">Tonder</span>
          </div>
        </div>

        {/* Desktop footer */}
        <div className="hidden lg:flex absolute bottom-6 items-center gap-1.5 text-[11px] text-gray-300">
          <span>Pascal Dashboard</span>
          <span className="text-gray-200">·</span>
          <span>Tonder AI Agent</span>
        </div>
      </div>
    </div>
  );
}
