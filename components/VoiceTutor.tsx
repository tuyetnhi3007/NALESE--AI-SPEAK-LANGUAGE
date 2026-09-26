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
import { useSettings } from './SettingsContext';
import { generateId, blobToBase64, getBestAudioMimeType } from '@/lib/audio-utils';
import type { SupportedLanguage, ConversationMessage, VoiceChatRequest, VoiceChatResponse, SyllableAssessment } from '@/lib/types';

type TutorState = 'idle' | 'listening' | 'waiting' | 'thinking' | 'speaking';

interface VoiceTutorProps {
  language: SupportedLanguage;
  topic?: string;
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
  let romanization = m.romanization || '';
  let translation = m.translation || '';
  let audioBase64 = m.audioBase64;
  const pronunciationResult = m.pronunciationResult;
  const pronunciationScore = typeof m.pronunciationScore === 'number' ? m.pronunciationScore : (pronunciationResult?.overallScore ?? null);

  // Trích xuất romanization và translation nếu chuỗi chứa JSON
  if (rawOriginal.includes('"romanization"')) {
    const romMatch = rawOriginal.match(/"romanization"\s*:\s*"((?:[^"\\]|\\.)*)"?/i);
    if (romMatch && romMatch[1]) romanization = romMatch[1].replace(/\\"/g, '"').trim();
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
    translation,
    text: original,
    audioBase64,
    pronunciationResult,
    pronunciationScore,
    timestamp: m.timestamp || Date.now(),
    toolResults: m.toolResults,
  };
}

export default function VoiceTutor({ language, topic }: VoiceTutorProps) {
  const { settings } = useSettings();

  // ─── State ────────────────────────────────────────────────
  const [tutorState, setTutorState] = useState<TutorState>('idle');
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [error, setError] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [silenceCountdown, setSilenceCountdown] = useState<number | null>(null);
  const [isSpeechSupported, setIsSpeechSupported] = useState(true);

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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef(0);
  const timeRef = useRef(0);

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

  // ─── Canvas: sóng đơn giản ────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const animate = (t: number) => {
      timeRef.current = t / 1000;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const isActive = tutorState !== 'idle';
        ctx.strokeStyle = isActive ? 'rgba(139,92,246,0.7)' : 'rgba(139,92,246,0.2)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let x = 0; x < canvas.width; x++) {
          const freq = isActive ? (tutorState === 'speaking' ? 3 : 1.5) : 0.5;
          const amp = isActive ? (tutorState === 'thinking' ? 8 : 14) : 4;
          const y = canvas.height / 2 + Math.sin((x / canvas.width) * Math.PI * freq * 4 + timeRef.current * (isActive ? 4 : 1)) * amp;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [tutorState]);

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
          recorder.onstop = () => resolve();
          recorder.stop();
        });
      }
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

  // ─── Gửi transcript & audio đến AI ────────────────────────
  const sendToAI = useCallback(async (text: string, audioBase64?: string) => {
    if (!text.trim() || isProcessingRef.current) return;

    isProcessingRef.current = true;
    lastSpeechTimeRef.current = 0;
    setInterimTranscript('');
    setFinalTranscript('');
    setSilenceCountdown(null);
    setTutorState('thinking');
    setError('');
    accumulatedFinalRef.current = '';
    interimTranscriptRef.current = '';

    const startTime = Date.now();

    try {
      // Chỉ gửi câu original sạch vào history context của LLM (không gửi format, không gửi JSON)
      const history = conversationRef.current.slice(-8).map((m) => ({
        role: m.role,
        content: m.original || m.text || '',
      }));

      const body: VoiceChatRequest = {
        text,
        language: languageRef.current,
        level: settingsRef.current.level,
        topic: topicRef.current,
        history,
        voice: settingsRef.current.voice,
        speed: settingsRef.current.speed,
        audioBase64,
      };

      const resp = await fetch('/api/voice-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data: VoiceChatResponse = await resp.json();

      if (data.error) {
        setError(data.error);
        setTutorState('idle');
        isProcessingRef.current = false;
        return;
      }

      // Thêm tin nhắn của User vào lịch sử cùng với điểm phát âm và Pinyin (nếu có)
      if (data.userTranscript) {
        const userMsg: ConversationMessage = {
          id: generateId(),
          role: 'user',
          original: data.userTranscript,
          romanization: data.userRomanization || data.userPinyin || '',
          pronunciationResult: data.pronunciationResult,
          pronunciationScore: data.pronunciationResult?.overallScore ?? null,
          text: data.userTranscript,
          timestamp: Date.now(),
        };
        setConversation((prev) => [...prev, userMsg]);
      }

      // Thêm tin nhắn của AI (đã phân tách rõ original cho TTS, romanization & translation cho UI)
      const assistantOriginal = cleanOriginalString(data.assistantOriginal || data.assistantText || '');
      if (assistantOriginal) {
        const assistantMsg: ConversationMessage = {
          id: generateId(),
          role: 'assistant',
          original: assistantOriginal,
          romanization: data.assistantRomanization || '',
          translation: data.assistantTranslation || '',
          text: assistantOriginal,
          audioBase64: data.audioBase64 || undefined,
          timestamp: Date.now(),
          toolResults: data.toolResults,
        };

        setConversation((prev) => [...prev, assistantMsg]);

        setTutorState('speaking');

        const afterSpeak = () => {
          setTutorState('idle');
          isProcessingRef.current = false;
          // Tự động lắng nghe lại sau khi AI nói xong
          if (sessionActiveRef.current) {
            setTimeout(() => {
              if (sessionActiveRef.current && !isProcessingRef.current) {
                startListening();
              }
            }, 600);
          }
        };

        // Browser SpeechSynthesis là TTS DUY NHẤT — TUYỆT ĐỐI CHỈ ĐỌC assistantOriginal!
        speakWithBrowser(assistantOriginal, afterSpeak);
      } else {
        setTutorState('idle');
        isProcessingRef.current = false;
      }
    } catch (err) {
      console.error('sendToAI error:', err);
      setError('Lỗi kết nối. Vui lòng kiểm tra kết nối mạng.');
      setTutorState('idle');
      isProcessingRef.current = false;
    }
  }, [stopAudio, speakWithBrowser]);

  // Ref để silence interval có thể gọi sendToAI mà không stale
  const sendToAIRef = useRef(sendToAI);
  useEffect(() => { sendToAIRef.current = sendToAI; }, [sendToAI]);

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
        // Đủ 3s im lặng → dừng recognition & lấy audio → gửi
        lastSpeechTimeRef.current = 0;
        setSilenceCountdown(null);
        isProcessingRef.current = true;
        try { recognitionRef.current?.abort(); } catch {}
        stopAndGetAudioBase64().then((audioBase64) => {
          isProcessingRef.current = false;
          sendToAIRef.current(text, audioBase64);
        });
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
      cancelAnimationFrame(animFrameRef.current);
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
      // Gửi ngay nếu có nội dung
      const text = accumulatedFinalRef.current.trim();
      if (text && !isProcessingRef.current) {
        lastSpeechTimeRef.current = 0;
        setSilenceCountdown(null);
        isProcessingRef.current = true;
        try { recognitionRef.current?.abort(); } catch {}
        stopAndGetAudioBase64().then((audioBase64) => {
          isProcessingRef.current = false;
          sendToAIRef.current(text, audioBase64);
        });
      } else {
        stopSession();
      }
    }
  }, [tutorState, startSession, stopAudio, stopSession, stopAndGetAudioBase64]);

  // ─── Render ───────────────────────────────────────────────
  const isActive = tutorState !== 'idle';
  const badgeState = tutorState === 'waiting' ? 'listening' : tutorState;

  const getMicIcon = () => {
    if (tutorState === 'thinking') {
      return (
        <span className="flex gap-1">
          {[0, 0.15, 0.3].map((d) => (
            <span key={d} className="block w-1.5 h-1.5 rounded-full bg-yellow-400 animate-bounce"
              style={{ animationDelay: `${d}s` }} />
          ))}
        </span>
      );
    }
    if (tutorState === 'speaking') return <Volume2 size={32} className="text-emerald-400" />;
    if (tutorState === 'listening' || tutorState === 'waiting') return <Square size={28} className="text-red-400" fill="currentColor" />;
    return <Mic size={32} className="text-purple-400" />;
  };

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Visualizer + Mic */}
      <div className="glass-card p-6 flex flex-col items-center gap-4">
        <canvas ref={canvasRef} width={400} height={50} className="w-full rounded-lg" style={{ maxHeight: 50 }} />

        {/* Mic orb */}
        <div className="relative flex items-center justify-center">
          {(tutorState === 'listening' || tutorState === 'waiting') && (
            <>
              <div className="mic-ring-1" />
              <div className="mic-ring-2" />
              <div className="mic-ring-3" />
            </>
          )}
          <button id="mic-button"
            className={`mic-orb ${badgeState} w-24 h-24 flex items-center justify-center select-none`}
            onClick={handleMainButton}
            aria-label={isActive ? 'Dừng' : 'Bắt đầu nói'}>
            {getMicIcon()}
          </button>
        </div>

        {/* Status */}
        <div className="flex flex-col items-center gap-2 w-full">
          <div className={`status-badge ${badgeState}`}>{STATE_LABELS[tutorState]}</div>

          {/* Countdown */}
          {tutorState === 'waiting' && silenceCountdown !== null && (
            <div className="flex items-center gap-2 text-sm" style={{ color: '#fde68a' }}>
              <span>Gửi sau</span>
              <span className="font-bold tabular-nums">{silenceCountdown}s</span>
              <span>im lặng</span>
            </div>
          )}

          {tutorState === 'idle' && (
            <p className="text-xs text-indigo-900/35 text-center max-w-xs">
              Nhấn 🎤 để bắt đầu. Hệ thống tự nhận diện sau <strong>3 giây</strong> im lặng.
            </p>
          )}
        </div>

        {/* Realtime transcript */}
        {(tutorState === 'listening' || tutorState === 'waiting') && (
          <div className="w-full rounded-xl p-4 min-h-[60px]"
            style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.2)' }}>
            <div className="text-xs text-purple-400/70 uppercase tracking-wider mb-1.5">
              📝 Đang nhận diện...
            </div>
            <p className="text-sm leading-relaxed">
              {finalTranscript && <span className="text-indigo-900">{finalTranscript}</span>}
              {interimTranscript && <span className="text-indigo-900/45 italic"> {interimTranscript}</span>}
              {!finalTranscript && !interimTranscript && (
                <span className="text-indigo-900/25 italic">Hãy nói gì đó...</span>
              )}
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="w-full text-sm text-center py-2 px-4 rounded-xl"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}>
            ⚠️ {error}
          </div>
        )}

        {/* Browser không hỗ trợ */}
        {!isSpeechSupported && (
          <div className="w-full p-3 rounded-xl text-sm text-center"
            style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', color: '#fde68a' }}>
            <MicOff size={16} className="mx-auto mb-1" />
            Dùng <strong>Chrome</strong> hoặc <strong>Edge</strong> để có Web Speech API.
          </div>
        )}
      </div>

      {/* Hội thoại */}
      <div className="glass-card flex-1 flex flex-col" style={{ minHeight: 280 }}>
        <div className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <h3 className="text-sm font-semibold text-indigo-900/70 flex items-center gap-2">
            <Sparkles size={14} className="text-purple-400" /> Lịch sử hội thoại
            {conversation.length > 0 && (
              <span className="text-xs font-normal text-indigo-900/25">({conversation.length})</span>
            )}
          </h3>
          {conversation.length > 0 && (
            <button onClick={clearConversation}
              className="flex items-center gap-1 text-xs text-indigo-900/30 hover:text-indigo-900/60 transition-colors">
              <RotateCcw size={12} /> Xóa
            </button>
          )}
        </div>

        <div className="conversation-area flex-1 overflow-y-auto" style={{ maxHeight: 380 }}>
          {conversation.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-10">
              <div className="text-4xl">🤖</div>
              <p className="text-indigo-900/35 text-sm max-w-xs">
                Nhấn nút micro và bắt đầu nói.<br />
                AI sẽ trả lời sau 3 giây im lặng.
              </p>
            </div>
          ) : (
            <>
              {conversation.map((msg) => {
                const originalText = cleanOriginalString(msg.original || msg.text || '');

                if (msg.role === 'user') {
                  return (
                    <div key={msg.id} className="self-end flex items-center gap-2.5 max-w-[88%]">
                      {/* Điểm phát âm hiển thị bên TRÁI bubble của USER */}
                      {typeof msg.pronunciationScore === 'number' && (
                        <div
                          className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-bold border shadow-sm ${getScoreBadgeStyle(
                            msg.pronunciationScore
                          )}`}
                          title={`Điểm phát âm: ${Math.round(msg.pronunciationScore)}%`}
                        >
                          {Math.round(msg.pronunciationScore)}%
                        </div>
                      )}

                      {/* Bubble tin nhắn của USER */}
                      <div className="message-bubble user rounded-2xl p-3 flex-1 min-w-0">
                        <div className="flex items-start gap-2">
                          <span className="text-base mt-0.5 flex-shrink-0">👤</span>
                          <div className="flex-1 min-w-0">
                            {/* Dòng 1: Câu tiếng Trung */}
                            <p className="text-sm leading-relaxed font-semibold">{originalText}</p>

                            {/* Dòng 2: Pinyin (chỉ bôi đỏ âm tiết phát âm sai) */}
                            {msg.pronunciationResult?.syllables && msg.pronunciationResult.syllables.length > 0 ? (
                              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 mt-1.5">
                                {msg.pronunciationResult.syllables.map((s, idx) => {
                                  const isError =
                                    s.errorType !== 'None' ||
                                    (typeof s.accuracyScore === 'number' && s.accuracyScore < 70);
                                  return (
                                    <span
                                      key={idx}
                                      className={`text-xs font-mono tracking-wide transition-colors ${
                                        isError
                                          ? 'text-red-300 font-bold bg-red-950/60 px-1 py-0.5 rounded border border-red-500/40 shadow-sm'
                                          : 'text-white/80'
                                      }`}
                                      title={
                                        s.accuracyScore !== null
                                          ? `${s.character || ''} (${s.pinyin}): ${s.accuracyScore} điểm${
                                              s.errorType !== 'None' ? ` - ${s.errorType}` : ''
                                            }`
                                          : `${s.character || ''} (${s.pinyin})`
                                      }
                                    >
                                      {s.pinyin}
                                    </span>
                                  );
                                })}
                              </div>
                            ) : msg.romanization ? (
                              <p className="text-xs text-white/80 leading-relaxed mt-1 font-mono">
                                {msg.romanization}
                              </p>
                            ) : null}

                            <div className="flex items-center gap-2 mt-2">
                              <span className="text-xs text-white/50">
                                {new Date(msg.timestamp).toLocaleTimeString('vi-VN')}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={msg.id}
                    className="message-bubble assistant rounded-2xl p-3">
                    <div className="flex items-start gap-2">
                      <span className="text-base mt-0.5 flex-shrink-0">🤖</span>
                      <div className="flex-1 min-w-0">
                        {/* Dòng 1: ORIGINAL AI RESPONSE (Nguồn duy nhất cho TTS) */}
                        <p className="text-sm text-indigo-900/90 leading-relaxed font-semibold">
                          {originalText}
                        </p>
                        {/* Dòng 2: ROMANIZATION (Chỉ dùng hiển thị UI) */}
                        {msg.romanization && (
                          <p className="text-sm text-indigo-900/60 leading-relaxed mt-1">
                            {msg.romanization}
                          </p>
                        )}
                        {/* Dòng 3: TRANSLATION (Chỉ dùng hiển thị UI) */}
                        {msg.translation && (
                          <p className="text-sm text-indigo-900/75 leading-relaxed mt-1 italic">
                            {msg.translation}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs text-indigo-900/30">
                            {new Date(msg.timestamp).toLocaleTimeString('vi-VN')}
                          </span>
                          <button
                            onClick={() => replayAudio(msg)}
                            className="text-xs text-purple-600 hover:text-purple-800 transition-colors flex items-center gap-1 font-medium"
                          >
                            <Volume2 size={12} /> Phát lại
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={conversationEndRef} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
