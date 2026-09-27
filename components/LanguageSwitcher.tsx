'use client';
// ============================================================
// components/LanguageSwitcher.tsx — Bộ nút chuyển đổi ngôn ngữ
//
// Thay thế panel "Thông tin phiên" cũ.
// Hiển thị các nút chọn ngôn ngữ CN/JP/ENG với trạng thái nổi bật.
// ============================================================

import React from 'react';
import type { SupportedLanguage } from '@/lib/types';

interface LanguageSwitcherProps {
  language: SupportedLanguage;
  onLanguageChange: (lang: SupportedLanguage) => void;
}

const LANGUAGES: { code: SupportedLanguage; short: string; label: string; emoji: string }[] = [
  { code: 'zh', short: 'CN', label: 'Tiếng Trung', emoji: '🇨🇳' },
  { code: 'ja', short: 'JP', label: 'Tiếng Nhật', emoji: '🇯🇵' },
  { code: 'en', short: 'ENG', label: 'Tiếng Anh', emoji: '🇬🇧' },
];

export default function LanguageSwitcher({ language, onLanguageChange }: LanguageSwitcherProps) {
  return (
    <div className="lang-switcher glass-card">
      <div className="lang-switcher-header">
        <span className="lang-switcher-icon">🌐</span>
        <span className="lang-switcher-title">Chọn ngôn ngữ</span>
      </div>
      <div className="lang-switcher-grid">
        {LANGUAGES.map((l) => {
          const isSelected = language === l.code;
          return (
            <button
              key={l.code}
              onClick={() => onLanguageChange(l.code)}
              className={`lang-btn ${isSelected ? 'lang-btn-selected' : 'lang-btn-default'}`}
            >
              <span className="lang-btn-emoji">{l.emoji}</span>
              <span className="lang-btn-short">{l.short}</span>
              <span className="lang-btn-label">{l.label}</span>
              {isSelected && (
                <span className="lang-btn-check">✔</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
