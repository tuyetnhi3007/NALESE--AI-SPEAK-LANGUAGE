// ============================================================
// app/api/tts/route.ts — Standalone TTS (Text-to-Speech)
// Dùng cho phát âm từ vựng, exercise audio hints
// Fallback về browser-tts nếu OpenAI không khả dụng
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { textToSpeech } from '@/lib/ai';
import type { TutorVoice } from '@/lib/types';

export const maxDuration = 30;

interface TTSRequest {
  text: string;
  voice?: TutorVoice;
  speed?: number;
  apiKey?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: TTSRequest = await request.json();
    const { text, voice = 'nova', speed = 1.0 } = body;

    const clientApiKey = request.headers.get('x-api-key') || body.apiKey || undefined;

    if (!text?.trim()) {
      return NextResponse.json({ error: 'Không có văn bản để chuyển đổi.' }, { status: 400 });
    }

    const result = await textToSpeech(text, voice, speed, clientApiKey);

    return NextResponse.json({
      audioBase64: result.audioBase64,
      provider: result.provider,
      text,
      useBrowserTts: result.provider === 'browser-tts',
    });
  } catch (error) {
    console.error('[tts] Error:', error);
    // Trả về browser-tts fallback thay vì lỗi 500
    return NextResponse.json({
      audioBase64: '',
      provider: 'browser-tts',
      text: '',
      useBrowserTts: true,
    });
  }
}
