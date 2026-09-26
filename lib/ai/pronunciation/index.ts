// ============================================================
// lib/ai/pronunciation/index.ts
// Pronunciation Assessor Orchestrator
// ============================================================

import type { PronunciationAssessmentResult } from '@/lib/types';
import type { AssessPronunciationOptions } from './types';
import { getPronunciationConfig, PRONUNCIATION_CONFIGS } from './config';
import { AzurePronunciationAssessor } from './azure';
import { GeminiPronunciationAssessor } from './gemini';

export { getPronunciationConfig, PRONUNCIATION_CONFIGS };

const azureAssessor = new AzurePronunciationAssessor();
const geminiAssessor = new GeminiPronunciationAssessor();

/**
 * Điều phối đánh giá phát âm cho cả 3 ngôn ngữ (zh-CN, en-US, ja-JP):
 * 1. Ưu tiên AzurePronunciationAssessor nếu đã cấu hình key trong .env.local
 * 2. Tự động chuyển sang GeminiPronunciationAssessor (audio-based multimodal evaluator)
 * 3. Nếu cả 2 đều không khả dụng hoặc không có audio: trả về unassessed (overallScore: null)
 */
export async function assessPronunciation(
  options: AssessPronunciationOptions
): Promise<PronunciationAssessmentResult> {
  const { referenceText, language } = options;
  const config = getPronunciationConfig(language);

  // Kiểm tra văn bản mục tiêu và ngôn ngữ hợp lệ
  if (!referenceText?.trim() || !config || !config.enabled) {
    return {
      provider: 'unassessed',
      referenceText: referenceText || '',
      overallScore: null,
      syllables: [],
    };
  }

  // 1. Kiểm tra và gọi Azure (Primary Dedicated Engine)
  if (azureAssessor.isConfigured()) {
    try {
      const result = await azureAssessor.assess(options);
      if (typeof result.overallScore === 'number') {
        console.log(`[Pronunciation]\nlanguage: ${config.locale}\nprovider: azure\noverallScore: ${result.overallScore}`);
        return result;
      }
    } catch (err) {
      console.warn('[Pronunciation] Azure assessment thất bại, thử Gemini fallback:', err);
    }
  }

  // 2. Chuyển sang Gemini Fallback (Audio-based Evaluator)
  if (geminiAssessor.isConfigured()) {
    try {
      const result = await geminiAssessor.assess(options);
      if (typeof result.overallScore === 'number') {
        console.log(`[Pronunciation]\nlanguage: ${config.locale}\nprovider: gemini\noverallScore: ${result.overallScore}`);
        return result;
      }
    } catch (err) {
      console.warn('[Pronunciation] Gemini fallback thất bại:', err);
    }
  }

  // 3. Dự phòng an toàn tuyệt đối khi không có provider nào đánh giá thành công
  console.log(`[Pronunciation]\nlanguage: ${config.locale}\nprovider: unassessed\noverallScore: null`);
  return {
    provider: 'unassessed',
    referenceText,
    overallScore: null,
    syllables: [],
  };
}
