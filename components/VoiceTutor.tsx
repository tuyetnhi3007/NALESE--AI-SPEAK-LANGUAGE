'use client';
// ============================================================
// components/VoiceTutor.tsx — Gia sư AI bằng giọng nói
//
// Pipeline hoàn toàn miễn phí:
//   STT: Web Speech API (browser, miễn phí, realtime transcript)
//   LLM: Gemini 2.0 Flash (miễn phí) → OpenAI GPT-4o (fallback)
//   TTS: browser speechSynthesis (Web Speech API, hoàn toàn miễn phí, client-side)
//
// Silence detection: theo dõi lastSpeechTime qua setInterval
// → không dùng onspeechend (không đáng tin cậy trên mọi browser)
// ============================================================

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Volume2, RotateCcw, Sparkles, Square } from 'lucide-react';
import AICharacterPanel from './AICharacterPanel';
import ChatHistoryStack from './ChatHistoryStack';
import { useSettings } from './SettingsContext';
import { generateId, blobToBase64, getBestAudioMimeType } from '@/lib/audio-utils';
import type { SupportedLanguage, ConversationMessage, VoiceChatRequest, VoiceChatResponse, SyllableAssessment } from '@/lib/types';
import { parseAIResponse } from '@/app/api/voice-chat/route';

type TutorState = 'idle' | 'listening' | 'waiting' | 'thinking' | 'speaking';

interface VoiceTutorProps {
  language: SupportedLanguage;
  topic?: string;
  onLanguageChange?: (lang: SupportedLanguage) => void;
}

// ─── Hằng số ────────────────────────────────────────────────
const SILENCE_MS = 3000;      // 3s im lặng → tự gửi
const WAITING_SHOW_MS = 1200; // 1.2s → hiện trạng thái "Đang chờ..."

const SPEECH_LANG: Record<SupportedLanguage, string> = {
  en: 'en-US',
  zh: 'zh-CN',
  ja: 'ja-JP',
};

const STATE_LABELS: Record<TutorState, string> = {
  idle: 'Sẵn sàng',
  listening: '🎤 Đang lắng nghe...',
  waiting: '⏳ Đang chờ bạn nói tiếp...',
  thinking: '🤖 Đang xử lý...',
  speaking: '🔊 AI đang trả lời...',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSpeechRecognition(): any | null {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
  return SR ? new SR() : null;
}

// Phát audio từ base64 mp3
function playBase64Audio(base64: string, speed: number = 1.0): HTMLAudioElement {
  const audio = new Audio(`data:audio/mp3;base64,${base64}`);
  audio.playbackRate = speed;
  audio.play().catch(console.error);
  return audio;
}

const STORAGE_KEY = 'nalese_conversation_v1';

export function cleanOriginalString(raw: string): string {
  if (!raw) return '';
  const str = raw.trim();

  // 1. Thử parse JSON hoàn chỉnh nếu có
  if (str.startsWith('{') && str.endsWith('}')) {
    try {
      const parsed = JSON.parse(str);
      if (parsed && parsed.original) return String(parsed.original).trim();
    } catch {}
  }

  // 2. Trích xuất "original" kể cả khi JSON bị dở dang/thiếu dấu ngoặc kép hoặc ngoặc nhọn
  const match = str.match(/"original"\s*:\s*"((?:[^"\\]|\\.)*)"?/i) || str.match(/"original"\s*:\s*"([^"]*)/i);
  if (match && match[1]) {
    return match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
  }

  // 3. Loại bỏ các tiền tố JSON sót lại như {"original": " và hậu tố provider như (Gemini)
  let cleaned = str
    .replace(/^\s*\{\s*"original"\s*:\s*"?/i, '')
    .replace(/^\s*\{?\s*/, '')
    .replace(/\s*\}?\s*$/, '')
    .replace(/^"(?:original|response|text)"\s*:\s*"?/i, '')
    .replace(/"?\s*$/, '')
    .replace(/\s*\((?:Gemini|Azure|OpenAI)\)\s*$/i, '')
    .trim();

  return cleaned;
}

function getScoreBadgeStyle(score: number): string {
  if (score >= 90) return 'border-emerald-400/50 bg-emerald-500/15 text-emerald-400';
  if (score >= 70) return 'border-amber-400/50 bg-amber-500/15 text-amber-400';
  return 'border-red-400/50 bg-red-500/15 text-red-400';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sanitizeMessage(m: any): ConversationMessage {
  const rawOriginal = String(m.original || m.text || '');
  let romanization = m.romanization || m.pinyin || '';
  let pinyin = m.pinyin || m.romanization || '';
  let translation = m.translation || '';
  let audioBase64 = m.audioBase64;
  const pronunciationResult = m.pronunciationResult;
  const pronunciationScore = typeof m.pronunciationScore === 'number'
    ? m.pronunciationScore
    : (pronunciationResult?.overallScore ?? null);

  // Trích xuất romanization, pinyin và translation nếu chuỗi chứa JSON
  if (rawOriginal.includes('"romanization"') || rawOriginal.includes('"pinyin"')) {
    const romMatch = rawOriginal.match(/"(?:romanization|pinyin)"\s*:\s*"((?:[^"\\]|\\.)*)"?/i);
    if (romMatch && romMatch[1]) {
      const extracted = romMatch[1].replace(/\\"/g, '"').trim();
      romanization = extracted;
      pinyin = extracted;
    }
  }
  if (rawOriginal.includes('"translation"')) {
    const transMatch = rawOriginal.match(/"translation"\s*:\s*"((?:[^"\\]|\\.)*)"?/i);
    if (transMatch && transMatch[1]) translation = transMatch[1].replace(/\\"/g, '"').trim();
  }

  const original = cleanOriginalString(rawOriginal);

  // Nếu câu cũ từng bị dính chuỗi JSON, hủy audioBase64 cũ để TTS browser đọc câu original sạch
  if (rawOriginal.includes('"original"') || rawOriginal.startsWith('{')) {
    audioBase64 = undefined;
  }

  return {
    id: m.id || generateId(),
    role: m.role || 'assistant',
    original,
    romanization,
    pinyin,
    translation,
    text: original,
    audioBase64,
    pronunciationResult,
    pronunciationScore,
    timestamp: m.timestamp || Date.now(),
    toolResults: m.toolResults,
  };
}

export default function VoiceTutor({ language, topic, onLanguageChange }: VoiceTutorProps) {
  const { settings } = useSettings();

  // ─── State ────────────────────────────────────────────────
  const [tutorState, setTutorState] = useState<TutorState>('idle');
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [error, setError] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [silenceCountdown, setSilenceCountdown] = useState<number | null>(null);
  const [isSpeechSupported, setIsSpeechSupported] = useState(true);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

  // ─── Refs (truy cập được từ mọi closure mà không stale) ──
  const sessionActiveRef = useRef(false);
  const isProcessingRef = useRef(false);
  const accumulatedFinalRef = useRef('');
  const interimTranscriptRef = useRef('');
  const lastSpeechTimeRef = useRef(0); // timestamp của lần nói cuối
  const recognitionRef = useRef<ReturnType<typeof getSpeechRecognition>>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const conversationRef = useRef<ConversationMessage[]>([]);
  const settingsRef = useRef(settings);
  const languageRef = useRef(language);
  const prevLanguageRef = useRef(language);
  const topicRef = useRef(topic);
  const conversationEndRef = useRef<HTMLDivElement>(null);
  const startListeningRef = useRef<() => void>(() => {});

  // Đồng bộ refs với props/state
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { languageRef.current = language; }, [language]);
  useEffect(() => { topicRef.current = topic; }, [topic]);
  useEffect(() => { conversationRef.current = conversation; }, [conversation]);

  // Load conversation từ localStorage và tự động migrate dữ liệu cũ
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const sanitized = parsed.map(sanitizeMessage);
          setConversation(sanitized);
        }
      }
    } catch (e) {
      console.warn('Lỗi đọc conversation từ localStorage:', e);
    }
  }, []);

  // Lưu conversation vào localStorage mỗi khi thay đổi
  useEffect(() => {
    try {
      if (conversation.length > 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(conversation));
      }
    } catch (e) {
      console.warn('Lỗi lưu conversation vào localStorage:', e);
    }
  }, [conversation]);

  // ─── Kiểm tra hỗ trợ trình duyệt & nạp voice SpeechSynthesis ───
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    setIsSpeechSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));

    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
      };
      window.speechSynthesis.getVoices();
    }
  }, []);

  // ─── Auto-scroll ─────────────────────────────────────────
  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation]);

  // ─── Browser SpeechSynthesis (TTS duy nhất của ứng dụng) ───
  const speakWithBrowser = useCallback((text: string, onEnd: () => void) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      onEnd();
      return;
    }

    // 1. Luôn dừng mọi âm thanh đang phát trước khi nói để tránh chồng âm
    window.speechSynthesis.cancel();

    // 2. CHỈ đọc câu original sạch (không Pinyin, không Tiếng Việt, không JSON)
    const cleanText = cleanOriginalString(text);
    if (!cleanText.trim()) {
      onEnd();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(cleanText);
    const targetLang = SPEECH_LANG[languageRef.current] || 'zh-CN';
    utterance.lang = targetLang;
    utterance.rate = Math.max(0.5, Math.min(2.0, settingsRef.current.speed));

    // 3. Ưu tiên tìm voice browser phù hợp (zh-CN, hoặc bắt đầu bằng zh)
    if (window.speechSynthesis.getVoices) {
      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length > 0) {
        const normalizedTarget = targetLang.toLowerCase().replace('_', '-');
        let selectedVoice = voices.find(v => v.lang.toLowerCase().replace('_', '-') === normalizedTarget);

        if (!selectedVoice && normalizedTarget.startsWith('zh')) {
          selectedVoice = voices.find(v => v.lang.toLowerCase().startsWith('zh'));
        }

        if (!selectedVoice) {
          const prefix = normalizedTarget.split('-')[0];
          selectedVoice = voices.find(v => v.lang.toLowerCase().startsWith(prefix));
        }

        if (selectedVoice) {
          utterance.voice = selectedVoice;
        }
      }
    }

    utterance.onend = onEnd;
    utterance.onerror = (e) => {
      console.warn('[BrowserTTS] Phát âm hoàn tất hoặc bị ngắt:', e);
      onEnd();
    };

    window.speechSynthesis.speak(utterance);
  }, []);

  // ─── Dừng âm thanh đang phát ─────────────────────────────
  const stopAudio = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, []);

  // ─── Thu âm audio thực tế phục vụ Pronunciation Assessment ──
  const startRecordingAudio = useCallback(async () => {
    try {
      if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;

      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop(); } catch {}
      }

      if (!mediaStreamRef.current || !mediaStreamRef.current.active) {
        mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
        setMediaStream(mediaStreamRef.current);
      }
      if (window.MediaRecorder && mediaStreamRef.current) {
        audioChunksRef.current = [];
        const mimeType = getBestAudioMimeType();
        const recorder = new MediaRecorder(mediaStreamRef.current, { mimeType });
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            audioChunksRef.current.push(e.data);
          }
        };
        recorder.start(100);
        mediaRecorderRef.current = recorder;
      }
    } catch (err) {
      console.warn('[Pronunciation] Lỗi khởi tạo MediaRecorder:', err);
    }
  }, []);

  const stopAndGetAudioBase64 = useCallback(async (): Promise<string | undefined> => {
    try {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => resolve(), 300);
          recorder.addEventListener('stop', () => {
            clearTimeout(timer);
            resolve();
          }, { once: true });
          try {
            recorder.stop();
          } catch {
            clearTimeout(timer);
            resolve();
          }
        });
      }
      // Nhường event loop 40ms để ondataavailable hoàn tất đẩy chunk cuối cùng vào mảng
      await new Promise((r) => setTimeout(r, 40));

      if (audioChunksRef.current.length > 0) {
        const mimeType = getBestAudioMimeType();
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        audioChunksRef.current = [];
        if (blob.size > 200) {
          return await blobToBase64(blob);
        }
      }
    } catch (err) {
      console.warn('[Pronunciation] Lỗi trích xuất audio base64:', err);
    }
    return undefined;
  }, []);

  // ─── Đánh giá phát âm song song ngầm không làm chậm AI response ─
  const runPronunciationAssessment = useCallback(async (audioBase64: string, referenceText: string, userMsgId: string) => {
    if (!audioBase64 || !referenceText.trim()) return;
    console.log('[PERF] pronunciation_start', Date.now());

    try {
      const resp = await fetch('/api/voice-chat/pronounce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64,
          referenceText,
          language: languageRef.current,
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        console.log('[PERF] pronunciation_end', Date.now(), data.latencyMs ? `duration: ${data.latencyMs}ms` : '');

        if (data.pronunciationResult || typeof data.pronunciationScore === 'number' || data.userRomanization || data.userPinyin) {
          setConversation((prev) =>
            prev.map((msg) =>
              msg.id === userMsgId
                ? {
                    ...msg,
                    pronunciationResult: data.pronunciationResult,
                    pronunciationScore: typeof data.pronunciationScore === 'number' ? data.pronunciationScore : (data.pronunciationResult?.overallScore ?? null),
                    romanization: data.userRomanization || data.userPinyin || msg.romanization,
                  }
                : msg
            )
          );
        }
      }
    } catch (err) {
      console.warn('[Pronunciation] background assessment error:', err);
    }
  }, []);

  // ─── Gửi transcript & audio đến AI (Streaming + Low Latency) ───
  const sendToAI = useCallback(async (text: string, existingUserMsgId?: string, fallbackAudioBase64?: string) => {
    lastSpeechTimeRef.current = 0;
    setInterimTranscript('');
    setFinalTranscript('');
    setSilenceCountdown(null);
    setTutorState('thinking');
    setError('');
    accumulatedFinalRef.current = '';
    interimTranscriptRef.current = '';

    const startTime = Date.now();
    console.log('[PERF] api_request_start', startTime);

    const history = conversationRef.current.slice(-8).map((m) => ({
      role: m.role,
      content: m.original || m.text || '',
    }));

    const afterSpeak = () => {
      setTutorState('idle');
      isProcessingRef.current = false;
      if (sessionActiveRef.current) {
        setTimeout(() => {
          if (sessionActiveRef.current && !isProcessingRef.current) {
            startListeningRef.current?.();
          }
        }, 600);
      }
    };

    try {
      const body: VoiceChatRequest = {
        text: text || undefined,
        audioBase64: fallbackAudioBase64,
        language: languageRef.current,
        level: settingsRef.current.level,
        topic: topicRef.current,
        history,
        voice: settingsRef.current.voice,
        speed: settingsRef.current.speed,
        skipPronunciation: !fallbackAudioBase64,
        stream: true,
      };

      const resp = await fetch('/api/voice-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(body),
      });

      const contentType = resp.headers.get('content-type') || '';

      if (contentType.includes('text/event-stream') && resp.body) {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let assistantMsgId = '';
        let currentUserMsgId = existingUserMsgId;
        let accumulatedRaw = '';
        let assistantOriginal = '';
        let assistantRomanization = '';
        let assistantTranslation = '';
        let ttsFired = false;
        let firstTokenLogged = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const dataStr = trimmed.replace(/^data:\s*/, '');
            if (!dataStr) continue;

            try {
              const evt = JSON.parse(dataStr);
              if (evt.type === 'init' && evt.userTranscript && !currentUserMsgId) {
                currentUserMsgId = generateId();
                setConversation((prev) => [
                  ...prev,
                  {
                    id: currentUserMsgId!,
                    role: 'user',
                    original: evt.userTranscript,
                    text: evt.userTranscript,
                    pinyin: '',
                    romanization: '',
                    translation: '',
                    pronunciationScore: null,
                    timestamp: Date.now(),
                  },
                ]);
              } else if (evt.type === 'token') {
                if (!firstTokenLogged) {
                  console.log('[PERF] llm_first_token', Date.now(), `ttft: ${Date.now() - startTime}ms`);
                  firstTokenLogged = true;
                  setTutorState('speaking');
                }
                accumulatedRaw += evt.chunk;

                const parsed = parseAIResponse(accumulatedRaw);
                const currentOriginal = cleanOriginalString(parsed.original);

                if (!assistantMsgId) {
                  assistantMsgId = generateId();
                  setConversation((prev) => [
                    ...prev,
                    {
                      id: assistantMsgId,
                      role: 'assistant',
                      original: currentOriginal,
                      text: currentOriginal,
                      romanization: '',
                      pinyin: '',
                      translation: '',
                      timestamp: Date.now(),
                    },
                  ]);
                } else if (currentOriginal) {
                  assistantOriginal = currentOriginal;
                  setConversation((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsgId
                        ? { ...m, original: assistantOriginal, text: assistantOriginal }
                        : m
                    )
                  );
                }
              } else if (evt.type === 'done') {
                console.log('[PERF] response_render', Date.now(), `total: ${Date.now() - startTime}ms`);
                assistantOriginal = cleanOriginalString(evt.assistantOriginal || assistantOriginal);
                assistantRomanization = evt.assistantRomanization || evt.assistantPinyin || '';
                assistantTranslation = evt.assistantTranslation || '';

                const userPinyin = evt.userPinyin || evt.userRomanization || '';
                const userTranslation = evt.userTranslation || '';

                // Cập nhật điểm phát âm, Pinyin & Bản dịch cho user message
                if (currentUserMsgId) {
                  setConversation((prev) =>
                    prev.map((m) =>
                      m.id === currentUserMsgId
                        ? {
                            ...m,
                            pinyin: userPinyin || m.pinyin || m.romanization || '',
                            romanization: userPinyin || m.romanization || m.pinyin || '',
                            translation: userTranslation || m.translation || '',
                            pronunciationResult: evt.pronunciationResult || m.pronunciationResult,
                            pronunciationScore: typeof evt.pronunciationScore === 'number'
                              ? evt.pronunciationScore
                              : (evt.pronunciationResult?.overallScore ?? m.pronunciationScore),
                          }
                        : m
                    )
                  );
                }

                if (!assistantMsgId) {
                  assistantMsgId = generateId();
                  setConversation((prev) => [
                    ...prev,
                    {
                      id: assistantMsgId,
                      role: 'assistant',
                      original: assistantOriginal,
                      text: assistantOriginal,
                      romanization: assistantRomanization,
                      pinyin: assistantRomanization,
                      translation: assistantTranslation,
                      timestamp: Date.now(),
                    },
                  ]);
                } else {
                  setConversation((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsgId
                        ? {
                            ...m,
                            original: assistantOriginal,
                            text: assistantOriginal,
                            romanization: assistantRomanization,
                            pinyin: assistantRomanization,
                            translation: assistantTranslation,
                          }
                        : m
                    )
                  );
                }

                if (!ttsFired && assistantOriginal) {
                  ttsFired = true;
                  speakWithBrowser(assistantOriginal, afterSpeak);
                }
              } else if (evt.type === 'error') {
                setError(evt.error || 'Lỗi xử lý AI.');
              }
            } catch {}
          }
        }

        if (!ttsFired && assistantOriginal) {
          ttsFired = true;
          speakWithBrowser(assistantOriginal, afterSpeak);
        } else if (!assistantOriginal && !ttsFired) {
          setTutorState('idle');
          isProcessingRef.current = false;
        }

      } else {
        const data: VoiceChatResponse = await resp.json();
        console.log('[PERF] response_render', Date.now(), `total: ${Date.now() - startTime}ms`);

        if (data.error) {
          setError(data.error);
          setTutorState('idle');
          isProcessingRef.current = false;
          return;
        }

        const userPinyin = data.userPinyin || data.userRomanization || '';
        const userTranslation = data.userTranslation || '';

        if (existingUserMsgId) {
          setConversation((prev) =>
            prev.map((m) =>
              m.id === existingUserMsgId
                ? {
                    ...m,
                    pinyin: userPinyin || m.pinyin || m.romanization || '',
                    romanization: userPinyin || m.romanization || m.pinyin || '',
                    translation: userTranslation || m.translation || '',
                    pronunciationResult: data.pronunciationResult || m.pronunciationResult,
                    pronunciationScore: typeof data.pronunciationScore === 'number'
                      ? data.pronunciationScore
                      : (data.pronunciationResult?.overallScore ?? m.pronunciationScore),
                  }
                : m
            )
          );
        } else if (data.userTranscript) {
          setConversation((prev) => [
            ...prev,
            {
              id: generateId(),
              role: 'user',
              original: data.userTranscript,
              text: data.userTranscript,
              pinyin: userPinyin,
              romanization: userPinyin,
              translation: userTranslation,
              pronunciationResult: data.pronunciationResult,
              pronunciationScore: typeof data.pronunciationScore === 'number'
                ? data.pronunciationScore
                : (data.pronunciationResult?.overallScore ?? null),
              timestamp: Date.now(),
            },
          ]);
        }

        const assistantOriginal = cleanOriginalString(data.assistantOriginal || data.assistantText || '');
        if (assistantOriginal) {
          const assistantPinyin = data.assistantRomanization || '';
          setConversation((prev) => [
            ...prev,
            {
              id: generateId(),
              role: 'assistant',
              original: assistantOriginal,
              text: assistantOriginal,
              romanization: assistantPinyin,
              pinyin: assistantPinyin,
              translation: data.assistantTranslation || '',
              audioBase64: data.audioBase64 || undefined,
              timestamp: Date.now(),
              toolResults: data.toolResults,
            },
          ]);

          setTutorState('speaking');
          speakWithBrowser(assistantOriginal, afterSpeak);
        } else {
          setTutorState('idle');
          isProcessingRef.current = false;
        }
      }
    } catch (err) {
      console.error('sendToAI error:', err);
      setError('Lỗi kết nối. Vui lòng kiểm tra kết nối mạng.');
      setTutorState('idle');
      isProcessingRef.current = false;
    }
  }, [speakWithBrowser]);

  // Ref để silence interval có thể gọi sendToAI mà không stale
  const sendToAIRef = useRef(sendToAI);
  useEffect(() => { sendToAIRef.current = sendToAI; }, [sendToAI]);

  // ─── Kích hoạt gửi nhanh & song song ─────────────────────
  const triggerSend = useCallback(async () => {
    if (isProcessingRef.current) return;
    const text = (accumulatedFinalRef.current.trim() || interimTranscriptRef.current.trim());
    if (!text && !mediaRecorderRef.current) return;

    console.log('[PERF] recording_end', Date.now());
    lastSpeechTimeRef.current = 0;
    setSilenceCountdown(null);
    isProcessingRef.current = true;

    try { recognitionRef.current?.abort(); } catch {}

    // Lấy audio base64 một cách an toàn (chỉ mất ~20-30ms)
    const audioBase64 = await stopAndGetAudioBase64();

    if (text) {
      // 1. User message được đưa ngay vào UI
      const userMsgId = generateId();
      setConversation((prev) => [
        ...prev,
        {
          id: userMsgId,
          role: 'user',
          original: text,
          text,
          pinyin: '',
          romanization: '',
          translation: '',
          pronunciationScore: null,
          timestamp: Date.now(),
        },
      ]);
      console.log('[PERF] response_render', Date.now(), '(user message added)');

      // 2. Gửi request LLM kèm audioBase64 để server xử lý song song chat và phát âm
      sendToAIRef.current(text, userMsgId, audioBase64);
    } else if (audioBase64) {
      // Fallback khi không có Web Speech API: Dùng Whisper STT
      sendToAIRef.current('', undefined, audioBase64);
    } else {
      isProcessingRef.current = false;
      setTutorState('idle');
    }
  }, [stopAndGetAudioBase64]);

  const triggerSendRef = useRef(triggerSend);
  useEffect(() => { triggerSendRef.current = triggerSend; }, [triggerSend]);

  // ─── Khởi động một chu kỳ lắng nghe ─────────────────────
  const startListening = useCallback(() => {
    if (!sessionActiveRef.current || isProcessingRef.current) return;

    // Dừng recognition cũ nếu có
    try { recognitionRef.current?.abort(); } catch {}

    accumulatedFinalRef.current = '';
    interimTranscriptRef.current = '';
    lastSpeechTimeRef.current = 0;
    setInterimTranscript('');
    setFinalTranscript('');
    setSilenceCountdown(null);
    setTutorState('listening');
    setError('');

    // Bắt đầu thu âm audio thực tế để phục vụ Pronunciation Assessment
    startRecordingAudio();

    const recognition = getSpeechRecognition();
    if (!recognition) return;

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = SPEECH_LANG[languageRef.current] || 'en-US';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (e: any) => {
      if (!sessionActiveRef.current) return;
      lastSpeechTimeRef.current = Date.now();

      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          accumulatedFinalRef.current += r[0].transcript;
          setFinalTranscript(accumulatedFinalRef.current);
        } else {
          interim += r[0].transcript;
        }
      }
      interimTranscriptRef.current = interim;
      setInterimTranscript(interim);
      setTutorState('listening');
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (e: any) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setError('Trình duyệt không cho phép truy cập microphone. Kiểm tra quyền và thử lại.');
        sessionActiveRef.current = false;
        setTutorState('idle');
      }
      // Các lỗi khác (no-speech, aborted) → bỏ qua, để onend restart
    };

    recognition.onend = () => {
      // Tự động restart nếu session còn active và chưa gửi
      if (sessionActiveRef.current && !isProcessingRef.current) {
        setTimeout(() => {
          if (sessionActiveRef.current && !isProcessingRef.current) {
            try { recognition.start(); } catch {}
          }
        }, 100);
      }
    };

    recognitionRef.current = recognition;
    try { recognition.start(); } catch (e) { console.warn('Recognition start error:', e); }
  }, [startRecordingAudio]);

  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  // Tự động khởi động lại lắng nghe với ngôn ngữ mới CHỈ KHI người dùng thực sự đổi ngôn ngữ
  useEffect(() => {
    if (prevLanguageRef.current !== language) {
      prevLanguageRef.current = language;
      languageRef.current = language;
      if (sessionActiveRef.current && (tutorState === 'listening' || tutorState === 'waiting')) {
        try { recognitionRef.current?.abort(); } catch {}
        startListening();
      }
    }
  }, [language, startListening, tutorState]);

  // ─── Silence detection qua setInterval ───────────────────
  // Chạy khi đang listening/waiting. Kiểm tra mỗi 300ms.
  useEffect(() => {
    if (tutorState !== 'listening' && tutorState !== 'waiting') return;

    const interval = setInterval(() => {
      if (isProcessingRef.current || !sessionActiveRef.current) return;
      if (!lastSpeechTimeRef.current) return; // chưa nói gì

      const silenceMs = Date.now() - lastSpeechTimeRef.current;
      const text = (accumulatedFinalRef.current.trim() || interimTranscriptRef.current.trim());

      if (text && silenceMs >= SILENCE_MS) {
        // Đủ 3s im lặng → kích hoạt gửi nhanh song song
        triggerSendRef.current();
      } else if (text && silenceMs >= WAITING_SHOW_MS) {
        // Đủ 1.2s → hiển thị "Đang chờ..."
        const remaining = Math.max(0, (SILENCE_MS - silenceMs) / 1000);
        setTutorState('waiting');
        setSilenceCountdown(parseFloat(remaining.toFixed(1)));
      }
    }, 300);

    return () => clearInterval(interval);
  }, [tutorState, stopAndGetAudioBase64]);

  // ─── Bắt đầu toàn session ────────────────────────────────
  const startSession = useCallback(async () => {
    setError('');
    sessionActiveRef.current = true;
    try {
      if (!mediaStreamRef.current || !mediaStreamRef.current.active) {
        mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
        setMediaStream(mediaStreamRef.current);
      }
    } catch (e) {
      console.warn('getUserMedia error on session start:', e);
    }
    startListening();
  }, [startListening]);

  // ─── Dừng toàn session ───────────────────────────────────
  const stopSession = useCallback(() => {
    sessionActiveRef.current = false;
    isProcessingRef.current = false;
    lastSpeechTimeRef.current = 0;

    try { recognitionRef.current?.abort(); } catch {}
    recognitionRef.current = null;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    mediaRecorderRef.current = null;

    if (mediaStreamRef.current) {
      try {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      } catch {}
      mediaStreamRef.current = null;
      setMediaStream(null);
    }
    audioChunksRef.current = [];

    stopAudio();
    accumulatedFinalRef.current = '';
    interimTranscriptRef.current = '';
    setInterimTranscript('');
    setFinalTranscript('');
    setSilenceCountdown(null);
    setTutorState('idle');
  }, [stopAudio]);

  // Cleanup khi unmount
  useEffect(() => {
    return () => {
      sessionActiveRef.current = false;
      try { recognitionRef.current?.abort(); } catch {}
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop(); } catch {}
      }
      if (mediaStreamRef.current) {
        try {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        } catch {}
      }
      stopAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Replay audio — TUYỆT ĐỐI CHỈ ĐỌC msg.original ─────────
  const replayAudio = useCallback((msg: ConversationMessage) => {
    stopAudio();
    const textToSpeak = cleanOriginalString(msg.original || msg.text || '');
    if (!textToSpeak.trim()) return;

    // Browser SpeechSynthesis là TTS duy nhất khi replay — TUYỆT ĐỐI CHỈ ĐỌC textToSpeak
    speakWithBrowser(textToSpeak, () => {});
  }, [stopAudio, speakWithBrowser]);

  const clearConversation = useCallback(() => {
    stopAudio();
    setConversation([]);
    setError('');
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, [stopAudio]);

  // ─── Nút chính ───────────────────────────────────────────
  const handleMainButton = useCallback(() => {
    if (tutorState === 'idle') {
      startSession();
    } else if (tutorState === 'speaking') {
      stopAudio();
      setTutorState('idle');
      isProcessingRef.current = false;
    } else if (tutorState === 'thinking') {
      stopSession();
    } else if (tutorState === 'listening' || tutorState === 'waiting') {
      const text = (accumulatedFinalRef.current.trim() || interimTranscriptRef.current.trim());
      if (text) {
        triggerSend();
      } else {
        stopSession();
      }
    }
  }, [tutorState, startSession, stopAudio, stopSession, triggerSend]);

  // ─── Render ───────────────────────────────────────────────
  return (
    <>
      {/* Khu vực nhân vật AI + nút ghi âm */}
      <AICharacterPanel
        tutorState={tutorState}
        isSpeechSupported={isSpeechSupported}
        silenceCountdown={silenceCountdown}
        finalTranscript={finalTranscript}
        interimTranscript={interimTranscript}
        error={error}
        onMainButtonClick={handleMainButton}
        mediaStream={mediaStream}
      />

      {/* Lịch sử hội thoại — đặt ở sidebar bởi page.tsx */}
      <ChatHistoryStack
        conversation={conversation}
        onClearConversation={clearConversation}
        onReplayAudio={replayAudio}
      />
    </>
  );
}
