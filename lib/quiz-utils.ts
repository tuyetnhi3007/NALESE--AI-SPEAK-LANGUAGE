// ============================================================
// lib/quiz-utils.ts — Chuẩn hóa dữ liệu bài tập và so sánh đáp án
// Hỗ trợ trắc nghiệm (A/B/C/D) và điền từ / dịch thuật (tách phiên âm, IME)
// ============================================================

export interface NormalizedOption {
  id: string; // "A" | "B" | "C" | "D"
  text: string;
}

export interface NormalizedExerciseQuestion {
  id: string;
  type: 'multiple-choice' | 'fill-blank' | 'translation' | 'listening' | 'speaking' | 'sentence-ordering' | 'vocabulary' | string;
  question: string;
  options?: NormalizedOption[];
  correctId?: string; // "A" | "B" | "C" | "D" cho trắc nghiệm
  correctAnswer: string; // Chuỗi hiển thị đầy đủ
  answer?: string; // Chữ đích thuần (không kèm phiên âm trong ngoặc)
  reading?: string; // Phiên âm (Pinyin/Romaji)
  acceptedAnswers?: string[]; // Danh sách các cách viết / đồng nghĩa được chấp nhận
  explanation: string;
  audioText?: string;
  words?: string[];
}

export interface NormalizedExerciseSet {
  title: string;
  language: string;
  topic?: string;
  level?: string;
  questions: NormalizedExerciseQuestion[];
  generatedAt?: number;
}

/**
 * Tách phần phiên âm trong ngoặc ở cuối đáp án (dạng "xxx (yyy)" hoặc "xxx（yyy）")
 * Chỉ lấy phần ngoặc cuối chuỗi làm phiên âm.
 */
export function splitAnswerAndReading(rawAns: string): { answer: string; reading?: string } {
  if (!rawAns) return { answer: '' };
  const trimmed = rawAns.trim();
  // Regex tìm ngoặc đơn nửa góc () hoặc toàn góc （） ở cuối chuỗi
  const match = trimmed.match(/^(.*?)\s*[(（]([^)）]+)[)）]\s*$/);
  if (match) {
    const mainAns = match[1].trim();
    const reading = match[2].trim();
    if (mainAns.length > 0) {
      return { answer: mainAns, reading };
    }
  }
  return { answer: trimmed };
}

/**
 * Chuẩn hóa chuỗi dùng chung theo đầy đủ 5 quy tắc:
 * 1. text.normalize("NFKC") (đổi dấu câu/chữ toàn góc sang bán góc)
 * 2. Bỏ dấu câu ở đầu/cuối (. , ! ? 。，！？、 ~ … và dấu ngoặc kép)
 * 3. toLowerCase() cho chữ Latin
 * 4. Gộp khoảng trắng liên tiếp thành 1; bỏ hẳn khoảng trắng với tiếng Trung (zh) và Nhật (ja)
 * 5. Bỏ dấu thanh khi so sánh nếu stripDiacritics = true (normalize("NFD") rồi bỏ \u0300-\u036f)
 */
export function normalizeAnswer(text: string, lang?: string, stripDiacritics: boolean = true): string {
  if (!text) return '';

  // 1. NFKC
  let res = text.normalize('NFKC');

  // 2. Bỏ dấu câu và ngoặc kép ở đầu và cuối chuỗi
  res = res.replace(/^[.,!?。，！？、~…"'"“”‘’`\s]+|[.,!?。，！？、~…"'"“”‘’`\s]+$/g, '');

  // 3. toLowerCase()
  res = res.toLowerCase();

  // 4. Xử lý khoảng trắng theo ngôn ngữ
  if (lang === 'zh' || lang === 'ja') {
    res = res.replace(/\s+/g, '');
  } else {
    res = res.trim().replace(/\s+/g, ' ');
  }

  // 5. Bỏ dấu thanh đối với ký tự Latin (cho phép gõ không dấu)
  if (stripDiacritics) {
    res = res.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');
  }

  return res;
}

/**
 * Kiểm tra xem đáp án có yêu cầu chữ Hán / Kanji không
 */
export function isHanziOrKanjiRequired(answerText: string, lang?: string): boolean {
  if (lang !== 'zh' && lang !== 'ja') return false;
  // CJK Unified Ideographs
  return /[\u4E00-\u9FFF]/.test(answerText);
}

/**
 * Kiểm tra xem người dùng có đang nhập phiên âm (Pinyin/Romaji) thay vì chữ Hán không
 */
export function checkPinyinOrRomajiInput(userInput: string, reading?: string): boolean {
  if (!reading || !userInput) return false;
  const normUser = normalizeAnswer(userInput, 'en', true);
  const normReading = normalizeAnswer(reading, 'en', true);
  return normUser === normReading || (normUser.length > 2 && normReading.includes(normUser));
}

/**
 * Chấm điểm câu hỏi điền từ / dịch thuật
 */
export function isFillCorrect(
  userInput: string,
  question: NormalizedExerciseQuestion,
  lang: string
): { isCorrect: boolean; isPinyinWarning?: boolean } {
  const cleanInput = (userInput || '').trim();
  if (!cleanInput) return { isCorrect: false };

  // Chuẩn bị danh sách ứng viên từ phía người dùng (gồm cả bản bỏ ngoặc nếu người dùng gõ kèm phiên âm)
  const userSplit = splitAnswerAndReading(cleanInput);
  const userCandidates = [cleanInput];
  if (userSplit.answer && userSplit.answer !== cleanInput) {
    userCandidates.push(userSplit.answer);
  }

  // Chuẩn bị danh sách đáp án đúng được chấp nhận
  const targetCandidates: string[] = [];
  if (question.answer) targetCandidates.push(question.answer);
  if (question.correctAnswer) targetCandidates.push(question.correctAnswer);
  if (question.acceptedAnswers && Array.isArray(question.acceptedAnswers)) {
    targetCandidates.push(...question.acceptedAnswers);
  }

  // Thêm bản đã tách phiên âm của correctAnswer nếu chưa có
  const correctSplit = splitAnswerAndReading(question.correctAnswer);
  if (correctSplit.answer && !targetCandidates.includes(correctSplit.answer)) {
    targetCandidates.push(correctSplit.answer);
  }

  // So sánh từng cặp candidate
  for (const u of userCandidates) {
    const normU = normalizeAnswer(u, lang, true);
    for (const t of targetCandidates) {
      const normT = normalizeAnswer(t, lang, true);
      if (normU === normT) {
        return { isCorrect: true };
      }
    }
  }

  // Kiểm tra trường hợp người dùng nhập Pinyin/Romaji khi đề yêu cầu chữ Hán
  const mainTarget = question.answer || correctSplit.answer;
  if (
    question.reading &&
    isHanziOrKanjiRequired(mainTarget, lang)
  ) {
    // Nếu người dùng chỉ gõ ký tự Latin
    const isLatinOnly = /^[a-zA-Z\s\u0300-\u036f.,!?]+$/.test(cleanInput);
    if (isLatinOnly && checkPinyinOrRomajiInput(cleanInput, question.reading)) {
      return { isCorrect: false, isPinyinWarning: true };
    }
  }

  return { isCorrect: false };
}

/**
 * Chuẩn hóa chuỗi văn bản cơ bản
 */
export function normalizeText(str: string): string {
  if (!str) return '';
  return str
    .trim()
    .toLowerCase()
    .normalize('NFC')
    .replace(/\s+/g, ' ');
}

/**
 * Tách nội dung giải thích thành từng dòng rõ ràng (không dồn 1 dòng dài)
 */
export function formatExplanationLines(explanation: string): string[] {
  if (!explanation) return [];
  const lines = explanation
    .split(/\r?\n|(?<=[.!?])\s+(?=[A-Z\u00C0-\u1EF9\u4E00-\u9FFF\u3040-\u30FF])/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return lines.length > 0 ? lines : [explanation.trim()];
}

/**
 * Chuẩn hóa một câu hỏi từ dữ liệu thô của AI
 */
export function normalizeExerciseQuestion(
  rawQ: any,
  index: number = 0,
  shuffleOptions: boolean = false
): NormalizedExerciseQuestion {
  const id = String(rawQ.id || `q${index + 1}`);
  const type = String(rawQ.type || 'multiple-choice');
  const question = String(rawQ.question || '').trim();
  const rawExplanation = String(rawQ.explanation || '').trim();
  const rawCorrect = String(rawQ.correctAnswer || rawQ.answer || '').trim();

  // ── XỬ LÝ CÂU ĐIỀN TỪ / DỊCH THUẬT / CÂU KHÔNG CÓ OPTIONS ──
  if (
    type !== 'multiple-choice' &&
    type !== 'listening' &&
    (!rawQ.options || !Array.isArray(rawQ.options) || rawQ.options.length === 0)
  ) {
    // Tự tách phần phiên âm trong ngoặc
    const split = splitAnswerAndReading(rawCorrect);
    const finalAnswer = (rawQ.answer ? String(rawQ.answer).trim() : '') || split.answer;
    const finalReading = (rawQ.reading ? String(rawQ.reading).trim() : '') || split.reading;

    const accepted: string[] = [];
    if (finalAnswer) accepted.push(finalAnswer);
    if (Array.isArray(rawQ.acceptedAnswers)) {
      for (const a of rawQ.acceptedAnswers) {
        const item = String(a).trim();
        if (item && !accepted.includes(item)) accepted.push(item);
      }
    }

    // Định dạng chuỗi hiển thị correctAnswer
    const displayCorrect = finalReading && !finalAnswer.includes(finalReading)
      ? `${finalAnswer} (${finalReading})`
      : finalAnswer || rawCorrect;

    return {
      id,
      type,
      question,
      correctAnswer: displayCorrect,
      answer: finalAnswer,
      reading: finalReading,
      acceptedAnswers: accepted,
      explanation: rawExplanation,
      audioText: rawQ.audioText,
      words: rawQ.words,
    };
  }

  // ── XỬ LÝ CÂU TRẮC NGHIỆM (GIỮ NGUYÊN 100% LOGIC ĐÃ HOÀN THIỆN) ──
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  const extractedItems: { originalLetter?: string; text: string }[] = (rawQ.options || []).map(
    (opt: any, i: number) => {
      let rawStr = '';
      if (typeof opt === 'object' && opt !== null) {
        rawStr = String(opt.text || opt.value || opt.label || JSON.stringify(opt)).trim();
      } else {
        rawStr = String(opt).trim();
      }

      const prefixMatch = rawStr.match(/^([A-Fa-f])[.):\-\s]+(.*)$/);
      if (prefixMatch) {
        return {
          originalLetter: prefixMatch[1].toUpperCase(),
          text: prefixMatch[2].trim(),
        };
      }
      return {
        originalLetter: letters[i],
        text: rawStr,
      };
    }
  );

  const normCorrect = normalizeText(rawCorrect);
  let correctItemIndex = -1;

  if (/^[A-Fa-f]$/.test(rawCorrect)) {
    const targetLetter = rawCorrect.toUpperCase();
    correctItemIndex = extractedItems.findIndex(
      (item, idx) => item.originalLetter === targetLetter || letters[idx] === targetLetter
    );
  }

  if (correctItemIndex === -1) {
    const prefixMatch = rawCorrect.match(/^([A-Fa-f])[.):\-\s]/);
    if (prefixMatch) {
      const targetLetter = prefixMatch[1].toUpperCase();
      correctItemIndex = extractedItems.findIndex(
        (item, idx) => item.originalLetter === targetLetter || letters[idx] === targetLetter
      );
    }
  }

  if (correctItemIndex === -1 && /^\d+$/.test(rawCorrect)) {
    const idx = parseInt(rawCorrect, 10);
    if (idx >= 0 && idx < extractedItems.length) {
      correctItemIndex = idx;
    }
  }

  if (correctItemIndex === -1) {
    correctItemIndex = extractedItems.findIndex(
      (item) => normalizeText(item.text) === normCorrect
    );
  }

  if (correctItemIndex === -1) {
    correctItemIndex = extractedItems.findIndex((item) => {
      const nItem = normalizeText(item.text);
      return nItem.includes(normCorrect) || normCorrect.includes(nItem);
    });
  }

  if (correctItemIndex === -1 && extractedItems.length > 0) {
    correctItemIndex = 0;
  }

  const targetCorrectText =
    correctItemIndex >= 0 && correctItemIndex < extractedItems.length
      ? extractedItems[correctItemIndex].text
      : rawCorrect;

  let workingItems = [...extractedItems];
  if (shuffleOptions) {
    workingItems = workingItems.sort(() => Math.random() - 0.5);
  }

  const finalOptions: NormalizedOption[] = workingItems.map((item, idx) => ({
    id: letters[idx] || `${idx + 1}`,
    text: item.text,
  }));

  let finalCorrectId = 'A';
  const foundOpt = finalOptions.find(
    (o) => normalizeText(o.text) === normalizeText(targetCorrectText)
  );
  if (foundOpt) {
    finalCorrectId = foundOpt.id;
  } else {
    const fuzzyOpt = finalOptions.find((o) => {
      const n1 = normalizeText(o.text);
      const n2 = normalizeText(targetCorrectText);
      return n1.includes(n2) || n2.includes(n1);
    });
    if (fuzzyOpt) finalCorrectId = fuzzyOpt.id;
  }

  const finalCorrectText =
    finalOptions.find((o) => o.id === finalCorrectId)?.text || targetCorrectText;

  return {
    id,
    type,
    question,
    options: finalOptions,
    correctId: finalCorrectId,
    correctAnswer: finalCorrectText,
    explanation: rawExplanation,
    audioText: rawQ.audioText,
    words: rawQ.words,
  };
}

/**
 * Chuẩn hóa toàn bộ bộ bài tập
 */
export function normalizeExerciseSet(
  rawSet: any,
  shuffleOptions: boolean = false
): NormalizedExerciseSet {
  const rawQuestions = Array.isArray(rawSet?.questions) ? rawSet.questions : [];
  const normalizedQuestions = rawQuestions.map((q: any, i: number) =>
    normalizeExerciseQuestion(q, i, shuffleOptions)
  );

  return {
    title: rawSet?.title || 'Bài tập rèn luyện',
    language: rawSet?.language || 'zh',
    topic: rawSet?.topic,
    level: rawSet?.level,
    questions: normalizedQuestions,
    generatedAt: rawSet?.generatedAt || Date.now(),
  };
}
