// ============================================================
// lib/prompts.ts — System prompts for EN, CN (zh), JP (ja)
// Injected into GPT-4o as the first system message on each request.
// ============================================================

import type { SupportedLanguage, LanguageLevel, VocabEntry } from './types';

interface PromptOptions {
  language: SupportedLanguage;
  level: LanguageLevel;
  topic?: string;
  vocabContext?: VocabEntry[];
}

// --- Base tutor persona shared across all languages ---
const BASE_PERSONA = `Bạn là Luna — gia sư ngoại ngữ AI của NALESE.
Bạn giao tiếp bằng ngôn ngữ người học đang luyện tập, kèm nghĩa tiếng Việt khi cần.

QUY TẮC PHẢN HỒI:
1. Trả lời NGẮN GỌN (1-3 câu), tự nhiên như hội thoại thực tế, kết thúc bằng một câu hỏi mở hoặc gợi mở tiếp theo.
2. Sửa lỗi nhẹ nhàng nếu học viên nói sai.
3. Luôn trả về DUY NHẤT một chuỗi JSON hợp lệ theo đúng cấu trúc yêu cầu. KHÔNG kèm bất kỳ văn bản nào ngoài JSON. KHÔNG dùng markdown.`;

// --- Level-specific instruction additions ---
const LEVEL_INSTRUCTIONS: Record<LanguageLevel, string> = {
  beginner: `TRÌNH ĐỘ SƠ CẤP: Dùng từ vựng đơn giản, câu ngắn, rõ ràng.`,
  intermediate: `TRÌNH ĐỘ TRUNG CẤP: Kết hợp câu phức hơn, diễn đạt tự nhiên.`,
  advanced: `TRÌNH ĐỘ NÂNG CAO: Dùng từ vựng tự nhiên, thành ngữ, thảo luận sâu.`,
};

// --- Language-specific instructions ---
const LANGUAGE_INSTRUCTIONS: Record<SupportedLanguage, string> = {
  en: `TARGET: ENGLISH
Định dạng JSON bắt buộc:
{
  "original": "Câu trả lời bằng tiếng Anh (1-3 câu)",
  "romanization": "Phiên âm IPA (/.../)",
  "translation": "Dịch nghĩa tiếng Việt"
}`,

  zh: `TARGET: MANDARIN CHINESE (普通话)
Định dạng JSON bắt buộc:
{
  "original": "Câu trả lời bằng chữ Hán giản thể (1-3 câu)",
  "romanization": "Pinyin có dấu thanh điệu (ví dụ: Nǐ hǎo)",
  "translation": "Dịch nghĩa tiếng Việt",
  "userRomanization": "Pinyin có dấu thanh điệu của câu người dùng vừa nói (ví dụ: Nǐ hǎo)"
}`,

  ja: `TARGET: JAPANESE (日本語)
Định dạng JSON bắt buộc:
{
  "original": "Câu trả lời bằng tiếng Nhật tự nhiên (Kanji/Kana, 1-3 câu)",
  "romanization": "Romaji viết bằng chữ cái Latin (ví dụ: Konnichiwa). TUYỆT ĐỐI KHÔNG dùng Hiragana/Katakana ở đây.",
  "translation": "Dịch nghĩa tiếng Việt",
  "userRomanization": "Romaji chữ Latin của câu người dùng vừa nói"
}`,
};

// --- Topic-specific roleplay prompts ---
const TOPIC_PROMPTS: Record<string, string> = {
  travel: `CHỦ ĐỀ: Du lịch & Sân bay (hỏi đường, khách sạn, vé máy bay).`,
  daily_life: `CHỦ ĐỀ: Cuộc sống hàng ngày (thói quen, mua sắm, thời tiết).`,
  work: `CHỦ ĐỀ: Công việc & Kinh doanh (phỏng vấn, họp hành, đối tác).`,
  food: `CHỦ ĐỀ: Ẩm thực & Nhà hàng (gọi món, hương vị, món ăn).`,
  health: `CHỦ ĐỀ: Sức khỏe & Bệnh viện (triệu chứng, bác sĩ, thuốc).`,
  technology: `CHỦ ĐỀ: Công nghệ & Đời sống số (ứng dụng, AI, thiết bị).`,
  education: `CHỦ ĐỀ: Giáo dục & Học tập (trường học, kỳ thi, du học).`,
  custom: `CHỦ ĐỀ: Hội thoại tự do theo sở thích người học.`,
};

/**
 * Builds the complete system prompt for a conversation session.
 */
export function buildSystemPrompt(options: PromptOptions): string {
  const { language, level, topic, vocabContext } = options;

  let prompt = `${BASE_PERSONA}\n${LEVEL_INSTRUCTIONS[level]}\n${LANGUAGE_INSTRUCTIONS[language]}`;

  if (topic && TOPIC_PROMPTS[topic]) {
    prompt += `\n${TOPIC_PROMPTS[topic]}`;
  }

  if (vocabContext && vocabContext.length > 0) {
    const vocabList = vocabContext
      .slice(0, 25)
      .map((v) => `${v.word} (${v.pronunciation}) = ${v.meaning}`)
      .join('; ');
    prompt += `\nTừ vựng cần lồng ghép tự nhiên: ${vocabList}`;
  }

  return prompt;
}

// Export topic info — tên tiếng Việt
export const TOPICS = [
  { id: 'travel', name: 'Du lịch & Sân bay', icon: '✈️', description: 'Sân bay, khách sạn và địa điểm du lịch' },
  { id: 'daily_life', name: 'Cuộc sống hàng ngày', icon: '🏠', description: 'Thói quen, mua sắm và giao tiếp xóm giềng' },
  { id: 'work', name: 'Công việc & Kinh doanh', icon: '💼', description: 'Phỏng vấn, họp hành và giao tiếp chuyên nghiệp' },
  { id: 'food', name: 'Ẩm thực & Nhà hàng', icon: '🍜', description: 'Gọi món, bàn về công thức và văn hóa ẩm thực' },
  { id: 'health', name: 'Sức khỏe & Bệnh viện', icon: '🏥', description: 'Khám bệnh, nhà thuốc và tình trạng sức khỏe' },
  { id: 'technology', name: 'Công nghệ', icon: '💻', description: 'Công nghệ, mạng xã hội và cuộc sống số' },
  { id: 'education', name: 'Giáo dục & Học tập', icon: '📚', description: 'Học tập, trường học và thảo luận học thuật' },
  { id: 'custom', name: 'Hội thoại tự do', icon: '💬', description: 'Trò chuyện tự nhiên về bất kỳ chủ đề nào' },
];

export const LANGUAGES = [
  { code: 'en' as SupportedLanguage, name: 'Tiếng Anh', flag: 'ENG', nativeName: 'English' },
  { code: 'zh' as SupportedLanguage, name: 'Tiếng Trung', flag: '🇨🇳', nativeName: '中文' },
  { code: 'ja' as SupportedLanguage, name: 'Tiếng Nhật', flag: '🇯🇵', nativeName: '日本語' },
];
