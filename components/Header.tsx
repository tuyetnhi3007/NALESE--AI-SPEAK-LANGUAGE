'use client';
// ============================================================
// components/Header.tsx — Thanh điều hướng responsive
// Desktop: logo + tabs + controls trong 1 hàng
// Mobile: logo + controls (tabs ở bottom nav)
// ============================================================

import React, { useState } from 'react';
import { Settings, Zap, Globe, ChevronRight } from 'lucide-react';
import SettingsModal from './SettingsModal';
import { useSettings } from './SettingsContext';
import type { SupportedLanguage, AppTab } from '@/lib/types';

interface HeaderProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  selectedLanguage: SupportedLanguage;
  onLanguageChange: (lang: SupportedLanguage) => void;
  latencyMs?: number;
}

const TABS: { id: AppTab; label: string; icon: string }[] = [
  { id: 'voice',  label: 'Gia Sư AI',       icon: '🎙️' },
  { id: 'vocab',  label: 'Từ Vựng',          icon: '📚' },
  { id: 'topics', label: 'Bài Tập Chủ Đề',  icon: '🎯' },
];

const LANGUAGES = [
  { code: 'en' as SupportedLanguage, flag: 'ENG', short: 'Anh',   name: 'Tiếng Anh' },
  { code: 'zh' as SupportedLanguage, flag: 'CN', short: 'Trung', name: 'Tiếng Trung' },
  { code: 'ja' as SupportedLanguage, flag: 'JP', short: 'Nhật',  name: 'Tiếng Nhật' },
];

export default function Header({
  activeTab, onTabChange, selectedLanguage, onLanguageChange, latencyMs,
}: HeaderProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { hasApiKey } = useSettings();
  const currentLang = LANGUAGES.find((l) => l.code === selectedLanguage)!;
  const LANGS = ['en', 'zh', 'ja'] as SupportedLanguage[];

  const cycleLang = () =>
    onLanguageChange(LANGS[(LANGS.indexOf(selectedLanguage) + 1) % LANGS.length]);

  return (
    <>
      {/* ── Main Header ── */}
      <header className="app-header">
        <div className="header-inner">

          {/* Logo */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0"
              style={{ boxShadow: '0 4px 14px rgba(124,58,237,0.4)' }}>
              <img src="/logo.jpg" alt="Logo" className="w-full h-full object-cover" style={{ transform: 'scale(1.12)' }} />
            </div>
            <div className="hidden xs:block">
              <span className="font-display font-bold text-lg tracking-tight gradient-text">NALESE</span>
              <div className="text-xs text-white/30 -mt-0.5 leading-none hidden sm:block">Gia sư ngoại ngữ AI</div>
            </div>
          </div>

          {/* Desktop Tab Navigation (center, flex-1) */}
          <nav className="desktop-tabs flex-1 justify-center">
            {TABS.map((tab) => (
              <button key={tab.id} onClick={() => onTabChange(tab.id)}
                className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}>
                <span className="mr-1.5">{tab.icon}</span>{tab.label}
              </button>
            ))}
          </nav>

          {/* Right Controls */}
          <div className="flex items-center gap-2 flex-shrink-0 ml-auto">

            {/* Latency (desktop only) */}
            {latencyMs !== undefined && latencyMs > 0 && (
              <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', color: '#6ee7b7' }}>
                <Zap size={11} />
                {latencyMs < 1000 ? `${latencyMs}ms` : `${(latencyMs / 1000).toFixed(1)}s`}
              </div>
            )}

            {/* Language toggle */}
            <button
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-all hover:bg-white/8"
              style={{ border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}
              onClick={cycleLang}
              title={`Đang học: ${currentLang.name}. Nhấn để chuyển`}>
              <span>{currentLang.flag}</span>
              <span className="hidden sm:inline text-xs">{currentLang.short}</span>
              <ChevronRight size={11} className="opacity-40 -rotate-90 sm:rotate-0" />
            </button>

            {/* Globe icon — hidden on mobile (saves space) */}
            <Globe size={14} className="hidden lg:block opacity-20" />

            {/* Settings */}
            <button onClick={() => setSettingsOpen(true)}
              className="relative p-2 rounded-lg transition-all hover:bg-white/8"
              style={{ border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)' }}
              title="Cài đặt" aria-label="Mở cài đặt">
              <Settings size={18} />
              <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${hasApiKey ? 'bg-emerald-400' : 'bg-red-400'}`} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Mobile Bottom Navigation ── */}
      <nav className="mobile-bottom-nav">
        {TABS.map((tab) => (
          <button key={tab.id} className={`bottom-nav-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => onTabChange(tab.id)}>
            <div className="bottom-nav-icon">{tab.icon}</div>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
