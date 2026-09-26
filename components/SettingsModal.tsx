'use client';
// ============================================================
// components/SettingsModal.tsx — Cài đặt ứng dụng (tiếng Việt)
//
// API keys được quản lý qua .env.local (server-side).
// Modal chỉ cho phép chỉnh: giọng đọc, tốc độ, trình độ.
// Hiển thị trạng thái provider (Gemini/Groq/OpenAI) từ API.
// ============================================================

import React, { useState, useEffect } from 'react';
import { X, Volume2, Gauge, Brain, CheckCircle2, XCircle, Loader2, Info } from 'lucide-react';
import { useSettings } from './SettingsContext';
import type { TutorVoice, LanguageLevel } from '@/lib/types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const VOICES: { value: TutorVoice; label: string; description: string }[] = [
  { value: 'alloy', label: 'Alloy', description: 'Trung tính, cân bằng' },
  { value: 'echo', label: 'Echo', description: 'Giọng nam ấm áp' },
  { value: 'fable', label: 'Fable', description: 'Giọng Anh biểu cảm' },
  { value: 'onyx', label: 'Onyx', description: 'Sâu, chắc chắn' },
  { value: 'nova', label: 'Nova', description: 'Năng động, thân thiện ✨' },
  { value: 'shimmer', label: 'Shimmer', description: 'Nhẹ nhàng, dễ chịu' },
];

const LEVELS: { value: LanguageLevel; label: string; emoji: string }[] = [
  { value: 'beginner', label: 'Sơ cấp', emoji: '🌱' },
  { value: 'intermediate', label: 'Trung cấp', emoji: '🌿' },
  { value: 'advanced', label: 'Nâng cao', emoji: '🌳' },
];

interface ProviderInfo {
  name: string;
  status: 'configured' | 'missing' | 'browser-native';
  role: string;
  model?: string;
  freeTier?: string;
  provider?: string;
}

interface ProviderStatusData {
  providers: Record<string, ProviderInfo>;
  webSpeechApi: ProviderInfo;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { settings, updateSettings } = useSettings();

  if (!isOpen) return null;

  const StatusIcon = ({ status }: { status: string }) => {
    if (status === 'configured' || status === 'browser-native') {
      return <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />;
    }
    return <XCircle size={14} className="text-red-400/70 flex-shrink-0" />;
  };

  const PROVIDER_ORDER = ['gemini', 'groq', 'openai', 'tts'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative glass-card w-full max-w-md z-10 shadow-2xl overflow-hidden"
        style={{ border: '1px solid rgba(139, 92, 246, 0.3)', boxShadow: '0 25px 50px rgba(0,0,0,0.5)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <h2 className="text-xl font-display font-bold text-white">⚙️ Cài đặt</h2>
          <button onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            aria-label="Đóng cài đặt">
            <X size={18} />
          </button>
        </div>

        {/* Không còn Tabs */}

        <div className="p-6 overflow-y-auto" style={{ maxHeight: '60vh' }}>
          {/* ── Nội dung Cài đặt ── */}
          <div className="space-y-5">
              {/* Giọng đọc */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-white/70 mb-2">
                  <Volume2 size={14} /> Giọng đọc của AI
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {VOICES.map((v) => (
                    <button key={v.value} onClick={() => updateSettings({ voice: v.value })}
                      className={`text-left p-3 rounded-xl border transition-all text-sm ${
                        settings.voice === v.value
                          ? 'border-purple-400 bg-purple-500/10 text-purple-900 shadow-[0_0_15px_rgba(168,85,247,0.3)]'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}>
                      <div className="font-medium">{v.label}</div>
                      <div className="text-xs opacity-70 mt-0.5">{v.description}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Tốc độ */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-white/70 mb-2">
                  <Gauge size={14} /> Tốc độ phát âm: <span className="text-purple-300">{settings.speed}x</span>
                </label>
                <div className="flex gap-2">
                  {[0.75, 1.0, 1.25].map((s) => (
                    <button key={s} onClick={() => updateSettings({ speed: s })}
                      className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-all ${
                        settings.speed === s
                          ? 'border-purple-400 bg-purple-500/10 text-purple-900 shadow-[0_0_15px_rgba(168,85,247,0.3)]'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}>
                      {s}x {s === 0.75 ? '(chậm)' : s === 1.0 ? '(bình thường)' : '(nhanh)'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Trình độ */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-white/70 mb-2">
                  <Brain size={14} /> Trình độ học
                </label>
                <div className="flex gap-2">
                  {LEVELS.map((l) => (
                    <button key={l.value} onClick={() => updateSettings({ level: l.value })}
                      className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-all ${
                        settings.level === l.value
                          ? 'border-purple-400 bg-purple-500/10 text-purple-900 shadow-[0_0_15px_rgba(168,85,247,0.3)]'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}>
                      {l.emoji} {l.label}
                    </button>
                  ))}
                </div>
              </div>

            </div>

        </div>

        {/* Footer button */}
        <div className="px-6 pb-6 mt-4">
          <button onClick={onClose} className="btn-primary w-full py-3">
            ✓ Lưu & Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
