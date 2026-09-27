// ============================================================
// app/api/voice-chat/pronounce/route.ts
// Chuyên biệt cho Pronunciation Assessment chạy song song
// Tách rời khỏi LLM chat để không block AI response!
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { assessPronunciation, getPronunciationConfig } from '@/lib/ai/pronunciation';
import { ensureRomaji } from '@/lib/japanese';
import type { SupportedLanguage, PronunciationAssessmentResult } from '@/lib/types';

export const maxDuration = 60;

interface PronounceRequest {
  audioBase64?: string;
  referenceText: string;
  language: SupportedLanguage;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const t0 = Date.now();
  console.log('[PERF] pronunciation_start', t0);

  try {
    const body: PronounceRequest = await request.json();
    const { audioBase64, referenceText, language } = body;

    if (!referenceText?.trim() || !audioBase64) {
      console.log('[PERF] pronunciation_end', Date.now(), 'duration: 0ms (no audio/text)');
      return NextResponse.json({
        pronunciationResult: undefined,
        pronunciationScore: null,
        userPinyin: undefined,
        userRomanization: undefined,
        latencyMs: Date.now() - t0,
      });
    }

    const config = getPronunciationConfig(language);
    if (!config?.enabled) {
      console.log('[PERF] pronunciation_end', Date.now(), 'duration: 0ms (disabled)');
      return NextResponse.json({
        pronunciationResult: undefined,
        pronunciationScore: null,
        userPinyin: undefined,
        userRomanization: undefined,
        latencyMs: Date.now() - t0,
      });
    }

    const result: PronunciationAssessmentResult = await assessPronunciation({
      audioBase64,
      referenceText,
      language,
    });

    const isChinese = (language as string) === 'zh' || (language as string) === 'zh-CN';
    const isJapanese = (language as string) === 'ja' || (language as string) === 'ja-JP';

    let userPinyin: string | undefined = undefined;
    let userRomanization: string | undefined = undefined;

    if (result && result.syllables && result.syllables.length > 0) {
      userPinyin = result.syllables.map(s => s.pinyin).filter(Boolean).join(' ');
    }

    if (isChinese) {
      userRomanization = userPinyin;
    } else if (isJapanese) {
      userRomanization = ensureRomaji('', referenceText);
    }

    console.log('[PERF] pronunciation_end', Date.now(), `duration: ${Date.now() - t0}ms, score: ${result.overallScore}`);

    return NextResponse.json({
      pronunciationResult: result,
      pronunciationScore: result.overallScore ?? null,
      userPinyin,
      userRomanization,
      latencyMs: Date.now() - t0,
    });

  } catch (error) {
    console.error('[PronounceAPI] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Lỗi đánh giá phát âm',
        pronunciationScore: null,
        latencyMs: Date.now() - t0,
      },
      { status: 500 }
    );
  }
}
