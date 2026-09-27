'use client';
// ============================================================
// components/AICharacterPanel.tsx — Khung Gia Sư AI
//
// Gồm:
// 1. AICharacterAvatar: Nhân vật photorealistic tại bàn học (500x500)
//    với hiệu ứng crossfade nói chuyện (lip-sync), thở, chớp mắt
// 2. RecordButtonOverlay: Nút mic nổi (floating badge) overlay
//    tại cạnh dưới khung nhân vật, phản ứng theo âm lượng mic
// 3. Transcript & Error: Hộp hiển thị văn bản nhận diện trực tiếp
// ============================================================

import React from 'react';
import AICharacterAvatar, { TutorState } from './AICharacterAvatar';
import RecordButtonOverlay from './RecordButtonOverlay';

interface AICharacterPanelProps {
  tutorState: TutorState;
  isSpeechSupported: boolean;
  silenceCountdown: number | null;
  finalTranscript: string;
  interimTranscript: string;
  error: string;
  onMainButtonClick: () => void;
  mediaStream: MediaStream | null;
}

export default function AICharacterPanel({
  tutorState,
  isSpeechSupported,
  silenceCountdown,
  finalTranscript,
  interimTranscript,
  error,
  onMainButtonClick,
  mediaStream,
}: AICharacterPanelProps) {
  return (
    <div className="ai-character-panel">
      {/* Khung avatar 500x500 chứa ảnh nhân vật và nút mic overlay */}
      <div className="ai-character-stage">
        <AICharacterAvatar tutorState={tutorState} />

        {/* Nút ghi âm floating badge overlay tại cạnh dưới */}
        <RecordButtonOverlay
          tutorState={tutorState}
          silenceCountdown={silenceCountdown}
          isSpeechSupported={isSpeechSupported}
          onMainButtonClick={onMainButtonClick}
          mediaStream={mediaStream}
        />
      </div>

      {/* Hộp nhận diện giọng nói theo thời gian thực */}
      {(tutorState === 'listening' || tutorState === 'waiting') && (
        <div className="ai-realtime-transcript glass-card animate-fade-in">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-2 h-2 rounded-full bg-purple-500 animate-ping" />
            <span className="text-xs font-bold text-purple-600 uppercase tracking-wider">
              Đang nhận diện giọng nói
            </span>
          </div>
          <p className="text-sm leading-relaxed text-slate-800">
            {finalTranscript && <span className="font-medium text-slate-900">{finalTranscript}</span>}
            {interimTranscript && <span className="text-slate-500 italic"> {interimTranscript}</span>}
            {!finalTranscript && !interimTranscript && (
              <span className="text-slate-400 italic">Hãy nói vào micro...</span>
            )}
          </p>
        </div>
      )}

      {/* Thông báo lỗi nếu có */}
      {error && (
        <div className="ai-error-box glass-card animate-shake">
          <div className="flex items-center gap-2 text-rose-600 text-sm font-medium">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        </div>
      )}
    </div>
  );
}
