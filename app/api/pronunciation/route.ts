// ============================================================
// app/api/pronunciation/route.ts — Endpoint chấm lại phát âm
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { assessPronunciation } from '@/lib/ai/pronunciation';

export const maxDuration = 35;

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { audioBase64, referenceText, language } = await req.json();
    if (!audioBase64 || !referenceText) {
      return NextResponse.json({ error: 'Thiếu dữ liệu audio hoặc câu mẫu.' }, { status: 400 });
    }

    const result = await assessPronunciation({
      audioBase64,
      referenceText,
      language: language || 'en',
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[api/pronunciation] Error:', err);
    return NextResponse.json({ error: err.message || 'Lỗi khi chấm phát âm.' }, { status: 500 });
  }
}
