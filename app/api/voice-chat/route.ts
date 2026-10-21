// ============================================================
// app/api/voice-chat/route.ts — Unified Voice Chat Pipeline
//
// Pipeline (ưu tiên free, bảo mật key hoàn toàn ở server):
//   STT:  text (Web Speech API, free) → Groq Whisper
//   LLM:  Gemini 3.5 Flash Lite (siêu nhanh ~800ms) → Groq (Llama/Qwen)
//   TTS:  Browser SpeechSynthesis (Client-side)
//
// Tối ưu hóa:
//   - Hỗ trợ Stream SSE (First token ~600-900ms)
//   - Hỗ trợ song song hóa Pronunciation qua skipPronunciation flag
//   - Internal logs đo latency [PERF]
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { transcribeAudio, chatWithAI, chatWithAIStream, ChatSystemError } from '@/lib/ai';
import { assessPronunciation, getPronunciationConfig } from '@/lib/ai/pronunciation';
import type { VoiceChatRequest, VoiceChatResponse, PronunciationAssessmentResult } from '@/lib/types';
import { ensureRomaji } from '@/lib/japanese';

export const maxDuration = 60;

const PROMPT_LEAK_PATTERNS = [
  /JSON formatting/i,
  /Bạn là Luna/i,
  /QUY TẮC PHẢN HỒI/i,
  /TARGET:/i,
  /Định dạng JSON bắt buộc/i,
  /System Instruction/i,
  /buildSystemPrompt/i,
  /^\s*\{\s*"/,
];

function isPromptLeak(str: string): boolean {
  if (!str) return false;
  return PROMPT_LEAK_PATTERNS.some((pattern) => pattern.test(str));
}

export function parseAIResponse(raw: string): {
  original: string;
  romanization: string;
  translation: string;
  userRomanization?: string;
  userTranslation?: string;
} {
  const fallback = {
    original: 'Luna chưa nghe rõ, bạn nói lại nhé.',
    romanization: '',
    translation: 'Luna chưa nghe rõ, bạn nói lại nhé.',
    userRomanization: undefined,
    userTranslation: undefined,
  };

  if (!raw) return fallback;
  
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // 1. Thử parse JSON hoàn chỉnh nếu có đủ cặp ngoặc {} (đã xóa dấu phẩy thừa)
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    let jsonCandidate = cleaned.slice(firstBrace, lastBrace + 1);
    jsonCandidate = jsonCandidate.replace(/,\s*([}\]])/g, '$1'); // Xóa dấu phẩy thừa
    try {
      const parsed = JSON.parse(jsonCandidate);
      if (parsed && typeof parsed === 'object') {
        const original = typeof parsed.original === 'string'
          ? parsed.original.trim()
          : (typeof parsed.originalText === 'string'
            ? parsed.originalText.trim()
            : (typeof parsed.chinese === 'string'
              ? parsed.chinese.trim()
              : (typeof parsed.text === 'string' ? parsed.text.trim() : '')));

        const romanization = typeof parsed.romanization === 'string'
          ? parsed.romanization.trim()
          : (typeof parsed.pinyin === 'string'
            ? parsed.pinyin.trim()
            : (typeof parsed.romaji === 'string' ? parsed.romaji.trim() : ''));

        const translation = typeof parsed.translation === 'string'
          ? parsed.translation.trim()
          : (typeof parsed.vietnamese === 'string'
            ? parsed.vietnamese.trim()
            : (typeof parsed.meaning === 'string' ? parsed.meaning.trim() : ''));

        const userRomanization = typeof parsed.userRomanization === 'string'
          ? parsed.userRomanization.trim()
          : (typeof parsed.userPinyin === 'string' ? parsed.userPinyin.trim() : undefined);

        const userTranslation = typeof parsed.userTranslation === 'string'
          ? parsed.userTranslation.trim()
          : (typeof parsed.userVietnamese === 'string' ? parsed.userVietnamese.trim() : undefined);

        if (original && !isPromptLeak(original)) {
          return { original, romanization, translation, userRomanization, userTranslation };
        }
      }
    } catch {}
  }

  // 2. Trích xuất qua Regex (hỗ trợ cả khi JSON bị cắt cụt)
  const origMatch = cleaned.match(/"(?:original|originalText|chinese)"\s*:\s*"((?:[^"\\]|\\.)*)"?/i) || cleaned.match(/"(?:original|originalText|chinese)"\s*:\s*"([^"]*)/i);
  const romMatch = cleaned.match(/"(?:romanization|pinyin|romaji)"\s*:\s*"((?:[^"\\]|\\.)*)"?/i);
  const transMatch = cleaned.match(/"(?:translation|vietnamese)"\s*:\s*"((?:[^"\\]|\\.)*)"?/i);
  const userRomMatch = cleaned.match(/"(?:userRomanization|userPinyin)"\s*:\s*"((?:[^"\\]|\\.)*)"?/i);
  const userTransMatch = cleaned.match(/"(?:userTranslation|userVietnamese)"\s*:\s*"((?:[^"\\]|\\.)*)"?/i);

  if (origMatch && origMatch[1]) {
    const original = origMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
    if (original && !isPromptLeak(original)) {
      const romanization = romMatch && romMatch[1] ? romMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim() : '';
      const translation = transMatch && transMatch[1] ? transMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim() : '';
      const userRomanization = userRomMatch && userRomMatch[1] ? userRomMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim() : undefined;
      const userTranslation = userTransMatch && userTransMatch[1] ? userTransMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim() : undefined;
      return { original, romanization, translation, userRomanization, userTranslation };
    }
  }

  // 3. Fallback an toàn: Trả thông báo thân thiện thay vì in text thô
  return fallback;
}

export async function POST(request: NextRequest): Promise<Response> {
  const startTime = Date.now();
  console.log('[PERF] api_request_start', startTime);

  try {
    const body: VoiceChatRequest = await request.json();
    const {
      text,
      audioBase64,
      language,
      level,
      topic,
      history,
      voice,
      speed = 1.0,
      vocabContext,
      skipPronunciation = false,
      stream = false,
    } = body;

    const clientApiKey = request.headers.get('x-api-key') || body.apiKey || undefined;

    if (!text && !audioBase64) {
      return NextResponse.json({ error: 'Cần cung cấp text hoặc audio.' }, { status: 400 });
    }

    // ─────────────────────────────────────────────────────
    // STEP 1: Lấy transcript (STT)
    // ─────────────────────────────────────────────────────
    let userTranscript = '';
    let sttProvider = 'web-speech';

    console.log('[PERF] stt_start', Date.now());
    if (text?.trim()) {
      userTranscript = text.trim();
      sttProvider = 'web-speech';
    } else if (audioBase64) {
      const sttResult = await transcribeAudio(audioBase64, language, clientApiKey);
      userTranscript = sttResult.transcript;
      sttProvider = sttResult.provider;
    }
    console.log('[PERF] stt_end', Date.now(), `provider: ${sttProvider}, transcript: "${userTranscript}"`);

    if (!userTranscript) {
      return NextResponse.json<VoiceChatResponse>({
        userTranscript: '',
        assistantOriginal: 'Mình không nghe rõ. Bạn có thể nói lại không?',
        assistantText: 'Mình không nghe rõ. Bạn có thể nói lại không?',
        audioBase64: '',
        latencyMs: Date.now() - startTime,
      });
    }

    const isJapanese = (language as string) === 'ja' || (language as string) === 'ja-JP';
    const isChinese = (language as string) === 'zh' || (language as string) === 'zh-CN';

    // ─────────────────────────────────────────────────────
    // Pronunciation Assessment (chạy song song cho cả Stream và Standard mode)
    // ─────────────────────────────────────────────────────
    const pronConfig = getPronunciationConfig(language);
    const shouldAssessPron = !skipPronunciation && pronConfig?.enabled && Boolean(userTranscript.trim()) && Boolean(audioBase64);

    const pronPromise: Promise<PronunciationAssessmentResult | undefined> = shouldAssessPron
      ? assessPronunciation({
          audioBase64: audioBase64!,
          referenceText: userTranscript,
          language,
        }).catch((err) => {
          console.warn('[Pronunciation] assessment error:', err);
          return undefined;
        })
      : Promise.resolve(undefined);

    // ─────────────────────────────────────────────────────
    // STEP 2A: STREAMING MODE (SSE)
    // ─────────────────────────────────────────────────────
    const wantsStream = stream || request.headers.get('accept')?.includes('text/event-stream');
    if (wantsStream) {
      const encoder = new TextEncoder();

      const readableStream = new ReadableStream({
        async start(controller) {
          try {
            // Gửi event userTranscript trước
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'init', userTranscript, sttProvider })}\n\n`)
            );

            let accumulatedText = '';
            let lastProvider = 'gemini';

            const streamGen = chatWithAIStream({
              language,
              level,
              topic,
              history,
              userMessage: userTranscript,
              vocabContext,
              clientApiKey,
            });

            for await (const { chunk, provider } of streamGen) {
              lastProvider = provider;
              accumulatedText += chunk;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'token', chunk })}\n\n`)
              );
            }

            // Chờ kết quả đánh giá phát âm chạy song song hoàn tất
            const pronRes = await pronPromise;
            let pronunciationResult: PronunciationAssessmentResult | undefined = undefined;
            let userPinyin: string | undefined = undefined;
            if (pronRes) {
              pronunciationResult = pronRes;
              if (pronRes.syllables && pronRes.syllables.length > 0) {
                userPinyin = pronRes.syllables.map((s) => s.pinyin).filter(Boolean).join(' ');
              }
            }

            // Kết thúc stream: Parse kết quả cuối cùng
            const parsed = parseAIResponse(accumulatedText);
            const assistantOriginal = parsed.original;
            const assistantRomanization = isJapanese
              ? ensureRomaji(parsed.romanization, assistantOriginal)
              : (isChinese ? (parsed.romanization || '') : '');
            const assistantTranslation = parsed.translation;
            const userTranslation = parsed.userTranslation || '';

            if (!userPinyin && isChinese) {
              userPinyin = parsed.userRomanization || '';
            }

            let userRomanization: string | undefined = undefined;
            if (isChinese) {
              userRomanization = userPinyin || parsed.userRomanization || '';
            } else if (isJapanese) {
              userRomanization = parsed.userRomanization
                ? ensureRomaji(parsed.userRomanization)
                : ensureRomaji('', userTranscript);
            } else {
              userRomanization = parsed.userRomanization;
            }

            const latencyMs = Date.now() - startTime;
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'done',
                  userTranscript,
                  userPinyin,
                  userRomanization,
                  userTranslation,
                  pronunciationResult,
                  pronunciationScore: pronunciationResult?.overallScore ?? null,
                  assistantOriginal,
                  assistantRomanization,
                  assistantPinyin: assistantRomanization,
                  assistantTranslation,
                  assistantText: assistantOriginal,
                  latencyMs,
                  sttProvider,
                  llmProvider: lastProvider,
                  ttsProvider: 'browser-tts',
                })}\n\n`
              )
            );
            controller.close();
          } catch (err: any) {
            console.error('[voice-chat-stream] Error:', err);
            const isChatSysErr = err instanceof ChatSystemError;
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'error',
                  error: err.message || 'Lỗi stream',
                  errorKind: isChatSysErr ? err.kind : 'busy',
                  resetHours: isChatSysErr ? err.resetHours : undefined,
                })}\n\n`
              )
            );
            controller.close();
          }
        },
      });

      return new Response(readableStream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
        },
      });
    }

    // ─────────────────────────────────────────────────────
    // STEP 2B: STANDARD JSON MODE
    // ─────────────────────────────────────────────────────
    let pronunciationResult: PronunciationAssessmentResult | undefined = undefined;
    let userPinyin: string | undefined = undefined;

    const chatPromise = chatWithAI({
      language,
      level,
      topic,
      history,
      userMessage: userTranscript,
      vocabContext,
      clientApiKey,
    });

    const [pronRes, chatResult] = await Promise.all([pronPromise, chatPromise]);

    if (pronRes) {
      pronunciationResult = pronRes;
      if (pronRes.syllables && pronRes.syllables.length > 0) {
        userPinyin = pronRes.syllables.map(s => s.pinyin).join(' ');
      }
    }

    const parsed = parseAIResponse(chatResult.text || '');
    const assistantOriginal = parsed.original;

    const assistantRomanization = isJapanese
      ? ensureRomaji(parsed.romanization, assistantOriginal)
      : (isChinese ? (parsed.romanization || '') : '');

    const assistantTranslation = parsed.translation;
    const userTranslation = parsed.userTranslation || '';

    if (!userPinyin && isChinese) {
      userPinyin = parsed.userRomanization || '';
    }

    let userRomanization: string | undefined = undefined;
    if (isChinese) {
      userRomanization = userPinyin || parsed.userRomanization || '';
    } else if (isJapanese) {
      userRomanization = parsed.userRomanization
        ? ensureRomaji(parsed.userRomanization)
        : ensureRomaji('', userTranscript);
    } else {
      userRomanization = parsed.userRomanization;
    }

    const latencyMs = Date.now() - startTime;

    return NextResponse.json<VoiceChatResponse>({
      userTranscript,
      userPinyin,
      userRomanization,
      userTranslation,
      pronunciationResult,
      pronunciationScore: pronunciationResult?.overallScore ?? null,
      assistantOriginal,
      assistantRomanization,
      assistantTranslation,
      assistantText: assistantOriginal,
      audioBase64: '',
      toolResults: chatResult.toolResults,
      latencyMs,
      sttProvider,
      llmProvider: chatResult.provider,
      ttsProvider: 'browser-tts',
    });

  } catch (error) {
    console.error('[voice-chat] Error:', error);

    if (error instanceof ChatSystemError) {
      const status = error.kind === 'quota' ? 429 : (error.kind === 'busy' ? 503 : 500);
      return NextResponse.json<VoiceChatResponse>(
        {
          userTranscript: '',
          assistantOriginal: '',
          assistantText: '',
          audioBase64: '',
          latencyMs: Date.now() - startTime,
          error: error.message,
          errorKind: error.kind,
          resetHours: error.resetHours,
        },
        { status }
      );
    }

    const message = error instanceof Error ? error.message : 'Lỗi không xác định.';
    let userMessage = `Lỗi xử lý: ${message}`;
    if (message.includes('Tất cả LLM đều lỗi')) {
      userMessage = 'Luna đang bận, vui lòng thử lại sau ít phút.';
    } else if (message.includes('credit') || message.includes('quota') || message.includes('429') || message.includes('insufficient')) {
      userMessage = 'Hôm nay đã hết lượt dùng AI, vui lòng thử lại vào ngày mai.';
    } else if (message.includes('GEMINI_API_KEY')) {
      userMessage = 'GEMINI_API_KEY chưa được cấu hình. Lấy key miễn phí tại aistudio.google.com/apikey';
    } else if (message.includes('GROQ_API_KEY')) {
      userMessage = 'GROQ_API_KEY chưa được cấu hình. Kiểm tra .env.local';
    } else if (message.includes('API_KEY_INVALID') || message.includes('401') || message.includes('403')) {
      userMessage = 'API key không hợp lệ hoặc đã hết hạn. Vui lòng kiểm tra lại khóa API.';
    }

    return NextResponse.json<VoiceChatResponse>(
      {
        userTranscript: '',
        assistantOriginal: '',
        assistantText: '',
        audioBase64: '',
        latencyMs: Date.now() - startTime,
        error: userMessage,
        errorKind: 'unknown',
      },
      { status: 500 }
    );
  }
}
