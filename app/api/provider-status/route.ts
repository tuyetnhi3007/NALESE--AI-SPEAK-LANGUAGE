// ============================================================
// app/api/provider-status/route.ts — Kiểm tra cấu hình provider
//
// Trả về trạng thái "configured" / "missing" cho từng provider.
// KHÔNG bao giờ trả về giá trị API key.
// Chỉ đọc process.env ở server-side.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getProvidersStatus } from '@/lib/ai';

export const dynamic = 'force-dynamic'; // Luôn chạy fresh, không cache

export async function GET(request: NextRequest): Promise<NextResponse> {
  // clientApiKey từ header (OpenAI key từ UI) — chỉ dùng để check status, không trả về
  const clientApiKey = request.headers.get('x-api-key') || undefined;

  const status = getProvidersStatus(clientApiKey);

  return NextResponse.json({
    providers: {
      gemini: {
        name: 'Google Gemini',
        status: status.gemini,
        role: 'LLM (ưu tiên)',
        model: 'gemini-3.6-flash',
        freeTier: '1500 req/ngày',
      },
      openai: {
        name: 'OpenAI',
        status: status.openai,
        role: 'LLM fallback',
        model: 'gpt-4o',
        freeTier: 'Không',
      },
      groq: {
        name: 'Groq Whisper',
        status: status.groq,
        role: 'STT (ưu tiên)',
        model: 'whisper-large-v3-turbo',
        freeTier: '6000 phút/tháng',
      },
      tts: {
        name: 'Browser SpeechSynthesis',
        status: 'browser-native',
        role: 'TTS Client-side',
        provider: 'Web Speech API',
        freeTier: 'Hoàn toàn miễn phí',
      },
    },
    webSpeechApi: {
      name: 'Web Speech API',
      status: 'browser-native',
      role: 'STT thay thế (không cần API key)',
      freeTier: 'Hoàn toàn miễn phí',
    },
  });
}
