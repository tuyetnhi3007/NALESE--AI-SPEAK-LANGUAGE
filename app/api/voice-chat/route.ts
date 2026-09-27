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
import { transcribeAudio, chatWithAI, chatWithAIStream } from '@/lib/ai';
import { assessPronunciation, getPronunciationConfig } from '@/lib/ai/pronunciation';
import type { VoiceChatRequest, VoiceChatResponse, PronunciationAssessmentResult } from '@/lib/types';
import { ensureRomaji } from '@/lib/japanese';

export const maxDuration = 60;

export function parseAIResponse(raw: string): { original: string; romanization: string; translation: string; userRomanization?: string } {
  if (!raw) return { original: '', romanization: '', translation: '' };
  
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // 1. Thử parse JSON hoàn chỉnh nếu có đủ cặp ngoặc {}
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const jsonCandidate = cleaned.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(jsonCandidate);
      if (parsed && typeof parsed === 'object') {
        const original = typeof parsed.original === 'string' ? parsed.original.trim() : (typeof parsed.originalText === 'string' ? parsed.originalText.trim() : '');
        const romanization = typeof parsed.romanization === 'string' ? parsed.romanization.trim() : (typeof parsed.romaji === 'string' ? parsed.romaji.trim() : '');
        const translation = typeof parsed.translation === 'string' ? parsed.translation.trim() : '';
        const userRomanization = typeof parsed.userRomanization === 'string' ? parsed.userRomanization.trim() : undefined;
        if (original) {
          return { original, romanization, translation, userRomanization };
        }
      }
    } catch {}
  }

  // 2. Trích xuất qua Regex (hỗ trợ cả khi JSON bị cắt cụt, thiếu dấu ngoặc kép hoặc ngoặc nhọn })
  const origMatch = cleaned.match(/"(?:original|originalText)"\s*:\s*"((?:[^"\\]|\\.)*)"?/i) || cleaned.match(/"(?:original|originalText)"\s*:\s*"([^"]*)/i);
  const romMatch = cleaned.match(/"(?:romanization|romaji)"\s*:\s*"((?:[^"\\]|\\.)*)"?/i);
  const transMatch = cleaned.match(/"translation"\s*:\s*"((?:[^"\\]|\\.)*)"?/i);
  const userRomMatch = cleaned.match(/"userRomanization"\s*:\s*"((?:[^"\\]|\\.)*)"?/i);

  if (origMatch && origMatch[1]) {
    const original = origMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
    const romanization = romMatch && romMatch[1] ? romMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim() : '';
    const translation = transMatch && transMatch[1] ? transMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim() : '';
    const userRomanization = userRomMatch && userRomMatch[1] ? userRomMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim() : undefined;
    if (original) {
      return { original, romanization, translation, userRomanization };
    }
  }

  // 3. Fallback: Nếu không match được, loại bỏ các ký tự thừa của JSON như {"original":
  let fallback = cleaned
    .replace(/^\s*\{\s*"original(?:Text)?"\s*:\s*"?/i, '')
    .replace(/^\s*\{?\s*/, '')
    .replace(/\s*\}?\s*$/, '')
    .replace(/^"(?:original|originalText|response|text)"\s*:\s*"?/i, '')
    .replace(/"?\s*$/, '')
    .trim();

  return {
    original: fallback,
    romanization: '',
    translation: '',
  };
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
              : (isChinese ? parsed.romanization : '');
            const assistantTranslation = parsed.translation;

            let userRomanization: string | undefined = undefined;
            if (isChinese) {
              userRomanization = userPinyin || parsed.userRomanization;
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
                  pronunciationResult,
                  pronunciationScore: pronunciationResult?.overallScore ?? null,
                  assistantOriginal,
                  assistantRomanization,
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
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'error', error: err.message || 'Lỗi stream' })}\n\n`)
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
      : (isChinese ? parsed.romanization : '');

    const assistantTranslation = parsed.translation;

    let userRomanization: string | undefined = undefined;
    if (isChinese) {
      userRomanization = userPinyin || parsed.userRomanization;
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
    const message = error instanceof Error ? error.message : 'Lỗi không xác định.';

    let userMessage = `Lỗi xử lý: ${message}`;
    if (message.includes('Tất cả LLM đều lỗi')) {
      userMessage = 'Mình đang gặp một chút trục trặc, Hẹn gặp bạn lần sau nha';
    } else if (message.includes('credit') || message.includes('quota') || message.includes('429') || message.includes('insufficient')) {
      userMessage = `Lỗi Quota/Credits: ${message}`;
    } else if (message.includes('GEMINI_API_KEY')) {
      userMessage = 'GEMINI_API_KEY chưa được cấu hình. Lấy key miễn phí tại aistudio.google.com/apikey';
    } else if (message.includes('GROQ_API_KEY')) {
      userMessage = 'GROQ_API_KEY chưa được cấu hình. Kiểm tra .env.local';
    } else if (message.includes('API_KEY_INVALID') || message.includes('401') || message.includes('403') || message.includes('400') || message.includes('404')) {
      userMessage = `Lỗi API: ${message} (Gemini/OpenAI key sai hoặc mô hình không tồn tại)`;
    } else if (message.includes('LLM provider')) {
      userMessage = 'Chưa có LLM nào hoạt động. Cần GEMINI_API_KEY (miễn phí) hoặc OPENAI_API_KEY có credits.';
    } else if (message.includes('STT provider')) {
      userMessage = 'Chưa cấu hình Speech-to-Text. Cần GROQ_API_KEY hoặc OPENAI_API_KEY.';
    }

    return NextResponse.json<VoiceChatResponse>(
      {
        userTranscript: '',
        assistantOriginal: '',
        assistantText: '',
        audioBase64: '',
        latencyMs: Date.now() - startTime,
        error: userMessage,
      },
      { status: 500 }
    );
  }
}
