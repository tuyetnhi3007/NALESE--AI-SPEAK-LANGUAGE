// ============================================================
// app/api/topic-exercises/route.ts — Tạo bài tập theo chủ đề
// Dùng Gemini (ưu tiên) hoặc OpenAI GPT-4o (fallback)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { chatWithAI } from '@/lib/ai';
import type { TopicExerciseRequest, ExerciseSet, ExerciseQuestion, SupportedLanguage, LanguageLevel } from '@/lib/types';

export const maxDuration = 60;

const LANG_NAMES: Record<SupportedLanguage, string> = {
  en: 'tiếng Anh',
  zh: 'tiếng Trung (Phổ thông)',
  ja: 'tiếng Nhật',
};

const LEVEL_NAMES: Record<LanguageLevel, string> = {
  beginner: 'sơ cấp (A1-A2)',
  intermediate: 'trung cấp (B1-B2)',
  advanced: 'nâng cao (C1-C2)',
};

const TOPIC_NAMES: Record<string, string> = {
  travel: 'Du lịch & Sân bay',
  daily_life: 'Cuộc sống hàng ngày',
  work: 'Công việc & Kinh doanh',
  food: 'Ẩm thực & Nhà hàng',
  health: 'Sức khỏe & Bệnh viện',
  technology: 'Công nghệ & Kỹ thuật số',
  education: 'Giáo dục & Học tập',
  shopping: 'Mua sắm',
  custom: 'Giao tiếp tự do',
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: TopicExerciseRequest = await request.json();
    const { language, topic, level } = body;

    const clientApiKey = request.headers.get('x-api-key') || body.apiKey || undefined;

    const langName = LANG_NAMES[language] || language;
    const levelName = LEVEL_NAMES[level] || level;
    const topicName = TOPIC_NAMES[topic] || topic;

    const langSpecific = language === 'zh'
      ? 'Luôn kèm phiên âm Pinyin (ví dụ: 你好 - nǐ hǎo).'
      : language === 'ja'
      ? 'Luôn kèm phiên âm Romaji (ví dụ: ありがとう - arigatou).'
      : 'Sử dụng từ vựng và ngữ pháp phù hợp với người Việt học tiếng Anh.';

    const prompt = `Bạn là giáo viên ${langName} chuyên nghiệp dạy cho người Việt Nam.
Hãy tạo một bộ bài tập học ${langName} về chủ đề "${topicName}" dành cho trình độ ${levelName}.

${langSpecific}

Tạo đúng 8 bài tập, kết hợp các dạng sau:
- vocabulary: Học từ vựng mới với nghĩa tiếng Việt
- multiple-choice: Trắc nghiệm 4 lựa chọn
- fill-blank: Điền vào chỗ trống
- translation: Dịch từ tiếng Việt sang ngôn ngữ đích
- sentence-ordering: Sắp xếp từ thành câu hoàn chỉnh
- listening: Câu để AI đọc, người học nghe và hiểu
- speaking: Tình huống để người học nói
- error-correction: Sửa lỗi sai trong câu

Trả về JSON object CHÍNH XÁC (không markdown, không text thừa):
{
  "title": "Tiêu đề bài tập bằng tiếng Việt",
  "questions": [
    {
      "id": "q1",
      "type": "vocabulary",
      "question": "Học các từ vựng sau:",
      "correctAnswer": "Danh sách từ với phiên âm và nghĩa tiếng Việt",
      "explanation": "Gợi ý cách ghi nhớ (tiếng Việt)"
    },
    {
      "id": "q2",
      "type": "multiple-choice",
      "question": "Câu hỏi",
      "options": ["A", "B", "C", "D"],
      "correctAnswer": "A",
      "explanation": "Giải thích (tiếng Việt)"
    },
    {
      "id": "q3",
      "type": "fill-blank",
      "question": "Câu có ___ là chỗ trống",
      "correctAnswer": "từ cần điền",
      "explanation": "Giải thích (tiếng Việt)"
    },
    {
      "id": "q4",
      "type": "translation",
      "question": "Dịch sang ${langName}: 'câu tiếng Việt'",
      "correctAnswer": "bản dịch đúng",
      "explanation": "Giải thích ngữ pháp (tiếng Việt)"
    },
    {
      "id": "q5",
      "type": "sentence-ordering",
      "question": "Sắp xếp các từ thành câu hoàn chỉnh:",
      "words": ["từ1", "từ2", "từ3", "từ4"],
      "correctAnswer": "câu đúng thứ tự",
      "explanation": "Giải thích trật tự từ (tiếng Việt)"
    },
    {
      "id": "q6",
      "type": "listening",
      "question": "Nghe câu sau và chọn nghĩa đúng:",
      "audioText": "câu bằng ngôn ngữ đích để AI đọc",
      "options": ["Nghĩa A", "Nghĩa B", "Nghĩa C", "Nghĩa D"],
      "correctAnswer": "Nghĩa A",
      "explanation": "Giải thích (tiếng Việt)"
    },
    {
      "id": "q7",
      "type": "speaking",
      "question": "Tình huống: mô tả tình huống bằng tiếng Việt. Hãy nói bằng ${langName}.",
      "audioText": "câu gợi ý để AI đọc hướng dẫn",
      "correctAnswer": "ví dụ câu trả lời tốt",
      "explanation": "Gợi ý từ vựng (tiếng Việt)"
    },
    {
      "id": "q8",
      "type": "error-correction",
      "question": "Tìm và sửa lỗi: 'câu có lỗi'",
      "correctAnswer": "câu đúng",
      "explanation": "Lỗi là gì và tại sao sai (tiếng Việt)"
    }
  ]
}

QUY TẮC: Mọi explanation bằng tiếng Việt. Nội dung bài tập bằng ngôn ngữ đích. Multiple choice có đúng 4 options.`;

    // Dùng provider orchestrator: Gemini → OpenAI
    const chatResult = await chatWithAI({
      language,
      level,
      topic,
      history: [],
      userMessage: prompt,
      clientApiKey,
    });

    const rawContent = chatResult.text;
    // Parse JSON — xử lý trường hợp Gemini trả về với markdown wrapper
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('AI không trả về JSON hợp lệ');
    }
    const parsed = JSON.parse(jsonMatch[0]);

    const exerciseSet: ExerciseSet = {
      title: parsed.title || `Bài tập ${langName} — ${topicName}`,
      language,
      topic,
      level,
      questions: (parsed.questions || []).map((q: Record<string, unknown>, i: number): ExerciseQuestion => ({
        id: (q.id as string) || `q${i + 1}`,
        type: q.type as ExerciseQuestion['type'],
        question: q.question as string,
        options: q.options as string[] | undefined,
        words: q.words as string[] | undefined,
        correctAnswer: q.correctAnswer as string,
        explanation: q.explanation as string,
        audioText: q.audioText as string | undefined,
      })),
      generatedAt: Date.now(),
    };

    return NextResponse.json(exerciseSet);
  } catch (error) {
    console.error('[topic-exercises] Error:', error);
    const message = error instanceof Error ? error.message : 'Lỗi không xác định';
    return NextResponse.json({ error: `Không thể tạo bài tập: ${message}` }, { status: 500 });
  }
}
