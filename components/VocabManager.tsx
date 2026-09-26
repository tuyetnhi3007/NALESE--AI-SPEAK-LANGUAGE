'use client';
// ============================================================
// components/VocabManager.tsx — Quản lý từ vựng (tiếng Việt)
// ============================================================

import React, { useState, useRef, useCallback } from 'react';
import { Upload, Download, Sparkles, CheckCircle, XCircle, Volume2, ChevronRight, RotateCcw, Trophy, FileText } from 'lucide-react';
import { useSettings } from './SettingsContext';
import { parseCSVText, parseXLSXBuffer, generateSampleCSV } from '@/lib/vocab-parser';
import { playBase64Audio } from '@/lib/audio-utils';
import type { VocabEntry, ExerciseSet, ExerciseQuestion, SupportedLanguage } from '@/lib/types';

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
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [exerciseState, setExerciseState] = useState<ExerciseState>('idle');
  const [exerciseSet, setExerciseSet] = useState<ExerciseSet | null>(null);
  const [currentQ, setCurrentQ] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [score, setScore] = useState(0);
  const [fillAnswer, setFillAnswer] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);

  const processFile = useCallback(async (file: File) => {
    setFileName(file.name);
    setParseErrors([]);

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

  const generateExercises = async () => {
    if (vocab.length === 0) return;
    setExerciseState('loading');
    setScore(0);
    setCurrentQ(0);
    setSelectedAnswer(null);
    setShowExplanation(false);

    try {
      const response = await fetch('/api/generate-exercises', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(settings.apiKey ? { 'x-api-key': settings.apiKey } : {}),
        },
        body: JSON.stringify({ vocab, language, exerciseCount: 10 }),
      });

      const data: ExerciseSet & { error?: string } = await response.json();
      if (data.error) {
        setParseErrors([data.error]);
        setExerciseState('idle');
        return;
      }

      setExerciseSet(data);
      setExerciseState('active');
    } catch {
      setParseErrors(['Không thể tạo bài tập. Kiểm tra API key và kết nối mạng.']);
      setExerciseState('idle');
    }
  };

  const pronounceWord = (entry: VocabEntry) => {
    const key = `${entry.index}`;
    setPlayingId(key);
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(entry.word);
      utterance.lang = 'zh-CN';
      utterance.rate = Math.max(0.5, Math.min(2.0, settings.speed || 1.0));
      if (window.speechSynthesis.getVoices) {
        const voices = window.speechSynthesis.getVoices();
        const zhVoice = voices.find(v => v.lang.toLowerCase().replace('_', '-') === 'zh-cn')
          || voices.find(v => v.lang.toLowerCase().startsWith('zh'));
        if (zhVoice) utterance.voice = zhVoice;
      }
      utterance.onend = () => setPlayingId(null);
      utterance.onerror = () => setPlayingId(null);
      window.speechSynthesis.speak(utterance);
    } else {
      setPlayingId(null);
    }
  };

  const question = exerciseSet?.questions[currentQ];

  const submitAnswer = (answer: string) => {
    if (selectedAnswer !== null || showExplanation) return;
    setSelectedAnswer(answer);
    setShowExplanation(true);
    const isCorrect = answer.trim().toLowerCase() === question?.correctAnswer.trim().toLowerCase();
    if (isCorrect) setScore((s) => s + 1);
  };

  const nextQuestion = () => {
    if (!exerciseSet) return;
    setSelectedAnswer(null);
    setShowExplanation(false);
    setFillAnswer('');
    if (currentQ + 1 >= exerciseSet.questions.length) {
      setExerciseState('complete');
    } else {
      setCurrentQ((q) => q + 1);
    }
  };

  const getOptionStyle = (opt: string) => {
    if (!showExplanation) return 'exercise-option';
    if (opt === question?.correctAnswer) return 'exercise-option correct';
    if (opt === selectedAnswer) return 'exercise-option incorrect';
    return 'exercise-option opacity-50';
  };

  const totalQ = exerciseSet?.questions.length || 0;
  const scorePercent = totalQ > 0 ? Math.round((score / totalQ) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Upload */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-display font-bold text-white flex items-center gap-2">
            <FileText size={18} className="text-purple-400" />
            Kho Từ Vựng
          </h2>
          <button onClick={downloadSampleCSV}
            className="flex items-center gap-1.5 text-xs py-1.5 px-3 rounded-lg transition-colors"
            style={{ color: '#7dd3fc', border: '1px solid rgba(56,189,248,0.2)', background: 'rgba(56,189,248,0.06)' }}>
            <Download size={12} /> Tải file mẫu
          </button>
        </div>

        <div className="mb-4 p-3 rounded-xl text-xs"
          style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)' }}>
          <div className="font-semibold text-purple-300 mb-1">Định dạng bắt buộc (4 cột):</div>
          <div className="text-white/60 font-mono text-xs overflow-x-auto">
            STT | Phiên âm (Pinyin/Romaji) | Từ đích | Nghĩa tiếng Việt
          </div>
        </div>

        <div
          className={`drop-zone p-8 text-center cursor-pointer transition-all ${isDragOver ? 'drag-over' : ''}`}
          onDrop={handleFileDrop}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onClick={() => fileInputRef.current?.click()}>
          <Upload size={32} className="mx-auto mb-3 text-purple-400/60" />
          <p className="text-white/60 text-sm font-medium">
            {fileName ? `📄 ${fileName}` : 'Kéo thả file .xlsx hoặc .csv vào đây'}
          </p>
          <p className="text-white/30 text-xs mt-1">hoặc nhấn để chọn file</p>
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls"
            onChange={handleFileSelect} className="hidden" id="vocab-file-input" />
        </div>

        {parseErrors.length > 0 && (
          <div className="mt-3 p-3 rounded-xl text-sm"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
            {parseErrors.map((e, i) => (
              <div key={i} className="flex items-start gap-2 text-red-300 text-xs">
                <XCircle size={12} className="mt-0.5 flex-shrink-0" /> {e}
              </div>
            ))}
          </div>
        )}

        {vocab.length > 0 && (
          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-emerald-400">
              <CheckCircle size={16} />
              <span>Đã tải {vocab.length} từ vựng thành công</span>
            </div>
            <button onClick={generateExercises} disabled={exerciseState === 'loading'}
              className="btn-primary flex items-center gap-2 py-2 px-4">
              {exerciseState === 'loading' ? (
                <><div className="loading-dots flex gap-1"><span /><span /><span /></div> Đang tạo...</>
              ) : (
                <><Sparkles size={14} /> Tạo bài tập</>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Vocab Table */}
      {vocab.length > 0 && (
        <div className="glass-card overflow-hidden">
          <div className="px-5 py-3 flex items-center justify-between"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <h3 className="text-sm font-semibold text-white/70">Danh sách từ vựng ({vocab.length} từ)</h3>
          </div>
          <div className="overflow-x-auto" style={{ maxHeight: 320 }}>
            <table className="w-full text-sm">
              <thead className="sticky top-0"
                style={{ background: 'rgba(8,8,15,0.9)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <tr>
                  {['#', 'Phiên âm', 'Từ đích', 'Nghĩa tiếng Việt', '🔊'].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-medium text-white/40">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vocab.map((entry) => (
                  <tr key={entry.index} className="border-b transition-colors hover:bg-white/3"
                    style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                    <td className="px-4 py-2.5 text-white/30 text-xs">{entry.index}</td>
                    <td className="px-4 py-2.5 text-blue-300 text-xs font-mono">{entry.pronunciation}</td>
                    <td className="px-4 py-2.5 text-white font-medium">{entry.word}</td>
                    <td className="px-4 py-2.5 text-white/60 text-xs">{entry.meaning}</td>
                    <td className="px-4 py-2.5">
                      <button onClick={() => pronounceWord(entry)} disabled={playingId === `${entry.index}`}
                        className="p-1 rounded hover:bg-purple-500/20 text-purple-400/60 hover:text-purple-400 transition-all disabled:opacity-50"
                        title="Phát âm">
                        <Volume2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Exercise Area */}
      {exerciseState === 'active' && question && (
        <div className="glass-card p-5" style={{ border: '1px solid rgba(139,92,246,0.2)' }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-white/50">Câu {currentQ + 1}/{totalQ}</span>
            <span className="text-xs font-medium text-purple-300">
              Điểm: {score}/{currentQ + (showExplanation ? 1 : 0)}
            </span>
          </div>
          <div className="progress-bar mb-4">
            <div className="progress-bar-fill" style={{ width: `${((currentQ) / totalQ) * 100}%` }} />
          </div>

          <div className="mb-4 p-4 rounded-xl"
            style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.15)' }}>
            <div className="text-xs text-purple-400 uppercase tracking-wider mb-1.5">
              {question.type === 'multiple-choice' ? 'Trắc nghiệm' :
               question.type === 'fill-blank' ? 'Điền từ' : 'Dịch thuật'}
            </div>
            <p className="text-white font-medium text-base">{question.question}</p>
          </div>

          {question.type === 'multiple-choice' && question.options && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
              {question.options.map((opt) => (
                <button key={opt} onClick={() => submitAnswer(opt)} disabled={showExplanation}
                  className={`${getOptionStyle(opt)} text-sm`}>
                  {opt}
                </button>
              ))}
            </div>
          )}

          {(question.type === 'fill-blank' || question.type === 'translation') && (
            <div className="flex gap-2 mb-4">
              <input type="text" value={fillAnswer}
                onChange={(e) => setFillAnswer(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitAnswer(fillAnswer)}
                disabled={showExplanation}
                placeholder="Nhập câu trả lời..."
                className="glass-input flex-1" />
              {!showExplanation && (
                <button onClick={() => submitAnswer(fillAnswer)} className="btn-primary px-4">Kiểm tra</button>
              )}
            </div>
          )}

          {showExplanation && (
            <div className={`p-3 rounded-xl mb-4 text-sm ${
              selectedAnswer?.trim().toLowerCase() === question.correctAnswer.trim().toLowerCase()
                ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-300'
                : 'bg-red-500/10 border border-red-500/25 text-red-300'
            }`}>
              <div className="font-semibold mb-1">
                {selectedAnswer?.trim().toLowerCase() === question.correctAnswer.trim().toLowerCase()
                  ? '✅ Chính xác!' : `❌ Đáp án đúng: ${question.correctAnswer}`}
              </div>
              <div className="text-white/70 text-xs">💡 {question.explanation}</div>
            </div>
          )}

          {showExplanation && (
            <button onClick={nextQuestion} className="btn-primary w-full flex items-center justify-center gap-2">
              {currentQ + 1 >= totalQ ? '🏁 Xem kết quả' : 'Câu tiếp theo'}
              <ChevronRight size={16} />
            </button>
          )}
        </div>
      )}

      {/* Complete */}
      {exerciseState === 'complete' && (
        <div className="glass-card p-8 text-center" style={{ border: '1px solid rgba(52,211,153,0.25)' }}>
          <Trophy size={48} className="mx-auto mb-4 text-yellow-400" />
          <h3 className="text-2xl font-display font-bold text-white mb-1">Hoàn thành!</h3>
          <p className="text-white/50 mb-4">Kết quả của bạn</p>
          <div className="text-6xl font-display font-black mb-2"
            style={{ background: 'linear-gradient(135deg, #34d399, #38bdf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            {scorePercent}%
          </div>
          <p className="text-white/60 mb-6">{score}/{totalQ} câu đúng</p>
          <div className="progress-bar mb-6" style={{ height: 8 }}>
            <div className="progress-bar-fill" style={{ width: `${scorePercent}%` }} />
          </div>
          <div className="text-lg mb-6">
            {scorePercent === 100 ? '🎉 Xuất sắc! Điểm tuyệt đối!' :
             scorePercent >= 80 ? '🌟 Rất giỏi! Tiếp tục phát huy!' :
             scorePercent >= 60 ? '👍 Khá tốt! Ôn thêm để cải thiện!' :
             '💪 Cần cố gắng thêm! Hãy thử lại!'}
          </div>
          <button onClick={generateExercises} className="btn-primary flex items-center gap-2 mx-auto">
            <RotateCcw size={14} /> Thử lại với câu hỏi mới
          </button>
        </div>
      )}
    </div>
  );
}
