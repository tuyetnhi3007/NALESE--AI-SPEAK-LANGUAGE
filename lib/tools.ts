// ============================================================
// lib/tools.ts — OpenAI Function Calling tool definitions
// These allow GPT-4o to fetch real-time data during conversation.
// ============================================================

import type OpenAI from 'openai';

// --- Tool Definitions (passed to OpenAI API) ---

export const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_current_time_and_date',
      description:
        'Returns the current date and time, optionally for a specific timezone or city. ' +
        'Use this when the user asks about the time, date, or current day.',
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description:
              'IANA timezone string (e.g., "Asia/Tokyo", "America/New_York", "Asia/Ho_Chi_Minh"). ' +
              'Default is UTC.',
          },
          city: {
            type: 'string',
            description: 'City name in English, used for user-friendly display (e.g., "Tokyo", "London").',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_cultural_fact',
      description:
        'Returns interesting cultural facts, etiquette tips, or historical background about a ' +
        'country or region relevant to the language being learned. Useful for enriching language ' +
        'learning with cultural context.',
      parameters: {
        type: 'object',
        properties: {
          country: {
            type: 'string',
            description: 'Country or region name in English (e.g., "Japan", "China", "United Kingdom").',
          },
          category: {
            type: 'string',
            enum: ['etiquette', 'food', 'holidays', 'business', 'history', 'general'],
            description: 'Category of cultural information to retrieve.',
          },
        },
        required: ['country'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_word',
      description:
        'Provides detailed breakdown of a word or phrase in the target language: pronunciation, ' +
        'meaning, part of speech, example sentences, and any relevant notes. ' +
        'Use when a user asks about a specific word or wants it explained.',
      parameters: {
        type: 'object',
        properties: {
          word: {
            type: 'string',
            description: 'The word or phrase to look up.',
          },
          language: {
            type: 'string',
            enum: ['en', 'zh', 'ja'],
            description: 'Language code of the word.',
          },
        },
        required: ['word', 'language'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_grammar_tip',
      description:
        'Provides a clear, concise grammar explanation for a specific grammatical pattern or rule ' +
        'in the target language. Use when a user makes a grammar mistake or asks about grammar.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description:
              'The grammar pattern or rule (e.g., "て-form in Japanese", "了 particle in Chinese", ' +
              '"present perfect vs simple past in English").',
          },
          language: {
            type: 'string',
            enum: ['en', 'zh', 'ja'],
          },
          example: {
            type: 'string',
            description: "An example sentence demonstrating the pattern (optional).",
          },
        },
        required: ['pattern', 'language'],
      },
    },
  },
];

// --- Tool Execution (server-side implementations) ---

export interface ToolCallResult {
  toolName: string;
  result: string;
}

/**
 * Executes a tool call from GPT-4o's function calling mechanism.
 * All tools are deterministic (no external API calls needed - GPT-4o itself
 * provides the factual data when executing these pseudo-tools).
 * The only "real" tool is time/date which uses the server's clock.
 */
export function executeToolCall(name: string, args: Record<string, string>): string {
  switch (name) {
    case 'get_current_time_and_date': {
      const timezone = args.timezone || 'UTC';
      const city = args.city || timezone;
      try {
        const now = new Date();
        const formatted = now.toLocaleString('en-US', {
          timeZone: timezone,
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        });
        return JSON.stringify({
          city,
          timezone,
          currentDateTime: formatted,
          utcIso: now.toISOString(),
          dayOfWeek: now.toLocaleDateString('en-US', { timeZone: timezone, weekday: 'long' }),
        });
      } catch {
        return JSON.stringify({ error: `Invalid timezone: ${timezone}` });
      }
    }

    case 'get_cultural_fact':
      // GPT-4o will generate the cultural facts — return a prompt scaffold
      return JSON.stringify({
        country: args.country,
        category: args.category || 'general',
        instruction:
          'Generate an accurate, engaging cultural fact or tip about this country in the specified category. ' +
          'Keep it brief (2-3 sentences) and directly relevant to language learners.',
      });

    case 'lookup_word':
      return JSON.stringify({
        word: args.word,
        language: args.language,
        instruction:
          'Provide: pronunciation (IPA or romanization), meaning, part of speech, ' +
          '2 natural example sentences with translations, and any important usage notes.',
      });

    case 'get_grammar_tip':
      return JSON.stringify({
        pattern: args.pattern,
        language: args.language,
        example: args.example || null,
        instruction:
          'Explain this grammar pattern clearly and concisely. ' +
          'Provide the rule, 2 examples, and common mistakes to avoid.',
      });

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
