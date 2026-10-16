'use client';
// ============================================================
// components/LanguageSwitcher.tsx — Bộ chọn ngôn ngữ tối giản
// Không chữ lặp, cao ~56px, active viền 1.5px var(--accent)
// Tiêu đề chữ thường 13px màu var(--muted), icon Globe lucide
// ============================================================

import React from 'react';
import { Globe } from 'lucide-react';
import type { SupportedLanguage } from '@/lib/types';

interface LanguageSwitcherProps {
  language: SupportedLanguage;
  onLanguageChange: (lang: SupportedLanguage) => void;
}

const LANGUAGES: { code: SupportedLanguage; short: string; label: string }[] = [
  { code: 'zh', short: 'CN', label: 'Tiếng Trung' },
  { code: 'ja', short: 'JP', label: 'Tiếng Nhật' },
  { code: 'en', short: 'ENG', label: 'Tiếng Anh' },
];

export default function LanguageSwitcher({ language, onLanguageChange }: LanguageSwitcherProps) {
  return (
    <div className="lang-switcher">
      <div className="lang-switcher-header">
        <Globe size={13} className="text-[var(--muted)]" />
        <span className="lang-switcher-title">Chọn ngôn ngữ</span>
      </div>
      <div className="lang-switcher-grid">
        {LANGUAGES.map((l) => {
          const isSelected = language === l.code;
          return (
            <button
              key={l.code}
              type="button"
              onClick={() => onLanguageChange(l.code)}
              className={`lang-btn ${isSelected ? 'lang-btn-selected' : 'lang-btn-default'}`}
            >
              <span className="lang-btn-label">{l.label}</span>
              <span className="lang-btn-short">{l.short}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
