'use client';
// ============================================================
// components/TopicExercises.tsx — Bài tập học ngoại ngữ theo chủ đề
//
// Người dùng chọn ngôn ngữ + chủ đề + trình độ
// AI tạo bộ bài tập đa dạng (từ vựng, MCQ, điền từ, dịch, v.v.)
// Tất cả giải thích bằng tiếng Việt
// ============================================================

import React, { useState, useCallback, useRef } from 'react';
import {
  BookOpen, Sparkles, ChevronRight, RotateCcw, Trophy,
  Volume2, Mic, CheckCircle, XCircle, ArrowRight, Brain,
  StopCircle
} from 'lucide-react';
import { useSettings } from './SettingsContext';
import { playBase64Audio } from '@/lib/audio-utils';
import type {
  SupportedLanguage, LanguageLevel, ExerciseSet,
  ExerciseQuestion, TopicExerciseRequest
} from '@/lib/types';

interface TopicExercisesProps {
  selectedLanguage: SupportedLanguage;
  onLanguageChange: (lang: SupportedLanguage) => void;
}

// ─── Danh sách ngôn ngữ ─────────────────────────────────────
const LANGUAGES = [
  { code: 'en' as SupportedLanguage, name: 'Tiếng Anh', flag: 'ENG', native: 'English' },
  { code: 'zh' as SupportedLanguage, name: 'Tiếng Trung', flag: 'CN', native: '中文' },
  { code: 'ja' as SupportedLanguage, name: 'Tiếng Nhật', flag: 'JP', native: '日本語' },
];

// ─── Danh sách chủ đề ────────────────────────────────────────
const TOPICS = [
  { id: 'travel', name: 'Du lịch & Sân bay', icon: '✈️' },
  { id: 'daily_life', name: 'Cuộc sống hàng ngày', icon: '🏠' },
  { id: 'work', name: 'Công việc & Kinh doanh', icon: '💼' },
  { id: 'food', name: 'Ẩm thực & Nhà hàng', icon: '🍜' },
  { id: 'health', name: 'Sức khỏe & Bệnh viện', icon: '🏥' },
  { id: 'shopping', name: 'Mua sắm', icon: '🛍️' },
  { id: 'technology', name: 'Công nghệ', icon: '💻' },
  { id: 'education', name: 'Giáo dục & Học tập', icon: '📚' },
];

const LEVELS: { value: LanguageLevel; label: string; desc: string }[] = [
  { value: 'beginner', label: '🌱 Sơ cấp', desc: 'A1-A2' },
  { value: 'intermediate', label: '🌿 Trung cấp', desc: 'B1-B2' },
  { value: 'advanced', label: '🌳 Nâng cao', desc: 'C1-C2' },
];

// ─── Tên loại bài tập ────────────────────────────────────────
const EXERCISE_TYPE_LABELS: Record<string, string> = {
  'vocabulary': '📖 Từ vựng',
  'multiple-choice': '🔤 Trắc nghiệm',
  'fill-blank': '✏️ Điền vào chỗ trống',
  'translation': '🔄 Dịch thuật',
  'sentence-ordering': '🔀 Sắp xếp câu',
  'listening': '🎧 Nghe hiểu',
  'speaking': '🎤 Luyện nói',
  'error-correction': '🔍 Sửa lỗi',
};

// ─── Speaking exercises sử dụng Web Speech API ───────────────
interface SpeechRecognitionError extends Event {
  error: string;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSpeechRecognition(): any | null {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!SR) return null;
  return new SR();
}

const SPEECH_LANG: Record<SupportedLanguage, string> = {
  en: 'en-US', zh: 'zh-CN', ja: 'ja-JP',
};

// ─── Component chính ─────────────────────────────────────────
export default function TopicExercises({ selectedLanguage, onLanguageChange }: TopicExercisesProps) {
  const { settings } = useSettings();

  // Setup state
  const [topic, setTopic] = useState('');
  const [level, setLevel] = useState<LanguageLevel>('beginner');

  // Exercise state
  const [isGenerating, setIsGenerating] = useState(false);
  const [exerciseSet, setExerciseSet] = useState<ExerciseSet | null>(null);
  const [currentQ, setCurrentQ] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [userInput, setUserInput] = useState('');
  const [orderedWords, setOrderedWords] = useState<string[]>([]);
  const [availableWords, setAvailableWords] = useState<string[]>([]);
  const [showResult, setShowResult] = useState(false);
  const [score, setScore] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState('');

  // Speaking state
  const [isSpeaking, setIsSpeaking] = useState(false); // TTS đang phát
  const [isRecording, setIsRecording] = useState(false); // Đang ghi âm
  const [spokenText, setSpokenText] = useState('');
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<ReturnType<typeof getSpeechRecognition>>(null);

  const [playingTTS, setPlayingTTS] = useState(false);

  // ─── Tạo bài tập ──────────────────────────────────────────
  const generateExercises = useCallback(async () => {
    if (!topic) return;
    setIsGenerating(true);
    setError('');
    setExerciseSet(null);
    setCurrentQ(0);
    setScore(0);
    setIsComplete(false);
    setSelectedAnswer(null);
    setShowResult(false);
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
      // Init sentence ordering
      const firstQ = data.questions[0];
      if (firstQ?.type === 'sentence-ordering' && firstQ.words) {
        setAvailableWords([...firstQ.words].sort(() => Math.random() - 0.5));
        setOrderedWords([]);
      }
    } catch (err) {
      setError('Không thể kết nối server. Kiểm tra kết nối mạng.');
    } finally {
      setIsGenerating(false);
    }
  }, [selectedLanguage, topic, level, settings.apiKey]);

  // ─── Phát âm thanh TTS (Browser SpeechSynthesis) ───────────
  const playTTS = useCallback((text: string) => {
    if (!text || playingTTS) return;
    setPlayingTTS(true);
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const targetLang = selectedLanguage === 'zh' ? 'zh-CN' : (selectedLanguage === 'ja' ? 'ja-JP' : 'en-US');
      utterance.lang = targetLang;
      utterance.rate = Math.max(0.5, Math.min(2.0, settings.speed || 1.0));

      if (window.speechSynthesis.getVoices) {
        const voices = window.speechSynthesis.getVoices();
        const normalizedTarget = targetLang.toLowerCase().replace('_', '-');
        let voice = voices.find(v => v.lang.toLowerCase().replace('_', '-') === normalizedTarget);
        if (!voice && normalizedTarget.startsWith('zh')) {
          voice = voices.find(v => v.lang.toLowerCase().startsWith('zh'));
        }
        if (voice) utterance.voice = voice;
      }

      utterance.onend = () => setPlayingTTS(false);
      utterance.onerror = () => setPlayingTTS(false);
      window.speechSynthesis.speak(utterance);
    } else {
      setPlayingTTS(false);
    }
  }, [selectedLanguage, settings.speed, playingTTS]);

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
  const checkAnswer = useCallback((answer: string) => {
    if (showResult || !question) return;
    setSelectedAnswer(answer);
    setShowResult(true);

    const correct = question.correctAnswer.trim().toLowerCase();
    const given = answer.trim().toLowerCase();
    const isCorrect = given === correct || correct.includes(given) || given.includes(correct.slice(0, 8));
    if (isCorrect) setScore((s) => s + 1);
  }, [showResult, question]);

  // ─── Next question ─────────────────────────────────────────
  const nextQuestion = useCallback(() => {
    if (!exerciseSet) return;
    setSelectedAnswer(null);
    setShowResult(false);
    setUserInput('');
    setSpokenText('');

    const nextIdx = currentQ + 1;
    if (nextIdx >= totalQ) {
      setIsComplete(true);
      return;
    }

    setCurrentQ(nextIdx);
    const nextQ = exerciseSet.questions[nextIdx];
    if (nextQ?.type === 'sentence-ordering' && nextQ.words) {
      setAvailableWords([...nextQ.words].sort(() => Math.random() - 0.5));
      setOrderedWords([]);
    } else {
      setAvailableWords([]);
      setOrderedWords([]);
    }
  }, [exerciseSet, currentQ, totalQ]);

  // ─── Sentence ordering ────────────────────────────────────
  const addWord = (word: string, idx: number) => {
    setOrderedWords((prev) => [...prev, word]);
    setAvailableWords((prev) => prev.filter((_, i) => i !== idx));
  };
  const removeWord = (word: string, idx: number) => {
    setAvailableWords((prev) => [...prev, word]);
    setOrderedWords((prev) => prev.filter((_, i) => i !== idx));
  };

  const scorePercent = totalQ > 0 ? Math.round((score / totalQ) * 100) : 0;

  // ─── Render bộ chọn ──────────────────────────────────────
  if (!exerciseSet && !isGenerating) {
    return (
      <div className="space-y-4">
        {/* Tiêu đề */}
        <div className="glass-card p-5">
          <h2 className="text-xl font-display font-bold text-white mb-1 flex items-center gap-2">
            <Brain size={20} className="text-purple-400" />
            Bài Tập Theo Chủ Đề
          </h2>
          <p className="text-white/50 text-sm">AI tạo bài tập học ngoại ngữ phù hợp với chủ đề và trình độ của bạn.</p>
        </div>

        {/* Chọn ngôn ngữ */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">1. Chọn ngôn ngữ</h3>
          <div className="grid grid-cols-3 gap-3">
            {LANGUAGES.map((l) => (
              <button key={l.code} onClick={() => onLanguageChange(l.code)}
                className={`p-4 rounded-2xl border text-center transition-all ${
                  selectedLanguage === l.code
                    ? 'border-purple-500/60 bg-purple-500/15'
                    : 'border-white/8 bg-white/3 hover:border-white/20 hover:bg-white/5'
                }`}>
                <div className="text-2xl mb-1 font-sans font-bold tracking-tight">{l.flag}</div>
                <div className={`font-semibold text-sm ${selectedLanguage === l.code ? 'text-purple-200' : 'text-white/70'}`}>{l.name}</div>
                <div className="text-xs text-white/30 mt-0.5">{l.native}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Chọn trình độ */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">2. Chọn trình độ</h3>
          <div className="flex gap-3">
            {LEVELS.map((l) => (
              <button key={l.value} onClick={() => setLevel(l.value)}
                className={`flex-1 py-3 px-2 rounded-xl border text-center transition-all ${
                  level === l.value
                    ? 'border-purple-500/60 bg-purple-500/15 text-purple-200'
                    : 'border-white/8 bg-white/3 text-white/50 hover:text-white/80 hover:border-white/20'
                }`}>
                <div className="font-semibold text-sm">{l.label}</div>
                <div className="text-xs text-white/40 mt-0.5">{l.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Chọn chủ đề */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">3. Chọn chủ đề</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {TOPICS.map((t) => (
              <button key={t.id} onClick={() => setTopic(t.id)}
                className={`p-4 rounded-2xl border-[1.5px] flex flex-col items-center justify-center text-center transition-all ${
                  topic === t.id
                    ? 'border-purple-500 bg-purple-100/50 shadow-sm'
                    : 'border-gray-300 hover:border-purple-400 bg-transparent'
                }`}>
                <div className="text-2xl mb-2">{t.icon}</div>
                <div className={`font-semibold text-sm leading-tight ${topic === t.id ? 'text-purple-700' : 'text-gray-700'}`}>
                  {t.name}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 rounded-xl text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#fca5a5' }}>
            ⚠️ {error}
          </div>
        )}

        {/* Nút tạo bài tập */}
        <button
          onClick={generateExercises}
          disabled={!topic}
          className="btn-primary w-full py-4 text-base font-semibold flex items-center justify-center gap-2"
        >
          <Sparkles size={18} />
          {!topic ? 'Chọn chủ đề để bắt đầu' : 'Tạo Bài Tập'}
        </button>
      </div>
    );
  }

  // ─── Đang tạo bài tập ─────────────────────────────────────
  if (isGenerating) {
    return (
      <div className="glass-card p-12 text-center">
        <div className="text-5xl mb-4">🤖</div>
        <h3 className="text-xl font-display font-bold text-white mb-2">Đang tạo bài tập...</h3>
        <p className="text-white/50 mb-6">AI đang soạn bài tập phù hợp cho bạn</p>
        <div className="loading-dots flex gap-2 justify-center" style={{ color: '#a78bfa' }}>
          <span /><span /><span />
        </div>
      </div>
    );
  }

  // ─── Hoàn thành ───────────────────────────────────────────
  if (isComplete) {
    return (
      <div className="glass-card p-8 text-center" style={{ border: '1px solid rgba(52,211,153,0.25)' }}>
        <Trophy size={52} className="mx-auto mb-4 text-yellow-400" />
        <h3 className="text-2xl font-display font-bold text-white mb-1">Hoàn thành bài tập!</h3>
        <p className="text-white/50 mb-4">Kết quả của bạn</p>
        <div className="text-6xl font-display font-black mb-2"
          style={{ background: 'linear-gradient(135deg, #34d399, #38bdf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          {scorePercent}%
        </div>
        <p className="text-white/60 mb-2">{score}/{totalQ} câu đúng</p>
        <div className="progress-bar mb-6 mt-4" style={{ height: 8 }}>
          <div className="progress-bar-fill" style={{ width: `${scorePercent}%` }} />
        </div>
        <div className="text-lg mb-6">
          {scorePercent === 100 ? '🎉 Xuất sắc! Bạn đã trả lời đúng tất cả!' :
           scorePercent >= 80 ? '🌟 Rất tốt! Tiếp tục phát huy!' :
           scorePercent >= 60 ? '👍 Khá tốt! Ôn tập thêm để cải thiện!' :
           '💪 Cần cố gắng thêm! Hãy ôn tập và thử lại!'}
        </div>
        <div className="flex gap-3 justify-center">
          <button onClick={generateExercises} className="btn-primary flex items-center gap-2">
            <RotateCcw size={14} /> Bài tập mới
          </button>
          <button
            onClick={() => { setExerciseSet(null); setIsComplete(false); setScore(0); }}
            className="btn-secondary flex items-center gap-2"
          >
            Chọn chủ đề khác
          </button>
        </div>
      </div>
    );
  }

  // ─── Bài tập đang làm ─────────────────────────────────────
  if (!question) return null;

  const isCorrectAnswer = () => {
    if (!selectedAnswer && question.type !== 'speaking') return false;
    const ans = question.type === 'sentence-ordering'
      ? orderedWords.join(' ')
      : question.type === 'speaking'
      ? spokenText
      : selectedAnswer || userInput;
    const correct = question.correctAnswer.trim().toLowerCase();
    const given = (ans || '').trim().toLowerCase();
    return given === correct || correct.includes(given.slice(0, 6)) || given.includes(correct.slice(0, 6));
  };

  return (
    <div className="space-y-4">
      {/* Header bài tập */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="font-display font-bold text-white">{exerciseSet?.title}</h3>
            <p className="text-xs text-white/40 mt-0.5">
              {LANGUAGES.find(l => l.code === exerciseSet?.language)?.flag}{' '}
              {LANGUAGES.find(l => l.code === exerciseSet?.language)?.name}
            </p>
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold text-purple-300">{score}/{currentQ + (showResult ? 1 : 0)}</div>
            <div className="text-xs text-white/40">Câu {currentQ + 1}/{totalQ}</div>
          </div>
        </div>
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${(currentQ / totalQ) * 100}%` }} />
        </div>
      </div>

      {/* Câu hỏi */}
      <div className="glass-card p-5" style={{ border: '1px solid rgba(139,92,246,0.2)' }}>
        {/* Loại bài */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium mb-3"
          style={{ background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.25)', color: '#c4b5fd' }}>
          {EXERCISE_TYPE_LABELS[question.type] || question.type}
        </div>

        {/* Nội dung câu hỏi */}
        <div className="mb-4 p-4 rounded-xl"
          style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.15)' }}>
          <p className="text-white font-medium leading-relaxed">{question.question}</p>
        </div>

        {/* ── Từ vựng ── */}
        {question.type === 'vocabulary' && (
          <div className="mb-4 p-4 rounded-xl text-sm whitespace-pre-line"
            style={{ background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.2)', color: '#e0f2fe' }}>
            {question.correctAnswer}
          </div>
        )}

        {/* ── Trắc nghiệm / Nghe hiểu ── */}
        {(question.type === 'multiple-choice' || question.type === 'listening') && question.options && (
          <>
            {question.type === 'listening' && question.audioText && (
              <button onClick={() => playTTS(question.audioText!)}
                disabled={playingTTS}
                className="flex items-center gap-2 mb-4 btn-secondary py-2 px-4 text-sm">
                <Volume2 size={16} />
                {playingTTS ? 'Đang phát...' : 'Phát câu nghe'}
              </button>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
              {question.options.map((opt) => {
                let cls = 'exercise-option text-sm';
                if (showResult) {
                  if (opt === question.correctAnswer) cls = 'exercise-option correct text-sm';
                  else if (opt === selectedAnswer) cls = 'exercise-option incorrect text-sm';
                  else cls = 'exercise-option opacity-40 text-sm';
                }
                return (
                  <button key={opt} onClick={() => checkAnswer(opt)} disabled={showResult} className={cls}>
                    {opt}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* ── Điền từ / Dịch ── */}
        {(question.type === 'fill-blank' || question.type === 'translation' || question.type === 'error-correction') && (
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !showResult && checkAnswer(userInput)}
              disabled={showResult}
              placeholder={
                question.type === 'translation' ? 'Nhập bản dịch...' :
                question.type === 'error-correction' ? 'Nhập câu đúng...' :
                'Điền vào chỗ trống...'
              }
              className="glass-input flex-1"
            />
            {!showResult && (
              <button onClick={() => checkAnswer(userInput)} className="btn-primary px-4">
                Kiểm tra
              </button>
            )}
          </div>
        )}

        {/* ── Sắp xếp câu ── */}
        {question.type === 'sentence-ordering' && (
          <div className="mb-4 space-y-3">
            {/* Câu đã sắp xếp */}
            <div className="min-h-12 p-3 rounded-xl flex flex-wrap gap-2"
              style={{ background: 'rgba(139,92,246,0.06)', border: '2px dashed rgba(139,92,246,0.3)' }}>
              {orderedWords.length === 0 && (
                <span className="text-white/30 text-sm italic">Nhấn vào các từ bên dưới để sắp xếp...</span>
              )}
              {orderedWords.map((word, i) => (
                <button key={`${word}-${i}`} onClick={() => !showResult && removeWord(word, i)}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium"
                  style={{ background: 'rgba(139,92,246,0.3)', color: '#c4b5fd', border: '1px solid rgba(139,92,246,0.5)' }}>
                  {word}
                </button>
              ))}
            </div>
            {/* Các từ có sẵn */}
            <div className="flex flex-wrap gap-2">
              {availableWords.map((word, i) => (
                <button key={`avail-${word}-${i}`} onClick={() => !showResult && addWord(word, i)}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
                  style={{ background: 'rgba(255,255,255,0.06)', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.12)' }}>
                  {word}
                </button>
              ))}
            </div>
            {!showResult && orderedWords.length > 0 && (
              <button onClick={() => checkAnswer(orderedWords.join(' '))} className="btn-primary">
                Kiểm tra câu
              </button>
            )}
          </div>
        )}

        {/* ── Luyện nói ── */}
        {question.type === 'speaking' && (
          <div className="mb-4 space-y-3">
            {question.audioText && (
              <button onClick={() => playTTS(question.audioText!)} disabled={playingTTS}
                className="flex items-center gap-2 btn-secondary py-2 px-4 text-sm">
                <Volume2 size={16} />
                {playingTTS ? 'Đang phát hướng dẫn...' : 'Nghe hướng dẫn'}
              </button>
            )}
            {/* Ghi âm */}
            <div className="flex items-center gap-3">
              {!isRecording ? (
                <button onClick={() => startSpeaking(selectedLanguage)}
                  className="flex items-center gap-2 btn-primary py-2 px-4">
                  <Mic size={16} /> Bắt đầu nói
                </button>
              ) : (
                <button onClick={stopSpeaking}
                  className="flex items-center gap-2 py-2 px-4 rounded-lg font-semibold"
                  style={{ background: 'rgba(239,68,68,0.2)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.4)' }}>
                  <StopCircle size={16} /> Dừng
                </button>
              )}
              {isRecording && (
                <span className="text-sm text-red-400 animate-pulse">● Đang nghe...</span>
              )}
            </div>
            {spokenText && (
              <div className="p-3 rounded-xl text-sm"
                style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)' }}>
                <div className="text-xs text-purple-400 mb-1">Bạn đã nói:</div>
                <p className="text-white">{spokenText}</p>
              </div>
            )}
            {spokenText && !showResult && (
              <button onClick={() => checkAnswer(spokenText)} className="btn-primary">
                Nộp câu trả lời
              </button>
            )}
          </div>
        )}

        {/* ── Kết quả + giải thích ── */}
        {showResult && question.type !== 'vocabulary' && (
          <div className={`p-4 rounded-xl mb-4 ${isCorrectAnswer()
            ? 'bg-emerald-500/10 border border-emerald-500/25'
            : 'bg-red-500/10 border border-red-500/25'
          }`}>
            <div className={`flex items-center gap-2 font-semibold mb-2 ${isCorrectAnswer() ? 'text-emerald-300' : 'text-red-300'}`}>
              {isCorrectAnswer() ? <CheckCircle size={16} /> : <XCircle size={16} />}
              {isCorrectAnswer() ? 'Chính xác! 🎉' : 'Chưa đúng'}
            </div>
            {!isCorrectAnswer() && (
              <div className="text-sm text-white/80 mb-2">
                <span className="text-white/50">Đáp án đúng: </span>
                <span className="text-emerald-300 font-medium">{question.correctAnswer}</span>
              </div>
            )}
            <div className="text-sm text-white/60 border-t border-white/10 pt-2 mt-2">
              <span className="text-yellow-300/80">💡 Giải thích: </span>
              {question.explanation}
            </div>
          </div>
        )}

        {/* ── Nút tiếp theo ── */}
        {(showResult || question.type === 'vocabulary') && (
          <button onClick={nextQuestion}
            className="btn-primary w-full flex items-center justify-center gap-2">
            {currentQ + 1 >= totalQ ? '🏁 Xem kết quả' : 'Câu tiếp theo'}
            <ArrowRight size={16} />
          </button>
        )}

        {/* Nút TTS cho câu hỏi thông thường */}
        {question.type !== 'listening' && question.type !== 'speaking' && (
          <div className="flex justify-end mt-2">
            <button onClick={() => playTTS(question.question)} disabled={playingTTS}
              className="text-xs text-purple-400/50 hover:text-purple-400 flex items-center gap-1 transition-colors">
              <Volume2 size={12} /> Nghe câu hỏi
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
