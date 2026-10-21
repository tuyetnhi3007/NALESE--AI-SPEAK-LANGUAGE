'use client';
// ============================================================
// components/ExerciseModal.tsx — Cửa sổ nổi (floating panel) bài tập
// Dùng chung cho tab Bài Tập Chủ Đề (và có thể tái sử dụng cho tab Từ Vựng)
// ============================================================

import React, { useEffect, useRef } from 'react';
import { X, RotateCcw } from 'lucide-react';

interface ExerciseModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  currentQ: number;
  totalQ: number;
  score: number;
  showResult: boolean;
  isComplete: boolean;
  onRestart?: () => void;
  resumeButtonRef?: React.RefObject<HTMLButtonElement | null>;
  children: React.ReactNode;
}

export default function ExerciseModal({
  isOpen,
  onClose,
  title,
  currentQ,
  totalQ,
  score,
  showResult,
  isComplete,
  onRestart,
  resumeButtonRef,
  children,
}: ExerciseModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  // ─── Khóa cuộn trang phía sau khi modal mở ──────────────────
  useEffect(() => {
    if (!isOpen) return;

    // Lưu lại phần tử đang focus trước khi mở
    previousActiveElementRef.current = document.activeElement as HTMLElement | null;

    // Khóa cuộn trang
    const mainScrollEl = document.querySelector('.app-main-topics') as HTMLElement | null;
    const prevMainOverflow = mainScrollEl?.style.overflowY;
    if (mainScrollEl) {
      mainScrollEl.style.overflowY = 'hidden';
    }

    // Tự động focus vào nút đóng hoặc panel
    const timer = setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 50);

    return () => {
      clearTimeout(timer);
      if (mainScrollEl) {
        mainScrollEl.style.overflowY = prevMainOverflow || 'auto';
      }
      // Trả lại focus
      if (resumeButtonRef?.current) {
        resumeButtonRef.current.focus();
      } else if (previousActiveElementRef.current) {
        previousActiveElementRef.current.focus();
      }
    };
  }, [isOpen, resumeButtonRef]);

  // ─── Focus Trap & Phím Esc ────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Phím Esc đóng tạm
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      // Focus trap (Tab / Shift+Tab)
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
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const progressPercent = totalQ > 0 ? ((currentQ + (showResult ? 1 : 0)) / totalQ) * 100 : 0;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[38] flex items-center justify-center p-3 sm:p-6"
      style={{
        top: 'var(--header-h)',
      }}
    >
      {/* Nền mờ phía sau (Backdrop: rgba(43, 33, 24, 0.35), không dùng blur để cuộn mượt) */}
      <div
        className="exercise-modal-backdrop absolute inset-0"
        style={{
          backgroundColor: 'rgba(43, 33, 24, 0.35)',
        }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel nổi chính */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="exercise-modal-title"
        className="exercise-modal-panel relative z-10 w-full flex flex-col overflow-hidden"
        style={{
          backgroundColor: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: '16px',
          width: 'min(920px, calc(100% - 24px))',
          maxHeight: 'calc(100% - 24px)',
          boxShadow: '0 8px 32px rgba(43, 33, 24, 0.12)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Thanh tiêu đề panel ── */}
        <div
          className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3.5 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          {/* Bên trái: Tên bài & câu hiện tại */}
          <div className="flex flex-col min-w-0 pr-2">
            <h3
              id="exercise-modal-title"
              className="text-sm sm:text-[15px] font-semibold truncate leading-tight"
              style={{ color: 'var(--text)' }}
            >
              {title}
            </h3>
            {!isComplete && totalQ > 0 && (
              <span className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                Câu {currentQ + 1}/{totalQ}
              </span>
            )}
          </div>

          {/* Bên phải: Điểm, nút Tạo lại & nút X đóng tạm */}
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {!isComplete && totalQ > 0 && (
              <div
                className="text-xs sm:text-sm font-semibold px-2 py-1 rounded-md"
                style={{
                  backgroundColor: 'var(--bubble-user)',
                  color: 'var(--accent)',
                }}
              >
                Điểm: {score}/{currentQ + (showResult ? 1 : 0)}
              </div>
            )}

            {onRestart && !isComplete && (
              <button
                type="button"
                onClick={onRestart}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors"
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
                title="Tạo lại bộ bài tập này"
              >
                <RotateCcw size={13} style={{ color: 'var(--accent)' }} />
                <span>Tạo lại</span>
              </button>
            )}

            {/* Nút X: vùng bấm 36x36px, hover nền var(--bubble-user) */}
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-lg cursor-pointer transition-colors"
              style={{
                color: 'var(--muted)',
                backgroundColor: 'transparent',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--bubble-user)';
                e.currentTarget.style.color = 'var(--text)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = 'var(--muted)';
              }}
              aria-label="Đóng, giữ tiến độ"
              title="Đóng (giữ nguyên tiến độ)"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* ── Thanh tiến độ (ngay dưới tiêu đề) ── */}
        {!isComplete && totalQ > 0 && (
          <div
            className="w-full overflow-hidden flex-shrink-0"
            style={{ height: '4px', backgroundColor: 'var(--border)' }}
          >
            <div
              className="h-full transition-all duration-300"
              style={{
                width: `${progressPercent}%`,
                backgroundColor: 'var(--accent)',
              }}
            />
          </div>
        )}

        {/* ── Phần thân panel (cuộn dọc mảnh 6px) ── */}
        <div
          className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6"
          style={{ overscrollBehavior: 'contain' }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
