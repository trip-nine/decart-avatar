// Simple in-memory session store for prototype
// In production, replace with a proper auth provider (NextAuth, Clerk, etc.)

const sessions = new Map<string, { email: string; createdAt: number }>();

// Allowed emails for dev access - add more as needed
const ALLOWED_EMAILS = new Set([
  "trip@ekballouniversity.com",
  "demo@decart.ai",
  "admin@localhost",
]);

export function generateSessionToken(): string {
  const array = new Uint8Array(32);
  // Use crypto in Node.js environment
  const crypto = require("crypto");
  crypto.randomFillSync(array);
  return Array.from(array, (b: number) => b.toString(16).padStart(2, "0")).join("");
}

export function createSession(email: string): string | null {
  const normalizedEmail = email.toLowerCase().trim();

  // For dev prototype: allow any valid email format
  // In production, validate against allowed list or send verification email
  if (!normalizedEmail.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
    return null;
  }

  const token = generateSessionToken();
  sessions.set(token, { email: normalizedEmail, createdAt: Date.now() });

  // Clean old sessions (older than 24h)
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [key, val] of sessions) {
    if (val.createdAt < cutoff) sessions.delete(key);
  }

  return token;
}

export function validateSession(token: string): { email: string } | null {
  const session = sessions.get(token);
  if (!session) return null;

  // 24h expiry
  if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) {
    sessions.delete(token);
    return null;
  }

  return { email: session.email };
}

export function isAllowedEmail(email: string): boolean {
  // For prototype, allow all valid emails
  return true;
  // For restricted access, uncomment:
  // return ALLOWED_EMAILS.has(email.toLowerCase().trim());
}
