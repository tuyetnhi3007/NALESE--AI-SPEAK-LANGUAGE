// ============================================================
// lib/ai/index.ts — Provider Orchestrator
//
// Thứ tự ưu tiên:
//   STT:  Groq Whisper → OpenAI Whisper
//   LLM:  Gemini 2.0 Flash → OpenAI GPT-4o
//   TTS:  Browser SpeechSynthesis (Client-side, miễn phí)
//
// Tất cả key chỉ đọc từ process.env — không bao giờ expose ra client.
// ============================================================

import { buildSystemPrompt } from '@/lib/prompts';
import type { SupportedLanguage, LanguageLevel, VocabEntry, ToolResult } from '@/lib/types';

// ─── Kiểm tra provider có sẵn ────────────────────────────────

export type ProviderStatus = 'configured' | 'missing';

export interface ProvidersStatus {
  gemini: ProviderStatus;
  openai: ProviderStatus;
  groq: ProviderStatus;
  tts: 'browser' | 'openai' | 'none'; // Browser SpeechSynthesis (miễn phí, client-side)
}

/** Kiểm tra các API key đã được cấu hình chưa (server-side only). */
export function getProvidersStatus(overrideClientKey?: string): ProvidersStatus {
  return {
    gemini: process.env.GEMINI_API_KEY ? 'configured' : 'missing',
    openai: 'missing', // Đã xóa OpenAI (LLM)
    groq: process.env.GROQ_API_KEY ? 'configured' : 'missing',
    tts: 'browser', // Browser SpeechSynthesis (miễn phí, client-side)
  };
}

// ─── STT: Groq → OpenAI Whisper ──────────────────────────────

/**
 * Nhận diện giọng nói từ audio base64.
 * Ưu tiên Groq Whisper (miễn phí, nhanh), fallback sang OpenAI Whisper.
 */
export async function transcribeAudio(
  audioBase64: string,
  language: string,
  clientApiKey?: string
): Promise<{ transcript: string; provider: string }> {
  // Option 1: Groq Whisper (ưu tiên — miễn phí)
  if (process.env.GROQ_API_KEY) {
    try {
      const { transcribeWithGroq } = await import('./groq');
      const transcript = await transcribeWithGroq(audioBase64, language);
      return { transcript, provider: 'groq' };
    } catch (err) {
      console.warn('[STT] Groq failed, trying OpenAI Whisper:', err);
    }
  }

  // Không còn OpenAI Whisper (đã xóa)

  throw new Error('Không có STT provider nào được cấu hình. Cần GROQ_API_KEY.');
}

// ─── LLM: Gemini → OpenAI GPT-4o ─────────────────────────────

interface ChatOptions {
  language: SupportedLanguage;
  level: LanguageLevel;
  topic?: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  userMessage: string;
  vocabContext?: VocabEntry[];
  clientApiKey?: string; // OpenAI key từ UI settings (nếu người dùng cung cấp)
}

interface ChatResult {
  text: string;
  provider: string;
  toolResults?: ToolResult[];
}

/**
 * Gửi message đến AI và nhận response.
 * Ưu tiên Gemini (miễn phí tier), fallback sang OpenAI GPT-4o.
 */
export async function chatWithAI(opts: ChatOptions): Promise<ChatResult> {
  const t0 = Date.now();
  console.log('[PERF] llm_start', t0);

  const systemPrompt = buildSystemPrompt({
    language: opts.language,
    level: opts.level,
    topic: opts.topic,
    vocabContext: opts.vocabContext,
  });

  const errors: string[] = [];
  const safeHistory = (opts.history || []).slice(-8);

  // Option 1: Gemini 3.5 Flash Lite (ưu tiên — miễn phí, siêu nhanh ~800ms)
  if (process.env.GEMINI_API_KEY) {
    try {
      const { chatWithGemini } = await import('./gemini');
      const text = await chatWithGemini(
        systemPrompt,
        safeHistory,
        opts.userMessage,
        opts.clientApiKey
      );
      console.log('[PERF] llm_end', Date.now(), `duration: ${Date.now() - t0}ms`);
      return { text, provider: 'gemini' };
    } catch (err: any) {
      console.warn('[LLM] Gemini failed:', err);
      errors.push(`Gemini: ${err.message}`);
    }
  }

  // Option 2: Groq (fallback 1 — qwen3.8-27b siêu nhanh ~210ms)
  if (process.env.GROQ_API_KEY) {
    try {
      const { chatWithGroq } = await import('./groq');
      const text = await chatWithGroq(
        systemPrompt,
        safeHistory,
        opts.userMessage,
        opts.clientApiKey
      );
      console.log('[PERF] llm_end', Date.now(), `duration: ${Date.now() - t0}ms`);
      return { text, provider: 'groq' };
    } catch (err: any) {
      console.warn('[LLM] Groq failed:', err);
      errors.push(`Groq: ${err.message}`);
    }
  }

  // Option 3: OpenRouter (fallback 2)
  if (process.env.OPENROUTER_API_KEY) {
    try {
      const { chatWithOpenRouter } = await import('./openrouter');
      const result = await chatWithOpenRouter(
        systemPrompt,
        safeHistory,
        opts.userMessage,
        undefined
      );
      console.log('[PERF] llm_end', Date.now(), `duration: ${Date.now() - t0}ms`);
      return { text: result.text, provider: 'openrouter', toolResults: result.toolResults };
    } catch (err: any) {
      console.warn('[LLM] OpenRouter failed:', err);
      errors.push(`OpenRouter: ${err.message}`);
    }
  }

  throw new Error(
    `Tất cả LLM đều lỗi! ${errors.join(' | ')}`
  );
}

/**
 * Stream LLM response chunk by chunk for lowest first-token latency.
 */
export async function* chatWithAIStream(
  opts: ChatOptions
): AsyncGenerator<{ chunk: string; provider: string }, void, unknown> {
  const t0 = Date.now();
  console.log('[PERF] llm_start', t0);

  const safeHistory = (opts.history || []).slice(-8);
  const systemPrompt = buildSystemPrompt({
    language: opts.language,
    level: opts.level,
    topic: opts.topic,
    vocabContext: opts.vocabContext,
  });

  // Ưu tiên Gemini Stream
  if (process.env.GEMINI_API_KEY) {
    try {
      const { chatWithGeminiStream } = await import('./gemini');
      let first = true;
      for await (const chunk of chatWithGeminiStream(
        systemPrompt,
        safeHistory,
        opts.userMessage,
        opts.clientApiKey
      )) {
        if (first) {
          console.log('[PERF] llm_first_token', Date.now(), `ttft: ${Date.now() - t0}ms`);
          first = false;
        }
        yield { chunk, provider: 'gemini' };
      }
      console.log('[PERF] llm_end', Date.now(), `duration: ${Date.now() - t0}ms`);
      return;
    } catch (err: any) {
      console.warn('[LLMStream] Gemini stream failed, falling back:', err);
    }
  }

  // Fallback sang regular non-streaming nếu stream gặp lỗi
  const fallback = await chatWithAI(opts);
  console.log('[PERF] llm_first_token', Date.now(), `ttft: ${Date.now() - t0}ms`);
  yield { chunk: fallback.text, provider: fallback.provider };
  console.log('[PERF] llm_end', Date.now(), `duration: ${Date.now() - t0}ms`);
}

// ─── TTS: Browser SpeechSynthesis (Client-side duy nhất) ──────

/**
 * Text-to-Speech: Hoàn toàn do Browser SpeechSynthesis (Web Speech API) đảm nhiệm trên frontend.
 * Không gọi bất kỳ API bên ngoài nào, không cần API key.
 */
export async function textToSpeech(
  _text: string,
  _voice: string = 'nova',
  _speed: number = 1.0,
  _clientApiKey?: string
): Promise<{ audioBase64: string; provider: string }> {
  return { audioBase64: '', provider: 'browser-tts' };
}
