'use client';
// ============================================================
// components/Header.tsx — Thanh điều hướng tối giản tông kem đào
// Cao 56px, nền var(--card), viền 1px var(--border)
// Icon nét mảnh lucide-react, gạch chân 2px var(--accent) cho active tab
// ============================================================

import React, { useState } from 'react';
import { Mic, BookOpen, Target, Settings, Zap } from 'lucide-react';
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

const TABS: { id: AppTab; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { id: 'voice',  label: 'Gia Sư AI',       icon: Mic },
  { id: 'vocab',  label: 'Từ Vựng',          icon: BookOpen },
  { id: 'topics', label: 'Bài Tập Chủ Đề',  icon: Target },
];

export default function Header({
  activeTab, onTabChange, selectedLanguage, latencyMs,
}: HeaderProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { hasApiKey } = useSettings();

  return (
    <>
      <header className="app-header">
        <div className="header-inner">

          {/* Logo & Avatar góc trái (bỏ bóng tím) */}
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <div className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0 border border-[var(--border)] bg-white">
              <img src="/logo.jpg" alt="Logo" className="w-full h-full object-cover" />
            </div>
            <span className="font-semibold text-base tracking-tight text-[var(--text)]">NALESE</span>
          </div>

          {/* Tab Navigation (Center) — icon lucide nét mảnh, active gạch chân 2px var(--accent) */}
          <nav className="desktop-tabs flex-1 justify-center">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onTabChange(tab.id)}
                  className={`tab-btn ${isActive ? 'active' : ''}`}
                >
                  <Icon size={16} className="tab-icon" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Right Controls */}
          <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
            {/* Latency indicator (nếu có) */}
            {latencyMs !== undefined && latencyMs > 0 && (
              <div className="hidden lg:flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-[var(--muted)] bg-[var(--bg)] border border-[var(--border)]">
                <Zap size={11} className="text-[var(--accent)]" />
                {latencyMs < 1000 ? `${latencyMs}ms` : `${(latencyMs / 1000).toFixed(1)}s`}
              </div>
            )}

            {/* Settings button */}
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="relative p-2 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--bg)] transition-colors border border-[var(--border)]"
              title="Cài đặt"
              aria-label="Mở cài đặt"
            >
              <Settings size={17} />
              <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${hasApiKey ? 'bg-emerald-500' : 'bg-[var(--danger)]'}`} />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Bottom Navigation */}
      <nav className="mobile-bottom-nav">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              className={`bottom-nav-btn ${isActive ? 'active' : ''}`}
              onClick={() => onTabChange(tab.id)}
            >
              <Icon size={18} className="bottom-nav-icon" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Settings Modal */}
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
