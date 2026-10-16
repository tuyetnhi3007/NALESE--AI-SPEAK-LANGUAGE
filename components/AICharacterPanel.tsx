'use client';
// ============================================================
// components/AICharacterPanel.tsx — Card thu âm & visualizer bên trái
// Card nền trắng, viền 1px var(--border), bo góc 12px, không gradient, không bóng đổ
// Cụm nội dung nằm GIỮA card theo cả chiều ngang và dọc:
// 1. Sóng âm + nút micro 88px ở giữa
// 2. Nhãn trạng thái chữ thường 13px kèm chấm tròn màu
// 3. Phụ đề 22px trực tiếp trên card, min-height 72px
// 4. Một dòng hướng dẫn nhỏ 13px màu var(--muted)
// ============================================================

import React, { useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import AudioWaveformVisualizer from './AudioWaveformVisualizer';
import type { TutorState } from './AICharacterAvatar';
import type { SupportedLanguage } from '@/lib/types';

interface AICharacterPanelProps {
  tutorState: TutorState;
  isSpeechSupported: boolean;
  silenceCountdown: number | null;
  finalTranscript: string;
  interimTranscript: string;
  error: string;
  onMainButtonClick: () => void;
  mediaStream: MediaStream | null;
  language?: SupportedLanguage;
}

// Cấu hình nhãn trạng thái: chữ thường 13px, chấm tròn nhỏ (xám, đỏ, cam, accent)
const STATUS_CONFIG: Record<TutorState, { label: string; dotClass: string }> = {
  idle: {
    label: 'Sẵn sàng',
    dotClass: 'bg-[#9CA3AF]', // Xám
  },
  listening: {
    label: 'Đang lắng nghe...',
    dotClass: 'bg-[var(--danger)] animate-pulse', // Đỏ
  },
  waiting: {
    label: 'Đang chờ bạn nói tiếp...',
    dotClass: 'bg-amber-500 animate-pulse', // Cam
  },
  thinking: {
    label: 'Đang xử lý...',
    dotClass: 'bg-amber-500 animate-bounce', // Cam
  },
  speaking: {
    label: 'AI đang trả lời...',
    dotClass: 'bg-[var(--accent)]', // Accent
  },
};

export default function AICharacterPanel({
  tutorState,
  isSpeechSupported,
  silenceCountdown,
  finalTranscript,
  interimTranscript,
  error,
  onMainButtonClick,
  mediaStream,
  language = 'en',
}: AICharacterPanelProps) {
  const statusInfo = STATUS_CONFIG[tutorState] || STATUS_CONFIG.idle;

  const completedText = (finalTranscript || '').trim();
  const interimText = (interimTranscript || '').trim();
  const hasSpokenContent = completedText.length > 0 || interimText.length > 0;

  // Font class chuẩn theo ngôn ngữ
  const langFontClass = useMemo(() => {
    if (language === 'zh') return 'font-sc';
    if (language === 'ja') return 'font-jp';
    return 'font-sans';
  }, [language]);

  return (
    <div className="ai-character-panel w-full h-full">
      {/* Card nền trắng, viền 1px, bo góc 12px, không gradient, không bóng đổ */}
      <div className="voice-visualizer-card">
        
        {/* Cụm nội dung nằm GIỮA card theo cả chiều ngang và dọc */}
        <div className="voice-center-cluster w-full flex flex-col items-center justify-center">

          {/* 1. Dải sóng âm chạy ngang + nút micro tròn ở chính giữa */}
          <div className="w-full flex items-center justify-center">
            <AudioWaveformVisualizer
              tutorState={tutorState}
              mediaStream={mediaStream}
              onMainButtonClick={onMainButtonClick}
              silenceCountdown={silenceCountdown}
              isSpeechSupported={isSpeechSupported}
            />
          </div>

          {/* 2. Nhãn trạng thái (cách nút ~24px, chữ thường 13px, chấm tròn màu, bỏ viên thuốc, bỏ emoji) */}
          <div className="voice-status-group flex items-center justify-center gap-2">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusInfo.dotClass}`} />
            <span className="text-[13px] text-[var(--muted)] font-normal tracking-normal">
              {statusInfo.label}
            </span>

            {/* Đếm ngược 3 giây im lặng khi đang chờ */}
            {tutorState === 'waiting' && silenceCountdown !== null && (
              <span className="text-[12px] text-[var(--muted)] font-medium tabular-nums ml-1">
                (Gửi sau {silenceCountdown}s)
              </span>
            )}
          </div>

          {/* 3. Phụ đề lời người dùng (cách nhãn ~16px, không khung nền, cỡ 22px, min-height 72px) */}
          <div className="voice-subtitle-wrapper w-full px-4">
            <div className={`voice-subtitle-box ${langFontClass}`}>
              {hasSpokenContent ? (
                <p className="voice-subtitle-text">
                  {completedText && (
                    <span className="text-[var(--text)] font-medium">{completedText}</span>
                  )}
                  {interimText && (
                    <span className="text-[var(--muted)] font-normal">
                      {completedText ? ` ${interimText}` : interimText}
                    </span>
                  )}
                </p>
              ) : (
                <p className="voice-subtitle-text text-[var(--muted)] font-normal">
                  Lời bạn nói sẽ hiển thị tại đây...
                </p>
              )}
            </div>
          </div>

          {/* 4. Dòng hướng dẫn nhỏ (cách phụ đề ~12px, chỉ hiện khi chưa ghi âm) */}
          {tutorState === 'idle' && (
            <p className="voice-idle-hint text-[13px] text-[var(--muted)] font-normal text-center px-4">
              Nhấn để bắt đầu, hệ thống tự nhận diện sau 3 giây im lặng
            </p>
          )}

          {/* Thông báo lỗi nếu có: nền #FDECEC, chữ đỏ nhỏ, icon lucide, bỏ emoji */}
          {error && (
            <div className="voice-error-banner flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] text-[var(--danger)] bg-[#FDECEC] border border-[var(--danger)]/25 mt-3">
              <AlertCircle size={14} className="flex-shrink-0 text-[var(--danger)]" />
              <span>{error}</span>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
