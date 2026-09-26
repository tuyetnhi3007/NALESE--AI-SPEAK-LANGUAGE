// ============================================================
// lib/ai/gemini.ts — Google Gemini LLM client
// Free tier: 1500 req/day (Gemini 2.0 Flash), 15 req/min
// Key format: AIzaSy... (lấy tại aistudio.google.com/apikey)
// ============================================================

import { GoogleGenerativeAI, type Content } from '@google/generative-ai';

export function createGeminiClient(clientApiKey?: string): GoogleGenerativeAI {
  const apiKey = clientApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY chưa được cấu hình.');
  }
  return new GoogleGenerativeAI(apiKey);
}

/** Model mặc định: Gemini 3.8 Flash (bản mới nhất được Google yêu cầu) */
export const GEMINI_CHAT_MODEL = 'gemini-3.8-flash';

/**
 * Chat với Gemini. Trả về text response.
 * Nếu history rỗng, dùng generateContent thay startChat để tránh lỗi empty history.
 */
export async function chatWithGemini(
  systemPrompt: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  userMessage: string,
  clientApiKey?: string
): Promise<string> {
  const keys = clientApiKey 
    ? [clientApiKey] 
    : [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2].filter(Boolean) as string[];

  if (keys.length === 0) {
    throw new Error('GEMINI_API_KEY chưa được cấu hình.');
  }

  let lastError: any = null;

  const chatModels = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.6-flash'];

  for (const apiKey of keys) {
    for (const modelName of chatModels) {
      try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            maxOutputTokens: 1000,
            temperature: 0.7,
            responseMimeType: 'application/json',
          },
        });

        // Nếu không có history → dùng generateContent (đơn giản, ít lỗi hơn)
        if (history.length === 0) {
          const result = await model.generateContent(
            `${systemPrompt}\n\nNgười dùng: ${userMessage}`
          );
          return result.response.text();
        }

        // Có history → dùng startChat
        const geminiHistory: Content[] = history.map((msg) => ({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        }));

        // Gemini yêu cầu history phải bắt đầu bằng 'user' và xen kẽ user/model
        // Lọc history không hợp lệ
        const validHistory: Content[] = [];
        for (let i = 0; i < geminiHistory.length; i++) {
          const expected = i % 2 === 0 ? 'user' : 'model';
          if (geminiHistory[i].role === expected) {
            validHistory.push(geminiHistory[i]);
          } else {
            break; // Dừng khi gặp role không đúng thứ tự
          }
        }

        // Phải có ít nhất 1 cặp user-model để startChat có history
        const finalHistory = validHistory.length >= 2 ? validHistory.slice(0, -1) : [];

        const chat = model.startChat({
          history: finalHistory,
          systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
        });

        // Thêm message cuối cùng từ history (nếu còn) + userMessage
        const lastHistoryMsg = validHistory.length >= 2 
          ? validHistory[validHistory.length - 1].parts[0] as { text: string }
          : null;
        
        const fullMessage = lastHistoryMsg
          ? `${lastHistoryMsg.text}\n\nNgười dùng: ${userMessage}`
          : userMessage;

        const result = await chat.sendMessage(fullMessage);
        return result.response.text();
        
      } catch (err: any) {
        console.warn(`[Gemini] Lỗi với key ${apiKey.substring(0, 8)}... model ${modelName}: ${err.message}. Đang thử tiếp...`);
        lastError = err;
        continue;
      }
    }
  }

  throw lastError || new Error('Tất cả các Gemini API keys đều bị lỗi hoặc hết Quota.');
}
