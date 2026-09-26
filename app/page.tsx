'use client';
// ============================================================
// app/page.tsx — Trang chính NALESE
// Responsive: Desktop 2-col + Mobile single-col + bottom nav
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
            <div className="voice-layout">
              {/* Main: VoiceTutor — 2/3 on desktop */}
              <div>
                <VoiceTutor language={language} />
              </div>

              {/* Sidebar — 1/3 on desktop, hidden on mobile ≤640px */}
              <aside className="voice-sidebar space-y-4">

                {/* Thông tin phiên */}
                <div className="glass-card" style={{ padding: '24px 32px' }}>
                  <div className="text-xs text-indigo-900/40 uppercase tracking-widest mb-5">Thông tin phiên</div>
                  <div className="space-y-6">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-indigo-900/60">Ngôn ngữ đang học</span>
                      <span className="text-base text-indigo-900 font-semibold">
                        {language === 'zh' ? 'CN Tiếng Trung'
                          : language === 'ja' ? 'JP Tiếng Nhật'
                          : 'ENG Tiếng Anh'}
                      </span>
                    </div>
                    <div className="h-px" style={{ background: 'rgba(0,0,0,0.06)' }} />
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-indigo-900/60">Trạng thái</span>
                      <span className="text-sm text-emerald-400 font-medium">● Hoạt động</span>
                    </div>
                    {loadedVocab.length > 0 && (
                      <>
                        <div className="h-px" style={{ background: 'rgba(0,0,0,0.06)' }} />
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-indigo-900/60">Từ vựng đã tải</span>
                          <span className="text-base text-emerald-400 font-semibold">{loadedVocab.length} từ</span>
                        </div>
                      </>
                    )}
                    {latencyMs > 0 && (
                      <>
                        <div className="h-px" style={{ background: 'rgba(0,0,0,0.06)' }} />
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-indigo-900/60">Độ trễ phản hồi</span>
                          <span className={`text-base font-semibold ${latencyMs < 5000 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {(latencyMs / 1000).toFixed(2)}s
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>



                {/* Chuyển ngôn ngữ nhanh */}
                <div className="glass-card" style={{ padding: '24px 32px' }}>
                  <div className="text-xs text-indigo-900/40 uppercase tracking-widest mb-5 font-bold">Chuyển ngôn ngữ</div>
                  <div className="flex flex-col gap-3">
                    {(['zh', 'ja', 'en'] as SupportedLanguage[]).map((l) => (
                      <button key={l} onClick={() => setLanguage(l)}
                        style={{ padding: '16px 24px' }}
                        className={`btn-3d flex items-center gap-4 w-full min-h-[60px] rounded-xl text-base font-bold border transition-all ${
                          language === l
                            ? 'btn-3d-selected border-purple-400 bg-purple-100 text-black'
                            : 'border-gray-300 bg-white text-black hover:border-gray-400 hover:bg-gray-50'
                        }`}>
                        <span className={`text-center flex-shrink-0 font-sans font-bold tracking-tight ${l === 'en' ? 'text-xs w-7' : 'text-sm w-6'}`}>
                          {l === 'zh' ? 'CN' : l === 'ja' ? 'JP' : 'ENG'}
                        </span>
                        <span className="flex-1 text-left whitespace-nowrap overflow-hidden text-ellipsis">
                          {l === 'zh' ? 'Tiếng Trung' : l === 'ja' ? 'Tiếng Nhật' : 'Tiếng Anh'}
                        </span>
                        {language === l && (
                          <span className="text-black text-xs flex-shrink-0">✔ Đang chọn</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>


              </aside>
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
