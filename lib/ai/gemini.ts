// ============================================================
// lib/ai/gemini.ts — Google Gemini LLM client cho Gia Sư AI (Luna)
// Quản lý thinkingConfig (thinkingBudget: 0), maxOutputTokens 2048,
// responseSchema chuẩn, timeout 15s/call, tổng ngân sách 30s,
// cooldown 60s khi 503/429/timeout và safe parsing chống lộ prompt.
// ============================================================

import { GoogleGenerativeAI, SchemaType, type Content } from '@google/generative-ai';

export function createGeminiClient(clientApiKey?: string): GoogleGenerativeAI {
  const apiKey = clientApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY chưa được cấu hình.');
  }
  return new GoogleGenerativeAI(apiKey);
}

/** Model mặc định: Gemini 3.6 Flash (siêu nhanh, ổn định) */
export const GEMINI_CHAT_MODEL = 'gemini-3.6-flash';
export const FAST_GEMINI_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest',
];

let preferredModel = FAST_GEMINI_MODELS[0];

import {
  classifyGoogleError,
  isModelInCooldown,
  markModelCooldown,
  areAllModelsInCooldown,
} from './errors';

export { isModelInCooldown, markModelCooldown, areAllModelsInCooldown };

// ─── Ngân sách thời gian & Cooldown ──────────────────────────
const TOTAL_BUDGET_MS = 20000; // Tổng ngân sách tối đa 20 giây cho hội thoại giọng nói
const PER_CALL_TIMEOUT_MS = 8000; // Timeout 8 giây mỗi lần gọi Gemini khi có backup provider (Groq/OpenRouter)

// ─── Response Schema chuẩn cho giao diện gia sư ─────────────
export const tutorResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    original: {
      type: SchemaType.STRING,
      description: 'Câu trả lời của Luna bằng ngôn ngữ đang học (1-3 câu)',
    },
    romanization: {
      type: SchemaType.STRING,
      description: 'Phiên âm (Pinyin/Romaji/IPA)',
    },
    translation: {
      type: SchemaType.STRING,
      description: 'Dịch nghĩa tiếng Việt của câu trả lời Luna',
    },
    userRomanization: {
      type: SchemaType.STRING,
      description: 'Phiên âm của câu người dùng vừa nói',
    },
    userTranslation: {
      type: SchemaType.STRING,
      description: 'Dịch nghĩa tiếng Việt của câu người dùng vừa nói',
    },
  },
  required: ['original', 'romanization', 'translation'],
};

// ─── Safe Parse & Chống rò rỉ prompt ─────────────────────────
export interface TutorParsedResponse {
  original: string;
  romanization: string;
  translation: string;
  userRomanization?: string;
  userTranslation?: string;
}

export const FALLBACK_LUNA_RESPONSE: TutorParsedResponse = {
  original: 'Luna chưa nghe rõ, bạn nói lại nhé.',
  romanization: '',
  translation: 'Luna chưa nghe rõ, bạn nói lại nhé.',
  userRomanization: '',
  userTranslation: '',
};

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

export function isPromptLeak(str: string): boolean {
  if (!str) return false;
  return PROMPT_LEAK_PATTERNS.some((pattern) => pattern.test(str));
}

export function cleanTrailingCommas(jsonStr: string): string {
  return jsonStr.replace(/,\s*([}\]])/g, '$1');
}

export function safeParseTutorJson(raw: string): TutorParsedResponse | null {
  if (!raw) return null;
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    let jsonCandidate = cleaned.slice(firstBrace, lastBrace + 1);
    jsonCandidate = cleanTrailingCommas(jsonCandidate);
    try {
      const parsed = JSON.parse(jsonCandidate);
      if (parsed && typeof parsed === 'object') {
        const original =
          typeof parsed.original === 'string'
            ? parsed.original.trim()
            : typeof parsed.originalText === 'string'
            ? parsed.originalText.trim()
            : typeof parsed.chinese === 'string'
            ? parsed.chinese.trim()
            : typeof parsed.text === 'string'
            ? parsed.text.trim()
            : '';

        if (original && !isPromptLeak(original)) {
          return {
            original,
            romanization:
              typeof parsed.romanization === 'string'
                ? parsed.romanization.trim()
                : typeof parsed.pinyin === 'string'
                ? parsed.pinyin.trim()
                : typeof parsed.romaji === 'string'
                ? parsed.romaji.trim()
                : '',
            translation:
              typeof parsed.translation === 'string'
                ? parsed.translation.trim()
                : typeof parsed.vietnamese === 'string'
                ? parsed.vietnamese.trim()
                : typeof parsed.meaning === 'string'
                ? parsed.meaning.trim()
                : '',
            userRomanization:
              typeof parsed.userRomanization === 'string'
                ? parsed.userRomanization.trim()
                : typeof parsed.userPinyin === 'string'
                ? parsed.userPinyin.trim()
                : undefined,
            userTranslation:
              typeof parsed.userTranslation === 'string'
                ? parsed.userTranslation.trim()
                : typeof parsed.userVietnamese === 'string'
                ? parsed.userVietnamese.trim()
                : undefined,
          };
        }
      }
    } catch {}
  }

  // Regex fallback nếu JSON bị cắt cụt
  const origMatch = cleaned.match(/"(?:original|originalText|chinese)"\s*:\s*"((?:[^"\\]|\\.)*)"?/i);
  if (origMatch && origMatch[1]) {
    const original = origMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
    if (original && !isPromptLeak(original)) {
      const romMatch = cleaned.match(/"(?:romanization|pinyin|romaji)"\s*:\s*"((?:[^"\\]|\\.)*)"?/i);
      const transMatch = cleaned.match(/"(?:translation|vietnamese)"\s*:\s*"((?:[^"\\]|\\.)*)"?/i);
      const userRomMatch = cleaned.match(/"(?:userRomanization|userPinyin)"\s*:\s*"((?:[^"\\]|\\.)*)"?/i);
      const userTransMatch = cleaned.match(/"(?:userTranslation|userVietnamese)"\s*:\s*"((?:[^"\\]|\\.)*)"?/i);
      return {
        original,
        romanization: romMatch && romMatch[1] ? romMatch[1].replace(/\\"/g, '"').trim() : '',
        translation: transMatch && transMatch[1] ? transMatch[1].replace(/\\"/g, '"').trim() : '',
        userRomanization: userRomMatch && userRomMatch[1] ? userRomMatch[1].replace(/\\"/g, '"').trim() : undefined,
        userTranslation: userTransMatch && userTransMatch[1] ? userTransMatch[1].replace(/\\"/g, '"').trim() : undefined,
      };
    }
  }

  return null;
}

function prepareHistory(history: { role: 'user' | 'assistant'; content: string }[]): {
  finalHistory: Content[];
  lastHistoryMsg: { text: string } | null;
} {
  const geminiHistory: Content[] = history.map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));

  const validHistory: Content[] = [];
  for (let i = 0; i < geminiHistory.length; i++) {
    const expected = i % 2 === 0 ? 'user' : 'model';
    if (geminiHistory[i].role === expected) {
      validHistory.push(geminiHistory[i]);
    } else {
      break;
    }
  }

  const finalHistory = validHistory.length >= 2 ? validHistory.slice(0, -1) : [];
  const lastHistoryMsg =
    validHistory.length >= 2
      ? (validHistory[validHistory.length - 1].parts[0] as { text: string })
      : null;

  return { finalHistory, lastHistoryMsg };
}

/**
 * Chat với Gemini (non-streaming). Trả về JSON string hợp lệ chứa câu trả lời của Luna.
 */
export async function chatWithGemini(
  systemPrompt: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  userMessage: string,
  clientApiKey?: string
): Promise<string> {
  const overallStartTime = Date.now();
  const keys = clientApiKey
    ? [clientApiKey]
    : ([process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2].filter(Boolean) as string[]);

  if (keys.length === 0) {
    throw new Error('GEMINI_API_KEY chưa được cấu hình.');
  }

  const hasBackup = Boolean(process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY);
  const effectivePerCallTimeout = hasBackup ? 8000 : 15000;

  if (areAllModelsInCooldown(FAST_GEMINI_MODELS)) {
    throw new Error('Tất cả Gemini models đang trong thời gian cooldown.');
  }

  const { finalHistory, lastHistoryMsg } = prepareHistory(history);
  const fullMessage = lastHistoryMsg
    ? `${lastHistoryMsg.text}\n\nNgười dùng: ${userMessage}`
    : userMessage;

  let lastError: any = null;

  for (const apiKey of keys) {
    const availableModels = FAST_GEMINI_MODELS.filter((m) => !isModelInCooldown(m));
    if (availableModels.length === 0) {
      break;
    }

    const sortedModels = availableModels.includes(preferredModel)
      ? [preferredModel, ...availableModels.filter((m) => m !== preferredModel)]
      : availableModels;

    for (const modelName of sortedModels) {
      if (isModelInCooldown(modelName)) continue;

      const elapsed = Date.now() - overallStartTime;
      const remainingBudget = TOTAL_BUDGET_MS - elapsed;
      if (remainingBudget <= 1500) {
        throw new Error('Đã hết ngân sách thời gian xử lý AI (20s)');
      }

      const effectiveTimeoutMs = Math.min(effectivePerCallTimeout, remainingBudget);
      let timer: NodeJS.Timeout | null = null;
      const t0 = Date.now();

      try {
        const genAI = new GoogleGenerativeAI(apiKey);

        const executeCall = async (tokens: number) => {
          const model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
            generationConfig: {
              maxOutputTokens: tokens,
              temperature: 0.7,
              responseMimeType: 'application/json',
              responseSchema: tutorResponseSchema as any,
              thinkingConfig: {
                thinkingBudget: 0,
              },
            } as any,
          });

          const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`Timeout ${Math.round(effectiveTimeoutMs / 1000)}s`)),
              effectiveTimeoutMs
            );
          });

          const callPromise =
            history.length === 0
              ? model.generateContent(userMessage)
              : model.startChat({ history: finalHistory }).sendMessage(fullMessage);

          const result = await Promise.race([callPromise, timeoutPromise]);
          return result.response;
        };

        let response = await executeCall(2048);
        if (timer) clearTimeout(timer);
        const callDurationMs = Date.now() - t0;

        let candidate = response.candidates?.[0];
        let rawText = response.text();

        // Nếu finishReason = MAX_TOKENS: thử lại 1 lần với maxOutputTokens gấp đôi nếu còn đủ ngân sách
        if (
          candidate?.finishReason === 'MAX_TOKENS' &&
          TOTAL_BUDGET_MS - (Date.now() - overallStartTime) > 4000
        ) {
          try {
            response = await executeCall(4096);
            if (timer) clearTimeout(timer);
            rawText = response.text();
          } catch (retryErr) {
            console.warn(`[Gemini] Retry with 4096 tokens failed for ${modelName}:`, retryErr);
          }
        }

        const parsed = safeParseTutorJson(rawText);
        if (parsed) {
          preferredModel = modelName;
          return JSON.stringify(parsed);
        }

        throw new Error('AI không trả về JSON hợp lệ hoặc thiếu dữ liệu.');
      } catch (err: any) {
        if (timer) clearTimeout(timer);
        const callDurationMs = Date.now() - t0;

        const classified = classifyGoogleError(err);
        markModelCooldown(modelName, classified.kind, classified.retryDelaySec);

        console.warn(`[Gemini] Model ${modelName} error: ${err.message}. Trying next...`);
        lastError = err;

        if (classified.kind === 'KEY_INVALID') {
          break;
        }
      }
    }
  }

  throw lastError || new Error('Tất cả Gemini API keys hoặc models đều bận hoặc lỗi.');
}

/**
 * Chat với Gemini hỗ trợ Stream từng token cho first-token latency thấp nhất.
 */
export async function* chatWithGeminiStream(
  systemPrompt: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  userMessage: string,
  clientApiKey?: string
): AsyncGenerator<string, void, unknown> {
  const keys = clientApiKey
    ? [clientApiKey]
    : ([process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2].filter(Boolean) as string[]);

  if (keys.length === 0) {
    throw new Error('GEMINI_API_KEY chưa được cấu hình.');
  }

  if (areAllModelsInCooldown(FAST_GEMINI_MODELS)) {
    throw new Error('Tất cả Gemini models đang trong thời gian cooldown.');
  }

  const hasBackup = Boolean(process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY);
  const streamTimeoutMs = hasBackup ? 8000 : 20000;
  let lastError: any = null;

  for (const apiKey of keys) {
    const availableModels = FAST_GEMINI_MODELS.filter((m) => !isModelInCooldown(m));
    if (availableModels.length === 0) break;

    for (const modelName of availableModels) {
      if (isModelInCooldown(modelName)) continue;

      let timer: NodeJS.Timeout | null = null;
      try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
          generationConfig: {
            maxOutputTokens: 2048,
            temperature: 0.7,
            responseMimeType: 'application/json',
            responseSchema: tutorResponseSchema as any,
            thinkingConfig: {
              thinkingBudget: 0,
            },
          } as any,
        });

        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Yêu cầu stream quá thời gian (timeout ${streamTimeoutMs / 1000}s)`)), streamTimeoutMs);
        });

        const streamPromise = history.length === 0
          ? model.generateContentStream(userMessage)
          : (() => {
              const { finalHistory, lastHistoryMsg } = prepareHistory(history);
              const chat = model.startChat({ history: finalHistory });
              const fullMessage = lastHistoryMsg
                ? `${lastHistoryMsg.text}\n\nNgười dùng: ${userMessage}`
                : userMessage;
              return chat.sendMessageStream(fullMessage);
            })();

        const resultStream = await Promise.race([streamPromise, timeoutPromise]);
        if (timer) clearTimeout(timer);

        for await (const chunk of resultStream.stream) {
          yield chunk.text();
        }
        return;
      } catch (err: any) {
        if (timer) clearTimeout(timer);
        const classified = classifyGoogleError(err);
        markModelCooldown(modelName, classified.kind, classified.retryDelaySec);

        console.warn(`[GeminiStream] Model ${modelName} error: ${err.message}. Trying next...`);
        lastError = err;
        if (classified.kind === 'KEY_INVALID') {
          break;
        }
        continue;
      }
    }
  }

  throw lastError || new Error('Tất cả các Gemini API keys đều bị lỗi hoặc hết Quota.');
}
