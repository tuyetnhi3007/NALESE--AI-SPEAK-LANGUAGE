'use client';
// ============================================================
// components/TopicExercises.tsx — Bài tập học ngoại ngữ theo chủ đề
// Quản lý trạng thái bài tập tại component cha (không mất tiến độ khi đóng/mở panel)
// Tích hợp Cửa sổ nổi (ExerciseModal) và Thanh "Tiếp tục làm bài" (ResumeExerciseBar)
// Lưu trữ tiến độ an toàn qua localStorage, tự khôi phục sau khi F5
// ============================================================

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Brain,
  Sprout,
  Leaf,
  TreePine,
  Plane,
  Home,
  Briefcase,
  UtensilsCrossed,
  Stethoscope,
  ShoppingBag,
  Laptop,
  GraduationCap,
  Sparkles,
  RotateCcw,
  Trophy,
  Volume2,
  Mic,
  CheckCircle,
  XCircle,
  ArrowRight,
  StopCircle,
  Loader2,
} from 'lucide-react';
import { useSettings } from './SettingsContext';
import type {
  SupportedLanguage,
  LanguageLevel,
  ExerciseSet,
  TopicExerciseRequest,
} from '@/lib/types';
import { isFillCorrect } from '@/lib/quiz-utils';
import ExerciseModal from './ExerciseModal';
import ResumeExerciseBar from './ResumeExerciseBar';
import ConfirmDialog from './ConfirmDialog';

interface TopicExercisesProps {
  selectedLanguage: SupportedLanguage;
  onLanguageChange: (lang: SupportedLanguage) => void;
}

// ─── Danh sách ngôn ngữ ─────────────────────────────────────
const LANGUAGES = [
  { code: 'en' as SupportedLanguage, name: 'Tiếng Anh', flag: 'ENG' },
  { code: 'zh' as SupportedLanguage, name: 'Tiếng Trung', flag: 'CN' },
  { code: 'ja' as SupportedLanguage, name: 'Tiếng Nhật', flag: 'JP' },
];

// ─── Danh sách chủ đề ────────────────────────────────────────
const TOPICS = [
  { id: 'travel', name: 'Du lịch & Sân bay', icon: Plane },
  { id: 'daily_life', name: 'Cuộc sống hàng ngày', icon: Home },
  { id: 'work', name: 'Công việc & Kinh doanh', icon: Briefcase },
  { id: 'food', name: 'Ẩm thực & Nhà hàng', icon: UtensilsCrossed },
  { id: 'health', name: 'Sức khỏe & Bệnh viện', icon: Stethoscope },
  { id: 'shopping', name: 'Mua sắm', icon: ShoppingBag },
  { id: 'technology', name: 'Công nghệ', icon: Laptop },
  { id: 'education', name: 'Giáo dục & Học tập', icon: GraduationCap },
];

// ─── Danh sách cấp độ ────────────────────────────────────────
const LEVELS: {
  value: LanguageLevel;
  label: string;
  desc: string;
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
}[] = [
  { value: 'beginner', label: 'Sơ cấp', desc: 'A1-A2', icon: Sprout },
  { value: 'intermediate', label: 'Trung cấp', desc: 'B1-B2', icon: Leaf },
  { value: 'advanced', label: 'Cao cấp', desc: 'C1-C2', icon: TreePine },
];

// ─── Tên loại bài tập ────────────────────────────────────────
const EXERCISE_TYPE_LABELS: Record<string, string> = {
  'vocabulary': 'Từ vựng',
  'multiple-choice': 'Trắc nghiệm',
  'fill-blank': 'Điền vào chỗ trống',
  'translation': 'Dịch thuật',
  'sentence-ordering': 'Sắp xếp câu',
  'listening': 'Nghe hiểu',
  'speaking': 'Luyện nói',
  'error-correction': 'Sửa lỗi',
};

// ─── Web Speech Recognition ──────────────────────────────────
interface SpeechRecognitionError extends Event {
  error: string;
}

function getSpeechRecognition(): any | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!SR) return null;
  return new SR();
}

const SPEECH_LANG: Record<SupportedLanguage, string> = {
  en: 'en-US',
  zh: 'zh-CN',
  ja: 'ja-JP',
};

const STORAGE_KEY = 'nalese_topic_exercise_progress';
const STORAGE_VERSION = 1;

export default function TopicExercises({
  selectedLanguage,
  onLanguageChange,
}: TopicExercisesProps) {
  const { settings } = useSettings();

  // Setup state
  const [topic, setTopic] = useState('');
  const [level, setLevel] = useState<LanguageLevel>('beginner');

  // Exercise modal & state (Component cha quản lý toàn bộ state)
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [exerciseSet, setExerciseSet] = useState<ExerciseSet | null>(null);
  const [currentQ, setCurrentQ] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [userInput, setUserInput] = useState('');
  const [orderedWords, setOrderedWords] = useState<string[]>([]);
  const [availableWords, setAvailableWords] = useState<string[]>([]);
  const [showResult, setShowResult] = useState(false);
  const [isLastAnswerCorrect, setIsLastAnswerCorrect] = useState(false);
  const [score, setScore] = useState(0);
  const [isComposing, setIsComposing] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState('');

  // Confirmation dialogs
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const [confirmNewExerciseOpen, setConfirmNewExerciseOpen] = useState(false);

  // Speaking state
  const [isRecording, setIsRecording] = useState(false);
  const [spokenText, setSpokenText] = useState('');
  const recognitionRef = useRef<ReturnType<typeof getSpeechRecognition>>(null);
  const [playingTTS, setPlayingTTS] = useState(false);

  // Focus return ref
  const resumeButtonRef = useRef<HTMLButtonElement>(null);

  // ─── Khôi phục tiến độ từ localStorage khi tải trang ────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        parsed.version === STORAGE_VERSION &&
        parsed.exerciseSet &&
        !parsed.isComplete
      ) {
        setExerciseSet(parsed.exerciseSet);
        setCurrentQ(typeof parsed.currentQ === 'number' ? parsed.currentQ : 0);
        setScore(typeof parsed.score === 'number' ? parsed.score : 0);
        setSelectedAnswer(parsed.selectedAnswer || null);
        setUserInput(parsed.userInput || '');
        setOrderedWords(Array.isArray(parsed.orderedWords) ? parsed.orderedWords : []);
        setAvailableWords(Array.isArray(parsed.availableWords) ? parsed.availableWords : []);
        setShowResult(!!parsed.showResult);
        setIsLastAnswerCorrect(!!parsed.isLastAnswerCorrect);
        setIsComplete(false);
        setIsModalOpen(false); // Mặc định đóng tạm để người dùng thấy thanh "Tiếp tục"

        if (parsed.topic) setTopic(parsed.topic);
        if (parsed.level) setLevel(parsed.level);
        if (parsed.selectedLanguage && parsed.selectedLanguage !== selectedLanguage) {
          onLanguageChange(parsed.selectedLanguage);
        }
      }
    } catch {
      // Dữ liệu lỗi bỏ qua an toàn
    }
  }, [onLanguageChange]);

  // ─── Lưu tiến độ vào localStorage ──────────────────────────
  const saveProgressToStorage = useCallback(
    (overrides?: Partial<{
      exerciseSet: ExerciseSet | null;
      currentQ: number;
      score: number;
      selectedAnswer: string | null;
      userInput: string;
      orderedWords: string[];
      availableWords: string[];
      showResult: boolean;
      isLastAnswerCorrect: boolean;
      isComplete: boolean;
    }>) => {
      try {
        const currentExSet = overrides?.exerciseSet !== undefined ? overrides.exerciseSet : exerciseSet;
        const currentCompleted = overrides?.isComplete !== undefined ? overrides.isComplete : isComplete;

        if (!currentExSet || currentCompleted) {
          localStorage.removeItem(STORAGE_KEY);
          return;
        }

        const data = {
          version: STORAGE_VERSION,
          exerciseSet: currentExSet,
          currentQ: overrides?.currentQ !== undefined ? overrides.currentQ : currentQ,
          score: overrides?.score !== undefined ? overrides.score : score,
          selectedAnswer: overrides?.selectedAnswer !== undefined ? overrides.selectedAnswer : selectedAnswer,
          userInput: overrides?.userInput !== undefined ? overrides.userInput : userInput,
          orderedWords: overrides?.orderedWords !== undefined ? overrides.orderedWords : orderedWords,
          availableWords: overrides?.availableWords !== undefined ? overrides.availableWords : availableWords,
          showResult: overrides?.showResult !== undefined ? overrides.showResult : showResult,
          isLastAnswerCorrect:
            overrides?.isLastAnswerCorrect !== undefined
              ? overrides.isLastAnswerCorrect
              : isLastAnswerCorrect,
          isComplete: false,
          topic,
          level,
          selectedLanguage,
          updatedAt: Date.now(),
        };

        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch {
        // Tránh crash nếu bộ nhớ đầy
      }
    },
    [
      exerciseSet,
      currentQ,
      score,
      selectedAnswer,
      userInput,
      orderedWords,
      availableWords,
      showResult,
      isLastAnswerCorrect,
      isComplete,
      topic,
      level,
      selectedLanguage,
    ]
  );

  // ─── Xóa sạch tiến độ ──────────────────────────────────────
  const clearProgress = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setExerciseSet(null);
    setCurrentQ(0);
    setScore(0);
    setIsComplete(false);
    setSelectedAnswer(null);
    setShowResult(false);
    setIsLastAnswerCorrect(false);
    setUserInput('');
    setOrderedWords([]);
    setAvailableWords([]);
    setIsModalOpen(false);
  }, []);

  // ─── Gọi API sinh bài tập mới ─────────────────────────────
  const executeGenerateExercises = useCallback(async () => {
    if (!topic) return;
    setIsGenerating(true);
    setError('');
    setCurrentQ(0);
    setScore(0);
    setIsComplete(false);
    setSelectedAnswer(null);
    setShowResult(false);
    setIsLastAnswerCorrect(false);
    setUserInput('');

    try {
      const body: TopicExerciseRequest = {
        language: selectedLanguage,
        topic,
        level,
        ...(settings.apiKey ? { apiKey: settings.apiKey } : {}),
      };

      const response = await fetch('/api/topic-exercises', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(settings.apiKey ? { 'x-api-key': settings.apiKey } : {}),
        },
        body: JSON.stringify(body),
      });

      const data: ExerciseSet & { error?: string } = await response.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      setExerciseSet(data);

      let initialAvailableWords: string[] = [];
      const firstQ = data.questions[0];
      if (firstQ?.type === 'sentence-ordering' && firstQ.words) {
        initialAvailableWords = [...firstQ.words].sort(() => Math.random() - 0.5);
        setAvailableWords(initialAvailableWords);
        setOrderedWords([]);
      }

      // Tự động mở cửa sổ nổi khi tạo xong
      setIsModalOpen(true);

      // Lưu tiến độ ban đầu
      saveProgressToStorage({
        exerciseSet: data,
        currentQ: 0,
        score: 0,
        selectedAnswer: null,
        userInput: '',
        orderedWords: [],
        availableWords: initialAvailableWords,
        showResult: false,
        isLastAnswerCorrect: false,
        isComplete: false,
      });
    } catch {
      setError('Không thể kết nối server. Kiểm tra kết nối mạng.');
    } finally {
      setIsGenerating(false);
    }
  }, [selectedLanguage, topic, level, settings.apiKey, saveProgressToStorage]);

  // ─── Xử lý khi nhấn nút Tạo Bài Tập ────────────────────────
  const handleRequestGenerateExercises = useCallback(() => {
    if (!topic || isGenerating) return;

    // Nếu đang có bài tập chưa hoàn thành -> hiện xác nhận
    if (exerciseSet && !isComplete) {
      setConfirmNewExerciseOpen(true);
      return;
    }

    executeGenerateExercises();
  }, [topic, isGenerating, exerciseSet, isComplete, executeGenerateExercises]);

  // ─── Phát âm thanh TTS ─────────────────────────────────────
  const playTTS = useCallback(
    (text: string) => {
      if (!text || playingTTS) return;
      setPlayingTTS(true);
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        const targetLang =
          selectedLanguage === 'zh'
            ? 'zh-CN'
            : selectedLanguage === 'ja'
            ? 'ja-JP'
            : 'en-US';
        utterance.lang = targetLang;
        utterance.rate = Math.max(0.5, Math.min(2.0, settings.speed || 1.0));

        if (window.speechSynthesis.getVoices) {
          const voices = window.speechSynthesis.getVoices();
          const normalizedTarget = targetLang.toLowerCase().replace('_', '-');
          let voice = voices.find(
            (v) => v.lang.toLowerCase().replace('_', '-') === normalizedTarget
          );
          if (!voice && normalizedTarget.startsWith('zh')) {
            voice = voices.find((v) => v.lang.toLowerCase().startsWith('zh'));
          }
          if (voice) utterance.voice = voice;
        }

        utterance.onend = () => setPlayingTTS(false);
        utterance.onerror = () => setPlayingTTS(false);
        window.speechSynthesis.speak(utterance);
      } else {
        setPlayingTTS(false);
      }
    },
    [selectedLanguage, settings.speed, playingTTS]
  );

  // ─── Ghi âm speaking ──────────────────────────────────────
  const startSpeaking = useCallback((lang: SupportedLanguage) => {
    const recognition = getSpeechRecognition();
    if (!recognition) {
      setSpokenText('Trình duyệt không hỗ trợ nhận diện giọng nói.');
      return;
    }
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = SPEECH_LANG[lang];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (e: any) => {
      setSpokenText(e.results[0][0].transcript as string);
    };
    recognition.onend = () => setIsRecording(false);
    recognition.onerror = (e: SpeechRecognitionError) => {
      if (e.error !== 'no-speech') setSpokenText('Không nghe được. Thử lại.');
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
    setSpokenText('');
  }, []);

  const stopSpeaking = useCallback(() => {
    recognitionRef.current?.stop();
    setIsRecording(false);
  }, []);

  // ─── Câu hỏi hiện tại ─────────────────────────────────────
  const question = exerciseSet?.questions[currentQ];
  const totalQ = exerciseSet?.questions.length || 0;

  // ─── Kiểm tra đáp án ──────────────────────────────────────
  const checkAnswer = useCallback(
    (answer: string) => {
      if (showResult || !question) return;
      setSelectedAnswer(answer);
      setShowResult(true);

      const norm = (s: string) =>
        (s || '').trim().toLowerCase().normalize('NFC').replace(/\s+/g, ' ');
      const correct = norm(question.correctAnswer);
      const given = norm(answer);

      let isCorrect =
        given === correct ||
        correct.includes(given) ||
        (given.length > 5 && correct.includes(given.slice(0, 8)));

      if (
        !isCorrect &&
        (question.type === 'fill-blank' ||
          question.type === 'translation' ||
          question.type === 'error-correction')
      ) {
        const fillRes = isFillCorrect(answer, question as any, selectedLanguage);
        if (fillRes.isCorrect) isCorrect = true;
      }

      if (!isCorrect && question.options && Array.isArray(question.options)) {
        const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
        const optIdx = question.options.findIndex(
          (o) => norm(o) === given || norm(o).includes(given)
        );
        if (optIdx !== -1) {
          const optLetter = letters[optIdx]?.toLowerCase();
          if (
            correct === optLetter ||
            correct.startsWith(`${optLetter}.`) ||
            correct.startsWith(`${optLetter})`)
          ) {
            isCorrect = true;
          }
        }
      }

      setIsLastAnswerCorrect(isCorrect);
      const newScore = isCorrect ? score + 1 : score;
      if (isCorrect) {
        setScore((prev) => prev + 1);
      }

      saveProgressToStorage({
        selectedAnswer: answer,
        showResult: true,
        isLastAnswerCorrect: isCorrect,
        score: newScore,
      });
    },
    [showResult, question, selectedLanguage, score, saveProgressToStorage]
  );

  // ─── Next question ─────────────────────────────────────────
  const nextQuestion = useCallback(() => {
    if (!exerciseSet) return;
    setSelectedAnswer(null);
    setShowResult(false);
    setIsLastAnswerCorrect(false);
    setUserInput('');
    setSpokenText('');

    const nextIdx = currentQ + 1;
    if (nextIdx >= totalQ) {
      setIsComplete(true);
      saveProgressToStorage({
        isComplete: true,
      });
      return;
    }

    setCurrentQ(nextIdx);
    const nextQ = exerciseSet.questions[nextIdx];
    let newAvail: string[] = [];
    if (nextQ?.type === 'sentence-ordering' && nextQ.words) {
      newAvail = [...nextQ.words].sort(() => Math.random() - 0.5);
      setAvailableWords(newAvail);
      setOrderedWords([]);
    } else {
      setAvailableWords([]);
      setOrderedWords([]);
    }

    saveProgressToStorage({
      currentQ: nextIdx,
      selectedAnswer: null,
      showResult: false,
      isLastAnswerCorrect: false,
      userInput: '',
      availableWords: newAvail,
      orderedWords: [],
    });
  }, [exerciseSet, currentQ, totalQ, saveProgressToStorage]);

  // ─── Sentence ordering ────────────────────────────────────
  const addWord = (word: string, idx: number) => {
    const nextOrdered = [...orderedWords, word];
    const nextAvail = availableWords.filter((_, i) => i !== idx);
    setOrderedWords(nextOrdered);
    setAvailableWords(nextAvail);
    saveProgressToStorage({ orderedWords: nextOrdered, availableWords: nextAvail });
  };
  const removeWord = (word: string, idx: number) => {
    const nextAvail = [...availableWords, word];
    const nextOrdered = orderedWords.filter((_, i) => i !== idx);
    setAvailableWords(nextAvail);
    setOrderedWords(nextOrdered);
    saveProgressToStorage({ orderedWords: nextOrdered, availableWords: nextAvail });
  };

  const scorePercent = totalQ > 0 ? Math.round((score / totalQ) * 100) : 0;

  // Lấy tên hiển thị
  const selectedLangObj = LANGUAGES.find((l) => l.code === selectedLanguage);
  const selectedLevelObj = LEVELS.find((l) => l.value === level);
  const selectedTopicObj = TOPICS.find((t) => t.id === topic);

  const modalTitle = `Bài tập: ${selectedLangObj?.name || ''} · ${selectedLevelObj?.label || ''} · ${selectedTopicObj?.name || exerciseSet?.title || ''}`;
  const resumeSubtitle = `${selectedLangObj?.name} · ${selectedLevelObj?.label} · ${selectedTopicObj?.name || exerciseSet?.title} — Câu ${currentQ + 1}/${totalQ} · Điểm ${score}/${currentQ + (showResult ? 1 : 0)}`;

  return (
    <div
      className="w-full flex flex-col justify-between"
      style={{ minHeight: 'calc(100dvh - var(--header-h))' }}
    >
      {/* ── KHỐI NỘI DUNG CHÍNH (CANH GIỮA HOÀN HẢO, VỪA 1 MÀN HÌNH >= 720PX) ── */}
      <div
        className="w-full flex flex-col gap-4 flex-1"
        style={{
          maxWidth: '1100px',
          marginInline: 'auto',
          padding: '24px 24px 32px 24px',
        }}
      >
        {/* a) Tiêu đề: Không card, Brain icon + chữ 18px đậm + mô tả 13px */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Brain size={20} style={{ color: 'var(--accent)' }} className="flex-shrink-0" />
            <h2 style={{ color: 'var(--text)', fontWeight: 700, fontSize: '18px', lineHeight: 1.2 }}>
              Bài tập theo chủ đề
            </h2>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: '13px', lineHeight: 1.4 }}>
            AI tạo bài tập học ngoại ngữ phù hợp với chủ đề và trình độ của bạn.
          </p>
        </div>

        {/* b) Hàng chọn ngôn ngữ + trình độ: display grid 2 cột (1 cột dưới 900px), mỗi bên 1 card */}
        <div className="grid grid-cols-1 min-[900px]:grid-cols-2 gap-4">
          {/* Card: 1. Chọn ngôn ngữ */}
          <div
            style={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              padding: '16px',
            }}
          >
            <div
              className="text-[13px] font-semibold uppercase tracking-wider mb-2.5"
              style={{ color: 'var(--muted)' }}
            >
              1. Chọn ngôn ngữ
            </div>
            <div className="grid grid-cols-3 gap-3">
              {LANGUAGES.map((l) => {
                const isSelected = selectedLanguage === l.code;
                return (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => onLanguageChange(l.code)}
                    className="flex flex-col items-center justify-center text-center cursor-pointer transition-colors duration-150"
                    style={{
                      height: '64px',
                      minHeight: '64px',
                      borderRadius: '10px',
                      border: isSelected ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                      backgroundColor: isSelected ? 'var(--bubble-user)' : 'var(--card)',
                      padding: '6px 8px',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.borderColor = 'var(--accent)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) e.currentTarget.style.borderColor = 'var(--border)';
                    }}
                  >
                    <div
                      className="leading-tight"
                      style={{
                        color: 'var(--text)',
                        fontWeight: 600,
                        fontSize: '16px',
                      }}
                    >
                      {l.flag}
                    </div>
                    <div
                      className="mt-0.5 leading-tight truncate w-full"
                      style={{
                        color: 'var(--muted)',
                        fontSize: '12px',
                      }}
                    >
                      {l.name}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Card: 2. Chọn trình độ */}
          <div
            style={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              padding: '16px',
            }}
          >
            <div
              className="text-[13px] font-semibold uppercase tracking-wider mb-2.5"
              style={{ color: 'var(--muted)' }}
            >
              2. Chọn trình độ
            </div>
            <div className="grid grid-cols-3 gap-3">
              {LEVELS.map((l) => {
                const Icon = l.icon;
                const isSelected = level === l.value;
                return (
                  <button
                    key={l.value}
                    type="button"
                    onClick={() => setLevel(l.value)}
                    className="flex flex-col items-center justify-center text-center cursor-pointer transition-colors duration-150"
                    style={{
                      height: '64px',
                      minHeight: '64px',
                      borderRadius: '10px',
                      border: isSelected ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                      backgroundColor: isSelected ? 'var(--bubble-user)' : 'var(--card)',
                      padding: '6px 8px',
                      gap: '2px',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.borderColor = 'var(--accent)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) e.currentTarget.style.borderColor = 'var(--border)';
                    }}
                  >
                    <Icon size={16} style={{ color: 'var(--accent)' }} />
                    <div
                      className="leading-tight"
                      style={{
                        color: 'var(--text)',
                        fontSize: '13px',
                        fontWeight: 500,
                      }}
                    >
                      {l.label}
                    </div>
                    <div
                      className="leading-tight"
                      style={{
                        color: 'var(--muted)',
                        fontSize: '11px',
                      }}
                    >
                      {l.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* c) "3. Chọn chủ đề": card riêng, lưới 4 cột x 2 hàng, mỗi thẻ cao 64px, icon 24px bên trái */}
        <div
          style={{
            backgroundColor: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            padding: '16px',
          }}
        >
          <div
            className="text-[13px] font-semibold uppercase tracking-wider mb-2.5"
            style={{ color: 'var(--muted)' }}
          >
            3. Chọn chủ đề
          </div>
          <div className="grid grid-cols-2 min-[900px]:grid-cols-4 gap-3">
            {TOPICS.map((t) => {
              const Icon = t.icon;
              const isSelected = topic === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTopic(t.id)}
                  className="flex flex-row items-center gap-3 cursor-pointer transition-colors duration-150 text-left"
                  style={{
                    height: '64px',
                    minHeight: '64px',
                    backgroundColor: isSelected ? 'var(--bubble-user)' : 'var(--card)',
                    border: isSelected ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                    borderRadius: '10px',
                    padding: '0 16px',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.borderColor = 'var(--accent)';
                      e.currentTarget.style.backgroundColor = '#FFFBF6';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.borderColor = 'var(--border)';
                      e.currentTarget.style.backgroundColor = 'var(--card)';
                    }
                  }}
                >
                  <Icon size={24} strokeWidth={1.75} style={{ color: 'var(--accent)' }} className="flex-shrink-0" />
                  <span
                    className="line-clamp-2 leading-tight"
                    style={{
                      color: 'var(--text)',
                      fontSize: '14px',
                      fontWeight: 500,
                    }}
                  >
                    {t.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Error message nếu có */}
        {error && (
          <div
            className="p-3.5 rounded-xl text-sm flex items-center justify-between"
            style={{
              backgroundColor: '#FDECEC',
              border: '1px solid rgba(214, 69, 69, 0.25)',
              color: 'var(--danger)',
            }}
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={handleRequestGenerateExercises}
              className="underline font-semibold cursor-pointer ml-3 flex-shrink-0"
            >
              Thử lại
            </button>
          </div>
        )}

        {/* ── THẺ ĐANG TẠO BÀI TẬP (GIỮ NGUYÊN KHI ĐANG GỌI API) ── */}
        {isGenerating && (
          <div
            className="text-center p-8 rounded-xl"
            style={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
            }}
          >
            <Loader2
              size={36}
              className="animate-spin mx-auto mb-3"
              style={{ color: 'var(--accent)' }}
            />
            <h3
              style={{
                fontSize: '17px',
                fontWeight: 600,
                color: 'var(--text)',
                marginBottom: '4px',
              }}
            >
              Đang tạo bài tập...
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--muted)' }}>
              AI đang soạn bộ câu hỏi phù hợp cho {selectedLangObj?.name} ({selectedLevelObj?.label}) - {selectedTopicObj?.name}
            </p>
          </div>
        )}

        {/* ── THANH "TIẾP TỤC LÀM BÀI" (HIỆN KHI CÓ BÀI DỞ VÀ CỬA SỔ ĐANG ĐÓNG TẠM) ── */}
        {!isModalOpen && exerciseSet && !isComplete && !isGenerating && (
          <ResumeExerciseBar
            subtitle={resumeSubtitle}
            onResume={() => setIsModalOpen(true)}
            onDiscard={() => setConfirmDiscardOpen(true)}
            resumeButtonRef={resumeButtonRef}
          />
        )}
      </div>

      {/* ── d) THANH HÀNH ĐỘNG CỐ ĐỊNH Ở ĐÁY (STICKY BOTTOM ACTION BAR) ── */}
      <div
        className="topic-sticky-bar sticky bottom-0 z-20 w-full"
        style={{
          backgroundColor: 'var(--bg)',
          borderTop: '1px solid var(--border)',
          boxShadow: '0 -4px 16px rgba(43, 33, 24, 0.04)',
        }}
      >
        <div
          className="w-full flex items-center justify-between gap-4"
          style={{
            maxWidth: '1100px',
            marginInline: 'auto',
            padding: '12px 24px',
          }}
        >
          {/* Bên trái: Tóm tắt lựa chọn */}
          <div className="hidden min-[560px]:flex items-center gap-2 text-sm" style={{ color: 'var(--muted)' }}>
            <span>{selectedLangObj?.name}</span>
            <span>·</span>
            <span>{selectedLevelObj?.label}</span>
            <span>·</span>
            <span
              style={{
                color: selectedTopicObj ? 'var(--text)' : 'var(--muted)',
                fontWeight: selectedTopicObj ? 600 : 400,
              }}
            >
              {selectedTopicObj ? selectedTopicObj.name : 'Chưa chọn chủ đề'}
            </span>
          </div>

          {/* Bên phải: Nút Tạo Bài Tập */}
          <button
            type="button"
            onClick={handleRequestGenerateExercises}
            disabled={!topic || isGenerating}
            className="flex items-center justify-center gap-2 font-semibold text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap flex-shrink-0 w-full min-[560px]:w-auto"
            style={{
              height: '44px',
              padding: '0 24px',
              backgroundColor: 'var(--accent)',
              borderRadius: '8px',
              border: 'none',
              fontSize: '15px',
            }}
            onMouseEnter={(e) => {
              if (topic && !isGenerating) e.currentTarget.style.backgroundColor = 'var(--accent-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--accent)';
            }}
          >
            {isGenerating ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Đang tạo...</span>
              </>
            ) : (
              <>
                <Sparkles size={16} />
                <span>Tạo Bài Tập</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── CỬA SỔ NỔI (EXERCISE MODAL) CHỨA TOÀN BỘ TIẾN TRÌNH BÀI TẬP ── */}
      <ExerciseModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={modalTitle}
        currentQ={currentQ}
        totalQ={totalQ}
        score={score}
        showResult={showResult}
        isComplete={isComplete}
        onRestart={() => {
          setConfirmNewExerciseOpen(true);
        }}
        resumeButtonRef={resumeButtonRef}
      >
        {isComplete ? (
          /* Màn hình kết quả khi hoàn thành */
          <div className="text-center py-6 sm:py-8">
            <Trophy size={48} className="mx-auto mb-3" style={{ color: 'var(--accent)' }} />
            <h3
              style={{
                fontSize: '22px',
                fontWeight: 700,
                color: 'var(--text)',
                marginBottom: '4px',
              }}
            >
              Hoàn thành bài tập
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '14px' }}>
              Kết quả của bạn
            </p>

            <div
              style={{
                fontSize: '56px',
                fontWeight: 800,
                color: 'var(--accent)',
                lineHeight: 1,
                marginBottom: '8px',
              }}
            >
              {scorePercent}%
            </div>

            <p style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '16px' }}>
              {score}/{totalQ} câu đúng
            </p>

            <div
              className="w-full max-w-xs mx-auto mb-6 rounded-full overflow-hidden"
              style={{ height: '8px', backgroundColor: 'var(--border)' }}
            >
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${scorePercent}%`, backgroundColor: 'var(--accent)' }}
              />
            </div>

            <div
              style={{
                fontSize: '15px',
                fontWeight: 500,
                color: 'var(--text)',
                marginBottom: '24px',
              }}
            >
              {scorePercent === 100
                ? 'Xuất sắc! Bạn đã trả lời đúng tất cả các câu!'
                : scorePercent >= 80
                ? 'Rất tốt! Tiếp tục phát huy nhé!'
                : scorePercent >= 60
                ? 'Khá tốt! Ôn tập thêm để hoàn thiện hơn.'
                : 'Cần cố gắng thêm! Hãy ôn tập và thử lại nhé.'}
            </div>

            <div className="flex gap-3 justify-center flex-wrap">
              <button
                type="button"
                onClick={executeGenerateExercises}
                className="flex items-center gap-2 py-2.5 px-6 font-semibold text-white rounded-lg transition-colors cursor-pointer"
                style={{
                  backgroundColor: 'var(--accent)',
                  border: 'none',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent)')}
              >
                <RotateCcw size={15} />
                <span>Làm lại</span>
              </button>
              <button
                type="button"
                onClick={clearProgress}
                className="flex items-center gap-2 py-2.5 px-6 font-semibold rounded-lg transition-colors cursor-pointer"
                style={{
                  backgroundColor: 'var(--card)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--accent)';
                  e.currentTarget.style.backgroundColor = 'var(--bubble-user)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border)';
                  e.currentTarget.style.backgroundColor = 'var(--card)';
                }}
              >
                <span>Đóng</span>
              </button>
            </div>
          </div>
        ) : question ? (
          /* Nội dung câu hỏi đang làm */
          <div className="flex flex-col gap-4">
            {/* Header câu hỏi: Badge loại bài + Nút nghe câu hỏi */}
            <div className="flex items-center justify-between">
              <div
                className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold"
                style={{
                  backgroundColor: 'var(--bubble-user)',
                  border: '1px solid var(--border)',
                  color: 'var(--accent)',
                }}
              >
                {EXERCISE_TYPE_LABELS[question.type] || question.type}
              </div>

              {question.type !== 'listening' && question.type !== 'speaking' && (
                <button
                  type="button"
                  onClick={() => playTTS(question.question)}
                  disabled={playingTTS}
                  className="flex items-center gap-1.5 text-xs font-medium cursor-pointer transition-colors"
                  style={{ color: 'var(--muted)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--muted)')}
                >
                  <Volume2 size={14} style={{ color: 'var(--accent)' }} />
                  <span>{playingTTS ? 'Đang phát...' : 'Nghe câu hỏi'}</span>
                </button>
              )}
            </div>

            {/* Nội dung câu hỏi */}
            <div
              style={{
                backgroundColor: '#FFF7EE',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                padding: '16px 20px',
              }}
            >
              <p style={{ color: 'var(--text)', fontSize: '16px', fontWeight: 600, lineHeight: 1.5 }}>
                {question.question}
              </p>
            </div>

            {/* ── Từ vựng ── */}
            {question.type === 'vocabulary' && (
              <div
                className="rounded-xl text-sm whitespace-pre-line"
                style={{
                  backgroundColor: '#FFF7EE',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  padding: '16px 20px',
                  lineHeight: 1.6,
                }}
              >
                {question.correctAnswer}
              </div>
            )}

            {/* ── Trắc nghiệm / Nghe hiểu ── */}
            {(question.type === 'multiple-choice' || question.type === 'listening') &&
              question.options && (
                <>
                  {question.type === 'listening' && question.audioText && (
                    <button
                      type="button"
                      onClick={() => playTTS(question.audioText!)}
                      disabled={playingTTS}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors self-start"
                      style={{
                        backgroundColor: 'var(--card)',
                        border: '1px solid var(--border)',
                        color: 'var(--text)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = 'var(--accent)';
                        e.currentTarget.style.backgroundColor = 'var(--bubble-user)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'var(--border)';
                        e.currentTarget.style.backgroundColor = 'var(--card)';
                      }}
                    >
                      <Volume2 size={16} style={{ color: 'var(--accent)' }} />
                      <span>{playingTTS ? 'Đang phát...' : 'Phát câu nghe'}</span>
                    </button>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {question.options.map((opt, optIdx) => {
                      const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
                      const optLetter = letters[optIdx]?.toLowerCase();
                      const norm = (s: string) =>
                        (s || '').trim().toLowerCase().normalize('NFC').replace(/\s+/g, ' ');
                      const normCorrect = norm(question.correctAnswer);
                      const normOpt = norm(opt);

                      const isThisCorrect =
                        normOpt === normCorrect ||
                        normCorrect.includes(normOpt) ||
                        normCorrect === optLetter ||
                        normCorrect.startsWith(`${optLetter}.`) ||
                        normCorrect.startsWith(`${optLetter})`);

                      const isSelected = selectedAnswer === opt;
                      const isSelectedWrong = showResult && isSelected && !isThisCorrect;

                      let bg = 'var(--card)';
                      let border = '1px solid var(--border)';
                      let color = 'var(--text)';
                      let opacity = 1;

                      if (showResult) {
                        if (isThisCorrect) {
                          bg = '#E8F5EC';
                          border = '1.5px solid #2F9E6B';
                          color = '#1B5E20';
                        } else if (isSelectedWrong) {
                          bg = '#FDECEC';
                          border = '1.5px solid var(--danger)';
                          color = 'var(--danger)';
                        } else {
                          bg = 'var(--card)';
                          border = '1px solid var(--border)';
                          color = 'var(--muted)';
                          opacity = 0.6;
                        }
                      }

                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => checkAnswer(opt)}
                          disabled={showResult}
                          className="flex items-center justify-between text-left transition-colors cursor-pointer disabled:cursor-default"
                          style={{
                            backgroundColor: bg,
                            border: border,
                            color: color,
                            opacity: opacity,
                            borderRadius: '10px',
                            padding: '12px 16px',
                            fontSize: '14px',
                            fontWeight: 500,
                          }}
                          onMouseEnter={(e) => {
                            if (!showResult) {
                              e.currentTarget.style.borderColor = 'var(--accent)';
                              e.currentTarget.style.backgroundColor = 'var(--bubble-user)';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!showResult) {
                              e.currentTarget.style.borderColor = 'var(--border)';
                              e.currentTarget.style.backgroundColor = 'var(--card)';
                            }
                          }}
                        >
                          <div className="flex items-center gap-2.5 flex-1 min-w-0">
                            <span
                              className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold flex-shrink-0"
                              style={{
                                backgroundColor:
                                  isThisCorrect && showResult
                                    ? '#C8E6C9'
                                    : isSelectedWrong
                                    ? '#FFCDD2'
                                    : 'var(--bubble-user)',
                                color:
                                  isThisCorrect && showResult
                                    ? '#1B5E20'
                                    : isSelectedWrong
                                    ? 'var(--danger)'
                                    : 'var(--accent)',
                              }}
                            >
                              {letters[optIdx] || optIdx + 1}
                            </span>
                            <span className="truncate">{opt}</span>
                          </div>
                          {showResult && isThisCorrect && (
                            <CheckCircle
                              size={18}
                              style={{ color: '#2F9E6B' }}
                              className="ml-2 flex-shrink-0"
                            />
                          )}
                          {showResult && isSelectedWrong && (
                            <XCircle
                              size={18}
                              style={{ color: 'var(--danger)' }}
                              className="ml-2 flex-shrink-0"
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

            {/* ── Điền từ / Dịch / Sửa lỗi ── */}
            {(question.type === 'fill-blank' ||
              question.type === 'translation' ||
              question.type === 'error-correction') && (
              <div className="flex gap-2.5">
                <input
                  type="text"
                  value={userInput}
                  onChange={(e) => {
                    setUserInput(e.target.value);
                    saveProgressToStorage({ userInput: e.target.value });
                  }}
                  onCompositionStart={() => setIsComposing(true)}
                  onCompositionEnd={() => setIsComposing(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (isComposing || (e.nativeEvent as any).isComposing) return;
                      if (!showResult && userInput.trim()) checkAnswer(userInput);
                    }
                  }}
                  disabled={showResult}
                  placeholder={
                    question.type === 'translation'
                      ? 'Nhập bản dịch...'
                      : question.type === 'error-correction'
                      ? 'Nhập câu đúng...'
                      : 'Điền vào chỗ trống...'
                  }
                  className="flex-1 px-4 py-2.5 rounded-lg text-[15px] outline-none transition-colors"
                  style={{
                    backgroundColor: 'var(--card)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                />
                {!showResult && (
                  <button
                    type="button"
                    onClick={() => checkAnswer(userInput)}
                    disabled={!userInput.trim()}
                    className="px-5 py-2.5 font-semibold text-white rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                    style={{
                      backgroundColor: 'var(--accent)',
                      border: 'none',
                    }}
                    onMouseEnter={(e) => {
                      if (userInput.trim()) e.currentTarget.style.backgroundColor = 'var(--accent-hover)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--accent)';
                    }}
                  >
                    Kiểm tra
                  </button>
                )}
              </div>
            )}

            {/* ── Sắp xếp câu ── */}
            {question.type === 'sentence-ordering' && (
              <div className="space-y-3">
                <div
                  className="min-h-[56px] p-3 rounded-xl flex flex-wrap gap-2 items-center"
                  style={{
                    backgroundColor: '#FFF7EE',
                    border: '1.5px dashed var(--border)',
                  }}
                >
                  {orderedWords.length === 0 && (
                    <span style={{ color: 'var(--muted)', fontSize: '13px', fontStyle: 'italic' }}>
                      Nhấn vào các từ bên dưới để sắp xếp theo đúng thứ tự...
                    </span>
                  )}
                  {orderedWords.map((word, i) => (
                    <button
                      key={`${word}-${i}`}
                      type="button"
                      onClick={() => !showResult && removeWord(word, i)}
                      className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                      style={{
                        backgroundColor: 'var(--bubble-user)',
                        color: 'var(--text)',
                        border: '1px solid var(--accent)',
                      }}
                    >
                      {word}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  {availableWords.map((word, i) => (
                    <button
                      key={`avail-${word}-${i}`}
                      type="button"
                      onClick={() => !showResult && addWord(word, i)}
                      className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                      style={{
                        backgroundColor: 'var(--card)',
                        color: 'var(--text)',
                        border: '1px solid var(--border)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = 'var(--accent)';
                        e.currentTarget.style.backgroundColor = '#FFFBF6';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'var(--border)';
                        e.currentTarget.style.backgroundColor = 'var(--card)';
                      }}
                    >
                      {word}
                    </button>
                  ))}
                </div>

                {!showResult && orderedWords.length > 0 && (
                  <button
                    type="button"
                    onClick={() => checkAnswer(orderedWords.join(' '))}
                    className="px-5 py-2.5 font-semibold text-white rounded-lg transition-colors cursor-pointer"
                    style={{
                      backgroundColor: 'var(--accent)',
                      border: 'none',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent)')}
                  >
                    Kiểm tra câu
                  </button>
                )}
              </div>
            )}

            {/* ── Luyện nói ── */}
            {question.type === 'speaking' && (
              <div className="space-y-3">
                {question.audioText && (
                  <button
                    type="button"
                    onClick={() => playTTS(question.audioText!)}
                    disabled={playingTTS}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors"
                    style={{
                      backgroundColor: 'var(--card)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--accent)';
                      e.currentTarget.style.backgroundColor = 'var(--bubble-user)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border)';
                      e.currentTarget.style.backgroundColor = 'var(--card)';
                    }}
                  >
                    <Volume2 size={16} style={{ color: 'var(--accent)' }} />
                    <span>{playingTTS ? 'Đang phát hướng dẫn...' : 'Nghe hướng dẫn'}</span>
                  </button>
                )}

                <div className="flex items-center gap-3">
                  {!isRecording ? (
                    <button
                      type="button"
                      onClick={() => startSpeaking(selectedLanguage)}
                      className="flex items-center gap-2 px-5 py-2.5 font-semibold text-white rounded-lg transition-colors cursor-pointer"
                      style={{
                        backgroundColor: 'var(--accent)',
                        border: 'none',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent)')}
                    >
                      <Mic size={16} />
                      <span>Bắt đầu nói</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={stopSpeaking}
                      className="flex items-center gap-2 px-5 py-2.5 font-semibold rounded-lg transition-colors cursor-pointer"
                      style={{
                        backgroundColor: '#FDECEC',
                        color: 'var(--danger)',
                        border: '1px solid var(--danger)',
                      }}
                    >
                      <StopCircle size={16} />
                      <span>Dừng nói</span>
                    </button>
                  )}

                  {isRecording && (
                    <span className="text-sm font-medium animate-pulse" style={{ color: 'var(--danger)' }}>
                      ● Đang nghe...
                    </span>
                  )}
                </div>

                {spokenText && (
                  <div
                    className="p-3 rounded-xl text-sm"
                    style={{
                      backgroundColor: '#FFF7EE',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div className="text-xs font-semibold mb-1" style={{ color: 'var(--accent)' }}>
                      Bạn đã nói:
                    </div>
                    <p style={{ color: 'var(--text)' }}>{spokenText}</p>
                  </div>
                )}

                {spokenText && !showResult && (
                  <button
                    type="button"
                    onClick={() => checkAnswer(spokenText)}
                    className="px-5 py-2.5 font-semibold text-white rounded-lg transition-colors cursor-pointer"
                    style={{
                      backgroundColor: 'var(--accent)',
                      border: 'none',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent)')}
                  >
                    Nộp câu trả lời
                  </button>
                )}
              </div>
            )}

            {/* ── Kết quả + giải thích ── */}
            {showResult && question.type !== 'vocabulary' && (
              <div
                className="p-4 rounded-xl"
                style={{
                  backgroundColor: isLastAnswerCorrect ? '#E8F5EC' : '#FDECEC',
                  border: `1px solid ${isLastAnswerCorrect ? '#2F9E6B' : 'rgba(214, 69, 69, 0.3)'}`,
                }}
              >
                <div
                  className="flex items-center gap-2 font-semibold mb-2"
                  style={{ color: isLastAnswerCorrect ? '#1B5E20' : 'var(--danger)' }}
                >
                  {isLastAnswerCorrect ? (
                    <CheckCircle size={18} style={{ color: '#2F9E6B' }} />
                  ) : (
                    <XCircle size={18} style={{ color: 'var(--danger)' }} />
                  )}
                  <span>{isLastAnswerCorrect ? 'Chính xác!' : 'Chưa đúng'}</span>
                </div>

                {!isLastAnswerCorrect && (
                  <div className="text-sm mb-2" style={{ color: 'var(--text)' }}>
                    <span style={{ color: 'var(--muted)' }}>Đáp án đúng: </span>
                    <span className="font-semibold" style={{ color: '#1B5E20' }}>
                      {question.correctAnswer}
                    </span>
                  </div>
                )}

                {question.explanation && (
                  <div
                    className="text-sm pt-2 mt-2"
                    style={{
                      borderTop: '1px solid rgba(0, 0, 0, 0.08)',
                      color: 'var(--text)',
                    }}
                  >
                    <span className="font-semibold" style={{ color: 'var(--accent)' }}>
                      Giải thích:{' '}
                    </span>
                    <span style={{ color: 'var(--muted)' }}>{question.explanation}</span>
                  </div>
                )}
              </div>
            )}

            {/* ── Nút câu tiếp theo ── */}
            {(showResult || question.type === 'vocabulary') && (
              <button
                type="button"
                onClick={nextQuestion}
                className="w-full flex items-center justify-center gap-2 py-3 px-6 font-semibold text-white rounded-lg transition-colors cursor-pointer mt-2"
                style={{
                  backgroundColor: 'var(--accent)',
                  border: 'none',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent)')}
              >
                <span>{currentQ + 1 >= totalQ ? 'Xem kết quả' : 'Câu tiếp theo'}</span>
                <ArrowRight size={16} />
              </button>
            )}
          </div>
        ) : null}
      </ExerciseModal>

      {/* ── HỘP THOẠI XÁC NHẬN BỎ BÀI ── */}
      <ConfirmDialog
        isOpen={confirmDiscardOpen}
        title="Bỏ bài tập này?"
        message="Tiến độ làm bài sẽ bị mất. Bạn có chắc chắn muốn bỏ bài tập đang làm dở?"
        confirmText="Bỏ bài"
        cancelText="Hủy"
        isDanger={true}
        onConfirm={() => {
          setConfirmDiscardOpen(false);
          clearProgress();
        }}
        onCancel={() => setConfirmDiscardOpen(false)}
      />

      {/* ── HỘP THOẠI XÁC NHẬN TẠO BÀI MỚI KHI ĐANG CÓ BÀI DỞ ── */}
      <ConfirmDialog
        isOpen={confirmNewExerciseOpen}
        title="Bài tập đang làm dở"
        message="Bạn đang có bài tập làm dở. Tạo bài mới sẽ thay thế bài tập hiện tại."
        confirmText="Tạo bài mới"
        cancelText="Quay lại bài đang làm"
        isDanger={false}
        onConfirm={() => {
          setConfirmNewExerciseOpen(false);
          clearProgress();
          executeGenerateExercises();
        }}
        onCancel={() => {
          setConfirmNewExerciseOpen(false);
          setIsModalOpen(true);
        }}
      />
    </div>
  );
}
