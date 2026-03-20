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

  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const session = validateSession(token);
  if (!session) {
    return new Response("Invalid session", { status: 401 });
  }

  try {
    const body = await req.json();
    const { messages }: { messages: UIMessage[] } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response("No messages provided", { status: 400 });
    }

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
    console.error("Chat error:", error);
    return new Response("Chat error", { status: 500 });
  }
}
