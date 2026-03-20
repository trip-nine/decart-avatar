"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { createDecartClient, models } from "@decartai/sdk";

interface AvatarSessionProps {
  authToken: string;
  userEmail: string;
  onLogout: () => void;
}

type ConnectionState = "idle" | "connecting" | "connected" | "disconnected" | "error";

// Default avatar image (professional female headshot)
const DEFAULT_AVATAR_URL = "https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=720&h=720&fit=crop&crop=face";

export default function AvatarSession({ authToken, userEmail, onLogout }: AvatarSessionProps) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [statusMessage, setStatusMessage] = useState("Click Connect to start your avatar session");
  const [chatLog, setChatLog] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const realtimeClientRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chatLogRef = useRef<HTMLDivElement>(null);

  // Vercel AI SDK chat hook (v6 API)
  // Use a ref to ensure transport always has the latest token
  const authTokenRef = useRef(authToken);
  authTokenRef.current = authToken;

  const transportRef = useRef(
    new DefaultChatTransport({
      api: "/api/chat",
      headers: () => ({
        Authorization: `Bearer ${authTokenRef.current}`,
      }),
    })
  );

  const { messages, sendMessage, status } = useChat({
    transport: transportRef.current,
    onFinish: ({ message }) => {
      const text = message.parts
        ?.filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join("") || "";
      if (text) speakThroughAvatar(text);
    },
    onError: (error) => {
      console.error("[useChat] Error:", error);
      setStatusMessage(`Chat error: ${error.message}`);
    },
  });

  const isThinking = status === "streaming" || status === "submitted";

  // Auto-scroll chat log
  useEffect(() => {
    if (chatLogRef.current) {
      chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
    }
  }, [chatLog, messages]);

  // Track unread messages when chat is closed (mobile)
  useEffect(() => {
    if (!chatOpen && chatLog.length > 0) {
      setUnreadCount((prev) => prev + 1);
    }
  }, [chatLog.length]);

  // Reset unread when chat opens
  useEffect(() => {
    if (chatOpen) setUnreadCount(0);
  }, [chatOpen]);

  // Get Decart client token from our backend
  const getDecartToken = async (): Promise<string> => {
    const res = await fetch("/api/decart-token", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const data = await res.json();
    return data.apiKey;
  };

  // Connect to Decart Avatar Live using the official SDK
  const connectAvatar = useCallback(async () => {
    setConnectionState("connecting");
    setStatusMessage("Fetching credentials...");

    try {
      const apiKey = await getDecartToken();

      setStatusMessage("Connecting to Decart Avatar...");

      // Create the Decart SDK client
      const client = createDecartClient({
        apiKey,
        realtimeBaseUrl: "wss://api3.decart.ai",
      });

      const model = models.realtime("live_avatar");

      // Load avatar image
      const imageResponse = await fetch(DEFAULT_AVATAR_URL);
      const avatarImage = await imageResponse.blob();

      setStatusMessage("Establishing video connection...");

      // Connect using the SDK — null means no camera input (avatar-only mode)
      // The SDK creates an AudioStreamManager internally for playAudio()
      const realtimeClient = await client.realtime.connect(null, {
        model,
        initialState: {
          image: avatarImage,
          prompt: {
            text: "A friendly, warm, professional female technical support specialist. She smiles gently, makes eye contact, and nods while listening. When speaking, she gestures naturally and shows engaged facial expressions.",
            enhance: true,
          },
        },
        onRemoteStream: (animatedStream: MediaStream) => {
          if (videoRef.current) {
            videoRef.current.srcObject = animatedStream;
          }
        },
      });

      realtimeClientRef.current = realtimeClient;

      // Listen for connection state changes
      realtimeClient.on("connectionChange", (state: string) => {
        console.log("Decart connection state:", state);
        if (state === "connected" || state === "generating") {
          setConnectionState("connected");
          setStatusMessage("Avatar connected — tap mic to talk");
        } else if (state === "disconnected") {
          setConnectionState("disconnected");
          setStatusMessage("Connection lost. Tap Connect to reconnect.");
        } else if (state === "reconnecting") {
          setStatusMessage("Reconnecting...");
        }
      });

      // Listen for errors
      realtimeClient.on("error", (error: any) => {
        console.error("Decart error:", error);
        setStatusMessage(`Error: ${error?.message || "Unknown error"}`);
      });

      setConnectionState("connected");
      setStatusMessage("Avatar connected — tap mic to talk");
    } catch (error) {
      console.error("Connect error:", error);
      setStatusMessage(`Failed to connect: ${error instanceof Error ? error.message : "Unknown error"}`);
      setConnectionState("error");
    }
  }, [authToken]);

  // Text-to-Speech pipeline:
  // 1. Call /api/tts to generate MP3 audio bytes (female voice)
  // 2. Feed audio to Decart SDK's playAudio() for lip-sync
  // 3. Play audio in browser simultaneously
  const speakThroughAvatar = async (text: string) => {
    setIsSpeaking(true);
    setChatLog((prev) => [...prev, { role: "assistant", content: text }]);

    try {
      // 1. Generate TTS audio via server-side API
      const ttsRes = await fetch("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ text, voice: "aoede" }), // aoede = natural female
      });

      if (!ttsRes.ok) {
        throw new Error(`TTS failed: ${ttsRes.status}`);
      }

      const { audio_base64, content_type } = await ttsRes.json();

      // Decode base64 to bytes
      const audioBytes = Uint8Array.from(atob(audio_base64), (c) => c.charCodeAt(0));
      const audioBlob = new Blob([audioBytes], { type: content_type || "audio/mpeg" });

      // 2. Feed audio to Decart SDK for lip-sync animation
      // playAudio() sends audio through the WebRTC audio track — the server
      // detects it and animates the avatar's lips accordingly
      if (realtimeClientRef.current?.playAudio) {
        // Play through Decart (lip-sync) — this returns when audio finishes
        // We run it in parallel with browser audio playback
        realtimeClientRef.current.playAudio(audioBlob).catch((err: Error) => {
          console.warn("Decart playAudio error:", err);
        });
      }

      // 3. Also play audio in browser so the user hears the voice
      const audioUrl = URL.createObjectURL(audioBlob);

      // Stop any previous audio
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute("src");
      }

      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onended = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
      };

      audio.onerror = () => {
        console.error("Audio playback error");
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
      };

      await audio.play();
    } catch (error) {
      console.error("TTS/speak error:", error);
      setIsSpeaking(false);

      // Fallback: use browser SpeechSynthesis if TTS service is unavailable
      try {
        const utterance = new SpeechSynthesisUtterance(text);
        const voices = speechSynthesis.getVoices();
        const femaleVoice = voices.find(
          (v) => v.name.includes("Samantha") || v.name.includes("Google US English")
        ) || voices.find((v) => v.lang.startsWith("en"));
        if (femaleVoice) utterance.voice = femaleVoice;
        utterance.rate = 1.0;
        utterance.onend = () => setIsSpeaking(false);
        setIsSpeaking(true);
        speechSynthesis.speak(utterance);
      } catch {
        // Silently fail — at least the chat log shows the response
      }
    }
  };

  // Start speech recognition
  const startListening = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setStatusMessage("Speech recognition not supported in this browser");
      return;
    }

    const recognition = new SR();
    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let finalTranscript = "";

    recognition.onstart = () => {
      setIsListening(true);
      setTranscript("");
      finalTranscript = "";
    };

    recognition.onresult = (event: any) => {
      let interim = "";
      let accumulated = "";
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          accumulated += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      finalTranscript = accumulated;
      setTranscript(accumulated || interim);
    };

    recognition.onend = () => {
      setIsListening(false);
      if (finalTranscript.trim()) {
        const userMessage = finalTranscript.trim();
        setChatLog((prev) => [...prev, { role: "user", content: userMessage }]);
        sendMessage({ text: userMessage });
        setTranscript("");
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      setIsListening(false);
      if (event.error === "not-allowed") {
        setStatusMessage("Microphone access denied. Please allow mic access.");
      }
    };

    recognition.start();
  };

  const stopListening = () => {
    recognitionRef.current?.stop();
  };

  // Text input fallback
  const [textInput, setTextInput] = useState("");
  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    const msg = textInput.trim();
    setChatLog((prev) => [...prev, { role: "user", content: msg }]);
    sendMessage({ text: msg });
    setTextInput("");
  };

  // Disconnect
  const disconnect = () => {
    // Use SDK's disconnect method
    if (realtimeClientRef.current) {
      realtimeClientRef.current.disconnect();
      realtimeClientRef.current = null;
    }
    // Stop any playing TTS audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current = null;
    }
    speechSynthesis.cancel();
    recognitionRef.current?.stop();
    setConnectionState("idle");
    setIsSpeaking(false);
    setStatusMessage("Disconnected. Tap Connect to start a new session.");
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const isConnected = connectionState === "connected";
  const isIdle = connectionState === "idle" || connectionState === "error" || connectionState === "disconnected";

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden">
      {/* Header — compact on mobile */}
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-card-border bg-card/50 backdrop-blur-sm shrink-0"
        style={{ paddingTop: "max(0.625rem, var(--safe-top))" }}>
        <div className="flex items-center gap-2">
          <svg width="20" height="20" viewBox="0 0 32 32" fill="none" className="shrink-0">
            <circle cx="16" cy="12" r="6" stroke="currentColor" strokeWidth="2" />
            <path d="M8 26c0-4.4 3.6-8 8-8s8 3.6 8 8" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
            <circle cx="16" cy="12" r="2" fill="var(--accent)" />
          </svg>
          <span className="font-medium text-sm">AI Support</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted hidden sm:inline">{userEmail}</span>
          <button
            onClick={onLogout}
            className="text-xs text-muted hover:text-foreground transition-colors py-1 px-2"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Main content — desktop: side by side, mobile: stacked */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">

        {/* Avatar panel — takes full width on mobile, left side on desktop */}
        <div className="flex-1 flex flex-col items-center justify-center p-4 pt-6 lg:p-6 gap-4 min-h-0 relative">

          {/* Video container — responsive sizing */}
          <div className="relative avatar-video w-full max-w-[90vw] lg:max-w-2xl aspect-video bg-card border border-card-border">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />

            {/* Overlay when not connected */}
            {!isConnected && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-card/90 backdrop-blur-sm px-6">
                <svg width="40" height="40" viewBox="0 0 32 32" fill="none" className="mb-3 opacity-30">
                  <circle cx="16" cy="12" r="6" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M8 26c0-4.4 3.6-8 8-8s8 3.6 8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <p className="text-muted text-xs sm:text-sm text-center leading-relaxed max-w-[280px]">{statusMessage}</p>
              </div>
            )}

            {/* Status badge */}
            {isConnected && (
              <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 px-2 py-0.5 bg-black/60 backdrop-blur-sm rounded-full">
                <span className={`status-dot ${connectionState}`} />
                <span className="text-[10px] text-white/80">Live</span>
              </div>
            )}

            {/* Speaking indicator */}
            {isSpeaking && isConnected && (
              <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 px-2 py-0.5 bg-black/60 backdrop-blur-sm rounded-full">
                <div className="flex gap-0.5 items-end h-3">
                  <div className="audio-bar" style={{ animationDelay: "0ms" }} />
                  <div className="audio-bar" style={{ animationDelay: "150ms" }} />
                  <div className="audio-bar" style={{ animationDelay: "300ms" }} />
                  <div className="audio-bar" style={{ animationDelay: "450ms" }} />
                  <div className="audio-bar" style={{ animationDelay: "600ms" }} />
                </div>
                <span className="text-[10px] text-white/80">Speaking</span>
              </div>
            )}
          </div>

          {/* Transcript display */}
          {(isListening || transcript) && (
            <div className="w-full max-w-[90vw] lg:max-w-2xl px-3 py-2 bg-card border border-card-border rounded-lg">
              <p className="text-xs sm:text-sm text-muted">
                {isListening ? (
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-danger animate-pulse shrink-0" />
                    {transcript || "Listening..."}
                  </span>
                ) : (
                  transcript
                )}
              </p>
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center gap-3">
            {isIdle ? (
              <button
                onClick={connectAvatar}
                className="px-6 py-3 bg-accent hover:bg-accent-hover active:scale-95 text-background font-medium rounded-xl transition-all text-sm"
              >
                Connect Avatar
              </button>
            ) : connectionState === "connecting" ? (
              <button disabled className="px-6 py-3 bg-card border border-card-border text-muted rounded-xl text-sm flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-muted border-t-transparent rounded-full animate-spin" />
                Connecting...
              </button>
            ) : (
              <>
                {/* Mic button — large, touch-friendly */}
                <div className="relative">
                  {isListening && (
                    <div className="absolute inset-0 rounded-full bg-accent/20 pulse-ring" />
                  )}
                  <button
                    onMouseDown={startListening}
                    onMouseUp={stopListening}
                    onTouchStart={(e) => { e.preventDefault(); startListening(); }}
                    onTouchEnd={(e) => { e.preventDefault(); stopListening(); }}
                    disabled={isThinking || isSpeaking}
                    className={`relative w-16 h-16 rounded-full flex items-center justify-center transition-all touch-none ${
                      isListening
                        ? "bg-accent text-background scale-110"
                        : "bg-card border-2 border-card-border text-foreground hover:border-accent/50 active:scale-95"
                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" x2="12" y1="19" y2="22" />
                    </svg>
                  </button>
                </div>

                {/* Chat toggle button (mobile only — on desktop chat is always visible) */}
                <button
                  onClick={() => setChatOpen(true)}
                  className="relative lg:hidden w-12 h-12 rounded-full bg-card border border-card-border flex items-center justify-center hover:border-accent/50 active:scale-95 transition-all"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-accent text-background text-[10px] font-bold rounded-full flex items-center justify-center">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </button>

                {/* Disconnect */}
                <button
                  onClick={disconnect}
                  className="w-12 h-12 rounded-full bg-card border border-card-border flex items-center justify-center text-danger hover:bg-danger/10 active:scale-95 transition-all"
                  title="Disconnect"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
                    <line x1="12" x2="12" y1="2" y2="12" />
                  </svg>
                </button>
              </>
            )}
          </div>

          {/* Text input — shown when connected */}
          {isConnected && (
            <form onSubmit={handleTextSubmit} className="w-full max-w-[90vw] lg:max-w-2xl flex gap-2">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Type your question..."
                disabled={isThinking || isSpeaking}
                className="flex-1 px-3.5 py-2.5 bg-card border border-card-border rounded-xl text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isThinking || isSpeaking || !textInput.trim()}
                className="px-4 py-2.5 bg-accent hover:bg-accent-hover active:scale-95 text-background font-medium rounded-xl transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                Send
              </button>
            </form>
          )}
        </div>

        {/* Chat sidebar — DESKTOP ONLY (always visible) */}
        <div className="hidden lg:flex w-80 border-l border-card-border flex-col bg-card/30">
          <div className="px-4 py-3 border-b border-card-border">
            <h2 className="text-sm font-medium">Conversation</h2>
          </div>
          <div ref={chatLogRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {chatLog.length === 0 && (
              <p className="text-xs text-muted/50 text-center mt-8">
                Messages will appear here
              </p>
            )}
            {chatLog.map((msg, i) => (
              <div key={i} className={`text-sm ${msg.role === "user" ? "text-right" : ""}`}>
                <div
                  className={`inline-block px-3 py-2 rounded-xl max-w-[85%] ${
                    msg.role === "user"
                      ? "bg-accent/10 text-foreground"
                      : "bg-card border border-card-border text-foreground"
                  }`}
                >
                  <p className="text-[10px] text-muted mb-0.5">
                    {msg.role === "user" ? "You" : "AI Support"}
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                </div>
              </div>
            ))}
            {isThinking && (
              <div className="text-sm">
                <div className="inline-block px-3 py-2 rounded-xl bg-card border border-card-border">
                  <p className="text-[10px] text-muted mb-0.5">AI Support</p>
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile chat sheet overlay */}
      {chatOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col">
          {/* Backdrop */}
          <div
            className="chat-sheet-backdrop absolute inset-0"
            onClick={() => setChatOpen(false)}
          />

          {/* Sheet */}
          <div className="chat-sheet-enter relative mt-auto bg-background border-t border-card-border rounded-t-2xl flex flex-col"
            style={{ maxHeight: "75dvh", paddingBottom: "var(--safe-bottom)" }}>
            {/* Handle */}
            <div className="flex justify-center py-2 shrink-0">
              <div className="w-10 h-1 rounded-full bg-card-border" />
            </div>

            {/* Chat header */}
            <div className="flex items-center justify-between px-4 pb-2 border-b border-card-border shrink-0">
              <h2 className="text-sm font-medium">Conversation</h2>
              <button
                onClick={() => setChatOpen(false)}
                className="w-8 h-8 rounded-full bg-card flex items-center justify-center text-muted hover:text-foreground transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" x2="6" y1="6" y2="18" />
                  <line x1="6" x2="18" y1="6" y2="18" />
                </svg>
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
              {chatLog.length === 0 && (
                <p className="text-xs text-muted/50 text-center mt-8">
                  Messages will appear here
                </p>
              )}
              {chatLog.map((msg, i) => (
                <div key={i} className={`text-sm ${msg.role === "user" ? "text-right" : ""}`}>
                  <div
                    className={`inline-block px-3 py-2 rounded-xl max-w-[85%] ${
                      msg.role === "user"
                        ? "bg-accent/10 text-foreground"
                        : "bg-card border border-card-border text-foreground"
                    }`}
                  >
                    <p className="text-[10px] text-muted mb-0.5">
                      {msg.role === "user" ? "You" : "AI Support"}
                    </p>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                  </div>
                </div>
              ))}
              {isThinking && (
                <div className="text-sm">
                  <div className="inline-block px-3 py-2 rounded-xl bg-card border border-card-border">
                    <p className="text-[10px] text-muted mb-0.5">AI Support</p>
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Chat input inside sheet */}
            {isConnected && (
              <form onSubmit={handleTextSubmit} className="flex gap-2 px-4 py-3 border-t border-card-border shrink-0">
                <input
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="Type your question..."
                  disabled={isThinking || isSpeaking}
                  className="flex-1 px-3.5 py-2.5 bg-card border border-card-border rounded-xl text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={isThinking || isSpeaking || !textInput.trim()}
                  className="px-4 py-2.5 bg-accent hover:bg-accent-hover active:scale-95 text-background font-medium rounded-xl transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                >
                  Send
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Footer — compact */}
      <footer className="px-4 py-1.5 border-t border-card-border text-center shrink-0"
        style={{ paddingBottom: "max(0.375rem, var(--safe-bottom))" }}>
        <p className="text-[10px] sm:text-xs text-muted/40">
          Powered by Decart Avatar Live &middot; Hold mic to talk &middot;{" "}
          <a href="https://www.perplexity.ai/computer" target="_blank" rel="noopener noreferrer" className="hover:text-muted/60 transition-colors">
            Created with Perplexity Computer
          </a>
        </p>
      </footer>
    </div>
  );
}
