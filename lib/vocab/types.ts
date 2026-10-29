// lib/vocab/types.ts
// Các kiểu dữ liệu cốt lõi cho Flashcard và Kho từ vựng đã thuộc

import type { SupportedLanguage } from '@/lib/types';

export interface FlashcardItem {
  id: string;
  position: number;
  term: string;
  reading: string;
  word_type?: string;
  meaning_vi: string;
  level?: string | null;
  extra?: Record<string, any> | null;
}

export interface LearnedWordItem {
  user_id: string;
  vocab_id: string;
  language: SupportedLanguage;
  learned_at: string;
  vocab_items?: {
    language: string;
    term: string;
    reading: string;
    word_type?: string;
    meaning_vi: string;
  } | null;
}

export type FlashcardMode = 'all' | 'unlearned' | 'learned';

export interface LearnedCounts {
  zh: number;
  ja: number;
  en: number;
  total: number;
}
