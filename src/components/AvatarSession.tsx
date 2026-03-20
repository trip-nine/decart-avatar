"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

interface AvatarSessionProps {
  authToken: string;
  userEmail: string;
  onLogout: () => void;
}

type ConnectionState = "idle" | "connecting" | "connected" | "disconnected" | "error";

// Default avatar image (professional headshot placeholder)
const DEFAULT_AVATAR_URL = "https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=720&h=720&fit=crop&crop=face";

export default function AvatarSession({ authToken, userEmail, onLogout }: AvatarSessionProps) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [statusMessage, setStatusMessage] = useState("Click Connect to start your avatar session");
  const [chatLog, setChatLog] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesisUtterance | null>(null);
  const decartTokenRef = useRef<string>("");
  const chatLogRef = useRef<HTMLDivElement>(null);

  // Vercel AI SDK chat hook (v6 API)
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      headers: { Authorization: `Bearer ${authToken}` },
    }),
    onFinish: ({ message }) => {
      // When LLM response is complete, speak it through the avatar
      const text = message.parts
        ?.filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join("") || "";
      if (text) speakThroughAvatar(text);
    },
  });

  const isThinking = status === "streaming" || status === "submitted";

  // Auto-scroll chat log
  useEffect(() => {
    if (chatLogRef.current) {
      chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
    }
  }, [chatLog, messages]);

  // Get Decart client token from our backend
  const getDecartToken = async (): Promise<string> => {
    const res = await fetch("/api/decart-token", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const data = await res.json();
    return data.apiKey;
  };

  // File to base64 helper
  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // Connect to Decart Avatar Live via WebSocket + WebRTC
  const connectAvatar = useCallback(async () => {
    setConnectionState("connecting");
    setStatusMessage("Fetching credentials...");

    try {
      const apiKey = await getDecartToken();
      decartTokenRef.current = apiKey;

      setStatusMessage("Connecting to Decart...");

      // Connect via WebSocket
      const ws = new WebSocket(`wss://api3.decart.ai/v1/live_avatar/stream?api_key=${apiKey}`);
      wsRef.current = ws;

      ws.onopen = async () => {
        setStatusMessage("Sending avatar image...");
        // Fetch and send avatar image
        const imgRes = await fetch(DEFAULT_AVATAR_URL);
        const imgBlob = await imgRes.blob();
        const imgBase64 = await blobToBase64(imgBlob);

        ws.send(JSON.stringify({
          type: "set_image",
          image_data: imgBase64,
        }));
      };

      ws.onmessage = async (event) => {
        const message = JSON.parse(event.data);

        if (message.type === "set_image_ack") {
          setStatusMessage("Setting up video stream...");
          await setupWebRTC(ws);
        } else if (message.type === "answer" && pcRef.current) {
          await pcRef.current.setRemoteDescription({
            type: "answer",
            sdp: message.sdp,
          });
          setConnectionState("connected");
          setStatusMessage("Avatar connected — click the mic to talk");
        } else if (message.type === "error") {
          console.error("Decart error:", message);
          setStatusMessage(`Error: ${message.message || "Unknown error"}`);
          setConnectionState("error");
        }
      };

      ws.onerror = () => {
        setStatusMessage("WebSocket connection failed");
        setConnectionState("error");
      };

      ws.onclose = () => {
        if (connectionState === "connected") {
          setConnectionState("disconnected");
          setStatusMessage("Connection lost. Click Connect to reconnect.");
        }
      };
    } catch (error) {
      console.error("Connect error:", error);
      setStatusMessage("Failed to connect. Check console for details.");
      setConnectionState("error");
    }
  }, [authToken]);

  // Setup WebRTC peer connection
  const setupWebRTC = async (ws: WebSocket) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcRef.current = pc;

    // Send ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "ice-candidate",
          candidate: event.candidate,
        }));
      }
    };

    // Receive animated video stream
    pc.ontrack = (event) => {
      if (videoRef.current) {
        videoRef.current.srcObject = event.streams[0];
      }
    };

    // Add receive-only video transceiver
    pc.addTransceiver("video", { direction: "recvonly" });

    // Create silent audio stream for initial connection
    const audioContext = new AudioContext({ sampleRate: 16000 });
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const destination = audioContext.createMediaStreamDestination();
    gain.gain.value = 0;
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start();
    destination.stream.getTracks().forEach((track) => {
      pc.addTrack(track, destination.stream);
    });

    // Create and send offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({
      type: "offer",
      sdp: offer.sdp,
    }));
  };

  // Send audio blob to Decart for lip-sync
  const sendAudioToDecart = async (audioBlob: Blob) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const audioBase64 = await blobToBase64(audioBlob);
    wsRef.current.send(JSON.stringify({
      type: "audio",
      audio_data: audioBase64,
    }));
  };

  // Text-to-Speech → capture audio → send to Decart avatar
  const speakThroughAvatar = async (text: string) => {
    setIsSpeaking(true);
    setChatLog((prev) => [...prev, { role: "assistant", content: text }]);

    // Use Web Speech API TTS
    const utterance = new SpeechSynthesisUtterance(text);
    synthRef.current = utterance;

    // Select a good voice
    const voices = speechSynthesis.getVoices();
    const preferredVoice = voices.find(
      (v) => v.name.includes("Samantha") || v.name.includes("Google US English") || v.name.includes("Microsoft")
    ) || voices.find((v) => v.lang.startsWith("en"));
    if (preferredVoice) utterance.voice = preferredVoice;

    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    // Capture TTS audio using AudioContext + MediaRecorder for Decart lip-sync
    try {
      // Create an audio destination to capture TTS output
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      const dest = audioCtx.createMediaStreamDestination();
      const source = audioCtx.createMediaStreamSource(dest.stream);

      // Unfortunately, Web Speech API doesn't expose raw audio output.
      // For the prototype, we'll just speak via TTS and send the text as a prompt
      // to animate the avatar. In production, use ElevenLabs streaming TTS
      // which gives you raw audio bytes.

      // Set avatar behavior prompt to match speech
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: "prompt",
          prompt: "Speaking naturally with warm expressions, making eye contact",
        }));
      }

      await audioCtx.close();
    } catch (e) {
      // Silently continue - avatar animation is best-effort
    }

    utterance.onend = () => {
      setIsSpeaking(false);
      // Reset avatar to idle
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: "prompt",
          prompt: "Listening attentively with occasional subtle nods",
        }));
      }
    };

    speechSynthesis.speak(utterance);
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
      // Send the final transcript to the LLM
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
    wsRef.current?.close();
    pcRef.current?.close();
    speechSynthesis.cancel();
    recognitionRef.current?.stop();
    wsRef.current = null;
    pcRef.current = null;
    setConnectionState("idle");
    setStatusMessage("Disconnected. Click Connect to start a new session.");
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-card-border bg-card/50 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="12" r="6" stroke="currentColor" strokeWidth="2" />
            <path d="M8 26c0-4.4 3.6-8 8-8s8 3.6 8 8" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
            <circle cx="16" cy="12" r="2" fill="var(--accent)" />
          </svg>
          <span className="font-medium text-sm">AI Support Avatar</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-muted">{userEmail}</span>
          <button
            onClick={onLogout}
            className="text-xs text-muted hover:text-foreground transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Avatar panel */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
          {/* Video container */}
          <div className="relative avatar-video w-full max-w-2xl aspect-video bg-card border border-card-border">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />

            {/* Overlay when not connected */}
            {connectionState !== "connected" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-card/90 backdrop-blur-sm">
                <svg width="48" height="48" viewBox="0 0 32 32" fill="none" className="mb-4 opacity-30">
                  <circle cx="16" cy="12" r="6" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M8 26c0-4.4 3.6-8 8-8s8 3.6 8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <p className="text-muted text-sm">{statusMessage}</p>
              </div>
            )}

            {/* Status badge */}
            {connectionState === "connected" && (
              <div className="absolute top-3 left-3 flex items-center gap-2 px-2.5 py-1 bg-black/60 backdrop-blur-sm rounded-full">
                <span className={`status-dot ${connectionState}`} />
                <span className="text-xs text-white/80">Live</span>
              </div>
            )}

            {/* Speaking indicator */}
            {isSpeaking && connectionState === "connected" && (
              <div className="absolute bottom-3 left-3 flex items-center gap-2 px-2.5 py-1 bg-black/60 backdrop-blur-sm rounded-full">
                <div className="flex gap-0.5 items-end h-3">
                  <div className="w-0.5 bg-accent animate-pulse h-1" style={{ animationDelay: "0ms" }} />
                  <div className="w-0.5 bg-accent animate-pulse h-2" style={{ animationDelay: "150ms" }} />
                  <div className="w-0.5 bg-accent animate-pulse h-3" style={{ animationDelay: "300ms" }} />
                  <div className="w-0.5 bg-accent animate-pulse h-2" style={{ animationDelay: "450ms" }} />
                  <div className="w-0.5 bg-accent animate-pulse h-1" style={{ animationDelay: "600ms" }} />
                </div>
                <span className="text-xs text-white/80">Speaking</span>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-4">
            {connectionState === "idle" || connectionState === "error" || connectionState === "disconnected" ? (
              <button
                onClick={connectAvatar}
                className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-background font-medium rounded-lg transition-colors text-sm"
              >
                Connect Avatar
              </button>
            ) : connectionState === "connecting" ? (
              <button disabled className="px-6 py-2.5 bg-card border border-card-border text-muted rounded-lg text-sm flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-muted border-t-transparent rounded-full animate-spin" />
                Connecting...
              </button>
            ) : (
              <>
                {/* Mic button */}
                <div className="relative">
                  {isListening && (
                    <div className="absolute inset-0 rounded-full bg-accent/20 pulse-ring" />
                  )}
                  <button
                    onMouseDown={startListening}
                    onMouseUp={stopListening}
                    onTouchStart={startListening}
                    onTouchEnd={stopListening}
                    disabled={isThinking || isSpeaking}
                    className={`relative w-14 h-14 rounded-full flex items-center justify-center transition-all ${
                      isListening
                        ? "bg-accent text-background scale-110"
                        : "bg-card border border-card-border text-foreground hover:border-accent/50"
                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" x2="12" y1="19" y2="22" />
                    </svg>
                  </button>
                </div>

                {/* Disconnect */}
                <button
                  onClick={disconnect}
                  className="px-4 py-2 text-sm text-danger hover:bg-danger/10 rounded-lg transition-colors"
                >
                  Disconnect
                </button>
              </>
            )}
          </div>

          {/* Transcript display */}
          {(isListening || transcript) && (
            <div className="w-full max-w-2xl px-4 py-2 bg-card border border-card-border rounded-lg">
              <p className="text-sm text-muted">
                {isListening ? (
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-danger animate-pulse" />
                    {transcript || "Listening..."}
                  </span>
                ) : (
                  transcript
                )}
              </p>
            </div>
          )}

          {/* Text input fallback */}
          {connectionState === "connected" && (
            <form onSubmit={handleTextSubmit} className="w-full max-w-2xl flex gap-2">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Or type your question here..."
                disabled={isThinking || isSpeaking}
                className="flex-1 px-4 py-2.5 bg-card border border-card-border rounded-lg text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isThinking || isSpeaking || !textInput.trim()}
                className="px-4 py-2.5 bg-accent hover:bg-accent-hover text-background font-medium rounded-lg transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Send
              </button>
            </form>
          )}
        </div>

        {/* Chat sidebar */}
        <div className="w-80 border-l border-card-border flex flex-col bg-card/30">
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
              <div
                key={i}
                className={`text-sm ${
                  msg.role === "user" ? "text-right" : ""
                }`}
              >
                <div
                  className={`inline-block px-3 py-2 rounded-lg max-w-full ${
                    msg.role === "user"
                      ? "bg-accent/10 text-foreground"
                      : "bg-card border border-card-border text-foreground"
                  }`}
                >
                  <p className="text-xs text-muted mb-0.5">
                    {msg.role === "user" ? "You" : "AI Support"}
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                </div>
              </div>
            ))}
            {isThinking && (
              <div className="text-sm">
                <div className="inline-block px-3 py-2 rounded-lg bg-card border border-card-border">
                  <p className="text-xs text-muted mb-0.5">AI Support</p>
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

      {/* Footer */}
      <footer className="px-6 py-2 border-t border-card-border text-center">
        <p className="text-xs text-muted/40">
          Powered by Decart Avatar Live &middot; Hold mic to talk, release to send &middot;{" "}
          <a href="https://www.perplexity.ai/computer" target="_blank" rel="noopener noreferrer" className="hover:text-muted/60 transition-colors">
            Created with Perplexity Computer
          </a>
        </p>
      </footer>
    </div>
  );
}
