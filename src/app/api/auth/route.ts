import { NextRequest, NextResponse } from "next/server";
import { createSession, validateSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const token = createSession(email);
    if (!token) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }

    return NextResponse.json({ token, email: email.toLowerCase().trim() });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (!token) {
    return NextResponse.json({ error: "No token" }, { status: 401 });
  }

  const session = validateSession(token);
  if (!session) {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  return NextResponse.json({ email: session.email });
}
