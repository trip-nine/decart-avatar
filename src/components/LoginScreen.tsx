"use client";

import { useState } from "react";

interface LoginScreenProps {
  onLogin: (token: string, email: string) => void;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Authentication failed");
        return;
      }

      onLogin(data.token, data.email);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center px-6 py-12"
      style={{ paddingBottom: "max(3rem, var(--safe-bottom))" }}>
      <div className="w-full max-w-sm">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-card border border-card-border mb-5">
            <svg
              width="28"
              height="28"
              viewBox="0 0 32 32"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="16" cy="12" r="6" stroke="currentColor" strokeWidth="2" />
              <path
                d="M8 26c0-4.4 3.6-8 8-8s8 3.6 8 8"
                stroke="var(--accent)"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <circle cx="16" cy="12" r="2" fill="var(--accent)" />
            </svg>
          </div>
          <h1 className="text-lg sm:text-xl font-semibold tracking-tight">
            AI Support Avatar
          </h1>
          <p className="text-muted text-xs sm:text-sm mt-1.5">
            Real-time technical support powered by Decart
          </p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-muted mb-1.5"
            >
              Email address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoComplete="email"
              autoCapitalize="none"
              className="w-full px-4 py-3 bg-card border border-card-border rounded-xl text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all text-base"
            />
          </div>

          {error && (
            <p className="text-danger text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !email}
            className="w-full py-3 px-4 bg-accent hover:bg-accent-hover active:scale-[0.98] text-background font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed text-base"
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-background border-t-transparent rounded-full animate-spin" />
                Signing in...
              </span>
            ) : (
              "Sign in"
            )}
          </button>
        </form>

        <p className="text-center text-muted/60 text-xs mt-6">
          Dev prototype — no verification email required
        </p>
      </div>
    </div>
  );
}
