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

/** Model mặc định: Gemini 3.5 Flash Lite (nhanh nhất ~800ms) */
export const GEMINI_CHAT_MODEL = 'gemini-3.5-flash-lite';
const FAST_GEMINI_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.6-flash'];

function prepareHistory(history: { role: 'user' | 'assistant'; content: string }[]): {
  finalHistory: Content[];
  lastHistoryMsg: { text: string } | null;
} {
  const geminiHistory: Content[] = history.map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));

  const validHistory: Content[] = [];
  for (let i = 0; i < geminiHistory.length; i++) {
    const expected = i % 2 === 0 ? 'user' : 'model';
    if (geminiHistory[i].role === expected) {
      validHistory.push(geminiHistory[i]);
    } else {
      break;
    }
  }

  const finalHistory = validHistory.length >= 2 ? validHistory.slice(0, -1) : [];
  const lastHistoryMsg = validHistory.length >= 2 
    ? validHistory[validHistory.length - 1].parts[0] as { text: string }
    : null;

  return { finalHistory, lastHistoryMsg };
}

/**
 * Chat với Gemini. Trả về text response.
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

  for (const apiKey of keys) {
    for (const modelName of FAST_GEMINI_MODELS) {
      try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            maxOutputTokens: 300,
            temperature: 0.7,
            responseMimeType: 'application/json',
          },
        });

        if (history.length === 0) {
          const result = await model.generateContent(
            `${systemPrompt}\n\nNgười dùng: ${userMessage}`
          );
          return result.response.text();
        }

        const { finalHistory, lastHistoryMsg } = prepareHistory(history);
        const chat = model.startChat({
          history: finalHistory,
          systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
        });

        const fullMessage = lastHistoryMsg
          ? `${lastHistoryMsg.text}\n\nNgười dùng: ${userMessage}`
          : userMessage;

        const result = await chat.sendMessage(fullMessage);
        return result.response.text();
        
      } catch (err: any) {
        console.warn(`[Gemini] Model ${modelName} error: ${err.message}. Trying next...`);
        lastError = err;
        // Nếu lỗi 401 hoặc auth error, không thử lại cùng key đó
        if (err.message?.includes('API_KEY_INVALID') || err.status === 401 || err.status === 403) {
          break;
        }
        continue;
      }
    }
  }

  throw lastError || new Error('Tất cả các Gemini API keys đều bị lỗi hoặc hết Quota.');
}

/**
 * Chat với Gemini hỗ trợ Stream từng token cho first-token latency thấp nhất.
 */
export async function* chatWithGeminiStream(
  systemPrompt: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  userMessage: string,
  clientApiKey?: string
): AsyncGenerator<string, void, unknown> {
  const keys = clientApiKey 
    ? [clientApiKey] 
    : [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2].filter(Boolean) as string[];

  if (keys.length === 0) {
    throw new Error('GEMINI_API_KEY chưa được cấu hình.');
  }

  let lastError: any = null;

  for (const apiKey of keys) {
    for (const modelName of FAST_GEMINI_MODELS) {
      try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            maxOutputTokens: 300,
            temperature: 0.7,
            responseMimeType: 'application/json',
          },
        });

        if (history.length === 0) {
          const resultStream = await model.generateContentStream(
            `${systemPrompt}\n\nNgười dùng: ${userMessage}`
          );
          for await (const chunk of resultStream.stream) {
            yield chunk.text();
          }
          return;
        }

        const { finalHistory, lastHistoryMsg } = prepareHistory(history);
        const chat = model.startChat({
          history: finalHistory,
          systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
        });

        const fullMessage = lastHistoryMsg
          ? `${lastHistoryMsg.text}\n\nNgười dùng: ${userMessage}`
          : userMessage;

        const resultStream = await chat.sendMessageStream(fullMessage);
        for await (const chunk of resultStream.stream) {
          yield chunk.text();
        }
        return;

      } catch (err: any) {
        console.warn(`[GeminiStream] Model ${modelName} error: ${err.message}. Trying next...`);
        lastError = err;
        if (err.message?.includes('API_KEY_INVALID') || err.status === 401 || err.status === 403) {
          break;
        }
        continue;
      }
    }
  }

  throw lastError || new Error('Tất cả các Gemini API keys đều bị lỗi hoặc hết Quota.');
}
