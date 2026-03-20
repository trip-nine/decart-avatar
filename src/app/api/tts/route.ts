import { NextRequest, NextResponse } from "next/server";
import { validateSession } from "@/lib/auth";

// TTS service configuration:
// - TTS_SERVICE_URL: URL to a TTS microservice (for sandbox/self-hosted)
// - OPENAI_API_KEY: If set to a real key (not placeholder), uses OpenAI TTS directly
// - Fallback: returns 503, client uses browser SpeechSynthesis
const TTS_SERVICE_URL = process.env.TTS_SERVICE_URL || "http://localhost:3099/tts";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

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
    const { text, voice } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    const trimmedText = text.slice(0, 2000);

    // Strategy 1: Try the TTS microservice (sandbox / self-hosted)
    try {
      const ttsRes = await fetch(TTS_SERVICE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: trimmedText,
          voice: voice || "aoede",
        }),
        signal: AbortSignal.timeout(25000),
      });

      if (ttsRes.ok) {
        const data = await ttsRes.json();
        return NextResponse.json({
          audio_base64: data.audio_base64,
          content_type: data.content_type || "audio/mpeg",
        });
      }
    } catch {
      // TTS microservice not available — try next strategy
    }

    // Strategy 2: Use OpenAI TTS directly if a real API key is configured
    if (OPENAI_API_KEY && !OPENAI_API_KEY.includes("placeholder")) {
      const openaiRes = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "tts-1",
          voice: "nova", // nova = warm female voice
          input: trimmedText,
          response_format: "mp3",
        }),
      });

      if (openaiRes.ok) {
        const audioBuffer = await openaiRes.arrayBuffer();
        const audioBase64 = Buffer.from(audioBuffer).toString("base64");
        return NextResponse.json({
          audio_base64: audioBase64,
          content_type: "audio/mpeg",
        });
      }
    }

    // No TTS backend available — client will fall back to browser SpeechSynthesis
    return NextResponse.json(
      { error: "No TTS service available. Set TTS_SERVICE_URL or OPENAI_API_KEY." },
      { status: 503 }
    );
  } catch (error) {
    console.error("TTS route error:", error);
    return NextResponse.json({ error: "TTS error" }, { status: 500 });
  }
}
