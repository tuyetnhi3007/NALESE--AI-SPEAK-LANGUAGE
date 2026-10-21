'use client';
// ============================================================
// app/page.tsx — Trang chính NALESE
// Responsive: Desktop 2-col + Mobile single-col + bottom nav
//
// Voice tab layout (desktop):
//   ┌─────────────────────┬──────────────┐
//   │                     │ Lang Switcher │
//   │  AI Character Panel ├──────────────┤
//   │                     │ Chat History  │
//   │                     │   Stack       │
//   └─────────────────────┴──────────────┘
// ============================================================

import React, { useState, useCallback } from 'react';
import Header from '@/components/Header';
import VoiceTutor from '@/components/VoiceTutor';
import VocabManager from '@/components/VocabManager';
import TopicExercises from '@/components/TopicExercises';
import { SettingsProvider } from '@/components/SettingsContext';
import type { SupportedLanguage, AppTab, VocabEntry } from '@/lib/types';

export default function Home() {
  const [activeTab, setActiveTab]     = useState<AppTab>('voice');
  const [language, setLanguage]       = useState<SupportedLanguage>('zh');
  const [loadedVocab, setLoadedVocab] = useState<VocabEntry[]>([]);
  const [latencyMs, setLatencyMs]     = useState<number>(0);

  const handleVocabLoaded = useCallback((vocab: VocabEntry[]) => setLoadedVocab(vocab), []);

  return (
    <SettingsProvider>
      <div className="app-shell flex flex-col">
        <Header
          activeTab={activeTab}
          onTabChange={setActiveTab}
          selectedLanguage={language}
          onLanguageChange={setLanguage}
          latencyMs={latencyMs}
        />

        <main
          className={`flex-1 ${
            activeTab === 'voice'
              ? 'app-main'
              : activeTab === 'vocab'
              ? 'app-main app-main-scrollable'
              : 'app-main-topics'
          }`}
        >
          {/* ── TAB: Gia Sư AI ── */}
          {activeTab === 'voice' && (
            <VoiceTutor language={language} onLanguageChange={setLanguage} />
          )}

          {/* ── TAB: Từ Vựng ── */}
          {activeTab === 'vocab' && (
            <VocabManager language={language} onVocabLoaded={handleVocabLoaded} />
          )}

          {/* ── TAB: Bài Tập Chủ Đề ── */}
          {activeTab === 'topics' && (
            <TopicExercises selectedLanguage={language} onLanguageChange={setLanguage} />
          )}
        </main>

        {/* Footer — chỉ hiển thị ở tab Từ Vựng */}
        {activeTab === 'vocab' && (
          <footer className="hidden md:block py-2 text-center border-t border-[var(--border)]">
            <p className="text-[12px] text-[var(--muted)] opacity-50">
              NALESE
            </p>
          </footer>
        )}
      </div>
    </SettingsProvider>
  );
}
