'use client';
// ============================================================
// components/AICharacterAvatar.tsx — Nhân vật AI Photorealistic (Canvas Edition)
//
// ĐÃ CHUYỂN HOÀN TOÀN TỪ CSS/IMG SANG HTML5 CANVAS:
// - Render 100% bằng AICharacterCanvas (Canvas context { alpha: false }).
// - Hoàn toàn không dùng thẻ <img>, không xếp chồng ảnh, không transition opacity CSS.
// - Nạp ảnh 1 lần bằng createImageBitmap off-thread.
// - Mount 1 lần duy nhất, không unmount/remount khi đổi state hoặc đổi ngôn ngữ.
// - useLipSync cấp hàm getOpenness() đọc trực tiếp từ ref.
// - RecordButtonOverlay và bố cục 500x500 giữ nguyên 100%.
// ============================================================

import React from 'react';
import AICharacterCanvas, { CANVAS_AVATAR_CONSTANTS } from './AICharacterCanvas';
import { useLipSync, LIPSYNC_CONSTANTS } from './hooks/useLipSync';

export type TutorState = 'idle' | 'listening' | 'waiting' | 'thinking' | 'speaking';
export type MouthState = 'closed' | 'small' | 'wide';

export { CANVAS_AVATAR_CONSTANTS, LIPSYNC_CONSTANTS, AICharacterCanvas };

export interface AICharacterAvatarProps {
  /** Trạng thái gia sư */
  state?: TutorState;
  tutorState?: TutorState;
  /** Nguồn audio trực tiếp nếu có */
  audioElement?: HTMLAudioElement | null;
  audioSource?: HTMLAudioElement | MediaStream | null;
  /** Âm lượng tùy chọn truyền vào thủ công (0 đến 1) */
  audioLevel?: number;
  className?: string;
}

function AICharacterAvatarComponent({
  state,
  tutorState,
  audioElement,
  audioSource,
  audioLevel,
  className = '',
}: AICharacterAvatarProps) {
  const currentState: TutorState = (state || tutorState || 'idle') as TutorState;
  const isSpeaking = currentState === 'speaking';

  // Nguồn cấp openness (0..1) từ useLipSync
  const { getOpenness } = useLipSync({
    isSpeaking,
    audioElement,
    audioSource,
    audioLevel,
  });

  return (
    <div
      className={`ai-character-avatar-container ${className}`}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: '#181528',
      }}
    >
      <AICharacterCanvas
        getOpenness={getOpenness}
        style={{
          width: '100%',
          height: '100%',
          maxWidth: '100%',
          borderRadius: 0,
        }}
      />
    </div>
  );
}

const AICharacterAvatar = React.memo(AICharacterAvatarComponent);
export default AICharacterAvatar;
