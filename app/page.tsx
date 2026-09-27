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
import LanguageSwitcher from '@/components/LanguageSwitcher';
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
      <div className="min-h-screen flex flex-col">
        <Header
          activeTab={activeTab}
          onTabChange={setActiveTab}
          selectedLanguage={language}
          onLanguageChange={setLanguage}
          latencyMs={latencyMs}
        />

        <main className="app-main flex-1">

          {/* ── TAB: Gia Sư AI ── */}
          {activeTab === 'voice' && (
            <div className="voice-layout-v2">
              {/* VoiceTutor renders AICharacterPanel (grid-area: main)
                  and ChatHistoryStack (grid-area: chat) as Fragment children */}
              <VoiceTutor language={language} onLanguageChange={setLanguage} />

              {/* LanguageSwitcher sits in sidebar (grid-area: lang) */}
              <div className="voice-area-lang">
                <LanguageSwitcher
                  language={language}
                  onLanguageChange={setLanguage}
                />
              </div>
            </div>
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

        {/* Footer — desktop only */}
        <footer className="hidden md:block border-t py-3 px-6 text-center"
          style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
          <p className="text-xs text-indigo-900/20">
            NALESE · Gia sư ngoại ngữ AI ·{' '}
            <span className="text-blue-400/50">Gemini 3.8 Flash</span> ·{' '}
            <span className="text-emerald-400/50">Web Speech API</span> ·{' '}
            <span className="text-purple-400/50">Browser TTS</span>
          </p>
        </footer>
      </div>
    </SettingsProvider>
  );
}
