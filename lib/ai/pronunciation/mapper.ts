// ============================================================
// lib/ai/pronunciation/mapper.ts
// Thuật toán ánh xạ và tổng hợp tất định Phoneme ↔ Pinyin Syllables ↔ Hán tự
// ============================================================

import type { PhonemeAssessment, SyllableAssessment } from '@/lib/types';

/**
 * Danh sách Thanh mẫu (Initials) trong tiếng Trung Mandarin zh-CN
 */
const MANDARIN_INITIALS = [
  'b', 'p', 'm', 'f',
  'd', 't', 'n', 'l',
  'g', 'k', 'h',
  'j', 'q', 'x',
  'zh', 'ch', 'sh', 'r',
  'z', 'c', 's',
  'y', 'w'
];

/**
 * Phân tích âm tiết Pinyin thành Thanh mẫu (Initial), Vận mẫu (Final), và Thanh điệu (Tone: 1-5)
 */
export function decomposePinyin(pinyinWithTone: string): {
  initial: string;
  final: string;
  tone: number;
} {
  const p = pinyinWithTone.trim().toLowerCase();
  if (!p) return { initial: '', final: '', tone: 5 };

  // Nhận diện thanh điệu qua ký tự có dấu
  let tone = 5; // thanh nhẹ mặc định
  let normalized = p;

  const toneMap: Record<string, { char: string; tone: number }> = {
    'ā': { char: 'a', tone: 1 }, 'á': { char: 'a', tone: 2 }, 'ǎ': { char: 'a', tone: 3 }, 'à': { char: 'a', tone: 4 },
    'ō': { char: 'o', tone: 1 }, 'ó': { char: 'o', tone: 2 }, 'ǒ': { char: 'o', tone: 3 }, 'ò': { char: 'o', tone: 4 },
    'ē': { char: 'e', tone: 1 }, 'é': { char: 'e', tone: 2 }, 'ě': { char: 'e', tone: 3 }, 'è': { char: 'e', tone: 4 },
    'ī': { char: 'i', tone: 1 }, 'í': { char: 'i', tone: 2 }, 'ǐ': { char: 'i', tone: 3 }, 'ì': { char: 'i', tone: 4 },
    'ū': { char: 'u', tone: 1 }, 'ú': { char: 'u', tone: 2 }, 'ǔ': { char: 'u', tone: 3 }, 'ù': { char: 'u', tone: 4 },
    'ǖ': { char: 'v', tone: 1 }, 'ǘ': { char: 'v', tone: 2 }, 'ǚ': { char: 'v', tone: 3 }, 'ǜ': { char: 'v', tone: 4 },
  };

  for (const [accent, val] of Object.entries(toneMap)) {
    if (normalized.includes(accent)) {
      tone = val.tone;
      normalized = normalized.replace(new RegExp(accent, 'g'), val.char);
      break;
    }
  }

  // Tách Thanh mẫu (Initial)
  let initial = '';
  // Ưu tiên khớp 2 ký tự (zh, ch, sh) trước
  for (const init of MANDARIN_INITIALS) {
    if (normalized.startsWith(init)) {
      if (init.length > initial.length) {
        initial = init;
      }
    }
  }

  const final = normalized.slice(initial.length);

  return { initial, final, tone };
}

/**
 * Tổng hợp tất định điểm và loại lỗi cấp âm tiết từ danh sách phonemes
 *
 * Áp dụng trọng số ngữ âm học Hán ngữ:
 * - Vận mẫu (Final): 0.50 (mang trọng tải âm thanh và thanh điệu chính)
 * - Thanh mẫu (Initial): 0.30
 * - Thanh điệu (Tone): 0.20
 * (Nếu không có thanh mẫu: Vận mẫu 0.70, Thanh điệu 0.30)
 */
export function aggregateSyllableAssessment(
  character: string,
  pinyin: string,
  phonemes: PhonemeAssessment[],
  providerSegmentScore?: number
): SyllableAssessment {
  // Nếu provider (như Azure) đã có sẵn điểm phân đoạn cho chữ/từ tương ứng
  if (typeof providerSegmentScore === 'number' && providerSegmentScore >= 0) {
    const hasOmission = phonemes.some(p => p.errorType === 'Omission');
    const hasMispron = phonemes.some(p => p.errorType === 'Mispronunciation');
    const hasToneError = phonemes.some(p => p.errorType === 'ToneError');

    let derivedError: SyllableAssessment['errorType'] = 'None';
    if (hasOmission) derivedError = 'Omission';
    else if (hasMispron) derivedError = 'Mispronunciation';
    else if (hasToneError) derivedError = 'ToneError';
    else if (providerSegmentScore < 70) derivedError = 'Mispronunciation';

    return {
      character,
      pinyin,
      accuracyScore: Math.round(providerSegmentScore),
      errorType: derivedError,
      phonemes,
    };
  }

  // Nếu không có phoneme nào được ghi nhận
  if (!phonemes || phonemes.length === 0) {
    return {
      character,
      pinyin,
      accuracyScore: 0,
      errorType: 'Omission',
      phonemes: [],
      note: 'Không thu được tín hiệu âm thanh cho âm tiết này',
    };
  }

  // Phân tích thành phần âm tiết
  const decomp = decomposePinyin(pinyin);
  const hasInitial = Boolean(decomp.initial);

  let initialScore: number | null = null;
  let finalScore: number | null = null;
  let toneScore: number | null = null;
  const otherScores: number[] = [];

  let hasOmission = false;
  let hasMispron = false;
  let hasToneError = false;

  for (const p of phonemes) {
    if (p.errorType === 'Omission') hasOmission = true;
    if (p.errorType === 'Mispronunciation') hasMispron = true;
    if (p.errorType === 'ToneError') hasToneError = true;

    const pName = p.phoneme.toLowerCase();
    if (pName.includes('tone') || /^[1-5]$/.test(pName)) {
      toneScore = p.accuracyScore;
    } else if (hasInitial && pName === decomp.initial.toLowerCase()) {
      initialScore = p.accuracyScore;
    } else if (decomp.final && (pName.includes(decomp.final) || decomp.final.includes(pName))) {
      finalScore = p.accuracyScore;
    } else {
      otherScores.push(p.accuracyScore);
    }
  }

  // Thuật toán trọng số tất định
  let accuracyScore = 0;

  if (hasInitial) {
    const init = initialScore ?? (otherScores.length > 0 ? otherScores[0] : 70);
    const fin = finalScore ?? (otherScores.length > 1 ? otherScores[1] : (otherScores[0] ?? 70));
    const t = toneScore ?? 70;
    accuracyScore = 0.30 * init + 0.50 * fin + 0.20 * t;
  } else {
    const fin = finalScore ?? (otherScores.length > 0 ? otherScores[0] : 70);
    const t = toneScore ?? 70;
    accuracyScore = 0.70 * fin + 0.30 * t;
  }

  // Dẫn xuất ErrorType cấp âm tiết
  let errorType: SyllableAssessment['errorType'] = 'None';
  if (hasOmission) {
    errorType = 'Omission';
  } else if (hasMispron) {
    errorType = 'Mispronunciation';
  } else if (hasToneError) {
    errorType = 'ToneError';
  } else if (accuracyScore < 70) {
    errorType = 'Mispronunciation';
  }

  return {
    character,
    pinyin,
    accuracyScore: Math.max(0, Math.min(100, Math.round(accuracyScore))),
    errorType,
    phonemes,
  };
}
