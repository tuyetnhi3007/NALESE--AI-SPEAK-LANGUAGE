// ============================================================
// lib/ai/pronunciation/gemini.ts
// Fallback Adapter: Audio-based Pronunciation Evaluator (Gemini)
// Hỗ trợ: zh-CN, en-US, ja-JP
// ============================================================

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { PronunciationAssessorAdapter, AssessPronunciationOptions } from './types';
import type { PronunciationAssessmentResult, SyllableAssessment, PhonemeAssessment } from '@/lib/types';
import { getPronunciationConfig } from './config';
import { aggregateSyllableAssessment } from './mapper';

function detectAudioMimeType(base64: string): string {
  try {
    const buffer = Buffer.from(base64.slice(0, 32), 'base64');
    if (buffer.length >= 4) {
      if (buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3) {
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
    }
  } catch {}
  return 'audio/webm';
}

export class GeminiPronunciationAssessor implements PronunciationAssessorAdapter {
  readonly name = 'gemini' as const;

  isConfigured(): boolean {
    return Boolean(process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_2 || process.env.OPENROUTER_API_KEY);
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

    // Nếu không có audio thực tế từ mic, trả về unassessed (tuyệt đối không tạo score giả)
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

    // Xây dựng prompt thẩm định ngữ âm chuyên sâu theo từng ngôn ngữ
    let prompt = '';
    if (config.locale === 'zh-CN') {
      prompt = `Bạn là chuyên gia thẩm định ngữ âm tiếng Trung Quốc (Mandarin zh-CN).
Hãy nghe đoạn âm thanh thực tế của người dùng và đối chiếu với câu mục tiêu: "${referenceText}".

Nhiệm vụ phân tích âm học:
1. Đối chiếu âm thanh thực tế với từng chữ Hán và âm tiết Pinyin chuẩn (kèm dấu thanh điệu 1-4).
2. Đảm bảo mảng "syllables" có đủ từng chữ Hán tương ứng với câu "${referenceText}".
3. Đánh giá tính chính xác của phụ âm đầu (thanh mẫu), nguyên âm (vận mẫu), và thanh điệu (tones 1-4).
4. Nếu phát âm đúng, cho điểm từ 75-100 và errorType là "None".
5. Nếu phát âm sai thanh điệu (ví dụ thanh 3 đọc thành thanh 4), cho điểm dưới 70 và errorType là "ToneError".
6. Nếu phát âm sai âm tiết hoặc nuốt chữ, cho điểm dưới 60 và errorType là "Mispronunciation" hoặc "Omission".
7. QUAN TRỌNG: Chỉ những âm tiết người dùng phát âm sai mới cho điểm < 70 hoặc errorType khác "None". Các âm tiết đúng phải giữ errorType là "None" và điểm >= 75.
8. Tính điểm tổng thể overallScore (0-100) và accuracyScore (0-100).

Định dạng JSON bắt buộc:
{
  "overallScore": 85,
  "accuracyScore": 84,
  "syllables": [
    {
      "character": "你",
      "pinyin": "nǐ",
      "accuracyScore": 95,
      "errorType": "None",
      "phonemes": [
        { "phoneme": "n", "accuracyScore": 96, "errorType": "None" },
        { "phoneme": "i", "accuracyScore": 95, "errorType": "None" },
        { "phoneme": "3", "accuracyScore": 94, "errorType": "None" }
      ]
    }
  ]
}`;
    } else if (config.locale === 'en-US') {
      prompt = `Bạn là chuyên gia thẩm định ngữ âm tiếng Anh (English en-US).
Hãy nghe đoạn âm thanh thực tế của người dùng và đối chiếu với câu mục tiêu: "${referenceText}".

Nhiệm vụ phân tích âm học:
1. Đối chiếu âm thanh thực tế của người dùng với cách phát âm tiếng Anh chuẩn của từng từ trong câu: "${referenceText}".
2. Đánh giá độ chính xác của nguyên âm (vowels), phụ âm (consonants), trọng âm từ (word stress) và ngữ điệu (intonation).
3. Đánh giá phát âm thực tế: nếu phát âm chuẩn rõ ràng cho điểm từ 80-100, nếu phát âm sai/nuốt âm/ngọng cho điểm dưới 70.
4. Tính điểm tổng thể overallScore (0-100) và accuracyScore (0-100) dựa trên âm thanh thực tế.

Định dạng JSON bắt buộc:
{
  "overallScore": 85,
  "accuracyScore": 84
}`;
    } else if (config.locale === 'ja-JP') {
      prompt = `Bạn là chuyên gia thẩm định ngữ âm tiếng Nhật (Japanese ja-JP).
Hãy nghe đoạn âm thanh thực tế của người dùng và đối chiếu với câu mục tiêu: "${referenceText}".

Nhiệm vụ phân tích âm học:
1. Đối chiếu âm thanh thực tế của người dùng với cách phát âm tiếng Nhật chuẩn của từng từ/âm tiết trong câu: "${referenceText}".
2. Đánh giá độ chính xác của trường âm (chōon), âm ngắt (sokuon), âm mũi (hatsuon), và cao độ âm điệu (pitch accent).
3. Đánh giá phát âm thực tế: nếu phát âm chuẩn rõ ràng cho điểm từ 80-100, nếu phát âm sai/nuốt âm/ngọng cho điểm dưới 70.
4. Tính điểm tổng thể overallScore (0-100) và accuracyScore (0-100) dựa trên âm thanh thực tế.

Định dạng JSON bắt buộc:
{
  "overallScore": 85,
  "accuracyScore": 84
}`;
    }

    let responseText = '';

    // 1. Thử qua các key và model Gemini với dữ liệu audio thực tế
    for (const key of geminiKeys) {
      if (responseText) break;
      for (const modelName of geminiModels) {
        if (responseText) break;
        try {
          const genAI = new GoogleGenerativeAI(key);
          const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 2048,
              responseMimeType: 'application/json',
            },
          });

          const audioPart = {
            inlineData: {
              data: audioBase64,
              mimeType: detectedMimeType,
            },
          };
          const result = await model.generateContent([prompt, audioPart]);
          responseText = result.response.text();
        } catch (err) {
          console.warn(`[GeminiPronunciation] Key/Model ${modelName} error:`, err);
        }
      }
    }

    // Nếu không nhận được phản hồi âm thanh hợp lệ
    if (!responseText) {
      return {
        provider: 'gemini',
        referenceText,
        overallScore: null,
        syllables: [],
      };
    }

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
      const syllables: SyllableAssessment[] = [];

      // CHỈ xử lý mảng syllables khi là tiếng Trung (script: pinyin)
      if (config.script === 'pinyin' && Array.isArray(parsed.syllables)) {
        for (const s of parsed.syllables) {
          const char = typeof s.character === 'string' ? s.character : '';
          const pinyin = typeof s.pinyin === 'string' ? s.pinyin : '';
          const score = typeof s.accuracyScore === 'number' ? s.accuracyScore : 70;
          const rawPhonemes: PhonemeAssessment[] = Array.isArray(s.phonemes)
            ? s.phonemes.map((ph: any) => ({
                phoneme: String(ph.phoneme || ''),
                accuracyScore: typeof ph.accuracyScore === 'number' ? ph.accuracyScore : score,
                errorType: ph.errorType || (ph.accuracyScore < 70 ? 'Mispronunciation' : 'None'),
              }))
            : [];

          // Sử dụng aggregateSyllableAssessment để tổng hợp chuẩn xác các phoneme
          const aggregated = aggregateSyllableAssessment(char, pinyin, rawPhonemes, score);
          syllables.push({
            ...aggregated,
            note: s.note,
          });
        }
      }
      // en-US và ja-JP: syllables giữ [] để không bị gán sai vào Chinese Pinyin

      return {
        provider: 'gemini',
        referenceText,
        overallScore,
        accuracyScore: typeof parsed.accuracyScore === 'number' ? parsed.accuracyScore : (overallScore ?? undefined),
        syllables,
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
