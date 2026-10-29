'use client';
// components/FlashcardTab.tsx
// Tab Flashcard học từ vựng hiệu quả - Ghi nhớ lâu dài

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Layers,
  Volume2,
  RefreshCw,
  CheckCircle2,
  RotateCcw,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Check,
  AlertCircle,
  Loader2,
  Sparkles,
} from 'lucide-react';
import type { SupportedLanguage } from '@/lib/types';
import type { FlashcardItem, FlashcardMode } from '@/lib/vocab/types';
import { fetchVocabByLanguage } from '@/lib/vocab/service';
import { useLearnedVocab } from '@/lib/vocab/context';
import { speakVocabTerm } from '@/lib/vocab/tts';
import { FlagCN, FlagJP, FlagGB } from './MyVocabModal';
import MyVocabModal from './MyVocabModal';
import { createClient } from '@/lib/supabase/client';

// Thuật toán xáo trộn Fisher-Yates
function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export default function FlashcardTab() {
  const { counts, isLearned, markAsLearned, loadLearnedForLang } = useLearnedVocab();

  // Ngôn ngữ đang chọn (lưu trong localStorage theo user id)
  const [selectedLanguage, setSelectedLanguage] = useState<SupportedLanguage>('zh');
  const [userId, setUserId] = useState<string | null>(null);

  // Modal "Từ vựng của tôi"
  const [myVocabOpen, setMyVocabOpen] = useState(false);
  const myVocabBtnRef = useRef<HTMLButtonElement>(null);

  // Trạng thái tải từ vựng
  const [vocabList, setVocabList] = useState<FlashcardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Chế độ học: Tất cả | Chưa thuộc | Đã thuộc
  const [mode, setMode] = useState<FlashcardMode>('all');

  // Lượt học (Session) 20 thẻ
  const [sessionCards, setSessionCards] = useState<FlashcardItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isSessionComplete, setIsSessionComplete] = useState(false);
  const [sessionLearnedCount, setSessionLearnedCount] = useState(0);

  // Animation lật qua thẻ kế tiếp
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionDirection, setTransitionDirection] = useState<'next' | 'prev'>('next');
  const [transitionPhase, setTransitionPhase] = useState<'idle' | 'out' | 'in'>('idle');

  // TTS
  const [isPlayingTTS, setIsPlayingTTS] = useState(false);
  const stopTTSRef = useRef<(() => void) | null>(null);

  // Thông báo lỗi nhỏ nổi lên (không chặn thao tác)
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Thẻ flashcard element ref để focus
  const cardRef = useRef<HTMLDivElement>(null);

  // ─── 1. Khởi tạo User & Ngôn ngữ lưu trữ ─────────────────────
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id || 'guest';
      setUserId(uid);
      try {
        const savedLang = localStorage.getItem(`nalese_flashcard_lang_${uid}`);
        if (savedLang === 'zh' || savedLang === 'ja' || savedLang === 'en') {
          setSelectedLanguage(savedLang);
        }
      } catch {}
    });
  }, []);

  const changeLanguage = (lang: SupportedLanguage) => {
    if (lang === selectedLanguage) return;
    setSelectedLanguage(lang);
    if (stopTTSRef.current) {
      stopTTSRef.current();
      setIsPlayingTTS(false);
    }
    try {
      localStorage.setItem(`nalese_flashcard_lang_${userId || 'guest'}`, lang);
    } catch {}
  };

  // ─── 2. Tải từ vựng khi đổi ngôn ngữ ────────────────────────
  const loadVocab = useCallback(async (lang: SupportedLanguage) => {
    setLoading(true);
    setError(null);
    try {
      // Tải từ vựng và nạp danh sách id đã thuộc
      const [items] = await Promise.all([
        fetchVocabByLanguage(lang),
        loadLearnedForLang(lang),
      ]);
      setVocabList(items);
    } catch (err: any) {
      setError(err?.message || 'Không thể tải danh sách từ vựng. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }, [loadLearnedForLang]);

  useEffect(() => {
    loadVocab(selectedLanguage);
  }, [selectedLanguage, loadVocab]);

  // ─── 3. Khởi tạo Lượt học (20 thẻ ngẫu nhiên) ────────────────
  const startSession = useCallback(
    (targetMode = mode, sourceVocab = vocabList) => {
      if (sourceVocab.length === 0) {
        setSessionCards([]);
        setCurrentIndex(0);
        setIsFlipped(false);
        setIsSessionComplete(false);
        return;
      }

      let pool: FlashcardItem[] = [];

      if (targetMode === 'all') {
        // Tất cả: gồm cả từ đã thuộc, không loại từ đã thuộc
        pool = [...sourceVocab];
      } else if (targetMode === 'unlearned') {
        // Chỉ chưa thuộc
        pool = sourceVocab.filter((item) => !isLearned(selectedLanguage, item.id));
      } else if (targetMode === 'learned') {
        // Đã thuộc (tổng ôn)
        pool = sourceVocab.filter((item) => isLearned(selectedLanguage, item.id));
      }

      if (pool.length === 0) {
        setSessionCards([]);
        setCurrentIndex(0);
        setIsFlipped(false);
        setIsSessionComplete(false);
        return;
      }

      // Xáo trộn ngẫu nhiên Fisher-Yates
      const shuffled = shuffleArray(pool);
      // Lấy tối đa 20 thẻ
      const session = shuffled.slice(0, 20);

      setSessionCards(session);
      setCurrentIndex(0);
      setIsFlipped(false);
      setIsSessionComplete(false);
      setSessionLearnedCount(0);
    },
    [mode, vocabList, isLearned, selectedLanguage]
  );

  // Ref giữ phiên bản mới nhất của startSession — dùng trong effect
  // để tránh vòng lặp phụ thuộc (isLearned thay đổi → startSession mới
  // → effect chạy lại → reset session giữa chừng).
  const startSessionRef = useRef(startSession);
  useEffect(() => {
    startSessionRef.current = startSession;
  }, [startSession]);

  // Khi vocabList thay đổi hoặc đổi mode, dựng lại session.
  // KHÔNG theo dõi startSession — chỉ theo dõi vocabList và mode,
  // tránh session bị rebuild khi isLearned thay đổi (gây nhảy 2 từ).
  useEffect(() => {
    if (vocabList.length > 0) {
      startSessionRef.current(mode, vocabList);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vocabList, mode]);

  // ─── 4. Điều hướng thẻ với Animation lật qua (280ms) ──────────
  const navigateCard = useCallback(
    (direction: 'next' | 'prev') => {
      if (isTransitioning || sessionCards.length === 0) return;

      if (direction === 'next') {
        if (currentIndex >= sessionCards.length - 1) {
          // Hoàn thành lượt học
          setIsSessionComplete(true);
          return;
        }
      } else {
        if (currentIndex <= 0) return;
      }

      setIsTransitioning(true);
      setTransitionDirection(direction);
      setTransitionPhase('out');

      // Giai đoạn 1: Xoay ra (280ms)
      setTimeout(() => {
        if (direction === 'next') {
          setCurrentIndex((prev) => prev + 1);
        } else {
          setCurrentIndex((prev) => prev - 1);
        }
        setIsFlipped(false); // Thẻ mới luôn ở mặt trước
        setTransitionPhase('in');

        // Giai đoạn 2: Xoay vào (280ms)
        setTimeout(() => {
          setTransitionPhase('idle');
          setIsTransitioning(false);
        }, 280);
      }, 280);
    },
    [currentIndex, sessionCards.length, isTransitioning]
  );

  // Lật thẻ (Toggle Mặt trước / Mặt sau)
  const toggleFlip = useCallback(() => {
    if (isTransitioning) return;
    setIsFlipped((prev) => !prev);
  }, [isTransitioning]);

  // ─── 5. Đã thuộc / Chưa thuộc ───────────────────────────────
  const currentCard = sessionCards[currentIndex];

  const handleMarkLearned = async () => {
    if (!currentCard || isTransitioning) return;

    const cardId = currentCard.id;
    const wasAlreadyLearned = isLearned(selectedLanguage, cardId);

    if (!wasAlreadyLearned) {
      setSessionLearnedCount((prev) => prev + 1);
      try {
        await markAsLearned(selectedLanguage, cardId);
      } catch (err: any) {
        setSessionLearnedCount((prev) => Math.max(0, prev - 1));
        setToastMessage('Lỗi kết nối khi lưu trạng thái đã thuộc.');
        setTimeout(() => setToastMessage(null), 3000);
      }
    }

    // Chuyển sang thẻ kế tiếp
    navigateCard('next');
  };

  const handleMarkUnlearned = () => {
    if (!currentCard || isTransitioning) return;
    // Chưa thuộc: chỉ chuyển sang thẻ kế tiếp, không đổi dữ liệu
    navigateCard('next');
  };

  // ─── 6. Phát âm TTS ──────────────────────────────────────────
  const playCurrentTTS = useCallback(
    (e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (!currentCard) return;

      if (isPlayingTTS) {
        stopTTSRef.current?.();
        setIsPlayingTTS(false);
        return;
      }

      setIsPlayingTTS(true);
      stopTTSRef.current = speakVocabTerm(currentCard.term, selectedLanguage, 1.0, {
        onStart: () => setIsPlayingTTS(true),
        onEnd: () => setIsPlayingTTS(false),
        onError: () => setIsPlayingTTS(false),
      });
    },
    [currentCard, selectedLanguage, isPlayingTTS]
  );

  // Dừng TTS khi chuyển thẻ
  useEffect(() => {
    if (stopTTSRef.current) {
      stopTTSRef.current();
      setIsPlayingTTS(false);
    }
  }, [currentIndex, selectedLanguage]);

  // ─── 7. Phím tắt: Space lật thẻ, Mũi tên trái/phải đổi thẻ ────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (myVocabOpen) return;

      // Bỏ qua khi đang gõ vào ô nhập liệu
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        toggleFlip();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        navigateCard('next');
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        navigateCard('prev');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleFlip, navigateCard, myVocabOpen]);

  // Font theo ngôn ngữ
  const termFontClass =
    selectedLanguage === 'zh'
      ? 'font-sc'
      : selectedLanguage === 'ja'
      ? 'font-jp'
      : '';

  const totalLearnedCount = counts[selectedLanguage] ?? 0;
  const grandTotalLearned = counts.total ?? 0;

  // Tính toán transform xoay cho hiệu ứng chuyển thẻ
  const getCardTransitionStyle = () => {
    if (transitionPhase === 'out') {
      const deg = transitionDirection === 'next' ? -90 : 90;
      return {
        transform: `rotateY(${deg}deg)`,
        opacity: 0.7,
        transition: 'transform 280ms ease-in, opacity 280ms ease-in',
      };
    }
    if (transitionPhase === 'in') {
      return {
        transform: 'rotateY(0deg)',
        opacity: 1,
        transition: 'transform 280ms ease-out, opacity 280ms ease-out',
      };
    }
    return {};
  };

  return (
    <div className="w-full flex-1 flex flex-col justify-between max-w-5xl mx-auto px-4 py-3 sm:py-4 gap-3">
      {/* ── 1. HÀNG ĐẦU: TIÊU ĐỀ + CHỌN NGÔN NGỮ ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              backgroundColor: 'var(--bubble-user)',
              border: '1px solid var(--border)',
            }}
          >
            <Layers size={22} style={{ color: 'var(--accent)' }} />
          </div>
          <div>
            <h1 className="text-[22px] font-bold leading-tight" style={{ color: 'var(--text)' }}>
              Flashcard
            </h1>
            <p className="text-[14px]" style={{ color: 'var(--muted)' }}>
              Học từ vựng hiệu quả - Ghi nhớ lâu dài
            </p>
          </div>
        </div>

        {/* Ba nút ngôn ngữ dạng viên */}
        <div className="flex items-center gap-2 flex-wrap">
          {[
            { id: 'zh' as SupportedLanguage, label: 'Tiếng Trung', flag: <FlagCN /> },
            { id: 'ja' as SupportedLanguage, label: 'Tiếng Nhật', flag: <FlagJP /> },
            { id: 'en' as SupportedLanguage, label: 'Tiếng Anh', flag: <FlagGB /> },
          ].map((lang) => {
            const isSelected = selectedLanguage === lang.id;
            return (
              <button
                key={lang.id}
                type="button"
                onClick={() => changeLanguage(lang.id)}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[13px] font-medium transition-colors cursor-pointer"
                style={{
                  backgroundColor: isSelected ? 'var(--bubble-user)' : 'var(--card)',
                  border: isSelected ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                  color: 'var(--text)',
                }}
              >
                {lang.flag}
                <span>{lang.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 2. KHỐI CHÍNH (CARD TO) ── */}
      <div
        className="flex-1 flex flex-col justify-between p-4 sm:p-6 rounded-xl"
        style={{
          backgroundColor: 'var(--card)',
          border: '1px solid var(--border)',
          minHeight: '430px',
        }}
      >
        {/* Hàng trên: Bộ chọn chế độ nhỏ + Tiến độ + Nút Từ vựng của tôi */}
        <div className="flex flex-col gap-2.5 flex-shrink-0">
          <div className="flex items-center justify-between gap-2">
            {/* Bộ chọn chế độ */}
            <div
              className="inline-flex p-0.5 rounded-lg text-[12px] font-medium"
              style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}
            >
              {[
                { id: 'all' as FlashcardMode, label: 'Tất cả' },
                { id: 'unlearned' as FlashcardMode, label: 'Chưa thuộc' },
                { id: 'learned' as FlashcardMode, label: 'Đã thuộc' },
              ].map((m) => {
                const isCurrent = mode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMode(m.id)}
                    className="px-2.5 py-1 rounded-md transition-colors cursor-pointer"
                    style={{
                      backgroundColor: isCurrent ? 'var(--card)' : 'transparent',
                      color: isCurrent ? 'var(--accent)' : 'var(--muted)',
                      fontWeight: isCurrent ? 600 : 500,
                      boxShadow: isCurrent ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                    }}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>

            {/* Nút nhỏ Từ vựng của tôi */}
            <button
              ref={myVocabBtnRef}
              type="button"
              onClick={() => setMyVocabOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-semibold transition-colors cursor-pointer"
              style={{
                color: 'var(--accent)',
                backgroundColor: 'var(--bubble-user)',
                border: '1px solid var(--border)',
              }}
            >
              <BookOpen size={13} />
              <span>Từ vựng của tôi</span>
            </button>
          </div>

          {/* Thanh tiến độ */}
          {!loading && !error && sessionCards.length > 0 && !isSessionComplete && (
            <div className="flex items-center gap-3">
              <span className="text-[12px] font-semibold flex-shrink-0" style={{ color: 'var(--muted)' }}>
                {currentIndex + 1} / {sessionCards.length}
              </span>
              <div
                className="flex-1 h-1 rounded-full overflow-hidden"
                style={{ backgroundColor: 'var(--bg)' }}
              >
                <div
                  className="h-full transition-all duration-300 rounded-full"
                  style={{
                    backgroundColor: 'var(--accent)',
                    width: `${((currentIndex + 1) / sessionCards.length) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Khu vực giữa: Thẻ Flashcard */}
        <div className="flex-1 flex items-center justify-center py-3 my-auto">
          {loading ? (
            // Skeleton loading
            <div
              className="w-full max-w-[520px] h-[260px] rounded-2xl animate-pulse flex flex-col items-center justify-center gap-3"
              style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}
            >
              <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
              <span className="text-[14px]" style={{ color: 'var(--muted)' }}>
                Đang nạp từ vựng...
              </span>
            </div>
          ) : error ? (
            // Báo lỗi tải
            <div
              className="w-full max-w-[520px] p-6 rounded-2xl flex flex-col items-center justify-center text-center gap-3"
              style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}
            >
              <AlertCircle size={32} style={{ color: 'var(--danger)' }} />
              <p className="text-[14px] font-medium" style={{ color: 'var(--text)' }}>
                {error}
              </p>
              <button
                type="button"
                onClick={() => loadVocab(selectedLanguage)}
                className="px-4 py-2 rounded-xl text-[13px] font-semibold text-white cursor-pointer"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                Thử lại
              </button>
            </div>
          ) : vocabList.length === 0 ? (
            // Kho từ vựng ngôn ngữ chưa có dữ liệu
            <div
              className="w-full max-w-[520px] p-6 rounded-2xl flex flex-col items-center justify-center text-center gap-2"
              style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}
            >
              <BookOpen size={32} style={{ color: 'var(--muted)' }} />
              <p className="text-[15px] font-bold" style={{ color: 'var(--text)' }}>
                Kho từ vựng tiếng {selectedLanguage === 'zh' ? 'Trung' : selectedLanguage === 'ja' ? 'Nhật' : 'Anh'} chưa có dữ liệu
              </p>
              <p className="text-[13px]" style={{ color: 'var(--muted)' }}>
                Vui lòng nạp từ vựng vào hệ thống để bắt đầu học flashcard.
              </p>
            </div>
          ) : sessionCards.length === 0 ? (
            // Không có thẻ phù hợp với chế độ
            <div
              className="w-full max-w-[520px] p-6 rounded-2xl flex flex-col items-center justify-center text-center gap-3"
              style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}
            >
              <BookOpen size={30} style={{ color: 'var(--muted)' }} />
              <p className="text-[15px] font-bold" style={{ color: 'var(--text)' }}>
                {mode === 'learned'
                  ? 'Bạn chưa đánh dấu từ nào đã thuộc trong ngôn ngữ này.'
                  : 'Không có thẻ từ vựng nào trong danh sách.'}
              </p>
              {mode !== 'all' && (
                <button
                  type="button"
                  onClick={() => setMode('all')}
                  className="px-4 py-1.5 rounded-xl text-[13px] font-semibold text-white cursor-pointer"
                  style={{ backgroundColor: 'var(--accent)' }}
                >
                  Xem chế độ Tất cả
                </button>
              )}
            </div>
          ) : isSessionComplete ? (
            // Màn hình tóm tắt hoàn thành 20 thẻ
            <div
              className="w-full max-w-[520px] p-6 sm:p-8 rounded-2xl flex flex-col items-center justify-center text-center gap-4 animate-fade-in"
              style={{
                backgroundColor: 'var(--card)',
                border: '1px solid var(--border)',
                boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
              }}
            >
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ backgroundColor: 'var(--bubble-user)', border: '1px solid var(--border)' }}
              >
                <Sparkles size={28} style={{ color: 'var(--accent)' }} />
              </div>

              <div>
                <h3 className="text-[20px] font-bold mb-1" style={{ color: 'var(--text)' }}>
                  Hoàn thành lượt học!
                </h3>
                <p className="text-[14px]" style={{ color: 'var(--muted)' }}>
                  Bạn vừa hoàn thành 20 thẻ flashcard.
                </p>
              </div>

              <div
                className="w-full py-3 px-4 rounded-xl flex items-center justify-around"
                style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}
              >
                <div>
                  <span className="block text-[12px]" style={{ color: 'var(--muted)' }}>
                    Mới thuộc lượt này
                  </span>
                  <span className="text-[20px] font-bold" style={{ color: '#2F7D5B' }}>
                    +{sessionLearnedCount}
                  </span>
                </div>
                <div className="w-[1px] h-8" style={{ backgroundColor: 'var(--border)' }} />
                <div>
                  <span className="block text-[12px]" style={{ color: 'var(--muted)' }}>
                    Tổng đã thuộc ({selectedLanguage.toUpperCase()})
                  </span>
                  <span className="text-[20px] font-bold" style={{ color: 'var(--accent)' }}>
                    {totalLearnedCount}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3 w-full pt-1">
                <button
                  type="button"
                  onClick={() => startSession(mode)}
                  className="flex-1 h-[44px] rounded-xl text-[14px] font-bold text-white transition-opacity cursor-pointer flex items-center justify-center gap-1.5"
                  style={{ backgroundColor: 'var(--accent)' }}
                >
                  <RotateCcw size={15} />
                  <span>Học tiếp 20 thẻ</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMyVocabOpen(true)}
                  className="flex-1 h-[44px] rounded-xl text-[14px] font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                  style={{
                    backgroundColor: 'var(--card)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                  }}
                >
                  <BookOpen size={15} />
                  <span>Kho từ vựng</span>
                </button>
              </div>
            </div>
          ) : (
            // THẺ FLASHCARD 3D CHÍNH
            <div className="w-full flex items-center justify-center gap-3 sm:gap-6">
              {/* Nút tròn ‹ */}
              <button
                type="button"
                onClick={() => navigateCard('prev')}
                disabled={currentIndex === 0 || isTransitioning}
                className="hidden md:flex w-10 h-10 rounded-full items-center justify-center transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
                style={{
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--card)',
                  color: 'var(--text)',
                }}
                title="Thẻ trước (←)"
                aria-label="Về thẻ trước"
              >
                <ChevronLeft size={20} />
              </button>

              {/* Khung thẻ 3D */}
              <div
                className="w-full max-w-[520px] h-[260px] sm:h-[280px] select-none"
                style={{
                  perspective: '1000px',
                  ...getCardTransitionStyle(),
                }}
              >
                <div
                  ref={cardRef}
                  role="button"
                  tabIndex={0}
                  aria-label={isFlipped ? 'Thẻ đang ở mặt sau. Nhấn để quay lại.' : 'Thẻ đang ở mặt trước. Nhấn để xem nghĩa.'}
                  onClick={toggleFlip}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleFlip();
                    }
                  }}
                  className="relative w-full h-full rounded-2xl cursor-pointer transition-transform duration-450 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  style={{
                    transformStyle: 'preserve-3d',
                    transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                  }}
                >
                  {/* ── MẶT TRƯỚC (FRONT) ── */}
                  <div
                    className="absolute inset-0 rounded-2xl p-5 sm:p-6 flex flex-col justify-between"
                    style={{
                      backfaceVisibility: 'hidden',
                      backgroundColor: 'var(--card)',
                      border: '1px solid var(--accent)',
                      boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
                    }}
                  >
                    {/* Góc trên: Huy hiệu đã thuộc + Nút loa */}
                    <div className="flex items-center justify-between">
                      {isLearned(selectedLanguage, currentCard.id) ? (
                        <div
                          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold"
                          style={{
                            backgroundColor: '#E8F5EC',
                            border: '1px solid #BFE3CC',
                            color: '#2F7D5B',
                          }}
                        >
                          <Check size={12} strokeWidth={3} />
                          <span>Đã thuộc</span>
                        </div>
                      ) : (
                        <div />
                      )}

                      {/* Nút loa phát âm góc trên phải */}
                      <button
                        type="button"
                        onClick={playCurrentTTS}
                        className={`w-9 h-9 rounded-full flex items-center justify-center transition-transform hover:scale-105 active:scale-95 cursor-pointer ${
                          isPlayingTTS ? 'animate-pulse' : ''
                        }`}
                        style={{
                          backgroundColor: 'var(--bubble-user)',
                          border: '1px solid var(--border)',
                          color: 'var(--accent)',
                        }}
                        title="Phát âm"
                        aria-label="Phát âm từ đích"
                      >
                        <Volume2 size={18} />
                      </button>
                    </div>

                    {/* Nội dung chính mặt trước */}
                    <div className="flex flex-col items-center justify-center text-center my-auto px-2">
                      <span
                        className={`text-[44px] sm:text-[56px] font-bold leading-tight ${termFontClass}`}
                        style={{ color: 'var(--text)' }}
                      >
                        {currentCard.term}
                      </span>
                      {currentCard.reading && (
                        <span
                          className="text-[20px] sm:text-[22px] font-bold mt-1 tracking-wide"
                          style={{ color: 'var(--accent)' }}
                        >
                          {currentCard.reading}
                        </span>
                      )}
                      {currentCard.word_type && (
                        <span className="text-[14px] sm:text-[15px] mt-0.5" style={{ color: 'var(--muted)' }}>
                          {currentCard.word_type}
                        </span>
                      )}
                    </div>

                    {/* Gợi ý lật thẻ dưới đáy */}
                    <div
                      className="pt-2 flex items-center justify-center gap-1.5 text-[12px]"
                      style={{
                        borderTop: '1px solid var(--border)',
                        color: 'var(--muted)',
                      }}
                    >
                      <RefreshCw size={12} />
                      <span>Nhấn vào thẻ để xem nghĩa (Space)</span>
                    </div>
                  </div>

                  {/* ── MẶT SAU (BACK) ── */}
                  <div
                    className="absolute inset-0 rounded-2xl p-5 sm:p-6 flex flex-col justify-between"
                    style={{
                      backfaceVisibility: 'hidden',
                      transform: 'rotateY(180deg)',
                      backgroundColor: 'var(--card)',
                      border: '1px solid var(--accent)',
                      boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
                    }}
                  >
                    {/* Góc trên: Lặp lại từ đích nhỏ + Nút loa */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-baseline gap-2 min-w-0 pr-2">
                        <span className={`text-[18px] sm:text-[20px] font-bold truncate ${termFontClass}`} style={{ color: 'var(--muted)' }}>
                          {currentCard.term}
                        </span>
                        {currentCard.reading && (
                          <span className="text-[14px] font-medium truncate" style={{ color: 'var(--accent)' }}>
                            {currentCard.reading}
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={playCurrentTTS}
                        className={`w-9 h-9 rounded-full flex items-center justify-center transition-transform hover:scale-105 active:scale-95 cursor-pointer flex-shrink-0 ${
                          isPlayingTTS ? 'animate-pulse' : ''
                        }`}
                        style={{
                          backgroundColor: 'var(--bubble-user)',
                          border: '1px solid var(--border)',
                          color: 'var(--accent)',
                        }}
                        title="Phát âm"
                        aria-label="Phát âm từ đích"
                      >
                        <Volume2 size={18} />
                      </button>
                    </div>

                    {/* Nghĩa tiếng Việt cỡ lớn */}
                    <div className="flex flex-col items-center justify-center text-center my-auto px-4">
                      <p
                        className="text-[24px] sm:text-[28px] font-semibold leading-relaxed line-clamp-4"
                        style={{ color: 'var(--text)' }}
                      >
                        {currentCard.meaning_vi}
                      </p>
                    </div>

                    {/* Dòng gợi ý lật lại */}
                    <div
                      className="pt-2 flex items-center justify-center gap-1.5 text-[12px]"
                      style={{
                        borderTop: '1px solid var(--border)',
                        color: 'var(--muted)',
                      }}
                    >
                      <RefreshCw size={12} />
                      <span>Nhấn để quay lại mặt trước</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Nút tròn › */}
              <button
                type="button"
                onClick={() => navigateCard('next')}
                disabled={isTransitioning}
                className="hidden md:flex w-10 h-10 rounded-full items-center justify-center transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
                style={{
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--card)',
                  color: 'var(--text)',
                }}
                title="Thẻ sau (→)"
                aria-label="Sang thẻ kế tiếp"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          )}
        </div>

        {/* Nút điều hướng phụ trên màn hình hẹp (< 900px) */}
        {!loading && !error && sessionCards.length > 0 && !isSessionComplete && (
          <div className="flex md:hidden items-center justify-center gap-6 py-1">
            <button
              type="button"
              onClick={() => navigateCard('prev')}
              disabled={currentIndex === 0 || isTransitioning}
              className="w-10 h-10 rounded-full flex items-center justify-center border border-[var(--border)] bg-[var(--bg)] disabled:opacity-30"
              aria-label="Thẻ trước"
            >
              <ChevronLeft size={20} />
            </button>
            <span className="text-[13px] font-semibold" style={{ color: 'var(--muted)' }}>
              {currentIndex + 1} / {sessionCards.length}
            </span>
            <button
              type="button"
              onClick={() => navigateCard('next')}
              disabled={isTransitioning}
              className="w-10 h-10 rounded-full flex items-center justify-center border border-[var(--border)] bg-[var(--bg)] disabled:opacity-30"
              aria-label="Thẻ sau"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        )}

        {/* Hai nút hành động dưới thẻ: Đã thuộc & Chưa thuộc */}
        {!loading && !error && sessionCards.length > 0 && !isSessionComplete && (
          <div className="flex items-center justify-center gap-3 sm:gap-4 pt-2 flex-shrink-0">
            <button
              type="button"
              onClick={handleMarkLearned}
              disabled={isTransitioning}
              className="w-[160px] sm:w-[168px] h-[44px] rounded-xl text-[14px] font-bold flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-40"
              style={{
                backgroundColor: '#E8F5EC',
                border: '1px solid #BFE3CC',
                color: '#2F7D5B',
              }}
            >
              <CheckCircle2 size={18} />
              <span>Đã thuộc</span>
            </button>

            <button
              type="button"
              onClick={handleMarkUnlearned}
              disabled={isTransitioning}
              className="w-[160px] sm:w-[168px] h-[44px] rounded-xl text-[14px] font-bold flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-40"
              style={{
                backgroundColor: '#FDECEC',
                border: '1px solid #F2C4C4',
                color: 'var(--danger)',
              }}
            >
              <RotateCcw size={18} />
              <span>Chưa thuộc</span>
            </button>
          </div>
        )}
      </div>

      {/* ── 3. DƯỚI CÙNG: THANH KHO TỪ VỰNG CỦA TÔI ── */}
      <div
        className="w-full rounded-xl p-2.5 sm:p-3 flex items-center justify-center flex-shrink-0"
        style={{
          backgroundColor: 'var(--bubble-user)',
          border: '1px solid var(--border)',
        }}
      >
        <button
          type="button"
          onClick={() => setMyVocabOpen(true)}
          className="w-full max-w-md h-[44px] px-4 rounded-xl flex items-center justify-between gap-3 text-[14px] font-semibold transition-all cursor-pointer"
          style={{
            backgroundColor: 'var(--card)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
          }}
        >
          <div className="flex items-center gap-2">
            <BookOpen size={17} style={{ color: 'var(--accent)' }} />
            <span>Kho từ vựng của tôi</span>
          </div>

          <div className="flex items-center gap-2">
            <span
              className="px-2.5 py-0.5 rounded-full text-[12px] font-bold"
              style={{
                backgroundColor: 'var(--bg)',
                color: 'var(--accent)',
                border: '1px solid var(--border)',
              }}
            >
              {grandTotalLearned} từ
            </span>
            <ChevronRight size={16} style={{ color: 'var(--muted)' }} />
          </div>
        </button>
      </div>

      {/* Cửa sổ nổi Từ vựng của tôi */}
      <MyVocabModal
        isOpen={myVocabOpen}
        onClose={() => setMyVocabOpen(false)}
        initialLanguage={selectedLanguage}
        resumeButtonRef={myVocabBtnRef}
      />

      {/* Toast thông báo lỗi nhỏ */}
      {toastMessage && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-[13px] font-medium shadow-md"
          style={{
            backgroundColor: 'var(--danger)',
            color: '#FFFFFF',
          }}
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
}
