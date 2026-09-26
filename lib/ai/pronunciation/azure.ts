// ============================================================
// lib/ai/pronunciation/azure.ts
// Primary Adapter: Azure Pronunciation Assessment (Phoneme-level)
// ============================================================

import type { PronunciationAssessorAdapter, AssessPronunciationOptions } from './types';
import type { PronunciationAssessmentResult, PhonemeAssessment, SyllableAssessment } from '@/lib/types';
import { aggregateSyllableAssessment } from './mapper';

import { getPronunciationConfig } from './config';

export class AzurePronunciationAssessor implements PronunciationAssessorAdapter {
  readonly name = 'azure' as const;

  isConfigured(): boolean {
    return Boolean(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION);
  }

  async assess(options: AssessPronunciationOptions): Promise<PronunciationAssessmentResult> {
    const key = process.env.AZURE_SPEECH_KEY;
    const region = process.env.AZURE_SPEECH_REGION;

    if (!key || !region) {
      throw new Error('Azure Speech chưa được cấu hình (thiếu AZURE_SPEECH_KEY hoặc AZURE_SPEECH_REGION).');
    }

    const { audioBase64, referenceText, language } = options;
    const config = getPronunciationConfig(language);
    if (!config || !config.enabled) {
      throw new Error(`Ngôn ngữ ${language} không được hỗ trợ Pronunciation Assessment.`);
    }

    const lang = config.locale; // 'zh-CN' | 'en-US' | 'ja-JP'

    // Chuẩn bị tham số Pronunciation-Assessment header theo chuẩn Azure
    const pronParams = {
      ReferenceText: referenceText,
      GradingSystem: 'HundredMark',
      Granularity: 'Phoneme',
      Dimension: 'Comprehensive',
      EnableMiscue: 'True',
      PhonemeAlphabet: config.azurePhonemeAlphabet,
    };

    if (!audioBase64) {
      throw new Error('Azure Speech yêu cầu dữ liệu âm thanh');
    }

    const pronHeaderBase64 = Buffer.from(JSON.stringify(pronParams)).toString('base64');
    const audioBuffer = Buffer.from(audioBase64, 'base64');

    const url = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${lang}&format=detailed`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'audio/webm; codecs=opus',
        'Pronunciation-Assessment': pronHeaderBase64,
        'Accept': 'application/json',
      },
      body: new Uint8Array(audioBuffer),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Azure Pronunciation Assessment thất bại (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const nBest = data.NBest?.[0];

    if (!nBest) {
      throw new Error('Azure không trả về dữ liệu NBest');
    }

    // ƯU TIÊN lấy trực tiếp PronScore full-text của provider làm overallScore
    const overallScore = typeof nBest.PronScore === 'number' ? Math.round(nBest.PronScore) : null;
    const accuracyScore = typeof nBest.AccuracyScore === 'number' ? Math.round(nBest.AccuracyScore) : undefined;
    const fluencyScore = typeof nBest.FluencyScore === 'number' ? Math.round(nBest.FluencyScore) : undefined;
    const completenessScore = typeof nBest.CompletenessScore === 'number' ? Math.round(nBest.CompletenessScore) : undefined;

    const syllables: SyllableAssessment[] = [];
    const words = nBest.Words || [];

    // CHỈ áp dụng mapper Hán tự / Pinyin cho tiếng Trung
    if (config.script === 'pinyin') {
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        const char = w.Word || referenceText[i] || '';
        const wordScore = typeof w.AccuracyScore === 'number' ? w.AccuracyScore : undefined;

        const rawPhonemes: PhonemeAssessment[] = (w.Phonemes || []).map((ph: any) => ({
          phoneme: ph.Phoneme || '',
          accuracyScore: typeof ph.AccuracyScore === 'number' ? ph.AccuracyScore : 0,
          errorType: ph.ErrorType || (ph.AccuracyScore < 70 ? 'Mispronunciation' : 'None'),
        }));

        // Gọi mapper tổng hợp tất định cho chữ Hán này
        const syllable = aggregateSyllableAssessment(char, char, rawPhonemes, wordScore);
        syllables.push(syllable);
      }
    }
    // Đối với en-US và ja-JP: KHÔNG dùng Chinese Pinyin mapper!
    // Syllables để [] trong khi bảo toàn overallScore, accuracyScore, fluencyScore, completenessScore

    return {
      provider: 'azure',
      referenceText,
      overallScore,
      accuracyScore,
      fluencyScore,
      completenessScore,
      syllables,
    };
  }
}
