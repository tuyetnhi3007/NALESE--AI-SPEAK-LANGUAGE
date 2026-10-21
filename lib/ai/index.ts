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

import { areAllModelsInCooldown, getGlobalDailyResetHours } from './errors';
import { FAST_GEMINI_MODELS } from './gemini';

export class ChatSystemError extends Error {
  kind: 'quota' | 'busy' | 'key';
  resetHours?: number;
  constructor(kind: 'quota' | 'busy' | 'key', message: string, resetHours?: number) {
    super(message);
    this.name = 'ChatSystemError';
    this.kind = kind;
    this.resetHours = resetHours;
  }
}

interface ChatOptions {
  language: SupportedLanguage;
  level: LanguageLevel;
  topic?: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  userMessage: string;
  vocabContext?: VocabEntry[];
  clientApiKey?: string;
}

interface ChatResult {
  text: string;
  provider: string;
  toolResults?: ToolResult[];
}

/**
 * Gửi message đến AI và nhận response.
 * Thứ tự ưu tiên: 1. Gemini -> 2. Groq -> 3. OpenRouter.
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

  // Option 1: Gemini (ưu tiên — miễn phí tier)
  if (process.env.GEMINI_API_KEY) {
    if (!areAllModelsInCooldown(FAST_GEMINI_MODELS)) {
      try {
        const { chatWithGemini } = await import('./gemini');
        const text = await chatWithGemini(
          systemPrompt,
          safeHistory,
          opts.userMessage,
          opts.clientApiKey
        );
        return { text, provider: 'gemini' };
      } catch (err: any) {
        errors.push(`Gemini: ${err.message}`);
      }
    }
  }

  // Option 2: Groq (fallback 1 — qwen3.8-27b siêu nhanh ~300-800ms)
  if (process.env.GROQ_API_KEY) {
    try {
      const { chatWithGroq } = await import('./groq');
      const text = await chatWithGroq(
        systemPrompt,
        safeHistory,
        opts.userMessage,
        opts.clientApiKey
      );
      return { text, provider: 'groq' };
    } catch (err: any) {
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
      return { text: result.text, provider: 'openrouter', toolResults: result.toolResults };
    } catch (err: any) {
      errors.push(`OpenRouter: ${err.message}`);
    }
  }

  // Khi TẤT CẢ nhà cung cấp đều lỗi: Phân loại lỗi chính xác, không dùng câu trả lời giả
  const allErrStr = errors.join(' | ');

  const resetHours = getGlobalDailyResetHours();
  const isDailyQuota = allErrStr.includes('DAILY_QUOTA_EXCEEDED') || allErrStr.includes('PerDay') || allErrStr.includes('quota');
  const isKeyInvalid = allErrStr.includes('KEY_INVALID') || allErrStr.includes('API_KEY_INVALID') || allErrStr.includes('401') || allErrStr.includes('403');

  if (isDailyQuota) {
    const msg = resetHours
      ? `Hôm nay đã hết lượt dùng AI, vui lòng thử lại sau khoảng ${resetHours} giờ.`
      : 'Hôm nay đã hết lượt dùng AI, vui lòng thử lại vào ngày mai.';
    throw new ChatSystemError('quota', msg, resetHours);
  }

  if (isKeyInvalid) {
    throw new ChatSystemError('key', 'API key không hợp lệ hoặc đã hết hạn. Vui lòng kiểm tra lại khóa API.');
  }

  throw new ChatSystemError('busy', 'Luna đang bận, vui lòng thử lại sau ít phút.');
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

  // Ưu tiên Gemini Stream (bỏ qua ngay nếu tất cả model Gemini đang cooldown)
  const geminiCooldownStream = areAllModelsInCooldown(FAST_GEMINI_MODELS);
  if (process.env.GEMINI_API_KEY && !geminiCooldownStream) {
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
