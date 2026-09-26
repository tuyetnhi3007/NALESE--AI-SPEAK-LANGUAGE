import OpenAI from 'openai';
import { TOOLS, executeToolCall } from '@/lib/tools';

export function createOpenRouterClient(apiKey?: string): OpenAI {
  const key = apiKey || process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error('OPENROUTER_API_KEY chưa được cấu hình.');
  }
  return new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: key,
    defaultHeaders: {
      'HTTP-Referer': 'https://nalese.app', // Optional, for including your app on openrouter.ai rankings.
      'X-Title': 'NALESE', // Optional. Shows in rankings on openrouter.ai.
    }
  });
}

/** Model mặc định: dùng 1 model free hoặc model phổ biến trên openrouter */
export const OPENROUTER_CHAT_MODEL = 'google/gemini-2.5-flash'; // OpenRouter also has free gemini or you can use meta-llama/llama-3-8b-instruct:free

/**
 * Chat với OpenRouter (fallback).
 * Trả về text response và toolResults nếu có.
 */
export async function chatWithOpenRouter(
  systemPrompt: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  userMessage: string,
  clientApiKey?: string,
  tools?: Parameters<OpenAI['chat']['completions']['create']>[0]['tools']
): Promise<{ text: string; toolResults?: { toolName: string; result: string }[] }> {
  const openrouter = createOpenRouterClient(clientApiKey);

  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-8),
    { role: 'user', content: userMessage },
  ];

  const toolResults: { toolName: string; result: string }[] = [];

  // Thử các model theo thứ tự (fallback tự động trong nội bộ OpenRouter)
  // Các model free thường có trên OpenRouter:
  const modelsToTry = [
    'google/gemini-2.5-flash',
    'google/gemini-2.5-pro',
    'meta-llama/llama-3.3-70b-instruct',
    'mistralai/mixtral-8x7b-instruct'
  ];

  let lastError: any = null;

  for (const model of modelsToTry) {
    try {
      let chatResponse = await openrouter.chat.completions.create({
        model,
        messages,
        tools: tools ?? TOOLS,
        tool_choice: 'auto',
        max_tokens: 400,
        temperature: 0.75,
      });

      let assistantMessage = chatResponse.choices[0].message;

      while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        const toolCallMessages: {
          role: 'system' | 'user' | 'assistant' | 'tool';
          content: string;
          tool_call_id?: string;
          tool_calls?: typeof assistantMessage.tool_calls;
        }[] = [
          ...messages,
          { role: 'assistant', content: '', tool_calls: assistantMessage.tool_calls },
        ];

        for (const toolCall of assistantMessage.tool_calls) {
          if (toolCall.type !== 'function') continue;
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments || '{}');
          const result = executeToolCall(toolName, toolArgs);
          toolResults.push({ toolName, result });
          toolCallMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
        }

        const followUp = await openrouter.chat.completions.create({
          model,
          messages: toolCallMessages as Parameters<typeof openrouter.chat.completions.create>[0]['messages'],
          max_tokens: 400,
          temperature: 0.75,
        });

        assistantMessage = followUp.choices[0].message;
      }

      return {
        text: assistantMessage.content || '',
        toolResults: toolResults.length > 0 ? toolResults : undefined,
      };

    } catch (err: any) {
      console.warn(`[OpenRouter] Lỗi với model ${model}: ${err.message}. Đang thử model tiếp theo...`);
      lastError = err;
      continue; // Hết lượt hoặc lỗi -> thử model tiếp theo
    }
  }

  throw lastError || new Error('Tất cả các model trên OpenRouter đều bị lỗi hoặc hết Quota.');
}
