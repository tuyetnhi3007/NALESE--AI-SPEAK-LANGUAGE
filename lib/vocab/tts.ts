// lib/vocab/tts.ts
// Phát âm chuẩn theo Web Speech API cho từ vựng Flashcard

import type { SupportedLanguage } from '@/lib/types';

/**
 * Trích xuất từ gốc để đọc: nếu term chứa nhiều dạng ngăn bởi '｜' hoặc '|'
 * thì chỉ lấy dạng đầu tiên.
 */
export function getSpokenTerm(term: string): string {
  if (!term) return '';
  const firstPart = term.split(/[｜|]/)[0];
  return firstPart.trim();
}

/**
 * Chuyển đổi mã ngôn ngữ sang locale TTS
 */
export function getTTSLocale(lang: SupportedLanguage): string {
  switch (lang) {
    case 'zh':
      return 'zh-CN';
    case 'ja':
      return 'ja-JP';
    case 'en':
    default:
      return 'en-US';
  }
}

/**
 * Phát âm từ vựng bằng Web Speech API
 */
export function speakVocabTerm(
  term: string,
  lang: SupportedLanguage,
  speed = 1.0,
  callbacks?: {
    onStart?: () => void;
    onEnd?: () => void;
    onError?: (err?: any) => void;
  }
): () => void {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    callbacks?.onError?.('Trình duyệt không hỗ trợ SpeechSynthesis');
    return () => {};
  }

  const cleanText = getSpokenTerm(term);
  if (!cleanText) return () => {};

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(cleanText);
  const targetLang = getTTSLocale(lang);
  utterance.lang = targetLang;
  utterance.rate = Math.max(0.5, Math.min(2.0, speed || 1.0));

  if (window.speechSynthesis.getVoices) {
    const voices = window.speechSynthesis.getVoices();
    const normalizedTarget = targetLang.toLowerCase().replace('_', '-');
    let voice = voices.find(
      (v) => v.lang.toLowerCase().replace('_', '-') === normalizedTarget
    );
    if (!voice && normalizedTarget.startsWith('zh')) {
      voice = voices.find((v) => v.lang.toLowerCase().startsWith('zh'));
    }
    if (voice) {
      utterance.voice = voice;
    }
  }

  utterance.onstart = () => {
    callbacks?.onStart?.();
  };

  utterance.onend = () => {
    callbacks?.onEnd?.();
  };

  utterance.onerror = (e) => {
    callbacks?.onError?.(e);
  };

  window.speechSynthesis.speak(utterance);

  return () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      callbacks?.onEnd?.();
    }
  };
}
