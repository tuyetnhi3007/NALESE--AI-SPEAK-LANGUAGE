'use client';
// ============================================================
// components/ConfirmDialog.tsx — Hộp thoại xác nhận nhỏ gọn, đẹp mắt
// Tông màu kem đào chuẩn NALESE
// ============================================================

import React, { useEffect, useRef } from 'react';
import { AlertCircle } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  isDanger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText,
  cancelText,
  isDanger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        backgroundColor: 'rgba(43, 33, 24, 0.45)',
      }}
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl p-5 shadow-2xl flex flex-col gap-3"
        style={{
          backgroundColor: 'var(--card)',
          border: '1px solid var(--border)',
          boxShadow: '0 12px 36px rgba(43, 33, 24, 0.16)',
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{
              backgroundColor: isDanger ? '#FDECEC' : 'var(--bubble-user)',
              color: isDanger ? 'var(--danger)' : 'var(--accent)',
            }}
          >
            <AlertCircle size={20} />
          </div>
          <div className="flex flex-col gap-1">
            <h4
              style={{
                fontSize: '16px',
                fontWeight: 600,
                color: 'var(--text)',
                lineHeight: 1.3,
              }}
            >
              {title}
            </h4>
            <p
              style={{
                fontSize: '13px',
                color: 'var(--muted)',
                lineHeight: 1.45,
              }}
            >
              {message}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
            style={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--bubble-user)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--card)';
            }}
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors cursor-pointer"
            style={{
              backgroundColor: isDanger ? 'var(--danger)' : 'var(--accent)',
              border: 'none',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = isDanger
                ? '#B92E2E'
                : 'var(--accent-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = isDanger
                ? 'var(--danger)'
                : 'var(--accent)';
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
