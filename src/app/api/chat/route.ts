import { NextRequest } from "next/server";
import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { validateSession } from "@/lib/auth";

const SYSTEM_PROMPT = `You are a highly knowledgeable technical support specialist avatar. You help users solve technical problems across software, hardware, networking, cloud services, and development tools.

Guidelines:
- Be concise and direct. Keep responses under 3 sentences when possible since your words will be spoken aloud by a video avatar.
- Diagnose issues systematically: ask clarifying questions when needed.
- Provide step-by-step solutions.
- If you don't know something, say so honestly.
- Use a friendly, professional tone — you're a real-time video avatar, so be conversational.
- Avoid markdown formatting, code blocks, or bullet lists since this will be spoken aloud. Use natural speech patterns instead.
- When referencing commands or code, spell them out naturally.`;

export async function POST(req: NextRequest) {
  // Validate auth
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  console.log("[/api/chat] Auth header present:", !!authHeader);
  console.log("[/api/chat] Token length:", token?.length || 0);

  if (!token) {
    console.log("[/api/chat] REJECTED: No token in Authorization header");
    console.log("[/api/chat] All headers:", Object.fromEntries(req.headers.entries()));
    return new Response("Unauthorized - no token", { status: 401 });
  }

  const session = validateSession(token);
  if (!session) {
    console.log("[/api/chat] REJECTED: JWT validation failed for token:", token.substring(0, 20) + "...");
    return new Response("Invalid session - JWT validation failed", { status: 401 });
  }

  console.log("[/api/chat] Auth OK for:", session.email);

  try {
    const body = await req.json();
    const { messages }: { messages: UIMessage[] } = body;

    if (!messages || !Array.isArray(messages)) {
      console.log("[/api/chat] No messages in body. Body keys:", Object.keys(body));
      return new Response("No messages provided", { status: 400 });
    }

    console.log("[/api/chat] Processing", messages.length, "UI messages");

    // Convert UI messages (from useChat) to model messages (for streamText)
    // AI SDK v6 sends UIMessage[] with parts, but streamText needs ModelMessage[]
    const modelMessages = await convertToModelMessages(messages);

    const result = streamText({
      model: openai("gpt-4o-mini"),
      system: SYSTEM_PROMPT,
      messages: modelMessages,
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error("[/api/chat] Error:", error);
    return new Response(`Chat error: ${error instanceof Error ? error.message : "Unknown"}`, { status: 500 });
  }
}
