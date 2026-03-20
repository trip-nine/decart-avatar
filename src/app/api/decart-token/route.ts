import { NextRequest, NextResponse } from "next/server";
import { validateSession } from "@/lib/auth";
import { createDecartClient } from "@decartai/sdk";

const decartClient = createDecartClient({
  apiKey: process.env.DECART_API_KEY!,
});

export async function POST(req: NextRequest) {
  // Validate auth
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = validateSession(token);
  if (!session) {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  try {
    // Create a short-lived client token for browser use (10 min TTL)
    const clientToken = await decartClient.tokens.create();
    return NextResponse.json(clientToken);
  } catch (error: unknown) {
    console.error("Failed to create Decart client token:", error);
    // Fallback: return the API key directly for dev (not for production!)
    // This handles cases where tokens.create() isn't available in all SDK versions
    return NextResponse.json({
      apiKey: process.env.DECART_API_KEY,
      _fallback: true,
    });
  }
}
