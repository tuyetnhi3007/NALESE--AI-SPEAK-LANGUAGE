// ============================================================
// lib/ai/pronunciation/config.ts
// Cấu hình chuẩn cho Pronunciation Assessment (zh-CN, en-US, ja-JP)
// ============================================================

import type { SupportedLanguage } from '@/lib/types';

export interface PronunciationLanguageConfig {
  enabled: boolean;
  locale: 'zh-CN' | 'en-US' | 'ja-JP';
  languageCode: SupportedLanguage;
  languageName: string;
  script: 'pinyin' | 'words' | 'japanese';
  azurePhonemeAlphabet: 'SAPI' | 'IPA';
}

export const PRONUNCIATION_CONFIGS: Record<string, PronunciationLanguageConfig> = {
  // Tiếng Trung (Mandarin zh-CN)
  'zh': {
    enabled: true,
    locale: 'zh-CN',
    languageCode: 'zh',
    languageName: 'Chinese (Mandarin)',
    script: 'pinyin',
    azurePhonemeAlphabet: 'SAPI',
  },
  'zh-CN': {
    enabled: true,
    locale: 'zh-CN',
    languageCode: 'zh',
    languageName: 'Chinese (Mandarin)',
    script: 'pinyin',
    azurePhonemeAlphabet: 'SAPI',
  },

  // Tiếng Anh (English en-US)
  'en': {
    enabled: true,
    locale: 'en-US',
    languageCode: 'en',
    languageName: 'English',
    script: 'words',
    azurePhonemeAlphabet: 'SAPI',
  },
  'en-US': {
    enabled: true,
    locale: 'en-US',
    languageCode: 'en',
    languageName: 'English',
    script: 'words',
    azurePhonemeAlphabet: 'SAPI',
  },

  // Tiếng Nhật (Japanese ja-JP)
  'ja': {
    enabled: true,
    locale: 'ja-JP',
    languageCode: 'ja',
    languageName: 'Japanese',
    script: 'japanese',
    azurePhonemeAlphabet: 'SAPI',
  },
  'ja-JP': {
    enabled: true,
    locale: 'ja-JP',
    languageCode: 'ja',
    languageName: 'Japanese',
    script: 'japanese',
    azurePhonemeAlphabet: 'SAPI',
  },
};

export function getPronunciationConfig(langOrLocale?: string): PronunciationLanguageConfig | null {
  if (!langOrLocale) return null;
  const key = langOrLocale.trim();
  return PRONUNCIATION_CONFIGS[key] || PRONUNCIATION_CONFIGS[key.toLowerCase()] || null;
}
