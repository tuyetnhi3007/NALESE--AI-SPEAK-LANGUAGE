'use client';
// ============================================================
// components/SettingsModal.tsx — Cài đặt ứng dụng (tiếng Việt)
// Đồng bộ 100% bảng màu kem đào (--bg, --card, --border, --text, --muted, --accent)
// ============================================================

import React from 'react';
import {
  X,
  Volume2,
  Gauge,
  Brain,
  Settings,
  Sprout,
  Leaf,
  TreePine,
} from 'lucide-react';
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
  { value: 'nova', label: 'Nova', description: 'Năng động, thân thiện' },
  { value: 'shimmer', label: 'Shimmer', description: 'Nhẹ nhàng, dễ chịu' },
];

const LEVELS: {
  value: LanguageLevel;
  label: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
}[] = [
  { value: 'beginner', label: 'Sơ cấp', icon: Sprout },
  { value: 'intermediate', label: 'Trung cấp', icon: Leaf },
  { value: 'advanced', label: 'Nâng cao', icon: TreePine },
];

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { settings, updateSettings } = useSettings();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Modal Dialog */}
      <div
        className="relative w-full max-w-md z-10 overflow-hidden"
        style={{
          backgroundColor: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          boxShadow: '0 20px 40px rgba(43, 33, 24, 0.15)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 pt-5 pb-4"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <Settings size={18} style={{ color: 'var(--accent)' }} />
            <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text)' }}>
              Cài đặt
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors cursor-pointer"
            style={{ color: 'var(--muted)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text)';
              e.currentTarget.style.backgroundColor = 'var(--bubble-user)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--muted)';
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
            aria-label="Đóng cài đặt"
          >
            <X size={18} />
          </button>
        </div>

        {/* Nội dung cài đặt */}
        <div className="p-6 overflow-y-auto space-y-5" style={{ maxHeight: '65vh' }}>
          {/* Giọng đọc */}
          <div>
            <label
              className="flex items-center gap-2 text-sm font-medium mb-2.5"
              style={{ color: 'var(--text)' }}
            >
              <Volume2 size={15} style={{ color: 'var(--accent)' }} />
              <span>Giọng đọc của AI</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {VOICES.map((v) => {
                const isSelected = settings.voice === v.value;
                return (
                  <button
                    key={v.value}
                    type="button"
                    onClick={() => updateSettings({ voice: v.value })}
                    className="text-left p-3 rounded-xl transition-all text-sm cursor-pointer"
                    style={{
                      backgroundColor: isSelected ? 'var(--bubble-user)' : 'var(--card)',
                      border: isSelected ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                      color: 'var(--text)',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderColor = 'var(--accent)';
                        e.currentTarget.style.backgroundColor = '#FFFBF6';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderColor = 'var(--border)';
                        e.currentTarget.style.backgroundColor = 'var(--card)';
                      }
                    }}
                  >
                    <div className="font-semibold leading-tight">{v.label}</div>
                    <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                      {v.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tốc độ phát âm */}
          <div>
            <label
              className="flex items-center gap-2 text-sm font-medium mb-2.5"
              style={{ color: 'var(--text)' }}
            >
              <Gauge size={15} style={{ color: 'var(--accent)' }} />
              <span>Tốc độ phát âm:</span>
              <span style={{ color: 'var(--accent)', fontWeight: 600 }}>
                {settings.speed}x
              </span>
            </label>
            <div className="flex gap-2">
              {[0.75, 1.0, 1.25].map((s) => {
                const isSelected = settings.speed === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => updateSettings({ speed: s })}
                    className="flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors cursor-pointer text-center"
                    style={{
                      backgroundColor: isSelected ? 'var(--bubble-user)' : 'var(--card)',
                      border: isSelected ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                      color: 'var(--text)',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderColor = 'var(--accent)';
                        e.currentTarget.style.backgroundColor = '#FFFBF6';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderColor = 'var(--border)';
                        e.currentTarget.style.backgroundColor = 'var(--card)';
                      }
                    }}
                  >
                    {s}x {s === 0.75 ? '(chậm)' : s === 1.0 ? '(vừa)' : '(nhanh)'}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Trình độ học */}
          <div>
            <label
              className="flex items-center gap-2 text-sm font-medium mb-2.5"
              style={{ color: 'var(--text)' }}
            >
              <Brain size={15} style={{ color: 'var(--accent)' }} />
              <span>Trình độ học</span>
            </label>
            <div className="flex gap-2">
              {LEVELS.map((l) => {
                const Icon = l.icon;
                const isSelected = settings.level === l.value;
                return (
                  <button
                    key={l.value}
                    type="button"
                    onClick={() => updateSettings({ level: l.value })}
                    className="flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                    style={{
                      backgroundColor: isSelected ? 'var(--bubble-user)' : 'var(--card)',
                      border: isSelected ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                      color: 'var(--text)',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderColor = 'var(--accent)';
                        e.currentTarget.style.backgroundColor = '#FFFBF6';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderColor = 'var(--border)';
                        e.currentTarget.style.backgroundColor = 'var(--card)';
                      }
                    }}
                  >
                    <Icon size={15} style={{ color: 'var(--accent)' }} />
                    <span>{l.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 font-semibold text-white rounded-lg transition-colors cursor-pointer"
            style={{
              backgroundColor: 'var(--accent)',
              border: 'none',
              borderRadius: '8px',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent)')}
          >
            Lưu & Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
