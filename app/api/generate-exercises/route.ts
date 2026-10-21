// ============================================================
// app/api/generate-exercises/route.ts — Tạo bài tập từ từ vựng
// Dùng Gemini với responseSchema & responseMimeType chuẩn
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type { VocabEntry, ExerciseSet, ExerciseQuestion, SupportedLanguage, LanguageLevel } from '@/lib/types';
import {
  classifyGoogleError,
  isModelInCooldown,
  markModelCooldown,
  getGlobalDailyResetHours,
} from '@/lib/ai/errors';

export const maxDuration = 80;

interface GenerateExercisesRequest {
  vocab: VocabEntry[];
  language: SupportedLanguage;
  topic?: string;
  level?: LanguageLevel;
  exerciseCount?: number;
  apiKey?: string;
}

// Giữ nguyên các model đang dùng trong project
const FAST_GEMINI_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest',
];

// Schema ép kiểu JSON chuẩn từ Gemini
const exerciseResponseSchema = {
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
            description: 'Loại câu hỏi: multiple-choice, fill-blank, hoặc translation',
          },
          question: { type: SchemaType.STRING, description: 'Nội dung câu hỏi' },
          options: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: '4 lựa chọn cho câu hỏi trắc nghiệm',
          },
          correctAnswer: {
            type: SchemaType.STRING,
            description: 'Đáp án đúng (chữ cái A/B/C/D hoặc từ/câu thuần)',
          },
          answer: {
            type: SchemaType.STRING,
            description: 'Từ hoặc câu cần điền/dịch (KHÔNG kèm phiên âm trong ngoặc)',
          },
          reading: {
            type: SchemaType.STRING,
            description: 'Phiên âm nếu có (Pinyin hoặc Romaji)',
          },
          acceptedAnswers: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: 'Các đáp án hợp lệ khác nếu có',
          },
          explanation: {
            type: SchemaType.STRING,
            description: 'Giải thích bằng tiếng Việt kèm phiên âm',
          },
        },
        required: ['id', 'type', 'question', 'correctAnswer', 'explanation'],
      },
    },
  },
  required: ['title', 'questions'],
};

/**
 * Cố gắng sửa chữa chuỗi JSON bị cắt cụt do chạm hạn mức token
 */
function repairTruncatedJson(str: string): any {
  // Tìm vị trí đóng '}' của câu hỏi cuối cùng còn nguyên vẹn trong mảng questions
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
 * Kiểm tra cấu trúc câu hỏi sau khi parse, loại bỏ câu lỗi riêng biệt
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

    if (type === 'multiple-choice') {
      if (!Array.isArray(q.options) || q.options.length < 2) {
        continue;
      }
      const options = q.options.map((opt: any) => String(opt || '').trim()).filter(Boolean);
      if (options.length < 2) continue;

      // Kiểm tra đáp án đúng có thuộc options hoặc là A/B/C/D
      const isLetter = ['A', 'B', 'C', 'D'].includes(correctAnswer.toUpperCase());
      const isInOptions = options.some(
        (opt: string) =>
          opt.toLowerCase() === correctAnswer.toLowerCase() ||
          opt.startsWith(`${correctAnswer}.`) ||
          opt.startsWith(`${correctAnswer}:`)
      );

      if (!isLetter && !isInOptions) {
        // Loại bỏ câu trắc nghiệm nếu đáp án đúng không khớp danh sách lựa chọn
        continue;
      }

      validQuestions.push({
        id,
        type: 'multiple-choice',
        question: questionText,
        options,
        correctAnswer,
        explanation,
      });
    } else if (type === 'fill-blank' || type === 'translation') {
      validQuestions.push({
        id,
        type,
        question: questionText,
        correctAnswer,
        answer: rawAnswer || correctAnswer,
        reading: typeof q.reading === 'string' ? q.reading.trim() : undefined,
        acceptedAnswers: Array.isArray(q.acceptedAnswers)
          ? q.acceptedAnswers.map((a: any) => String(a || '').trim()).filter(Boolean)
          : undefined,
        explanation,
      });
    }
  }

  return validQuestions;
}

let preferredModel = FAST_GEMINI_MODELS[0];

interface GeminiCallResult {
  text: string;
  metrics: {
    durationMs: number;
    finishReason: string;
    thoughtsTokenCount: number;
    candidatesTokenCount: number;
  };
}

/**
 * Gọi Gemini với retry tự động tối đa 2 lần, timeout 25s mỗi lần và thinkingBudget: 0
 */
async function callGeminiWithRetry(
  prompt: string,
  clientApiKey?: string
): Promise<GeminiCallResult> {
  const keys = clientApiKey
    ? [clientApiKey]
    : [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2].filter(Boolean) as string[];

  if (keys.length === 0) {
    throw new Error('Chưa cấu hình GEMINI_API_KEY.');
  }

  const sortedModels = [
    preferredModel,
    ...FAST_GEMINI_MODELS.filter((m) => m !== preferredModel),
  ];

  const MAX_RETRIES = 2;
  const PER_CALL_TIMEOUT_MS = 25000; // Timeout 25 giây mỗi lần gọi
  let lastError: any = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delayMs = attempt * 1000;
      await new Promise((r) => setTimeout(r, delayMs));
    }

    const temperature = attempt === 0 ? 0.7 : 0.4;

    for (const apiKey of keys) {
      for (const modelName of sortedModels) {
        if (isModelInCooldown(modelName)) continue;

        let timer: NodeJS.Timeout | null = null;
        try {
          const genAI = new GoogleGenerativeAI(apiKey);
          const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: {
              maxOutputTokens: 8192,
              temperature,
              responseMimeType: 'application/json',
              responseSchema: exerciseResponseSchema as any,
              thinkingConfig: {
                thinkingBudget: 0, // Mức thấp nhất model cho phép: tắt hoàn toàn thinking
              },
            } as any,
          });

          const t0 = Date.now();
          const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`Yêu cầu AI quá thời gian (timeout ${PER_CALL_TIMEOUT_MS / 1000}s)`)),
              PER_CALL_TIMEOUT_MS
            );
          });

          const result = await Promise.race([
            model.generateContent(prompt),
            timeoutPromise,
          ]);

          if (timer) clearTimeout(timer);
          const durationMs = Date.now() - t0;

          const response = result.response;
          const candidate = response.candidates?.[0];
          const text = response.text();

          if (text && text.trim().length > 0) {
            preferredModel = modelName; // Ghi nhớ model hoạt động tốt nhất
            const usage = (response.usageMetadata as any) || {};
            return {
              text,
              metrics: {
                durationMs,
                finishReason: candidate?.finishReason || 'STOP',
                thoughtsTokenCount: usage.thoughtsTokenCount || 0,
                candidatesTokenCount: usage.candidatesTokenCount || 0,
              },
            };
          }
        } catch (err: any) {
          if (timer) clearTimeout(timer);
          lastError = err;
          const classified = classifyGoogleError(err);
          markModelCooldown(modelName, classified.kind, classified.retryDelaySec);

          if (classified.kind === 'KEY_INVALID') {
            break;
          }
        }
      }
    }
  }

  throw lastError || new Error('Không thể kết nối với AI sau nhiều lần thử.');
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: GenerateExercisesRequest = await request.json();
    const { vocab, language, exerciseCount = 10 } = body;

    const clientApiKey = request.headers.get('x-api-key') || body.apiKey || undefined;

    if (!vocab || !Array.isArray(vocab) || vocab.length === 0) {
      return NextResponse.json({ error: 'Không có dữ liệu từ vựng.' }, { status: 400 });
    }

    // Giảm kích thước đầu vào: chọn ngẫu nhiên tối đa 20 từ để prompt gọn gàng
    const selectedVocab = vocab.length > 20
      ? [...vocab].sort(() => Math.random() - 0.5).slice(0, 20)
      : vocab;

    const langName = language === 'zh' ? 'tiếng Trung' : language === 'ja' ? 'tiếng Nhật' : 'tiếng Anh';

    const vocabList = selectedVocab
      .map((v) => `- ${v.word} (${v.pronunciation}) = ${v.meaning}`)
      .join('\n');

    const targetCount = Math.min(Math.max(exerciseCount, 6), 10);

    const prompt = `Bạn là giáo viên ${langName} tạo bài tập cho người Việt Nam.

DANH SÁCH TỪ VỰNG:
${vocabList}

Hãy tạo đúng ${targetCount} bài tập học ${langName} dựa trên danh sách từ vựng ở trên.
Kết hợp các dạng:
- multiple-choice: trắc nghiệm 4 lựa chọn, đáp án đúng là "A", "B", "C" hoặc "D"
- fill-blank: điền từ vào chỗ trống ___
- translation: dịch câu tiếng Việt sang ${langName}

YÊU CẦU:
1. Trường "answer" CHỈ chứa từ/câu thuần bằng ngôn ngữ đích, TUYỆT ĐỐI KHÔNG để phiên âm trong ngoặc vào "answer" hay "correctAnswer".
2. Đặt phiên âm vào trường "reading" riêng biệt.
3. "explanation" phải bằng tiếng Việt, ngắn gọn trong 1-2 câu súc tích kèm phiên âm, tuyệt đối không lặp lại nội dung.
4. Trả về JSON đúng cấu trúc được yêu cầu.`;

    const { text: rawText, metrics } = await callGeminiWithRetry(prompt, clientApiKey);

    // Bước parse an toàn
    let parsed: any;
    try {
      parsed = safeParseJson(rawText);
    } catch (parseErr: any) {
      throw new Error('Dữ liệu bài tập từ AI không đúng định dạng JSON.');
    }

    // Kiểm tra và lọc danh sách câu hỏi
    const filteredQuestions = validateAndFilterQuestions(parsed.questions);

    if (filteredQuestions.length < 3) {
      throw new Error('Số lượng câu hỏi hợp lệ tạo ra không đủ (dưới 3 câu).');
    }

    const exerciseSet: ExerciseSet = {
      title: (typeof parsed.title === 'string' && parsed.title.trim()) || `Bài tập ${langName}`,
      language,
      topic: body.topic || 'vocab',
      level: body.level || 'beginner',
      questions: filteredQuestions,
      generatedAt: Date.now(),
    };

    return NextResponse.json(exerciseSet, {
      headers: {
        'x-quizgen-metrics': JSON.stringify(metrics),
      },
    });
  } catch (error: any) {
    console.error('[generate-exercises] Error:', error);
    const rawMsg = error instanceof Error ? error.message : 'Lỗi hệ thống';
    const classified = classifyGoogleError(error);

    if (classified.kind === 'KEY_INVALID' || rawMsg.includes('Chưa cấu hình GEMINI_API_KEY')) {
      return NextResponse.json(
        { error: 'API key không hợp lệ hoặc chưa cấu hình. Vui lòng kiểm tra lại khóa API.' },
        { status: 500 }
      );
    }

    if (classified.kind === 'DAILY_QUOTA_EXCEEDED') {
      const resetHours = classified.resetHours || getGlobalDailyResetHours();
      const msg = resetHours
        ? `Hôm nay đã hết lượt dùng AI, vui lòng thử lại sau khoảng ${resetHours} giờ.`
        : 'Hôm nay đã hết lượt dùng AI, vui lòng thử lại vào ngày mai';
      return NextResponse.json({ error: msg, resetHours }, { status: 429 });
    }

    if (classified.kind === 'AI_BUSY') {
      return NextResponse.json({ error: 'AI đang bận, vui lòng thử lại sau ít phút.' }, { status: 503 });
    }

    let userMsg = 'Không thể tạo bài tập lúc này. Vui lòng thử lại sau giây lát.';
    if (rawMsg.includes('Không có dữ liệu từ vựng')) {
      userMsg = 'Không có dữ liệu từ vựng để tạo bài tập.';
    }

    return NextResponse.json({ error: userMsg }, { status: 500 });
  }
}
