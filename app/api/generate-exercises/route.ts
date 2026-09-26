// ============================================================
// app/api/generate-exercises/route.ts — Tạo bài tập từ từ vựng
// Dùng Gemini (ưu tiên) hoặc OpenAI GPT-4o (fallback)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { chatWithAI } from '@/lib/ai';
import type { VocabEntry, ExerciseSet, ExerciseQuestion, SupportedLanguage, LanguageLevel } from '@/lib/types';

export const maxDuration = 60;

interface GenerateExercisesRequest {
  vocab: VocabEntry[];
  language: SupportedLanguage;
  topic?: string;
  level?: LanguageLevel;
  exerciseCount?: number;
  apiKey?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: GenerateExercisesRequest = await request.json();
    const { vocab, language, exerciseCount = 10 } = body;

    const clientApiKey = request.headers.get('x-api-key') || body.apiKey || undefined;

    if (!vocab || vocab.length === 0) {
      return NextResponse.json({ error: 'Không có dữ liệu từ vựng.' }, { status: 400 });
    }

    const selectedVocab = vocab.length > 20
      ? [...vocab].sort(() => Math.random() - 0.5).slice(0, 20)
      : vocab;

    const langName = language === 'zh' ? 'tiếng Trung' : language === 'ja' ? 'tiếng Nhật' : 'tiếng Anh';

    const vocabList = selectedVocab
      .map((v) => `- ${v.word} (${v.pronunciation}) = ${v.meaning}`)
      .join('\n');

    const prompt = `Bạn là giáo viên ${langName} tạo bài tập cho người Việt Nam.

DANH SÁCH TỪ VỰNG:
${vocabList}

Tạo đúng ${Math.min(exerciseCount, selectedVocab.length * 2)} bài tập dùng các từ trên.
Kết hợp: trắc nghiệm (multiple-choice), điền từ (fill-blank), dịch thuật (translation).

Trả về JSON (không markdown, không text thừa):
{
  "title": "Tiêu đề bộ bài tập bằng tiếng Việt",
  "questions": [
    {
      "id": "q1",
      "type": "multiple-choice",
      "question": "Câu hỏi",
      "options": ["A", "B", "C", "D"],
      "correctAnswer": "A",
      "explanation": "Giải thích bằng tiếng Việt"
    },
    {
      "id": "q2",
      "type": "fill-blank",
      "question": "Câu có ___ là chỗ trống",
      "correctAnswer": "từ cần điền",
      "explanation": "Giải thích bằng tiếng Việt"
    },
    {
      "id": "q3",
      "type": "translation",
      "question": "Dịch sang ${langName}: 'câu tiếng Việt'",
      "correctAnswer": "bản dịch đúng",
      "explanation": "Giải thích bằng tiếng Việt"
    }
  ]
}

QUY TẮC:
- Multiple choice: đúng 4 options, 1 đáp án đúng.
- Fill-blank: ___ là từ ngôn ngữ đích.
- Translation: dịch TỪ tiếng Việt SANG ngôn ngữ đích.
- Explanation PHẢI bằng tiếng Việt và có phiên âm.
- Chỉ trả về JSON hợp lệ.`;

    const chatResult = await chatWithAI({
      language,
      level: body.level || 'beginner',
      topic: body.topic || 'vocab',
      history: [],
      userMessage: prompt,
      clientApiKey,
    });

    // Extract JSON (xử lý trường hợp Gemini trả về với markdown wrapper)
    const rawContent = chatResult.text;
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('AI không trả về JSON hợp lệ');
    }
    const parsed = JSON.parse(jsonMatch[0]);

    const exerciseSet: ExerciseSet = {
      title: parsed.title || `Bài tập ${langName}`,
      language,
      topic: body.topic || 'vocab',
      level: body.level || 'beginner',
      questions: (parsed.questions || []).map((q: Record<string, unknown>, i: number): ExerciseQuestion => ({
        id: (q.id as string) || `q${i + 1}`,
        type: q.type as ExerciseQuestion['type'],
        question: q.question as string,
        options: q.options as string[] | undefined,
        correctAnswer: q.correctAnswer as string,
        explanation: q.explanation as string,
      })),
      generatedAt: Date.now(),
    };

    return NextResponse.json(exerciseSet);
  } catch (error) {
    console.error('[generate-exercises] Error:', error);
    const message = error instanceof Error ? error.message : 'Lỗi không xác định';
    return NextResponse.json({ error: `Không thể tạo bài tập: ${message}` }, { status: 500 });
  }
}
