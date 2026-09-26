// ============================================================
// lib/ai/pronunciation/types.ts
// Interfaces cho kiến trúc Pronunciation Assessment
// ============================================================

import type { PronunciationAssessmentResult } from '@/lib/types';

export interface AssessPronunciationOptions {
  audioBase64?: string;
  referenceText: string;
  language: string; // 'zh-CN' | 'en-US' | 'ja-JP' hoặc 'zh' | 'en' | 'ja'
}

export interface PronunciationAssessorAdapter {
  readonly name: 'azure' | 'gemini';
  isConfigured(): boolean;
  assess(options: AssessPronunciationOptions): Promise<PronunciationAssessmentResult>;
}
