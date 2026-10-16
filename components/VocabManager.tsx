'use client';
// ============================================================
// components/VocabManager.tsx — Quản lý từ vựng NALESE
// Thiết kế bảng màu kem đào (#FCF3EA, #C2693A) chuẩn 100%
// Chuẩn hóa câu hỏi trắc nghiệm & câu điền từ / dịch thuật (IME, tách phiên âm)
// ============================================================

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Upload,
  Download,
  Sparkles,
  CheckCircle2,
  XCircle,
  Lightbulb,
  Volume2,
  ChevronDown,
  RotateCcw,
  Trophy,
  FileText,
  FileSpreadsheet,
} from 'lucide-react';
import { useSettings } from './SettingsContext';
import { parseCSVText, parseXLSXBuffer, generateSampleCSV } from '@/lib/vocab-parser';
import {
  normalizeExerciseSet,
  formatExplanationLines,
  isFillCorrect,
  type NormalizedExerciseSet,
} from '@/lib/quiz-utils';
import type { VocabEntry, SupportedLanguage } from '@/lib/types';

interface VocabManagerProps {
  language: SupportedLanguage;
  onVocabLoaded?: (vocab: VocabEntry[]) => void;
}

type ExerciseState = 'idle' | 'loading' | 'active' | 'complete';

export default function VocabManager({ language, onVocabLoaded }: VocabManagerProps) {
  const { settings } = useSettings();

  const [vocab, setVocab] = useState<VocabEntry[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [fileName, setFileName] = useState('');
  const [fileSizeStr, setFileSizeStr] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Accordion bảng từ vựng (tự thu gọn khi bắt đầu bài tập)
  const [isTableOpen, setIsTableOpen] = useState(true);

  // Trạng thái bài tập
  const [exerciseState, setExerciseState] = useState<ExerciseState>('idle');
  const [rawExerciseData, setRawExerciseData] = useState<any>(null);
  const [exerciseSet, setExerciseSet] = useState<NormalizedExerciseSet | null>(null);
  const [currentQ, setCurrentQ] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [isLastAnswerCorrect, setIsLastAnswerCorrect] = useState(false);
  const [isPinyinWarning, setIsPinyinWarning] = useState(false);
  const [score, setScore] = useState(0);
  const [fillAnswer, setFillAnswer] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [exerciseError, setExerciseError] = useState<string | null>(null);

  // Ref cuộn mượt tới bài tập & input focus
  const exerciseRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const processFile = useCallback(async (file: File) => {
    setFileName(file.name);
    setFileSizeStr(formatFileSize(file.size));
    setParseErrors([]);
    setExerciseError(null);

    try {
      let result;
      if (file.name.endsWith('.csv') || file.type === 'text/csv') {
        const text = await file.text();
        result = parseCSVText(text);
      } else if (file.name.match(/\.xlsx?$/i)) {
        const buffer = await file.arrayBuffer();
        result = await parseXLSXBuffer(buffer);
      } else {
        setParseErrors(['Định dạng không hỗ trợ. Vui lòng tải lên file .csv hoặc .xlsx']);
        return;
      }

      if (result.errors.length > 0) setParseErrors(result.errors.slice(0, 5));
      if (result.data.length > 0) {
        setVocab(result.data);
        onVocabLoaded?.(result.data);
        setExerciseState('idle');
        setExerciseSet(null);
        setRawExerciseData(null);
        setIsTableOpen(true);
      } else {
        setParseErrors((e) => [...e, 'Không tìm thấy từ vựng hợp lệ. Kiểm tra lại định dạng file.']);
      }
    } catch (err) {
      setParseErrors([`Lỗi đọc file: ${err instanceof Error ? err.message : 'Không xác định'}`]);
    }
  }, [onVocabLoaded]);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const downloadSampleCSV = () => {
    const csv = generateSampleCSV();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nalese_mau_tu_vung.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const generateExercises = async (reshuffleExisting = false) => {
    if (reshuffleExisting && rawExerciseData) {
      // Xáo trộn lại các đáp án từ dữ liệu hiện có
      const normalized = normalizeExerciseSet(rawExerciseData, true);
      setExerciseSet(normalized);
      setExerciseState('active');
      setScore(0);
      setCurrentQ(0);
      setSelectedAnswer(null);
      setShowExplanation(false);
      setIsLastAnswerCorrect(false);
      setIsPinyinWarning(false);
      setFillAnswer('');
      setIsTableOpen(false);
      setTimeout(() => {
        exerciseRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
      return;
    }

    if (vocab.length === 0) return;
    setExerciseState('loading');
    setExerciseError(null);
    setScore(0);
    setCurrentQ(0);
    setSelectedAnswer(null);
    setShowExplanation(false);
    setIsLastAnswerCorrect(false);
    setIsPinyinWarning(false);
    setFillAnswer('');

    try {
      const response = await fetch('/api/generate-exercises', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(settings.apiKey ? { 'x-api-key': settings.apiKey } : {}),
        },
        body: JSON.stringify({ vocab, language, exerciseCount: 10 }),
      });

      const data = await response.json();
      if (data.error) {
        setExerciseError(data.error);
        setExerciseState('idle');
        return;
      }

      setRawExerciseData(data);
      // Chuẩn hóa dữ liệu bài tập qua quiz-utils (tách phiên âm, options sạch)
      const normalized = normalizeExerciseSet(data, false);
      setExerciseSet(normalized);
      setExerciseState('active');

      // Tự thu gọn bảng từ vựng để khu vực bài tập nổi bật
      setIsTableOpen(false);

      // Tự cuộn mượt tới khu vực bài tập
      setTimeout(() => {
        exerciseRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } catch {
      setExerciseError('Không thể tạo bài tập. Vui lòng kiểm tra API key và kết nối mạng.');
      setExerciseState('idle');
    }
  };

  const pronounceWord = (entry: VocabEntry) => {
    const key = `${entry.index}`;
    setPlayingId(key);
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(entry.word);
      utterance.lang = language === 'ja' ? 'ja-JP' : language === 'en' ? 'en-US' : 'zh-CN';
      utterance.rate = Math.max(0.5, Math.min(2.0, settings.speed || 1.0));
      if (window.speechSynthesis.getVoices) {
        const voices = window.speechSynthesis.getVoices();
        const targetPrefix = language === 'ja' ? 'ja' : language === 'en' ? 'en' : 'zh';
        const matchedVoice = voices.find((v) =>
          v.lang.toLowerCase().replace('_', '-').startsWith(targetPrefix)
        );
        if (matchedVoice) utterance.voice = matchedVoice;
      }
      utterance.onend = () => setPlayingId(null);
      utterance.onerror = () => setPlayingId(null);
      window.speechSynthesis.speak(utterance);
    } else {
      setPlayingId(null);
    }
  };

  const question = exerciseSet?.questions[currentQ];

  // Tự động focus ô nhập khi sang câu điền từ mới
  useEffect(() => {
    if (
      exerciseState === 'active' &&
      question &&
      (question.type === 'fill-blank' || question.type === 'translation') &&
      !showExplanation
    ) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [currentQ, exerciseState, question?.id, showExplanation]);

  const submitAnswer = (answer: string) => {
    if (selectedAnswer !== null || showExplanation || !question) return;
    const trimmed = (answer || '').trim();
    if (!trimmed) return;

    setSelectedAnswer(answer);
    setShowExplanation(true);

    let isCorrect = false;
    if (question.type === 'multiple-choice' || (question.options && question.options.length > 0)) {
      // answer là option id ("A", "B", "C", "D")
      isCorrect = answer.toUpperCase() === (question.correctId || 'A').toUpperCase();
      setIsLastAnswerCorrect(isCorrect);
      setIsPinyinWarning(false);
    } else {
      // Cho fill-blank hoặc translation dùng isFillCorrect chuẩn hóa
      const res = isFillCorrect(answer, question, language);
      isCorrect = res.isCorrect;
      setIsLastAnswerCorrect(isCorrect);
      setIsPinyinWarning(!!res.isPinyinWarning);
    }

    if (isCorrect) {
      setScore((prev) => prev + 1);
    }
  };

  const nextQuestion = () => {
    if (!exerciseSet) return;
    setSelectedAnswer(null);
    setShowExplanation(false);
    setIsLastAnswerCorrect(false);
    setIsPinyinWarning(false);
    setFillAnswer('');
    if (currentQ + 1 >= exerciseSet.questions.length) {
      setExerciseState('complete');
      setTimeout(() => {
        exerciseRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } else {
      setCurrentQ((q) => q + 1);
    }
  };

  const totalQ = exerciseSet?.questions.length || 0;
  const scorePercent = totalQ > 0 ? Math.round((score / totalQ) * 100) : 0;

  return (
    <div
      className="w-full flex flex-col gap-4"
      style={{
        maxWidth: '1200px',
        margin: '0 auto',
      }}
    >
      {/* ── CARD 1: KHO TỪ VỰNG & TẢI FILE ── */}
      <div
        className="w-full"
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '20px 24px',
        }}
      >
        {/* 1.1 Thanh tiêu đề */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <FileText size={20} style={{ color: 'var(--accent)' }} />
            <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text)' }}>
              Kho Từ Vựng
            </h2>
          </div>
          <button
            onClick={downloadSampleCSV}
            className="flex items-center gap-1.5 text-xs font-medium cursor-pointer transition-colors"
            style={{
              color: 'var(--accent)',
              border: '1px solid var(--border)',
              background: 'var(--card)',
              borderRadius: '8px',
              padding: '8px 14px',
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
            <Download size={14} /> Tải file mẫu
          </button>
        </div>

        {/* 1.2 Khung Định dạng bắt buộc (4 cột) */}
        <div
          className="mb-4"
          style={{
            background: '#FFF7EE',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            padding: '16px 20px',
          }}
        >
          <div
            style={{
              fontSize: '15px',
              fontWeight: 600,
              color: 'var(--text)',
              marginBottom: '10px',
            }}
          >
            Định dạng bắt buộc (4 cột):
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[
              'STT',
              'Phiên âm (Pinyin/Romaji)',
              'Từ đích',
              'Nghĩa tiếng Việt',
            ].map((col) => (
              <span
                key={col}
                className="font-sans"
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  padding: '4px 10px',
                  fontSize: '13px',
                  color: 'var(--muted)',
                }}
              >
                {col}
              </span>
            ))}
          </div>
        </div>

        {/* 1.3 Vùng tải file (dropzone) */}
        <div
          className="w-full text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2"
          style={{
            border: `1.5px dashed ${isDragOver || isHovered ? 'var(--accent)' : 'var(--border)'}`,
            background: isDragOver || isHovered ? '#FFF7EE' : '#FFFBF6',
            borderRadius: '12px',
            padding: '28px 24px',
            minHeight: '140px',
          }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onDrop={handleFileDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onClick={() => fileInputRef.current?.click()}
        >
          {!fileName ? (
            <>
              <Upload size={32} style={{ color: 'var(--accent)' }} />
              <p style={{ fontSize: '16px', color: 'var(--text)', fontWeight: 500 }}>
                Kéo thả file .xlsx hoặc .csv vào đây
              </p>
              <p style={{ fontSize: '13px', color: 'var(--muted)' }}>
                hoặc nhấn để chọn file
              </p>
            </>
          ) : (
            <>
              <FileSpreadsheet size={32} style={{ color: 'var(--accent)' }} />
              <p style={{ fontSize: '16px', color: 'var(--text)', fontWeight: 600 }}>
                {fileName}
              </p>
              {fileSizeStr && (
                <p style={{ fontSize: '13px', color: 'var(--muted)' }}>
                  {fileSizeStr}
                </p>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
                className="hover:underline cursor-pointer font-medium"
                style={{ fontSize: '13px', color: 'var(--accent)' }}
              >
                Đổi file
              </button>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileSelect}
            className="hidden"
            id="vocab-file-input"
          />
        </div>

        {/* 1.4 Lỗi đọc file */}
        {parseErrors.length > 0 && (
          <div
            className="mt-3 p-3 rounded-lg text-sm"
            style={{
              background: '#FDECEC',
              border: '1px solid rgba(214, 69, 69, 0.25)',
              color: 'var(--danger)',
            }}
          >
            {parseErrors.map((e, i) => (
              <div key={i} className="flex items-start gap-2 text-xs font-medium">
                <XCircle size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--danger)' }} />
                <span>{e}</span>
              </div>
            ))}
          </div>
        )}

        {/* 1.5 Toolbar trạng thái & Nút Tạo bài tập */}
        {vocab.length > 0 && (
          <div className="flex flex-col gap-2 mt-2">
            <div className="flex flex-wrap items-center justify-between gap-4 py-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={18} style={{ color: '#2F9E6B' }} />
                <span style={{ fontSize: '15px', color: '#2F7D5B', fontWeight: 500 }}>
                  Đã tải {vocab.length} từ vựng thành công
                </span>
              </div>

              <button
                onClick={() => generateExercises(false)}
                disabled={exerciseState === 'loading'}
                className="w-full sm:w-auto flex items-center justify-center gap-2 cursor-pointer transition-all disabled:cursor-not-allowed"
                style={{
                  height: '44px',
                  padding: '0 24px',
                  fontSize: '15px',
                  fontWeight: 600,
                  borderRadius: '10px',
                  backgroundColor: 'var(--accent)',
                  color: '#FFFFFF',
                  opacity: exerciseState === 'loading' ? 0.5 : 1,
                  border: 'none',
                }}
                onMouseEnter={(e) => {
                  if (exerciseState !== 'loading') e.currentTarget.style.backgroundColor = 'var(--accent-hover)';
                }}
                onMouseLeave={(e) => {
                  if (exerciseState !== 'loading') e.currentTarget.style.backgroundColor = 'var(--accent)';
                }}
              >
                {exerciseState === 'loading' ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Đang tạo...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={18} />
                    <span>Tạo bài tập</span>
                  </>
                )}
              </button>
            </div>

            {exerciseError && (
              <div
                className="flex items-center justify-between p-3 rounded-lg text-sm"
                style={{
                  background: '#FDECEC',
                  border: '1px solid rgba(214, 69, 69, 0.25)',
                  color: 'var(--danger)',
                }}
              >
                <span>{exerciseError}</span>
                <button
                  onClick={() => generateExercises(false)}
                  className="underline font-semibold cursor-pointer"
                >
                  Thử lại
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── CARD 2: KHU VỰC BÀI TẬP (NẰM DƯỚI TOOLBAR VÀ TRÊN BẢNG TỪ VỰNG) ── */}
      {exerciseState === 'active' && question && (
        <div
          ref={exerciseRef}
          className="w-full"
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            padding: '20px 24px',
          }}
        >
          {/* Header Bài tập */}
          <div
            className="flex items-center justify-between mb-4 pb-3"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <div className="flex items-center gap-2">
              <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text)' }}>
                Bài tập
              </h3>
              <span style={{ fontSize: '13px', color: 'var(--muted)' }}>
                (Câu {currentQ + 1}/{totalQ})
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--accent)' }}>
                Điểm: {score}/{currentQ + (showExplanation ? 1 : 0)}
              </span>
              <button
                onClick={() => generateExercises(true)}
                className="flex items-center gap-1.5 text-xs font-medium cursor-pointer transition-colors"
                style={{
                  color: 'var(--muted)',
                  padding: '6px 12px',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  background: 'var(--card)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--muted)')}
              >
                <RotateCcw size={12} /> Tạo lại
              </button>
            </div>
          </div>

          {/* Thanh tiến trình */}
          <div
            className="w-full mb-4 rounded-full overflow-hidden"
            style={{ height: '6px', backgroundColor: 'var(--border)' }}
          >
            <div
              className="h-full transition-all duration-300 rounded-full"
              style={{
                width: `${((currentQ) / totalQ) * 100}%`,
                backgroundColor: 'var(--accent)',
              }}
            />
          </div>

          {/* Khung câu hỏi */}
          <div
            className="mb-4"
            style={{
              background: '#FFF7EE',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              padding: '16px 20px',
            }}
          >
            <div
              className="text-xs font-semibold uppercase tracking-wider mb-1.5"
              style={{ color: 'var(--accent)' }}
            >
              {question.type === 'multiple-choice'
                ? 'Trắc nghiệm'
                : question.type === 'fill-blank'
                ? 'Điền từ'
                : 'Dịch thuật'}
            </div>
            <p style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text)' }}>
              {question.question}
            </p>
          </div>

          {/* Danh sách lựa chọn (Trắc nghiệm) */}
          {question.type === 'multiple-choice' && question.options && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              {question.options.map((opt) => {
                const isSelected = selectedAnswer === opt.id;
                const isCorrectOpt = opt.id === question.correctId;
                const isSelectedWrong = showExplanation && isSelected && !isCorrectOpt;

                let bg = 'var(--card)';
                let border = '1px solid var(--border)';
                let textColor = 'var(--text)';
                let opacity = 1;

                if (showExplanation) {
                  if (isCorrectOpt) {
                    bg = '#E8F5EC';
                    border = '1.5px solid #2F9E6B';
                    textColor = 'var(--text)';
                  } else if (isSelectedWrong) {
                    bg = '#FDECEC';
                    border = '1.5px solid var(--danger)';
                    textColor = 'var(--danger)';
                  } else {
                    bg = 'var(--card)';
                    border = '1px solid var(--border)';
                    textColor = 'var(--muted)';
                    opacity = 0.6;
                  }
                }

                return (
                  <button
                    key={opt.id}
                    onClick={() => submitAnswer(opt.id)}
                    disabled={showExplanation}
                    className="p-3 text-left transition-all font-medium flex items-center justify-between cursor-pointer disabled:cursor-default"
                    style={{
                      background: bg,
                      border: border,
                      color: textColor,
                      opacity: opacity,
                      borderRadius: '10px',
                      padding: '12px 16px',
                      fontSize: '14px',
                    }}
                    onMouseEnter={(e) => {
                      if (!showExplanation) {
                        e.currentTarget.style.borderColor = 'var(--accent)';
                        e.currentTarget.style.backgroundColor = 'var(--bubble-user)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!showExplanation) {
                        e.currentTarget.style.borderColor = 'var(--border)';
                        e.currentTarget.style.backgroundColor = 'var(--card)';
                      }
                    }}
                  >
                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                      <span
                        className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold flex-shrink-0"
                        style={{
                          background:
                            isCorrectOpt && showExplanation
                              ? '#C8E6C9'
                              : isSelectedWrong
                              ? '#FFCDD2'
                              : 'var(--border)',
                          color:
                            isCorrectOpt && showExplanation
                              ? '#1B5E20'
                              : isSelectedWrong
                              ? 'var(--danger)'
                              : 'var(--text)',
                        }}
                      >
                        {opt.id}
                      </span>
                      <span className="truncate">{opt.text}</span>
                    </div>

                    {showExplanation && isCorrectOpt && (
                      <CheckCircle2
                        size={18}
                        style={{ color: '#2F9E6B' }}
                        strokeWidth={1.75}
                        className="ml-2 flex-shrink-0"
                      />
                    )}

                    {showExplanation && isSelectedWrong && (
                      <XCircle
                        size={18}
                        style={{ color: 'var(--danger)' }}
                        strokeWidth={1.75}
                        className="ml-2 flex-shrink-0"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Ô điền từ / dịch thuật (Hỗ trợ IME và tự động focus) */}
          {(question.type === 'fill-blank' || question.type === 'translation') && (
            <div className="flex flex-col gap-2 mb-4">
              <div className="flex gap-2.5 items-center">
                <div className="relative flex-1">
                  <input
                    ref={inputRef}
                    type="text"
                    value={fillAnswer}
                    onChange={(e) => setFillAnswer(e.target.value)}
                    onCompositionStart={() => setIsComposing(true)}
                    onCompositionEnd={() => setIsComposing(false)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        // Không nộp bài nếu đang gõ bộ gõ IME (chốt chữ Hanzi / Kanji)
                        if (isComposing || (e.nativeEvent as any).isComposing) {
                          return;
                        }
                        if (!showExplanation && fillAnswer.trim()) {
                          submitAnswer(fillAnswer);
                        }
                      }
                    }}
                    disabled={showExplanation}
                    placeholder="Nhập đáp án..."
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className={`w-full outline-none transition-all ${
                      language === 'zh' ? 'font-sc' : language === 'ja' ? 'font-jp' : 'font-sans'
                    }`}
                    style={{
                      height: '48px',
                      padding: '12px 42px 12px 16px',
                      borderRadius: '10px',
                      fontSize: '18px',
                      color: 'var(--text)',
                      border: showExplanation
                        ? isLastAnswerCorrect
                          ? '1.5px solid #2F9E6B'
                          : '1.5px solid var(--danger)'
                        : '1px solid var(--border)',
                      backgroundColor: showExplanation
                        ? isLastAnswerCorrect
                          ? '#E8F5EC'
                          : '#FDECEC'
                        : 'var(--card)',
                    }}
                    onFocus={(e) => {
                      if (!showExplanation) e.currentTarget.style.borderColor = 'var(--accent)';
                    }}
                    onBlur={(e) => {
                      if (!showExplanation) e.currentTarget.style.borderColor = 'var(--border)';
                    }}
                  />

                  {showExplanation && (
                    <div className="absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center pointer-events-none">
                      {isLastAnswerCorrect ? (
                        <CheckCircle2 size={20} style={{ color: '#2F9E6B' }} strokeWidth={1.75} />
                      ) : (
                        <XCircle size={20} style={{ color: 'var(--danger)' }} strokeWidth={1.75} />
                      )}
                    </div>
                  )}
                </div>

                {!showExplanation && (
                  <button
                    onClick={() => submitAnswer(fillAnswer)}
                    disabled={!fillAnswer.trim()}
                    className="px-6 font-semibold text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                    style={{
                      height: '48px',
                      backgroundColor: 'var(--accent)',
                      borderRadius: '10px',
                      fontSize: '15px',
                    }}
                    onMouseEnter={(e) => {
                      if (fillAnswer.trim()) e.currentTarget.style.backgroundColor = 'var(--accent-hover)';
                    }}
                    onMouseLeave={(e) => {
                      if (fillAnswer.trim()) e.currentTarget.style.backgroundColor = 'var(--accent)';
                    }}
                  >
                    Kiểm tra
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Hộp giải thích / kết quả */}
          {showExplanation && (
            <div
              className="rounded-xl text-sm"
              style={{
                marginTop: '16px',
                marginBottom: '16px',
                padding: '12px 16px',
                borderRadius: '10px',
                background: isLastAnswerCorrect ? '#E8F5EC' : '#FDECEC',
                border: isLastAnswerCorrect
                  ? '1px solid #BFE3CC'
                  : '1px solid rgba(214, 69, 69, 0.25)',
              }}
            >
              {isLastAnswerCorrect ? (
                <div>
                  <div
                    className="flex items-center gap-2 mb-2 font-semibold"
                    style={{ color: '#2F7D5B', fontSize: '15px' }}
                  >
                    <CheckCircle2 size={18} strokeWidth={1.75} style={{ color: '#2F9E6B' }} />
                    <span>Chính xác!</span>
                  </div>

                  {/* Hiển thị phiên âm nếu có và không trùng lặp trong giải thích */}
                  {question.reading && !question.explanation?.includes(question.reading) && (
                    <div className="text-xs mb-2 font-medium" style={{ color: 'var(--muted)' }}>
                      Phiên âm: <span className="font-mono font-semibold" style={{ color: 'var(--accent)' }}>{question.reading}</span>
                    </div>
                  )}

                  {question.explanation && (
                    <div className="flex items-start gap-2 pt-1" style={{ color: 'var(--muted)', fontSize: '14px' }}>
                      <Lightbulb
                        size={16}
                        strokeWidth={1.75}
                        className="flex-shrink-0 mt-0.5"
                        style={{ color: '#2F7D5B' }}
                      />
                      <div className="flex flex-col gap-1 leading-relaxed">
                        {formatExplanationLines(question.explanation).map((line, idx) => (
                          <span key={idx}>{line}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div
                    className="flex items-center gap-2 mb-2 font-semibold"
                    style={{ color: 'var(--danger)', fontSize: '15px' }}
                  >
                    <XCircle size={18} strokeWidth={1.75} style={{ color: 'var(--danger)' }} />
                    <span>
                      Chưa đúng. Đáp án đúng:{' '}
                      {question.type === 'multiple-choice'
                        ? `${question.correctId ? `${question.correctId}. ` : ''}${question.correctAnswer}`
                        : `${question.answer || question.correctAnswer}${
                            question.reading && !(question.answer || question.correctAnswer).includes(question.reading)
                              ? ` (${question.reading})`
                              : ''
                          }`}
                    </span>
                  </div>

                  {/* Hiển thị bạn đã nhập gì để đối chiếu */}
                  {selectedAnswer && (
                    <div className="text-xs mb-2 font-medium" style={{ color: 'var(--muted)' }}>
                      Bạn đã nhập: <span className="font-semibold line-through text-[var(--danger)]">{selectedAnswer}</span>
                    </div>
                  )}

                  {/* Gợi ý nhẹ nếu nhập Pinyin/Romaji thay vì chữ Hán */}
                  {isPinyinWarning && (
                    <div
                      className="mb-2 p-2 rounded-lg text-xs font-medium"
                      style={{
                        background: '#FFF7EE',
                        border: '1px solid var(--border)',
                        color: 'var(--accent)',
                      }}
                    >
                      💡 Gợi ý: Bạn cần nhập chữ Hán / Kanji thay vì phiên âm Latin.
                    </div>
                  )}

                  {question.explanation && (
                    <div className="flex items-start gap-2 pt-1" style={{ color: 'var(--muted)', fontSize: '14px' }}>
                      <Lightbulb
                        size={16}
                        strokeWidth={1.75}
                        className="flex-shrink-0 mt-0.5"
                        style={{ color: 'var(--danger)' }}
                      />
                      <div className="flex flex-col gap-1 leading-relaxed">
                        {formatExplanationLines(question.explanation).map((line, idx) => (
                          <span key={idx}>{line}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Nút Câu tiếp theo */}
          {showExplanation && (
            <button
              onClick={nextQuestion}
              className="w-full flex items-center justify-center gap-2 font-semibold text-white transition-colors cursor-pointer"
              style={{
                height: '44px',
                padding: '0 24px',
                borderRadius: '10px',
                backgroundColor: 'var(--accent)',
                fontSize: '15px',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent)')}
            >
              <span>{currentQ + 1 >= totalQ ? '🏁 Xem kết quả' : 'Câu tiếp theo'}</span>
            </button>
          )}
        </div>
      )}

      {/* ── CARD 2B: HOÀN THÀNH BÀI TẬP ── */}
      {exerciseState === 'complete' && (
        <div
          ref={exerciseRef}
          className="w-full text-center"
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            padding: '28px 24px',
          }}
        >
          <Trophy size={48} className="mx-auto mb-3" style={{ color: 'var(--accent)' }} />
          <h3 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text)', marginBottom: '4px' }}>
            Hoàn thành!
          </h3>
          <p style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '16px' }}>
            Kết quả của bạn
          </p>
          <div
            className="font-black mb-2"
            style={{ fontSize: '56px', color: 'var(--accent)' }}
          >
            {scorePercent}%
          </div>
          <p style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '20px' }}>
            {score}/{totalQ} câu đúng
          </p>
          <div
            className="w-full max-w-md mx-auto mb-6 rounded-full overflow-hidden"
            style={{ height: '8px', backgroundColor: 'var(--border)' }}
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${scorePercent}%`,
                backgroundColor: 'var(--accent)',
              }}
            />
          </div>
          <div
            style={{
              fontSize: '16px',
              fontWeight: 600,
              color: 'var(--text)',
              marginBottom: '24px',
            }}
          >
            {scorePercent === 100
              ? '🎉 Xuất sắc! Điểm tuyệt đối!'
              : scorePercent >= 80
              ? '🌟 Rất giỏi! Tiếp tục phát huy!'
              : scorePercent >= 60
              ? '👍 Khá tốt! Ôn thêm để cải thiện!'
              : '💪 Cần cố gắng thêm! Hãy thử lại!'}
          </div>
          <button
            onClick={() => generateExercises(true)}
            className="inline-flex items-center gap-2 font-semibold text-white cursor-pointer transition-colors"
            style={{
              height: '44px',
              padding: '0 24px',
              borderRadius: '10px',
              backgroundColor: 'var(--accent)',
              fontSize: '15px',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent)')}
          >
            <RotateCcw size={16} /> Thử lại với câu hỏi mới
          </button>
        </div>
      )}

      {/* ── CARD 3: BẢNG DANH SÁCH TỪ VỰNG (CARD RIÊNG, ACCORDION) ── */}
      {vocab.length > 0 && (
        <div
          className="w-full overflow-hidden"
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
          }}
        >
          {/* Header Bảng kèm nút Thu gọn/Mở rộng */}
          <div
            onClick={() => setIsTableOpen((prev) => !prev)}
            className="flex items-center justify-between cursor-pointer select-none transition-colors"
            style={{
              padding: '16px 24px',
              borderBottom: isTableOpen ? '1px solid var(--border)' : 'none',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#FFFBF6')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text)' }}>
              Danh sách từ vựng ({vocab.length} từ)
            </h3>
            <button
              type="button"
              className="p-1 rounded text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
              aria-label={isTableOpen ? 'Thu gọn' : 'Mở rộng'}
            >
              <ChevronDown
                size={20}
                className={`transition-transform duration-200 ${isTableOpen ? 'rotate-180' : ''}`}
              />
            </button>
          </div>

          {/* Nội dung bảng */}
          {isTableOpen && (
            <div
              className="overflow-x-auto"
              style={{
                maxHeight: 'min(480px, 55vh)',
                overflowY: 'auto',
              }}
            >
              <table className="w-full border-collapse" style={{ minWidth: '600px' }}>
                <thead
                  className="sticky top-0 z-10"
                  style={{
                    background: 'var(--card)',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <tr>
                    <th
                      style={{
                        width: '64px',
                        textAlign: 'center',
                        padding: '12px 16px',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: 'var(--muted)',
                      }}
                    >
                      #
                    </th>
                    <th
                      style={{
                        width: '22%',
                        textAlign: 'left',
                        padding: '12px 16px',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: 'var(--muted)',
                      }}
                    >
                      Phiên âm
                    </th>
                    <th
                      style={{
                        width: '18%',
                        textAlign: 'left',
                        padding: '12px 16px',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: 'var(--muted)',
                      }}
                    >
                      Từ đích
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '12px 16px',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: 'var(--muted)',
                      }}
                    >
                      Nghĩa tiếng Việt
                    </th>
                    <th
                      style={{
                        width: '96px',
                        textAlign: 'center',
                        padding: '12px 16px',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: 'var(--muted)',
                      }}
                    >
                      Phát âm
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {vocab.map((entry) => (
                    <tr
                      key={entry.index}
                      className="transition-colors"
                      style={{
                        borderBottom: '1px solid var(--border)',
                        minHeight: '48px',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#FFFBF6')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <td
                        style={{
                          textAlign: 'center',
                          padding: '12px 16px',
                          fontSize: '14px',
                          color: 'var(--muted)',
                        }}
                      >
                        {entry.index}
                      </td>
                      <td
                        className="font-sans"
                        style={{
                          padding: '12px 16px',
                          fontSize: '15px',
                          color: 'var(--accent)',
                        }}
                      >
                        {entry.pronunciation}
                      </td>
                      <td
                        className={`${
                          language === 'zh'
                            ? 'font-sc'
                            : language === 'ja'
                            ? 'font-jp'
                            : 'font-sans'
                        }`}
                        style={{
                          padding: '12px 16px',
                          fontSize: '22px',
                          fontWeight: 700,
                          color: 'var(--text)',
                        }}
                      >
                        {entry.word}
                      </td>
                      <td
                        style={{
                          padding: '12px 16px',
                          fontSize: '15px',
                          color: 'var(--text)',
                        }}
                      >
                        {entry.meaning}
                      </td>
                      <td style={{ textAlign: 'center', padding: '12px 16px' }}>
                        <button
                          onClick={() => pronounceWord(entry)}
                          disabled={playingId === `${entry.index}`}
                          className="inline-flex items-center justify-center rounded-full transition-all cursor-pointer disabled:opacity-40"
                          style={{
                            width: '36px',
                            height: '36px',
                            color: 'var(--muted)',
                            backgroundColor: 'transparent',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--bubble-user)';
                            e.currentTarget.style.color = 'var(--accent)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent';
                            e.currentTarget.style.color = 'var(--muted)';
                          }}
                          title="Phát âm"
                        >
                          <Volume2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
