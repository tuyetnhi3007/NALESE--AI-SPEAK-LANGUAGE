// ============================================================
// lib/ai/groq.ts — Groq Whisper STT client
// Free tier: 6000 min/month, fastest Whisper inference
// Docs: https://console.groq.com/docs/speech-text
// ============================================================

import Groq from 'groq-sdk';

export function createGroqClient(clientApiKey?: string): Groq {
  const apiKey = clientApiKey || process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY chưa được cấu hình.');
  }
  return new Groq({ apiKey });
}

/** Ngôn ngữ STT cho Groq Whisper */
const GROQ_STT_LANG: Record<string, string> = {
  en: 'en',
  zh: 'zh',
  ja: 'ja',
};

/**
 * Transcribe audio using Groq Whisper (whisper-large-v3-turbo).
 * Accepts a base64-encoded audio blob (webm/opus).
 * Returns the transcript string.
 */
export async function transcribeWithGroq(
  audioBase64: string,
  language: string,
  clientApiKey?: string
): Promise<string> {
  const groq = createGroqClient(clientApiKey);
  const { toFile } = await import('groq-sdk');

  const audioBuffer = Buffer.from(audioBase64, 'base64');
  // Groq SDK expects a File-like object (use toFile for Node.js)
  const audioFile = await toFile(audioBuffer, 'audio.webm', { type: 'audio/webm' });

  const response = await groq.audio.transcriptions.create({
    file: audioFile,
    model: 'whisper-large-v3-turbo', // Nhanh nhất, miễn phí tier
    language: GROQ_STT_LANG[language] || 'en',
    response_format: 'text',
  });

  // Groq trả về string khi response_format là 'text'
  return (response as unknown as string).trim();
}

export const GROQ_STT_MODEL = 'whisper-large-v3-turbo';

/**
 * Chat với Groq (Llama 3.1) làm fallback miễn phí, cực nhanh.
 */
export async function chatWithGroq(
  systemPrompt: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  userMessage: string,
  clientApiKey?: string
): Promise<string> {
  const groq = createGroqClient(clientApiKey);
  
  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage }
  ];

  // Danh sách các model hoạt động trên Groq (qwen/qwen3.8-27b siêu nhanh ~210ms)
  const modelsToTry = [
    'qwen/qwen3.8-27b',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
  ];

  let lastError: any = null;

  for (const model of modelsToTry) {
    try {
      const response = await groq.chat.completions.create({
        messages,
        model,
        max_tokens: 300,
        temperature: 0.7,
        response_format: { type: 'json_object' },
      });
      return response.choices[0]?.message?.content || '';
    } catch (err: any) {
      console.warn(`[Groq] Lỗi với model ${model}: ${err.message}. Đang thử model tiếp theo...`);
      lastError = err;
      continue; // Đổi sang model free khác
    }
  }

  throw lastError || new Error('Tất cả các model miễn phí trên Groq đều bị lỗi hoặc hết lượt.');
}
