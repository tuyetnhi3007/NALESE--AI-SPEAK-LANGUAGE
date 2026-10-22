'use client';
// ============================================================
// components/AuthModal.tsx — Cửa sổ nổi Đăng nhập / Đăng ký
// Tông màu kem đào đồng bộ NALESE, không có nút Google
// ============================================================

import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import AuthForm from './AuthForm';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultMode?: 'signin' | 'signup';
}

export default function AuthModal({
  isOpen,
  onClose,
  defaultMode = 'signin',
}: AuthModalProps) {
  // Đóng bằng phím ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[440px] bg-[var(--card)] rounded-[16px] p-[32px] max-[480px]:p-[24px] shadow-xl border border-[var(--border)] animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Nút đóng */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 p-2 rounded-full text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--bg)] transition cursor-pointer"
          aria-label="Đóng"
        >
          <X size={18} />
        </button>

        {/* Tiêu đề & Logo */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-[72px] h-[72px] rounded-full overflow-hidden border border-[var(--border)] mb-3 bg-transparent flex items-center justify-center">
            <img src="/logo-circle.png" alt="NALESE Logo" className="w-full h-full object-cover" />
          </div>
          <h2 className="text-[22px] font-bold text-[var(--text)] tracking-tight">Chào mừng đến với NALESE</h2>
          <p className="text-[13px] text-[var(--muted)] mt-1">
            Đăng nhập để lưu tiến độ học tập và đồng bộ hội thoại
          </p>
        </div>

        {/* Form xác thực Email & Mật khẩu */}
        <AuthForm defaultMode={defaultMode} onSuccess={onClose} isModal={true} />
      </div>
    </div>
  );
}
