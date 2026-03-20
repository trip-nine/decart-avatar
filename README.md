# Decart AI Support Avatar

Real-time technical support AI video persona powered by [Decart Avatar Live](https://platform.decart.ai), with speech recognition, LLM responses via OpenAI, and browser-based TTS.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ftrip-nine%2Fdecart-avatar&env=DECART_API_KEY,OPENAI_API_KEY&envDescription=API%20keys%20for%20Decart%20and%20OpenAI&envLink=https%3A%2F%2Fplatform.decart.ai&project-name=decart-avatar&repository-name=decart-avatar)

## Architecture

```
Browser STT (Web Speech API)
    → OpenAI GPT-4o-mini (Vercel AI SDK)
        → Browser TTS (Web Speech Synthesis)
            → Decart Avatar Live (WebRTC lip-sync)
```

## Features

- **Email auth** — simple session-based authentication
- **Real-time avatar** — Decart Avatar Live via WebSocket + WebRTC
- **Voice input** — hold-to-talk with Web Speech API recognition
- **LLM responses** — OpenAI GPT-4o-mini via Vercel AI SDK streaming
- **Browser TTS** — zero-latency text-to-speech for avatar lip-sync
- **Chat sidebar** — full conversation transcript

## Setup

1. Clone and install:
```bash
git clone https://github.com/trip-nine/decart-avatar.git
cd decart-avatar
npm install
```

2. Configure environment:
```bash
cp .env.example .env.local
# Edit .env.local with your API keys
```

3. Run locally:
```bash
npm run dev
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DECART_API_KEY` | Your Decart API key from [platform.decart.ai](https://platform.decart.ai) |
| `OPENAI_API_KEY` | Your OpenAI API key from [platform.openai.com](https://platform.openai.com) |

## Extending

### Swap in ElevenLabs TTS
Replace the Web Speech API TTS with ElevenLabs streaming for higher quality voice. The audio bytes can be piped directly to Decart's `playAudio()` for perfect lip-sync.

### Add Deepgram STT
Replace Web Speech API recognition with Deepgram streaming for more reliable transcription.

### Pipecat Integration
For a production pipeline, use [Pipecat](https://github.com/pipecat-ai/pipecat) to orchestrate STT → LLM → TTS → Decart in a single framework.

## Tech Stack

- Next.js 16 (App Router)
- Decart Avatar Live SDK (`@decartai/sdk`)
- Vercel AI SDK v6 (`ai`, `@ai-sdk/openai`)
- Tailwind CSS
- TypeScript
