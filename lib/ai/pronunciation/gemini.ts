// ============================================================
// lib/ai/pronunciation/gemini.ts
// Fallback Adapter: Audio-based Pronunciation Evaluator (Gemini)
// Chấm phát âm trả kết quả TỪNG TỪ để tô đỏ từ sai
// Hỗ trợ: zh-CN, en-US, ja-JP
// ============================================================

import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type { PronunciationAssessorAdapter, AssessPronunciationOptions } from './types';
import type {
  PronunciationAssessmentResult,
  PronunciationWord,
  SyllableAssessment,
  SupportedLanguage,
} from '@/lib/types';
import { getPronunciationConfig } from './config';
import {
  classifyGoogleError,
  isModelInCooldown,
  markModelCooldown,
  areAllModelsInCooldown,
  getGlobalDailyResetHours,
} from '../errors';

export interface ReferenceToken {
  index: number;
  text: string;
  offset: number;
}

/**
 * 1. Tách từ ở phía code bằng Intl.Segmenter theo granularity "word"
 * Chỉ giữ các token có isWordLike = true.
 * Đánh số token từ 0 kèm offset chuẩn để ScoredText khớp theo vị trí.
 */
export function tokenizeReferenceText(
  text: string,
  language: SupportedLanguage | string
): ReferenceToken[] {
  if (!text || !text.trim()) return [];

  let locale = 'en';
  const langLower = (language || '').toLowerCase();
  if (langLower.startsWith('zh')) locale = 'zh';
  else if (langLower.startsWith('ja')) locale = 'ja';
  else if (langLower.startsWith('en')) locale = 'en';

  try {
    const segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
    const segments = Array.from(segmenter.segment(text));
    const tokens: ReferenceToken[] = [];
    let i = 0;
    for (const seg of segments) {
      if (seg.isWordLike) {
        tokens.push({
          index: i++,
          text: seg.segment,
          offset: seg.index,
        });
      }
    }
    return tokens;
  } catch {
    // Dự phòng khi Intl.Segmenter không khả dụng
    const regex = /[\p{L}\p{N}]+/gu;
    const tokens: ReferenceToken[] = [];
    let match: RegExpExecArray | null;
    let i = 0;
    while ((match = regex.exec(text)) !== null) {
      tokens.push({
        index: i++,
        text: match[0],
        offset: match.index,
      });
    }
    return tokens;
  }
}

/**
 * 3. Ghép kết quả theo chỉ số
 * Ghép words từ Gemini với tokens theo i để tạo PronunciationWord { text, correct, issue, offset }.
 * - Thiếu chỉ số nào: coi từ đó đúng (correct: true, issue: '').
 * - Chỉ số thừa hoặc ngoài khoảng: tự động bỏ qua.
 * - Gemini không trả words hoặc format sai: trả về undefined để caller bỏ words, không lỗi.
 */
export function mergePronunciationWords(
  tokens: ReferenceToken[],
  rawWords: any
): PronunciationWord[] | undefined {
  if (!Array.isArray(rawWords)) return undefined;

  const wordMap = new Map<number, { correct: boolean; issue: string }>();
  for (const item of rawWords) {
    if (item && typeof item.i === 'number' && Number.isInteger(item.i)) {
      wordMap.set(item.i, {
        correct: typeof item.correct === 'boolean' ? item.correct : true,
        issue: typeof item.issue === 'string' ? item.issue.trim() : '',
      });
    }
  }

  return tokens.map((token) => {
    const matched = wordMap.get(token.index);
    if (!matched) {
      return {
        text: token.text,
        correct: true,
        issue: '',
        offset: token.offset,
      };
    }

    const isCorrect = Boolean(matched.correct);
    return {
      text: token.text,
      correct: isCorrect,
      issue: isCorrect ? '' : (matched.issue || 'Phát âm chưa chuẩn'),
      offset: token.offset,
    };
  });
}

/**
 * 2. Response schema chuẩn cho Gemini chấm điểm phát âm từng từ
 */
export const pronunciationResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    overallScore: {
      type: SchemaType.NUMBER,
      description: 'Overall pronunciation score from 0 to 100',
    },
    accuracyScore: {
      type: SchemaType.NUMBER,
      description: 'Phonetic accuracy score from 0 to 100',
    },
    words: {
      type: SchemaType.ARRAY,
      description: 'Evaluation of each token matching index i',
      items: {
        type: SchemaType.OBJECT,
        properties: {
          i: {
            type: SchemaType.INTEGER,
            description: 'Token index starting from 0',
          },
          correct: {
            type: SchemaType.BOOLEAN,
            description: 'true if pronounced accurately, false otherwise',
          },
          issue: {
            type: SchemaType.STRING,
            description:
              'Empty string if correct; if incorrect, brief explanation in Vietnamese (e.g. "thanh điệu sai: nên đọc thanh 3")',
          },
        },
        required: ['i', 'correct', 'issue'],
      },
    },
  },
  required: ['overallScore', 'accuracyScore', 'words'],
};

function detectAudioMimeType(base64: string): string {
  try {
    const buffer = Buffer.from(base64.slice(0, 32), 'base64');
    if (buffer.length >= 4) {
      if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
        return 'audio/webm';
      }
      if (buffer.toString('utf8', 0, 4) === 'RIFF') {
        return 'audio/wav';
      }
      if (buffer.toString('utf8', 0, 4) === 'OggS') {
        return 'audio/ogg';
      }
      if (buffer.toString('utf8', 4, 8) === 'ftyp') {
        return 'audio/mp4';
      }
      if (
        buffer.toString('utf8', 0, 3) === 'ID3' ||
        (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
      ) {
        return 'audio/mp3';
      }
    }
  } catch {}
  return 'audio/webm';
}

export class GeminiPronunciationAssessor implements PronunciationAssessorAdapter {
  readonly name = 'gemini' as const;

  isConfigured(): boolean {
    return Boolean(process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_2);
  }

  async assess(options: AssessPronunciationOptions): Promise<PronunciationAssessmentResult> {
    const { audioBase64, referenceText, language } = options;
    const config = getPronunciationConfig(language);

    if (!config || !config.enabled) {
      return {
        provider: 'unassessed',
        referenceText,
        overallScore: null,
        syllables: [],
      };
    }

    // Nếu không có audio thực tế từ mic, trả về unassessed
    if (!audioBase64 || audioBase64.length < 200) {
      return {
        provider: 'unassessed',
        referenceText,
        overallScore: null,
        syllables: [],
      };
    }

    const geminiKeys = [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2].filter(Boolean) as string[];
    const geminiModels = [
      'gemini-3.6-flash',
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.5-flash',
      'gemini-flash-latest',
    ];
    const detectedMimeType = detectAudioMimeType(audioBase64);

    // 4. Giới hạn audio: kiểm tra độ dài audio (> ~250k chars base64 tương đương > 20s)
    const isLongAudio = audioBase64.length > 250000;

    // 1. Tách từ ở phía code
    const tokens = tokenizeReferenceText(referenceText, language);
    const tokenListStr = tokens.length > 0
      ? tokens.map((t) => `${t.index}: "${t.text}"`).join('\n')
      : `0: "${referenceText}"`;

    // 2. Schema và prompt chấm nghiêm khắc theo từng ngôn ngữ
    let prompt = '';
    if (config.locale === 'zh-CN') {
      prompt = `Bạn là chuyên gia thẩm định ngữ âm tiếng Trung Quốc (Mandarin zh-CN).
Hãy nghe đoạn âm thanh thực tế của người dùng và đối chiếu với câu mục tiêu: "${referenceText}".

Danh sách token cần đối chiếu (đánh số từ 0):
${tokenListStr}

Nhiệm vụ phân tích âm học và chấm điểm:
1. Nghe kỹ âm thanh thực tế và đối chiếu với từng token theo đúng chỉ số i.
2. LƯU Ý QUAN TRỌNG: Bộ nhận diện giọng nói (speech recognizer) có thể đã tự sửa chữ cho đúng ngữ cảnh ngữ pháp, do đó bạn PHẢI dựa hoàn toàn vào âm thanh thực tế trong audio để thẩm định, không được tin tưởng vào mặt chữ nếu audio phát âm sai.
3. Chấm CỰC KỲ NGHIÊM KHẮC về thanh điệu (4 thanh điệu 1, 2, 3, 4, khinh thanh), phụ âm đầu (thanh mẫu) và nguyên âm (vận mẫu). Nếu người dùng đọc sai thanh điệu (ví dụ thanh 3 đọc thành thanh 4, thanh 1 đọc chúc xuống, hoặc đọc ngang không dấu), PHẢI đánh dấu correct: false và ghi ngắn gọn lỗi ở issue (ví dụ: "thanh điệu sai: nên đọc thanh 3").
4. Quy định kết quả từng token:
   - Mỗi token trong danh sách phải có đúng một phần tử trong mảng "words" theo đúng chỉ số i (0, 1, 2...).
   - Nếu phát âm đúng chuẩn: "correct": true, "issue": "".
   - Nếu phát âm sai: "correct": false, "issue": "lý do ngắn gọn bằng tiếng Việt".
5. Giới hạn thời lượng audio: Chỉ lắng nghe và thẩm định trong tối đa 20 giây đầu tiên. Nếu audio dài hơn 20 giây, chỉ chấm phần đầu tương ứng với các từ xuất hiện trong 20 giây đầu.
6. Tính điểm:
   - overallScore (0-100): Điểm tổng thể dựa trên độ rõ ràng, trôi chảy và mức độ dễ hiểu của toàn bộ câu.
   - accuracyScore (0-100): Điểm độ chính xác ngữ âm dựa trên tỷ lệ từ phát âm đúng và chuẩn thanh điệu.`;
    } else if (config.locale === 'ja-JP') {
      prompt = `Bạn là chuyên gia thẩm định ngữ âm tiếng Nhật (Japanese ja-JP).
Hãy nghe đoạn âm thanh thực tế của người dùng và đối chiếu với câu mục tiêu: "${referenceText}".

Danh sách token cần đối chiếu (đánh số từ 0):
${tokenListStr}

Nhiệm vụ phân tích âm học và chấm điểm:
1. Nghe kỹ âm thanh thực tế và đối chiếu với từng token theo đúng chỉ số i.
2. LƯU Ý QUAN TRỌNG: Bộ nhận diện giọng nói (speech recognizer) có thể đã tự sửa chữ cho đúng ngữ cảnh ngữ pháp, do đó bạn PHẢI dựa hoàn toàn vào âm thanh thực tế trong audio để thẩm định, không được tin tưởng vào mặt chữ nếu audio phát âm sai.
3. Chấm CỰC KỲ NGHIÊM KHẮC về cao độ âm điệu (pitch accent), trường âm (chōon), âm ngắt (sokuon), âm mũi (hatsuon) và độ chuẩn của các âm tiết. Nếu thiếu trường âm, nuốt âm ngắt hoặc phát âm sai lệch âm tiết, PHẢI đánh dấu correct: false và ghi ngắn gọn lỗi ở issue (ví dụ: "thiếu trường âm", "sai âm ngắt").
4. Quy định kết quả từng token:
   - Mỗi token trong danh sách phải có đúng một phần tử trong mảng "words" theo đúng chỉ số i (0, 1, 2...).
   - Nếu phát âm đúng chuẩn: "correct": true, "issue": "".
   - Nếu phát âm sai: "correct": false, "issue": "lý do ngắn gọn bằng tiếng Việt".
5. Giới hạn thời lượng audio: Chỉ lắng nghe và thẩm định trong tối đa 20 giây đầu tiên. Nếu audio dài hơn 20 giây, chỉ chấm phần đầu tương ứng với các từ xuất hiện trong 20 giây đầu.
6. Tính điểm:
   - overallScore (0-100): Điểm tổng thể dựa trên độ rõ ràng, trôi chảy và tự nhiên của câu.
   - accuracyScore (0-100): Điểm độ chính xác ngữ âm dựa trên tỷ lệ từ phát âm đúng chuẩn âm học.`;
    } else {
      prompt = `Bạn là chuyên gia thẩm định ngữ âm tiếng Anh (English en-US).
Hãy nghe đoạn âm thanh thực tế của người dùng và đối chiếu với câu mục tiêu: "${referenceText}".

Danh sách token cần đối chiếu (đánh số từ 0):
${tokenListStr}

Nhiệm vụ phân tích âm học và chấm điểm:
1. Nghe kỹ âm thanh thực tế và đối chiếu với từng token theo đúng chỉ số i.
2. LƯU Ý QUAN TRỌNG: Bộ nhận diện giọng nói (speech recognizer) có thể đã tự sửa chữ cho đúng ngữ cảnh ngữ pháp, do đó bạn PHẢI dựa hoàn toàn vào âm thanh thực tế trong audio để thẩm định, không được tin tưởng vào mặt chữ nếu audio phát âm sai.
3. Chấm CỰC KỲ NGHIÊM KHẮC về nguyên âm (vowels), phụ âm (consonants), âm đuôi (ending sounds - ví dụ: /s/, /t/, /d/, /k/), trọng âm từ (word stress) và độ rõ ràng. Nếu nuốt âm đuôi, phát âm sai nguyên âm hoặc lệch trọng âm, PHẢI đánh dấu correct: false và ghi ngắn gọn lỗi ở issue (ví dụ: "nuốt âm đuôi /s/", "phát âm sai nguyên âm").
4. Quy định kết quả từng token:
   - Mỗi token trong danh sách phải có đúng một phần tử trong mảng "words" theo đúng chỉ số i (0, 1, 2...).
   - Nếu phát âm đúng chuẩn: "correct": true, "issue": "".
   - Nếu phát âm sai: "correct": false, "issue": "lý do ngắn gọn bằng tiếng Việt".
5. Giới hạn thời lượng audio: Chỉ lắng nghe và thẩm định trong tối đa 20 giây đầu tiên. Nếu audio dài hơn 20 giây, chỉ chấm phần đầu tương ứng với các từ xuất hiện trong 20 giây đầu.
6. Tính điểm:
   - overallScore (0-100): Điểm tổng thể dựa trên độ rõ ràng, trôi chảy và ngữ điệu câu.
   - accuracyScore (0-100): Điểm độ chính xác ngữ âm dựa trên tỷ lệ từ phát âm đúng và chuẩn âm vị.`;
    }

    if (areAllModelsInCooldown(geminiModels)) {
      const resetHours = getGlobalDailyResetHours();
      return {
        provider: 'gemini',
        referenceText,
        overallScore: null,
        syllables: [],
        errorKind: 'quota',
        errorMessage: resetHours
          ? `Hết lượt chấm hôm nay (thử lại sau khoảng ${resetHours} giờ)`
          : 'Hết lượt chấm hôm nay',
        resetHours,
      };
    }

    let responseText = '';
    const TOTAL_BUDGET_MS = 30000;
    const PER_CALL_TIMEOUT_MS = 15000;
    const startTime = Date.now();
    let lastErrorKind: 'quota' | 'busy' | 'error' | undefined = undefined;
    let lastResetHours: number | undefined = undefined;

    // Thử qua các key và model Gemini với cấu hình thinkingBudget: 0, temperature: 0.2
    for (const key of geminiKeys) {
      if (responseText) break;
      for (const modelName of geminiModels) {
        if (responseText) break;
        if (isModelInCooldown(modelName)) continue;

        const remainingBudget = TOTAL_BUDGET_MS - (Date.now() - startTime);
        if (remainingBudget <= 2000) break;

        const effectiveTimeoutMs = Math.min(PER_CALL_TIMEOUT_MS, remainingBudget);
        let timer: NodeJS.Timeout | null = null;

        try {
          const genAI = new GoogleGenerativeAI(key);
          const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 2048,
              responseMimeType: 'application/json',
              responseSchema: pronunciationResponseSchema as any,
              thinkingConfig: {
                thinkingBudget: 0,
              },
            } as any,
          });

          const audioPart = {
            inlineData: {
              data: audioBase64,
              mimeType: detectedMimeType,
            },
          };

          const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`Timeout ${Math.round(effectiveTimeoutMs / 1000)}s`)),
              effectiveTimeoutMs
            );
          });

          const result = await Promise.race([
            model.generateContent([prompt, audioPart]),
            timeoutPromise,
          ]);
          if (timer) clearTimeout(timer);
          responseText = result.response.text();
        } catch (err: any) {
          if (timer) clearTimeout(timer);
          const classified = classifyGoogleError(err);
          markModelCooldown(modelName, classified.kind, classified.retryDelaySec);

          lastErrorKind =
            classified.kind === 'DAILY_QUOTA_EXCEEDED'
              ? 'quota'
              : classified.kind === 'AI_BUSY'
              ? 'busy'
              : 'error';
          if (classified.resetHours) {
            lastResetHours = classified.resetHours;
          }

          console.warn(`[GeminiPronunciation] Model ${modelName} error (${classified.kind}):`, err.message);
          if (classified.kind === 'KEY_INVALID') break;
        }
      }
    }

    if (!responseText) {
      const resetHours = lastResetHours || getGlobalDailyResetHours();
      return {
        provider: 'gemini',
        referenceText,
        overallScore: null,
        syllables: [],
        errorKind: lastErrorKind || 'error',
        errorMessage:
          lastErrorKind === 'quota'
            ? (resetHours ? `Hết lượt chấm hôm nay (thử lại sau khoảng ${resetHours} giờ)` : 'Hết lượt chấm hôm nay')
            : 'Chưa chấm được',
        resetHours,
      };
    }

    // 3. Parse JSON và ghép từ theo chỉ số
    try {
      let cleanJson = responseText.trim();
      if (cleanJson.includes('```')) {
        cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      }
      const startIdx = cleanJson.indexOf('{');
      const endIdx = cleanJson.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1) {
        cleanJson = cleanJson.slice(startIdx, endIdx + 1);
      }

      const parsed = JSON.parse(cleanJson);
      const overallScore = typeof parsed.overallScore === 'number' ? Math.round(parsed.overallScore) : null;
      const accuracyScore =
        typeof parsed.accuracyScore === 'number'
          ? Math.round(parsed.accuracyScore)
          : (overallScore ?? undefined);

      let mergedWords: PronunciationWord[] | undefined = undefined;
      if (tokens.length > 0 && Array.isArray(parsed.words)) {
        mergedWords = mergePronunciationWords(tokens, parsed.words);
      }

      return {
        provider: 'gemini',
        referenceText,
        overallScore,
        accuracyScore,
        words: mergedWords,
        syllables: [],
        note: isLongAudio ? 'Audio dài hơn 20s, đã giới hạn chấm phần đầu.' : undefined,
      };
    } catch (err) {
      console.warn('[GeminiPronunciation] Lỗi parse JSON response:', err);
      return {
        provider: 'gemini',
        referenceText,
        overallScore: null,
        syllables: [],
      };
    }
  }
}
