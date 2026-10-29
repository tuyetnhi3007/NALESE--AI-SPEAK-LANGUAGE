'use client';
// components/MyVocabModal.tsx
// Cửa sổ nổi "Từ vựng của tôi" và xuất file Excel

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  BookOpen,
  X,
  Search,
  Download,
  MoreVertical,
  Volume2,
  Trash2,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import type { SupportedLanguage } from '@/lib/types';
import type { LearnedWordItem } from '@/lib/vocab/types';
import { fetchLearnedWordsDetailed } from '@/lib/vocab/service';
import { useLearnedVocab } from '@/lib/vocab/context';
import { exportLearnedWordsToExcel } from '@/lib/vocab/excel';
import { speakVocabTerm } from '@/lib/vocab/tts';

interface MyVocabModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialLanguage?: SupportedLanguage;
  resumeButtonRef?: React.RefObject<HTMLButtonElement | null>;
}

// ─── SVG cờ tròn nhỏ ──────────────────────────────────────────
export function FlagCN() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0 rounded-full" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#DE2910" />
      <polygon points="12,5 13.5,9.5 18,9.5 14.5,12 16,16.5 12,14 8,16.5 9.5,12 6,9.5 10.5,9.5" fill="#FFDE00" />
    </svg>
  );
}

export function FlagJP() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0 rounded-full" aria-hidden="true">
      <circle cx="12" cy="12" r="11.5" fill="#FFFFFF" stroke="#EBDDCF" strokeWidth="1" />
      <circle cx="12" cy="12" r="6" fill="#BC002D" />
    </svg>
  );
}

export function FlagGB() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0 rounded-full" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#012169" />
      <path d="M0,0 L24,24 M24,0 L0,24" stroke="#FFFFFF" strokeWidth="4" />
      <path d="M0,0 L24,24 M24,0 L0,24" stroke="#C8102E" strokeWidth="2" />
      <path d="M12,0 L12,24 M0,12 L24,12" stroke="#FFFFFF" strokeWidth="6" />
      <path d="M12,0 L12,24 M0,12 L24,12" stroke="#C8102E" strokeWidth="3" />
    </svg>
  );
}

// Hàm chuẩn hóa chuỗi để tìm kiếm không dấu
function removeAccents(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export default function MyVocabModal({
  isOpen,
  onClose,
  initialLanguage = 'zh',
  resumeButtonRef,
}: MyVocabModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  const { counts, unmarkAsLearned, markAsLearned, refreshCounts } = useLearnedVocab();

  const [activeLang, setActiveLang] = useState<SupportedLanguage>(initialLanguage);
  const [dataByLang, setDataByLang] = useState<Record<SupportedLanguage, LearnedWordItem[] | null>>({
    zh: null,
    ja: null,
    en: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tìm kiếm & phân trang
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;

  // Menu ba chấm
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // Xuất file Excel
  const [isExporting, setIsExporting] = useState(false);

  // Toast thông báo & Hoàn tác
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [undoItem, setUndoItem] = useState<{ lang: SupportedLanguage; item: LearnedWordItem } | null>(null);
  const undoTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cập nhật tab khi mở modal theo initialLanguage
  useEffect(() => {
    if (isOpen) {
      setActiveLang(initialLanguage);
      setSearchQuery('');
      setCurrentPage(1);
      setError(null);
    }
  }, [isOpen, initialLanguage]);

  // Khóa cuộn trang và quản lý Focus
  useEffect(() => {
    if (!isOpen) return;

    previousActiveElementRef.current = document.activeElement as HTMLElement | null;

    const mainScrollEl = document.querySelector('.app-shell') as HTMLElement | null;
    const prevOverflow = mainScrollEl?.style.overflowY;
    if (mainScrollEl) {
      mainScrollEl.style.overflowY = 'hidden';
    }

    const timer = setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 50);

    return () => {
      clearTimeout(timer);
      if (mainScrollEl) {
        mainScrollEl.style.overflowY = prevOverflow || 'auto';
      }
      if (resumeButtonRef?.current) {
        resumeButtonRef.current.focus();
      } else if (previousActiveElementRef.current) {
        previousActiveElementRef.current.focus();
      }
    };
  }, [isOpen, resumeButtonRef]);

  // Focus trap & phím Esc
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activeMenuId) {
          setActiveMenuId(null);
          return;
        }
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab' && panelRef.current) {
        const focusableElements = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const focusable = Array.from(focusableElements).filter(
          (el) => !el.hasAttribute('disabled') && el.offsetParent !== null
        );

        if (focusable.length === 0) return;

        const firstElement = focusable[0];
        const lastElement = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, activeMenuId, onClose]);

  // Tải dữ liệu cho ngôn ngữ đang chọn
  const loadData = useCallback(async (lang: SupportedLanguage, force = false) => {
    if (!force && dataByLang[lang] !== null) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const items = await fetchLearnedWordsDetailed(lang);
      setDataByLang((prev) => ({ ...prev, [lang]: items }));
    } catch (err: any) {
      setError(err?.message || 'Không thể tải danh sách từ vựng. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }, [dataByLang]);

  useEffect(() => {
    if (isOpen) {
      loadData(activeLang);
    }
  }, [isOpen, activeLang, loadData]);

  // Đổi tab ngôn ngữ
  const handleTabChange = (lang: SupportedLanguage) => {
    if (lang === activeLang) return;
    setActiveLang(lang);
    setSearchQuery('');
    setCurrentPage(1);
    setActiveMenuId(null);
  };

  // Đóng action menu khi bấm ra ngoài
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.action-menu-container')) {
        setActiveMenuId(null);
      }
    };
    if (activeMenuId) {
      document.addEventListener('click', handleOutsideClick);
    }
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [activeMenuId]);

  // Xóa cache khi đóng cửa sổ
  useEffect(() => {
    if (!isOpen) {
      setDataByLang({ zh: null, ja: null, en: null });
      setActiveMenuId(null);
      setToastMessage(null);
      setUndoItem(null);
      if (undoTimeoutRef.current) {
        clearTimeout(undoTimeoutRef.current);
      }
    }
  }, [isOpen]);

  // Lọc dữ liệu theo từ khóa tìm kiếm (không phân biệt hoa/thường, không phân biệt dấu)
  const currentItems = dataByLang[activeLang] || [];

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return currentItems;

    const q = removeAccents(searchQuery.trim());
    return currentItems.filter((item) => {
      const info = item.vocab_items;
      if (!info) return false;
      const term = removeAccents(info.term || '');
      const reading = removeAccents(info.reading || '');
      const meaning = removeAccents(info.meaning_vi || '');
      return term.includes(q) || reading.includes(q) || meaning.includes(q);
    });
  }, [currentItems, searchQuery]);

  // Phân trang
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const validCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (validCurrentPage - 1) * PAGE_SIZE;
  const pageItems = filteredItems.slice(startIndex, startIndex + PAGE_SIZE);

  // Bỏ đánh dấu từ đã thuộc
  const handleUnmark = async (item: LearnedWordItem) => {
    setActiveMenuId(null);

    // Cập nhật lạc quan trong bảng hiện tại
    setDataByLang((prev) => ({
      ...prev,
      [activeLang]: (prev[activeLang] || []).filter((i) => i.vocab_id !== item.vocab_id),
    }));

    try {
      await unmarkAsLearned(activeLang, item.vocab_id);

      // Thiết lập thông báo Hoàn tác trong 5 giây
      setUndoItem({ lang: activeLang, item });
      setToastMessage('Đã bỏ khỏi kho từ vựng.');

      if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
      undoTimeoutRef.current = setTimeout(() => {
        setToastMessage(null);
        setUndoItem(null);
      }, 5000);
    } catch {
      // Hoàn tác lại danh sách nếu thất bại
      setDataByLang((prev) => ({
        ...prev,
        [activeLang]: [item, ...(prev[activeLang] || [])],
      }));
      setToastMessage('Lỗi kết nối, không thể bỏ đánh dấu.');
      setTimeout(() => setToastMessage(null), 3000);
    }
  };

  // Hoàn tác
  const handleUndo = async () => {
    if (!undoItem) return;
    const { lang, item } = undoItem;
    setToastMessage(null);
    setUndoItem(null);
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);

    // Cập nhật lạc quan lại danh sách
    setDataByLang((prev) => ({
      ...prev,
      [lang]: [item, ...(prev[lang] || [])],
    }));

    try {
      await markAsLearned(lang, item.vocab_id);
    } catch {
      setDataByLang((prev) => ({
        ...prev,
        [lang]: (prev[lang] || []).filter((i) => i.vocab_id !== item.vocab_id),
      }));
    }
  };

  // Xuất file Excel
  const handleExport = async () => {
    let itemsToExport = dataByLang[activeLang];
    if (!itemsToExport) {
      setIsExporting(true);
      try {
        itemsToExport = await fetchLearnedWordsDetailed(activeLang);
        setDataByLang((prev) => ({ ...prev, [activeLang]: itemsToExport }));
      } catch (err: any) {
        setToastMessage(`Lỗi tải dữ liệu xuất: ${err?.message || 'Thử lại sau'}`);
        setTimeout(() => setToastMessage(null), 3000);
        setIsExporting(false);
        return;
      }
      setIsExporting(false);
    }

    if (!itemsToExport || itemsToExport.length === 0) {
      setToastMessage('Không có từ vựng nào để xuất.');
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }

    try {
      setIsExporting(true);
      exportLearnedWordsToExcel(itemsToExport, activeLang);
      setToastMessage('Xuất file Excel thành công.');
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err: any) {
      setToastMessage(`Lỗi xuất file: ${err?.message || 'Không thể tạo file'}`);
      setTimeout(() => setToastMessage(null), 3000);
    } finally {
      setIsExporting(false);
    }
  };

  // Phát âm
  const handlePlayTTS = (term: string) => {
    speakVocabTerm(term, activeLang);
    setActiveMenuId(null);
  };

  if (!isOpen) return null;

  const currentLangCount = counts[activeLang] ?? 0;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[40] flex items-center justify-center p-2 sm:p-4"
      style={{ top: 'var(--header-h)' }}
    >
      {/* Nền mờ phía sau: rgba(43,33,24,0.35), không dùng blur */}
      <div
        className="absolute inset-0 transition-opacity duration-200"
        style={{ backgroundColor: 'rgba(43, 33, 24, 0.35)' }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel nổi chính */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="my-vocab-modal-title"
        className="relative z-10 w-full flex flex-col overflow-hidden transition-all duration-200"
        style={{
          backgroundColor: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: '16px',
          maxWidth: '980px',
          height: 'calc(100% - 24px)',
          maxHeight: 'calc(100% - 24px)',
          boxShadow: '0 8px 32px rgba(43, 33, 24, 0.12)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Tiêu đề panel ── */}
        <div
          className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3.5 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{
                backgroundColor: 'var(--bubble-user)',
                border: '1px solid var(--border)',
              }}
            >
              <BookOpen size={18} style={{ color: 'var(--accent)' }} />
            </div>
            <div className="min-w-0">
              <h2
                id="my-vocab-modal-title"
                className="text-[20px] font-bold leading-tight truncate"
                style={{ color: 'var(--text)' }}
              >
                Từ vựng của tôi
              </h2>
              <p className="text-[13px] sm:text-[14px] leading-snug truncate" style={{ color: 'var(--muted)' }}>
                Danh sách từ vựng bạn đã học thuộc
              </p>
            </div>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg transition-colors cursor-pointer"
            style={{
              color: 'var(--muted)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--bg)',
            }}
            title="Đóng (Esc)"
            aria-label="Đóng cửa sổ"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Ba tab ngôn ngữ ── */}
        <div
          className="flex items-center gap-2 px-4 sm:px-6 py-2.5 flex-shrink-0 overflow-x-auto no-scrollbar"
          style={{
            borderBottom: '1px solid var(--border)',
            backgroundColor: 'var(--bg)',
          }}
        >
          {[
            { id: 'zh' as SupportedLanguage, label: 'Tiếng Trung', flag: <FlagCN /> },
            { id: 'ja' as SupportedLanguage, label: 'Tiếng Nhật', flag: <FlagJP /> },
            { id: 'en' as SupportedLanguage, label: 'Tiếng Anh', flag: <FlagGB /> },
          ].map((tab) => {
            const isActive = activeLang === tab.id;
            const count = counts[tab.id] ?? 0;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id)}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[13px] font-medium transition-colors cursor-pointer flex-shrink-0"
                style={{
                  backgroundColor: isActive ? 'var(--accent)' : 'var(--card)',
                  color: isActive ? '#FFFFFF' : 'var(--text)',
                  border: isActive ? '1px solid var(--accent)' : '1px solid var(--border)',
                }}
              >
                {tab.flag}
                <span>{tab.label}</span>
                <span
                  className="px-1.5 py-0.2 rounded-full text-[11px] font-semibold"
                  style={{
                    backgroundColor: isActive ? 'rgba(255, 255, 255, 0.2)' : 'var(--bubble-user)',
                    color: isActive ? '#FFFFFF' : 'var(--muted)',
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── Hàng tìm kiếm + Nút Xuất Excel ── */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 px-4 sm:px-6 py-3 flex-shrink-0">
          <div className="relative flex-1">
            <Search
              size={17}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--muted)' }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Tìm kiếm từ vựng, phiên âm, nghĩa..."
              className="w-full pl-10 pr-4 h-[44px] rounded-xl text-[14px] transition-colors focus:outline-none"
              style={{
                backgroundColor: 'var(--bg)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
              }}
            />
          </div>

          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting || currentLangCount === 0}
            className="flex items-center justify-center gap-2 px-4 h-[44px] rounded-xl text-[14px] font-semibold transition-all cursor-pointer flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--accent)',
              color: 'var(--accent)',
            }}
          >
            {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            <span>{isExporting ? 'Đang tạo file...' : 'Xuất Excel'}</span>
          </button>
        </div>

        {/* ── Bảng nội dung từ vựng ── */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-2 min-h-0">
          {loading ? (
            // Skeleton loading
            <div className="space-y-2 py-4">
              {[...Array(6)].map((_, i) => (
                <div
                  key={i}
                  className="h-[48px] rounded-lg animate-pulse"
                  style={{ backgroundColor: 'var(--bg)' }}
                />
              ))}
            </div>
          ) : error ? (
            // Lỗi tải dữ liệu
            <div className="py-12 flex flex-col items-center justify-center text-center">
              <AlertCircle size={36} className="mb-2" style={{ color: 'var(--danger)' }} />
              <p className="text-[15px] font-medium mb-3" style={{ color: 'var(--text)' }}>
                {error}
              </p>
              <button
                type="button"
                onClick={() => loadData(activeLang, true)}
                className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white cursor-pointer"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                Thử lại
              </button>
            </div>
          ) : currentItems.length === 0 ? (
            // Chưa có từ nào
            <div className="py-16 flex flex-col items-center justify-center text-center px-4">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3"
                style={{ backgroundColor: 'var(--bubble-user)', border: '1px solid var(--border)' }}
              >
                <BookOpen size={24} style={{ color: 'var(--accent)' }} />
              </div>
              <h3 className="text-[16px] font-bold mb-1" style={{ color: 'var(--text)' }}>
                Chưa có từ vựng
              </h3>
              <p className="text-[14px] max-w-sm mb-4" style={{ color: 'var(--muted)' }}>
                Bạn chưa học thuộc từ tiếng{' '}
                {activeLang === 'zh' ? 'Trung' : activeLang === 'ja' ? 'Nhật' : 'Anh'} nào. Hãy bấm "Đã thuộc" ở thẻ
                flashcard để lưu từ vào đây.
              </p>
            </div>
          ) : filteredItems.length === 0 ? (
            // Không tìm thấy kết quả
            <div className="py-14 flex flex-col items-center justify-center text-center px-4">
              <Search size={32} className="mb-2" style={{ color: 'var(--muted)' }} />
              <p className="text-[15px] font-medium" style={{ color: 'var(--text)' }}>
                Không tìm thấy từ vựng phù hợp
              </p>
              <p className="text-[13px]" style={{ color: 'var(--muted)' }}>
                Thử tìm với từ khóa hoặc cách viết khác.
              </p>
            </div>
          ) : (
            // Bảng dữ liệu
            <div
              className="overflow-x-auto rounded-xl"
              style={{ border: '1px solid var(--border)' }}
            >
              <table className="w-full text-left border-collapse min-w-[500px] sm:min-w-[620px]">
                <thead>
                  <tr
                    className="sticky top-0 z-10"
                    style={{
                      backgroundColor: 'var(--bg)',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <th className="py-3 px-3.5 text-[13px] font-bold w-[50px] text-center" style={{ color: 'var(--muted)' }}>
                      STT
                    </th>
                    <th className="py-3 px-3.5 text-[13px] font-bold w-[28%]" style={{ color: 'var(--muted)' }}>
                      Từ vựng
                    </th>
                    <th className="py-3 px-3.5 text-[13px] font-bold w-[24%]" style={{ color: 'var(--muted)' }}>
                      Phiên âm
                    </th>
                    <th className="py-3 px-3.5 text-[13px] font-bold" style={{ color: 'var(--muted)' }}>
                      Nghĩa tiếng Việt
                    </th>
                    <th className="hidden sm:table-cell py-3 px-3.5 text-[13px] font-bold w-[110px]" style={{ color: 'var(--muted)' }}>
                      Ngày học
                    </th>
                    <th className="py-3 px-2 w-[44px] text-center" style={{ color: 'var(--muted)' }}>
                      <span className="sr-only">Thao tác</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((item, idx) => {
                    const info = item.vocab_items;
                    const stt = startIndex + idx + 1;
                    const isMenuOpen = activeMenuId === item.vocab_id;
                    const termFontClass = activeLang === 'zh' ? 'font-sc' : activeLang === 'ja' ? 'font-jp' : '';

                    let formattedDate = '';
                    try {
                      const d = new Date(item.learned_at);
                      const day = String(d.getDate()).padStart(2, '0');
                      const month = String(d.getMonth() + 1).padStart(2, '0');
                      const year = d.getFullYear();
                      formattedDate = `${day}/${month}/${year}`;
                    } catch {
                      formattedDate = '—';
                    }

                    return (
                      <tr
                        key={item.vocab_id}
                        className="transition-colors hover:bg-[#FFFBF6]"
                        style={{
                          borderBottom: '1px solid var(--border)',
                          minHeight: '48px',
                        }}
                      >
                        <td className="py-3 px-3.5 text-[13px] text-center" style={{ color: 'var(--muted)' }}>
                          {stt}
                        </td>

                        <td className="py-3 px-3.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`text-[17px] sm:text-[18px] font-bold ${termFontClass}`}
                              style={{ color: 'var(--text)' }}
                            >
                              {info?.term || '—'}
                            </span>
                            {info?.word_type && (
                              <span
                                className="text-[11px] font-medium px-1.5 py-0.5 rounded border"
                                style={{
                                  backgroundColor: 'var(--bg)',
                                  borderColor: 'var(--border)',
                                  color: 'var(--muted)',
                                }}
                              >
                                {info.word_type}
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="py-3 px-3.5">
                          <span className="text-[14px] font-medium" style={{ color: 'var(--accent)' }}>
                            {info?.reading || '—'}
                          </span>
                        </td>

                        <td className="py-3 px-3.5 text-[14px]" style={{ color: 'var(--text)' }}>
                          {info?.meaning_vi || '—'}
                        </td>

                        <td className="hidden sm:table-cell py-3 px-3.5 text-[13px]" style={{ color: 'var(--muted)' }}>
                          {formattedDate}
                        </td>

                        <td className="py-2.5 px-2 text-center relative action-menu-container">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveMenuId(isMenuOpen ? null : item.vocab_id);
                            }}
                            className="p-1.5 rounded-lg transition-colors cursor-pointer"
                            style={{
                              color: 'var(--muted)',
                              backgroundColor: isMenuOpen ? 'var(--bg)' : 'transparent',
                            }}
                            title="Thao tác"
                            aria-label={`Thao tác cho từ ${info?.term}`}
                          >
                            <MoreVertical size={16} />
                          </button>

                          {/* Action Popover Menu */}
                          {isMenuOpen && (
                            <div
                              className="absolute right-2 top-11 z-30 w-[180px] rounded-xl py-1 shadow-md text-left transition-all"
                              style={{
                                backgroundColor: 'var(--card)',
                                border: '1px solid var(--border)',
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => handlePlayTTS(info?.term || '')}
                                className="w-full flex items-center gap-2 px-3 py-2 text-[13px] font-medium transition-colors hover:bg-[var(--bg)] cursor-pointer text-left"
                                style={{ color: 'var(--text)' }}
                              >
                                <Volume2 size={15} style={{ color: 'var(--accent)' }} />
                                <span>Nghe phát âm</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleUnmark(item)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-[13px] font-medium transition-colors hover:bg-[var(--bg)] cursor-pointer text-left"
                                style={{ color: 'var(--danger)' }}
                              >
                                <Trash2 size={15} />
                                <span>Bỏ đánh dấu</span>
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Phân trang phía dưới ── */}
        {!loading && !error && filteredItems.length > 0 && (
          <div
            className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 flex-shrink-0"
            style={{
              borderTop: '1px solid var(--border)',
              backgroundColor: 'var(--card)',
            }}
          >
            <span className="text-[13px]" style={{ color: 'var(--muted)' }}>
              Hiển thị {startIndex + 1} - {Math.min(startIndex + PAGE_SIZE, filteredItems.length)} /{' '}
              {filteredItems.length}
            </span>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={validCurrentPage === 1}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--bg)',
                  color: 'var(--text)',
                }}
                aria-label="Trang trước"
              >
                <ChevronLeft size={16} />
              </button>

              {/* Rút gọn số trang */}
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => {
                  return (
                    p === 1 ||
                    p === totalPages ||
                    (p >= validCurrentPage - 1 && p <= validCurrentPage + 1)
                  );
                })
                .map((p, idx, arr) => {
                  const showEllipsisBefore = idx > 0 && p - arr[idx - 1] > 1;
                  const isCurrent = p === validCurrentPage;
                  return (
                    <React.Fragment key={p}>
                      {showEllipsisBefore && (
                        <span className="px-1 text-[12px]" style={{ color: 'var(--muted)' }}>
                          ...
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setCurrentPage(p)}
                        className="w-8 h-8 rounded-lg text-[13px] font-semibold transition-colors cursor-pointer"
                        style={{
                          backgroundColor: isCurrent ? 'var(--accent)' : 'var(--card)',
                          color: isCurrent ? '#FFFFFF' : 'var(--text)',
                          border: isCurrent ? '1px solid var(--accent)' : '1px solid var(--border)',
                        }}
                      >
                        {p}
                      </button>
                    </React.Fragment>
                  );
                })}

              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={validCurrentPage === totalPages}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--bg)',
                  color: 'var(--text)',
                }}
                aria-label="Trang sau"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ── Toast thông báo và nút Hoàn tác ── */}
        {toastMessage && (
          <div
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2.5 rounded-xl shadow-lg animate-fade-in"
            style={{
              backgroundColor: 'var(--text)',
              color: '#FFFFFF',
              border: '1px solid var(--border)',
            }}
          >
            <span className="text-[13px] font-medium">{toastMessage}</span>
            {undoItem && (
              <button
                type="button"
                onClick={handleUndo}
                className="flex items-center gap-1 text-[13px] font-bold hover:underline cursor-pointer"
                style={{ color: '#FFD7B2' }}
              >
                <RotateCcw size={13} />
                <span>Hoàn tác</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
