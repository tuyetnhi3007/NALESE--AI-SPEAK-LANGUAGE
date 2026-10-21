// ============================================================
// app/api/topic-exercises/route.ts — Tạo bài tập theo chủ đề
// Dùng Gemini trực tiếp với responseSchema, responseMimeType chuẩn,
// thinkingBudget: 0, ngân sách thời gian tối đa 50s, timeout 20s/call
// và cơ chế cooldown 60s cho model bị lỗi (503/429/timeout).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type {
  TopicExerciseRequest,
  ExerciseSet,
  ExerciseQuestion,
  SupportedLanguage,
  LanguageLevel,
} from '@/lib/types';

// Vercel serverless function max duration (phải lớn hơn ngân sách 50s)
export const maxDuration = 60;

import {
  classifyGoogleError,
  isModelInCooldown,
  markModelCooldown,
  getEarliestExpiringModel,
  getGlobalDailyResetHours,
  clearModelCooldown,
} from '@/lib/ai/errors';

export { classifyGoogleError };

const TOTAL_BUDGET_MS = 48000; // Ngân sách thời gian TỔNG tối đa 50 giây (48s để trừ hao network ~200ms)
const PER_CALL_TIMEOUT_MS = 20000; // Timeout cho mỗi lần gọi đơn lẻ tối đa 20 giây

const LANG_NAMES: Record<SupportedLanguage, string> = {
  en: 'tiếng Anh',
  zh: 'tiếng Trung (Phổ thông)',
  ja: 'tiếng Nhật',
};

const LEVEL_NAMES: Record<LanguageLevel, string> = {
  beginner: 'sơ cấp (A1-A2)',
  intermediate: 'trung cấp (B1-B2)',
  advanced: 'nâng cao (C1-C2)',
};

const TOPIC_NAMES: Record<string, string> = {
  travel: 'Du lịch & Sân bay',
  daily_life: 'Cuộc sống hàng ngày',
  work: 'Công việc & Kinh doanh',
  food: 'Ẩm thực & Nhà hàng',
  health: 'Sức khỏe & Bệnh viện',
  technology: 'Công nghệ & Kỹ thuật số',
  education: 'Giáo dục & Học tập',
  shopping: 'Mua sắm',
  custom: 'Giao tiếp tự do',
};

// Giữ nguyên các model đang dùng trong project, ưu tiên model có độ trễ thấp
const FAST_GEMINI_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest',
  'gemini-3.7-flash',
  'gemini-3.8-flash',
];

let preferredModel = FAST_GEMINI_MODELS[0];

function getOrderedModels(): { models: string[]; isCooldownFallback: boolean } {
  // 1. Lọc ra các model không bị cooldown
  const available = FAST_GEMINI_MODELS.filter((m) => !isModelInCooldown(m));
  if (available.length > 0) {
    const list = available.includes(preferredModel)
      ? [preferredModel, ...available.filter((m) => m !== preferredModel)]
      : available;
    return { models: list, isCooldownFallback: false };
  }

  // 2. Nếu tất cả model đang cooldown: thử model sắp hết cooldown nhất (1 model duy nhất, timeout 20s)
  const earliest = getEarliestExpiringModel(FAST_GEMINI_MODELS);
  return { models: [earliest ? earliest.model : FAST_GEMINI_MODELS[0]], isCooldownFallback: true };
}

// Schema JSON chuẩn cho bài tập theo chủ đề
const topicExerciseResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    title: {
      type: SchemaType.STRING,
      description: 'Tiêu đề bộ bài tập bằng tiếng Việt',
    },
    questions: {
      type: SchemaType.ARRAY,
      description: 'Danh sách bài tập',
      items: {
        type: SchemaType.OBJECT,
        properties: {
          id: { type: SchemaType.STRING, description: 'ID câu hỏi ví dụ q1, q2' },
          type: {
            type: SchemaType.STRING,
            description:
              'Loại câu hỏi: multiple-choice, fill-blank, translation, vocabulary, sentence-ordering, listening, speaking, error-correction',
          },
          question: { type: SchemaType.STRING, description: 'Nội dung câu hỏi hoặc yêu cầu' },
          options: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: '4 lựa chọn cho câu trắc nghiệm hoặc nghe hiểu',
          },
          words: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: 'Danh sách các từ xáo trộn cho câu sắp xếp từ',
          },
          correctAnswer: {
            type: SchemaType.STRING,
            description: 'Đáp án đúng (chữ cái A/B/C/D hoặc câu/từ chuẩn)',
          },
          answer: {
            type: SchemaType.STRING,
            description: 'Từ hoặc câu thuần bằng ngôn ngữ đích (KHÔNG chứa phiên âm trong ngoặc)',
          },
          reading: {
            type: SchemaType.STRING,
            description: 'Phiên âm Pinyin hoặc Romaji nếu có',
          },
          acceptedAnswers: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: 'Các đáp án hợp lệ khác nếu có',
          },
          explanation: {
            type: SchemaType.STRING,
            description: 'Giải thích bằng tiếng Việt, ngắn gọn trong 1-2 câu',
          },
          audioText: {
            type: SchemaType.STRING,
            description: 'Đoạn văn ngôn ngữ đích để AI đọc cho listening hoặc speaking',
          },
        },
        required: ['id', 'type', 'question', 'correctAnswer', 'explanation'],
      },
    },
  },
  required: ['title', 'questions'],
};

// System instruction riêng cho tạo bài tập, không dùng persona Luna của chatWithAI
const TOPIC_SYSTEM_INSTRUCTION = `Bạn là chuyên gia giáo dục ngôn ngữ và thiết kế bài tập ngoại ngữ tương tác cho người Việt Nam.
Nhiệm vụ của bạn là tạo các bộ bài tập chất lượng cao, đúng ngữ pháp, tự nhiên, kèm giải thích tiếng Việt ngắn gọn (1-2 câu).
Chỉ trả về JSON object thuần theo đúng JSON Schema được quy định, không kèm văn bản hội thoại hay markdown bên ngoài.`;

/**
 * Cố gắng sửa chữa chuỗi JSON bị cắt cụt nếu chạm giới hạn token
 */
function repairTruncatedJson(str: string): any {
  const lastValidObj = str.lastIndexOf('}');
  if (lastValidObj !== -1) {
    const candidates = [
      str.slice(0, lastValidObj + 1) + ']}',
      str.slice(0, lastValidObj + 1) + '}',
    ];
    for (const cand of candidates) {
      try {
        const p = JSON.parse(cand);
        if (p && Array.isArray(p.questions) && p.questions.length > 0) {
          return p;
        }
      } catch {}
    }
  }
  return null;
}

/**
 * Hàm parse JSON an toàn: loại bỏ markdown, ký tự điều khiển, dấu phẩy thừa, tự phục hồi khi bị cắt cụt
 */
function safeParseJson(raw: string): any {
  if (!raw || typeof raw !== 'string') {
    throw new Error('Chuỗi phản hồi rỗng');
  }

  // 1. Gỡ bỏ khối markdown ```json ... ``` hoặc ``` ... ```
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // 2. Cắt lấy đoạn từ ký tự { đầu tiên đến } cuối cùng
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  // 3. Xử lý ký tự điều khiển không hợp lệ trong chuỗi JSON (ngoại trừ tab, newline)
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');

  // 4. Xóa dấu phẩy thừa trước dấu đóng } hoặc ]
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

  // 5. Thử parse
  try {
    return JSON.parse(cleaned);
  } catch (err: any) {
    // 6. Thử phục hồi JSON nếu chuỗi bị cắt cụt
    const repaired = repairTruncatedJson(cleaned);
    if (repaired) {
      return repaired;
    }
    throw new Error(`Lỗi cú pháp JSON: ${err.message}`);
  }
}

/**
 * Kiểm tra và lọc danh sách câu hỏi: loại bỏ câu lỗi riêng biệt, đảm bảo các trường chuẩn
 */
function validateAndFilterQuestions(rawQuestions: any[]): ExerciseQuestion[] {
  if (!Array.isArray(rawQuestions)) return [];

  const validQuestions: ExerciseQuestion[] = [];

  for (let i = 0; i < rawQuestions.length; i++) {
    const q = rawQuestions[i];
    if (!q || typeof q !== 'object') continue;

    const id = typeof q.id === 'string' && q.id ? q.id : `q${i + 1}`;
    const type = q.type as ExerciseQuestion['type'];
    const questionText = typeof q.question === 'string' ? q.question.trim() : '';
    const explanation = typeof q.explanation === 'string' ? q.explanation.trim() : '';
    const rawCorrect = typeof q.correctAnswer === 'string' ? q.correctAnswer.trim() : '';
    const rawAnswer = typeof q.answer === 'string' ? q.answer.trim() : '';
    const correctAnswer = rawCorrect || rawAnswer;

    // Yêu cầu tối thiểu phải có question, explanation và correctAnswer
    if (!questionText || !explanation || !correctAnswer) {
      continue;
    }

    if (type === 'multiple-choice' || type === 'listening') {
      if (!Array.isArray(q.options) || q.options.length < 2) {
        continue;
      }
      const options = q.options.map((opt: any) => String(opt || '').trim()).filter(Boolean);
      if (options.length < 2) continue;

      const isLetter = ['A', 'B', 'C', 'D'].includes(correctAnswer.toUpperCase());
      const isInOptions = options.some(
        (opt: string) =>
          opt.toLowerCase() === correctAnswer.toLowerCase() ||
          opt.startsWith(`${correctAnswer}.`) ||
          opt.startsWith(`${correctAnswer}:`) ||
          opt.startsWith(`${correctAnswer})`)
      );

      if (!isLetter && !isInOptions) {
        continue;
      }

      validQuestions.push({
        id,
        type,
        question: questionText,
        options,
        correctAnswer,
        audioText: typeof q.audioText === 'string' ? q.audioText.trim() : undefined,
        explanation,
      });
    } else if (type === 'sentence-ordering') {
      const words = Array.isArray(q.words)
        ? q.words.map((w: any) => String(w || '').trim()).filter(Boolean)
        : [];
      if (words.length < 2) continue;

      validQuestions.push({
        id,
        type,
        question: questionText,
        words,
        correctAnswer,
        explanation,
      });
    } else if (type === 'fill-blank' || type === 'translation' || type === 'error-correction') {
      let pureAnswer = rawAnswer || correctAnswer;
      let pureReading = typeof q.reading === 'string' ? q.reading.trim() : undefined;

      // Tách phiên âm nếu bị gộp trong ngoặc
      const parenMatch = pureAnswer.match(/^([^(（]+)\s*[(（]([^)）]+)[)）]$/);
      if (parenMatch) {
        pureAnswer = parenMatch[1].trim();
        if (!pureReading) {
          pureReading = parenMatch[2].trim();
        }
      }

      validQuestions.push({
        id,
        type,
        question: questionText,
        correctAnswer: pureAnswer,
        answer: pureAnswer,
        reading: pureReading,
        acceptedAnswers: Array.isArray(q.acceptedAnswers)
          ? q.acceptedAnswers.map((a: any) => String(a || '').trim()).filter(Boolean)
          : undefined,
        explanation,
      });
    } else if (type === 'vocabulary') {
      validQuestions.push({
        id,
        type,
        vocabulary: true,
        question: questionText,
        correctAnswer,
        explanation,
      } as any);
    } else if (type === 'speaking') {
      validQuestions.push({
        id,
        type: 'speaking',
        question: questionText,
        correctAnswer,
        audioText: typeof q.audioText === 'string' ? q.audioText.trim() : undefined,
        explanation,
      });
    }
  }

  return validQuestions;
}

interface GeminiCallResult {
  text: string;
  metrics: {
    durationMs: number;
    finishReason: string;
    thoughtsTokenCount: number;
    candidatesTokenCount: number;
    model: string;
  };
}

/**
 * Gọi Gemini trực tiếp với ngân sách thời gian 50s, timeout 20s/call và cooldown 60s
 */
async function callGeminiForTopic(
  prompt: string,
  maxOutputTokens: number = 8192,
  clientApiKey: string | undefined,
  overallStartTime: number
): Promise<GeminiCallResult> {
  const keys = clientApiKey
    ? [clientApiKey]
    : ([process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2].filter(Boolean) as string[]);

  if (keys.length === 0) {
    throw new Error('Chưa cấu hình GEMINI_API_KEY.');
  }

  const MAX_RETRIES = 1;
  let lastError: any = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // 1. Kiểm tra ngân sách trước mỗi lần thử lại
    const elapsedBeforeAttempt = Date.now() - overallStartTime;
    const remainingBeforeAttempt = TOTAL_BUDGET_MS - elapsedBeforeAttempt;
    if (remainingBeforeAttempt <= 2000) {
      throw new Error('Đã hết ngân sách thời gian xử lý AI (tối đa 50s)');
    }

    const { models: sortedModels, isCooldownFallback } = getOrderedModels();

    if (attempt > 0) {
      const delayMs = Math.min(600, remainingBeforeAttempt - 2000);
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    const temperature = attempt === 0 ? 0.5 : 0.3;

    for (const apiKey of keys) {
      for (const modelName of sortedModels) {
        // Bỏ qua nếu model đang tạm nghỉ (trừ khi tất cả đều đang cooldown và ta thử model sớm nhất)
        if (!isCooldownFallback && isModelInCooldown(modelName)) {
          continue;
        }

        // 2. Kiểm tra ngân sách thời gian trước mỗi lần gọi đơn lẻ
        const elapsedBeforeCall = Date.now() - overallStartTime;
        const remainingBudget = TOTAL_BUDGET_MS - elapsedBeforeCall;
        if (remainingBudget <= 2000) {
          throw new Error('Đã hết ngân sách thời gian xử lý AI (tối đa 50s)');
        }

        // Timeout mỗi lần gọi: tối đa 20s hoặc phần ngân sách còn lại
        const effectiveTimeoutMs = Math.min(PER_CALL_TIMEOUT_MS, remainingBudget);

        let timer: NodeJS.Timeout | null = null;
        const t0 = Date.now();
        try {
          const genAI = new GoogleGenerativeAI(apiKey);
          const model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: {
              role: 'system',
              parts: [{ text: TOPIC_SYSTEM_INSTRUCTION }],
            },
            generationConfig: {
              maxOutputTokens,
              temperature,
              responseMimeType: 'application/json',
              responseSchema: topicExerciseResponseSchema as any,
              thinkingConfig: {
                thinkingBudget: 0,
              },
            } as any,
          });

          const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`Yêu cầu AI quá thời gian (timeout ${Math.round(effectiveTimeoutMs / 1000)}s)`)),
              effectiveTimeoutMs
            );
          });

          const result = await Promise.race([
            model.generateContent(prompt),
            timeoutPromise,
          ]);

          if (timer) clearTimeout(timer);
          const callDurationMs = Date.now() - t0;

          const response = result.response;
          const candidate = response.candidates?.[0];
          const text = response.text();

          if (text && text.trim().length > 0) {
            preferredModel = modelName;
            clearModelCooldown(modelName);
            const usage = (response.usageMetadata as any) || {};
            return {
              text,
              metrics: {
                durationMs: callDurationMs,
                finishReason: candidate?.finishReason || 'STOP',
                thoughtsTokenCount: usage.thoughtsTokenCount || 0,
                candidatesTokenCount: usage.candidatesTokenCount || 0,
                model: modelName,
              },
            };
          }
        } catch (err: any) {
          if (timer) clearTimeout(timer);
          const callDurationMs = Date.now() - t0;

          const classified = classifyGoogleError(err);
          // Chỉ cooldown cho 503/429/timeout, KHÔNG cooldown cho lỗi key hoặc lỗi dữ liệu
          if (classified.kind === 'AI_BUSY' || classified.kind === 'DAILY_QUOTA_EXCEEDED') {
            markModelCooldown(modelName, classified.kind, classified.retryDelaySec);
          }

          lastError = err;
          if (classified.kind === 'KEY_INVALID') {
            break;
          }
        }
      }
    }
  }

  throw lastError || new Error('Không thể kết nối với AI sau nhiều lần thử.');
}

function buildPrompt(
  langName: string,
  levelName: string,
  topicName: string,
  language: SupportedLanguage,
  count: number = 8
): string {
  const langSpecific =
    language === 'zh'
      ? 'Luôn kèm phiên âm Pinyin vào trường "reading" riêng biệt (ví dụ: 你好 -> reading: "nǐ hǎo"). Trường "answer" và "correctAnswer" CHỈ chứa chữ Hán thuần, không kèm phiên âm trong ngoặc.'
      : language === 'ja'
      ? 'Luôn kèm phiên âm Romaji vào trường "reading" riêng biệt (ví dụ: ありがとう -> reading: "arigatou"). Trường "answer" và "correctAnswer" CHỈ chứa Kanji/Kana thuần, không kèm phiên âm trong ngoặc.'
      : 'Sử dụng từ vựng và ngữ pháp phù hợp với người Việt học tiếng Anh.';

  return `Hãy tạo một bộ bài tập học ${langName} về chủ đề "${topicName}" dành cho trình độ ${levelName}.

${langSpecific}

Tạo đúng ${count} bài tập chất lượng cao, kết hợp linh hoạt các dạng:
- vocabulary: Học từ vựng then chốt của chủ đề với nghĩa tiếng Việt
- multiple-choice: Trắc nghiệm có đúng 4 lựa chọn A, B, C, D
- fill-blank: Điền vào chỗ trống có ký hiệu ___
- translation: Dịch câu tiếng Việt sang ${langName}
- sentence-ordering: Sắp xếp các từ trong danh sách "words" thành câu hoàn chỉnh
- listening: Câu để AI đọc (audioText) kèm câu hỏi và 4 lựa chọn
- speaking: Tình huống để người học nói kèm câu mẫu tốt
- error-correction: Sửa lỗi sai trong câu

QUY TẮC BẮT BUỘC:
1. Mọi explanation bằng tiếng Việt ngắn gọn trong 1-2 câu súc tích.
2. Multiple choice và listening phải có đúng 4 options.
3. Không để phiên âm trong ngoặc vào trường "answer" hay "correctAnswer".
4. Trả về đúng JSON theo Schema quy định.`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const overallStartTime = Date.now();
  try {
    const body: TopicExerciseRequest = await request.json();
    const { language, topic, level } = body;

    const clientApiKey = request.headers.get('x-api-key') || body.apiKey || undefined;

    const langName = LANG_NAMES[language] || language;
    const levelName = LEVEL_NAMES[level] || level;
    const topicName = TOPIC_NAMES[topic] || topic;

    // Tạo prompt tiêu chuẩn 8 câu hỏi
    const prompt = buildPrompt(langName, levelName, topicName, language, 8);

    // Lần gọi 1 với ngân sách thời gian 50s
    let geminiResult = await callGeminiForTopic(
      prompt,
      8192,
      clientApiKey,
      overallStartTime
    );

    // Nếu finishReason = MAX_TOKENS và còn đủ ngân sách (>= 15s): tự thử lại 1 lần với token gấp đôi và 6 câu
    if (
      geminiResult.metrics.finishReason === 'MAX_TOKENS' &&
      TOTAL_BUDGET_MS - (Date.now() - overallStartTime) > 15000
    ) {
      const reducedPrompt = buildPrompt(langName, levelName, topicName, language, 6);
      try {
        const retryResult = await callGeminiForTopic(
          reducedPrompt,
          16384,
          clientApiKey,
          overallStartTime
        );
        geminiResult = retryResult;
      } catch (retryErr) {
        console.warn('[topic-exercises] Retry with reduced count failed, using original response:', retryErr);
      }
    }

    // Parse JSON an toàn
    let parsed: any;
    try {
      parsed = safeParseJson(geminiResult.text);
    } catch {
      throw new Error('Dữ liệu bài tập từ AI không đúng định dạng JSON.');
    }

    // Kiểm tra và lọc danh sách câu hỏi hợp lệ
    const filteredQuestions = validateAndFilterQuestions(parsed.questions);

    if (filteredQuestions.length < 3) {
      throw new Error('Số lượng câu hỏi hợp lệ tạo ra không đủ (dưới 3 câu).');
    }

    const exerciseSet: ExerciseSet = {
      title: (typeof parsed.title === 'string' && parsed.title.trim()) || `Bài tập ${langName} — ${topicName}`,
      language,
      topic,
      level,
      questions: filteredQuestions,
      generatedAt: Date.now(),
    };

    return NextResponse.json(exerciseSet, {
      headers: {
        'x-topicgen-metrics': JSON.stringify(geminiResult.metrics),
      },
    });
  } catch (error: any) {
    console.error('[topic-exercises] Error:', error);
    const rawMsg = error instanceof Error ? error.message : 'Lỗi không xác định';
    const classified = classifyGoogleError(error);

    // 1. Lỗi API key sai hoặc chưa cấu hình
    if (
      classified.kind === 'KEY_INVALID' ||
      rawMsg.includes('Chưa cấu hình GEMINI_API_KEY') ||
      rawMsg.includes('API key không hợp lệ')
    ) {
      return NextResponse.json(
        { error: 'Không thể tạo bài tập: API key không hợp lệ hoặc đã hết hạn. Vui lòng kiểm tra lại khóa API.' },
        { status: 500 }
      );
    }

    // 2. Lỗi hết hạn ngạch NGÀY (Daily Quota Exceeded)
    if (classified.kind === 'DAILY_QUOTA_EXCEEDED') {
      const resetHours = classified.resetHours || getGlobalDailyResetHours();
      const msg = resetHours
        ? `Hôm nay đã hết lượt dùng AI, vui lòng thử lại sau khoảng ${resetHours} giờ.`
        : 'Hôm nay đã hết lượt dùng AI, vui lòng thử lại vào ngày mai';
      return NextResponse.json(
        { error: msg, resetHours },
        { status: 429 }
      );
    }

    // 3. Lỗi AI bận: 503, rate limit theo phút, timeout, hoặc vượt ngân sách 50s
    const isAiBusy =
      classified.kind === 'AI_BUSY' ||
      rawMsg.includes('hết ngân sách') ||
      rawMsg.includes('quá thời gian') ||
      Date.now() - overallStartTime >= TOTAL_BUDGET_MS;

    if (isAiBusy) {
      return NextResponse.json(
        { error: 'AI đang bận, vui lòng thử lại sau ít phút' },
        { status: 503 }
      );
    }

    if (rawMsg.includes('dưới 3 câu')) {
      return NextResponse.json(
        { error: 'Không thể tạo bài tập: AI tạo chưa đủ số câu hỏi hợp lệ, vui lòng thử lại.' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: 'Không thể tạo bài tập: AI đang bận hoặc quá tải, vui lòng thử lại sau giây lát.' },
      { status: 500 }
    );
  }
}
