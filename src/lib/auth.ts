// JWT-based session management for serverless (Vercel)
// Each token is self-contained — no shared state needed between Lambda instances

import jwt from "jsonwebtoken";

// Secret for signing JWTs — in production, use a proper secret from env
const JWT_SECRET = process.env.JWT_SECRET || "decart-avatar-prototype-secret-key-2026";
const TOKEN_EXPIRY = "24h";

interface SessionPayload {
  email: string;
  iat?: number;
  exp?: number;
}

export function createSession(email: string): string | null {
  const normalizedEmail = email.toLowerCase().trim();

  // Validate email format
  if (!normalizedEmail.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
    return null;
  }

  // Sign a JWT token — this is self-contained, no shared state needed
  const token = jwt.sign({ email: normalizedEmail }, JWT_SECRET, {
    expiresIn: TOKEN_EXPIRY,
  });

  return token;
}

export function validateSession(token: string): { email: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as SessionPayload;
    return { email: decoded.email };
  } catch {
    return null;
  }
}

export function isAllowedEmail(email: string): boolean {
  // For prototype, allow all valid emails
  return true;
}

// Keep generateSessionToken for backward compat if anything references it
export function generateSessionToken(): string {
  return createSession("anonymous@prototype")!;
}
