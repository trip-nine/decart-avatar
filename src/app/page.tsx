"use client";

import { useState, useEffect } from "react";
import LoginScreen from "@/components/LoginScreen";
import AvatarSession from "@/components/AvatarSession";

export default function Home() {
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Check for existing session
    const stored = sessionStorage.getItem("auth_token");
    const email = sessionStorage.getItem("user_email");
    if (stored && email) {
      // Validate the token
      fetch("/api/auth", {
        headers: { Authorization: `Bearer ${stored}` },
      })
        .then((r) => {
          if (r.ok) {
            setAuthToken(stored);
            setUserEmail(email);
          } else {
            sessionStorage.removeItem("auth_token");
            sessionStorage.removeItem("user_email");
          }
        })
        .catch(() => {})
        .finally(() => setChecking(false));
    } else {
      setChecking(false);
    }
  }, []);

  const handleLogin = (token: string, email: string) => {
    sessionStorage.setItem("auth_token", token);
    sessionStorage.setItem("user_email", email);
    setAuthToken(token);
    setUserEmail(email);
  };

  const handleLogout = () => {
    sessionStorage.removeItem("auth_token");
    sessionStorage.removeItem("user_email");
    setAuthToken(null);
    setUserEmail("");
  };

  if (checking) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!authToken) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <AvatarSession
      authToken={authToken}
      userEmail={userEmail}
      onLogout={handleLogout}
    />
  );
}
