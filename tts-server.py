"""
Lightweight TTS microservice using the sandbox's built-in Gemini TTS.
Runs on port 3099. The Next.js app calls this from /api/tts.

Start with: python tts-server.py
(requires api_credentials=["llm-api:audio"])
"""

import asyncio
import base64
import json
import os
import sys
import tempfile
import subprocess
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

PORT = 3099


class TTSHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == "/tts":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)
            text = data.get("text", "")
            voice = data.get("voice", "aoede")  # aoede = relaxed natural female

            if not text:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "No text provided"}).encode())
                return

            try:
                # Write text to temp file
                with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
                    f.write(text)
                    txt_path = f.name

                # Call the built-in TTS CLI
                out_path = txt_path.replace(".txt", ".mp3")
                params = json.dumps({
                    "file_path": txt_path,
                    "voice": voice,
                    "model": "gemini_2_5_pro_tts"
                })
                result = subprocess.run(
                    ["asi-text-to-speech", params],
                    capture_output=True, text=True, timeout=30
                )

                if result.returncode != 0:
                    raise RuntimeError(f"TTS failed: {result.stderr}")

                # Find the output file - CLI saves to workspace dir
                # Parse the output to find the actual file path
                output_line = result.stdout.strip()
                if "saved to" in output_line:
                    actual_path = output_line.split("saved to ")[1].split(" (")[0]
                else:
                    # Fallback: check common locations
                    basename = os.path.basename(txt_path).replace(".txt", ".mp3")
                    actual_path = os.path.join("/home/user/workspace", basename)

                if not os.path.exists(actual_path):
                    raise RuntimeError(f"Output file not found at {actual_path}")

                with open(actual_path, "rb") as f:
                    audio_bytes = f.read()

                # Clean up temp files
                os.unlink(txt_path)
                if os.path.exists(actual_path):
                    os.unlink(actual_path)

                # Return base64-encoded MP3
                audio_b64 = base64.b64encode(audio_bytes).decode()

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "audio_base64": audio_b64,
                    "content_type": "audio/mpeg",
                    "size": len(audio_bytes),
                }).encode())

            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())

        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format, *args):
        print(f"[TTS] {args[0]}", flush=True)


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), TTSHandler)
    print(f"[TTS] Server running on port {PORT}", flush=True)
    server.serve_forever()
# TTS is configured via OPENAI_API_KEY env var on Vercel
