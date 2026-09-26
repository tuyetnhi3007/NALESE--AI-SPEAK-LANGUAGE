# 🎙️ NALESE — AI Voice Language Learning Tutor

> Real-time voice conversations with an AI tutor powered by **GPT-4o**, **Whisper STT**, and **OpenAI TTS-1**.  
> Learn **English**, **Mandarin Chinese**, and **Japanese** through immersive voice roleplay, vocabulary exercises, and instant pronunciation feedback.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🎙️ **Real-time Voice Conversation** | Push-to-Talk or Continuous listening. Sub-5-second response latency |
| 🧠 **GPT-4o with Tool Calling** | AI can fetch real-time time/date, cultural facts, and word definitions |
| 📚 **Vocabulary File Upload** | Upload `.xlsx` or `.csv` with 4-column format → instant AI exercises |
| 🎭 **Topic Roleplay** | 8 curated scenarios (Travel, Work, Food, etc.) for EN/CN/JP |
| 🌊 **Audio Visualizer** | Real-time waveform during recording and playback |
| ⚙️ **Customizable** | Choose voice, speed, level, and mic mode |
| 📱 **Fully Responsive** | Works on mobile and desktop |

---

## 🚀 Quick Start

### 1. Prerequisites
- Node.js 18+
- An [OpenAI API Key](https://platform.openai.com/api-keys) with access to `gpt-4o`, `whisper-1`, and `tts-1`

### 2. Installation

```bash
# Clone or download the project to your machine
cd NALESE

# Install dependencies
npm install

# Create your environment file
cp .env.example .env.local

# Edit .env.local and add your OpenAI API key
# OPENAI_API_KEY=sk-your-key-here
```

### 3. Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

> **Tip**: You can also set your API key directly in the app UI (Settings icon in the top right). It's stored only in your browser's localStorage.

---

## 📁 Vocabulary File Format

Upload a `.xlsx` or `.csv` file with exactly **4 columns**:

| Column 1 | Column 2 | Column 3 | Column 4 |
|---|---|---|---|
| STT (Index) | Pinyin / Pronunciation | Target Language Word | Vietnamese Meaning |
| 1 | nǐ hǎo | 你好 | Xin chào |
| 2 | arigatou | ありがとう | Cảm ơn |
| 3 | thank you | thank you | Cảm ơn |

Download a [sample CSV template](./public/) from the Vocab Vault tab in the app.

---

## 🏗️ Architecture

```
/app
  /api
    /voice-chat      → Whisper STT + GPT-4o (Tool Calling) + TTS-1 pipeline
    /generate-exercises → AI quiz generator from vocabulary
    /tts             → Standalone TTS for word pronunciation
  page.tsx           → Main app page
  layout.tsx         → Root layout + SEO metadata
  globals.css        → Glassmorphic dark theme

/components
  Header.tsx         → Navigation, language switcher, latency badge
  VoiceTutor.tsx     → Voice recording studio with waveform visualizer
  VocabManager.tsx   → File upload, vocab table, exercise arena
  TopicRoleplay.tsx  → Language & topic selector with phrase guide
  SettingsModal.tsx  → API key, voice, speed, level settings
  SettingsContext.tsx → Global settings state (localStorage)

/lib
  openai.ts          → OpenAI client factory
  prompts.ts         → System prompts for EN/CN/JP with level adaptation
  tools.ts           → GPT-4o Function Calling tool definitions
  vocab-parser.ts    → 4-column CSV/XLSX parser
  audio-utils.ts     → Web Audio API utilities
  types.ts           → TypeScript type definitions
```

---

## 🌐 Deploy to Vercel

### Step 1: Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit: NALESE AI Language Tutor"
git remote add origin https://github.com/yourusername/nalese.git
git push -u origin main
```

### Step 2: Import to Vercel
1. Go to [vercel.com](https://vercel.com) → **Add New Project**
2. Import your GitHub repository
3. Vercel auto-detects Next.js — no configuration needed

### Step 3: Set Environment Variables
In **Vercel Project Settings → Environment Variables**, add:

| Key | Value |
|---|---|
| `OPENAI_API_KEY` | `sk-your-openai-api-key` |

### Step 4: Configure Function Timeout *(Important!)*
In **Vercel Project Settings → Functions**:
- Set **Max Duration** to `60` seconds for the voice pipeline API routes

### Step 5: Deploy
Click **Deploy**. Your app will be live at `https://your-project.vercel.app` in ~2 minutes!

---

## ⚡ Performance & Latency

The app is optimized to achieve **< 5 second voice response latency**:

1. **Single pipeline API call**: STT → GPT-4o → TTS in one serverless function (eliminates 2 extra round-trips)
2. **Optimized audio recording**: `audio/webm;codecs=opus` with 16kHz mono (≈30KB per 5-second clip)
3. **`tts-1` model**: Fastest OpenAI TTS model (vs `tts-1-hd` which is higher quality but slower)
4. **Concise prompting**: GPT-4o responses are capped at 300 tokens for natural conversation pacing
5. **Stateless architecture**: No database lookups, no session management overhead
6. **Tool Calling loop**: Maximum 1 tool call iteration to minimize latency impact

---

## 🛠️ Technology Stack

- **Frontend**: Next.js 15 (App Router), React 19, TypeScript
- **Styling**: Tailwind CSS + custom CSS animations
- **AI**: OpenAI GPT-4o, Whisper-1, TTS-1
- **Audio**: Web Audio API (recording, visualization, playback)
- **File Parsing**: SheetJS (xlsx), PapaParse-style CSV parser
- **Deployment**: Vercel Serverless Functions

---

## 📝 Notes

- The app works without authentication — anyone with the URL can use it (or your API key if set server-side)
- For production with multiple users, consider implementing rate limiting on the API routes
- OpenAI costs: ~$0.006 per minute of Whisper STT + ~$0.015 per 1K GPT-4o tokens + ~$0.015 per 1K TTS characters
- 15 concurrent users with ~10 requests each would cost approximately $2-5 per session

---

*Built with ❤️ using Next.js and OpenAI APIs*
