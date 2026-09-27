'use client';
// ============================================================
// components/AICharacterAvatar.tsx — Nhân vật AI Photorealistic
//
// Tính năng:
// 1. Hiển thị nhân vật photorealistic tại bàn học
// 2. Chuyển đổi mượt (crossfade CSS) giữa 4 frame:
//    - avatar_idle: mắt mở, miệng khép
//    - avatar_blink: mắt nhắm (chớp mắt mỗi 3-5s)
//    - avatar_mouth_open_small: miệng hé mở
//    - avatar_mouth_open_wide: miệng mở rộng
// 3. Hiệu ứng thở (subtle breathing) tự nhiên khi idle
// 4. Lip-sync mượt mà khi AI nói (tutorState === 'speaking')
// ============================================================

import React, { useEffect, useState, useRef } from 'react';

export type TutorState = 'idle' | 'listening' | 'waiting' | 'thinking' | 'speaking';

export type AvatarFrame = 'idle' | 'blink' | 'mouth_small' | 'mouth_wide';

interface AICharacterAvatarProps {
  tutorState: TutorState;
  /** Tùy chọn: Audio amplitude level từ 0 đến 1 khi AI nói */
  audioLevel?: number;
  className?: string;
}

const FRAMES: { key: AvatarFrame; src: string; fallbackSrc: string; alt: string }[] = [
  { key: 'idle', src: '/avatar_idle.webp', fallbackSrc: '/avatar_idle.png', alt: 'Gia sư AI - Nghỉ' },
  { key: 'blink', src: '/avatar_blink.webp', fallbackSrc: '/avatar_blink.png', alt: 'Gia sư AI - Chớp mắt' },
  { key: 'mouth_small', src: '/avatar_mouth_open_small.webp', fallbackSrc: '/avatar_mouth_open_small.png', alt: 'Gia sư AI - Nói nhỏ' },
  { key: 'mouth_wide', src: '/avatar_mouth_open_wide.webp', fallbackSrc: '/avatar_mouth_open_wide.png', alt: 'Gia sư AI - Nói lớn' },
];

export default function AICharacterAvatar({
  tutorState,
  audioLevel,
  className = '',
}: AICharacterAvatarProps) {
  const [currentFrame, setCurrentFrame] = useState<AvatarFrame>('idle');
  const blinkTimerRef = useRef<NodeJS.Timeout | null>(null);
  const blinkEndTimerRef = useRef<NodeJS.Timeout | null>(null);
  const speechIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // ─── Preload 4 frames vào memory để transition không giật ───
  useEffect(() => {
    FRAMES.forEach((frame) => {
      const img = new Image();
      img.src = frame.src;
      const fallback = new Image();
      fallback.src = frame.fallbackSrc;
    });
  }, []);

  // ─── Idle: Tự động chớp mắt ngẫu nhiên mỗi 3-5s ─────────────
  useEffect(() => {
    // Chỉ chớp mắt khi không đang nói
    if (tutorState === 'speaking') {
      if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current);
      if (blinkEndTimerRef.current) clearTimeout(blinkEndTimerRef.current);
      return;
    }

    const scheduleNextBlink = () => {
      // 3000ms đến 5000ms ngẫu nhiên
      const delay = Math.floor(Math.random() * 2000) + 3000;
      blinkTimerRef.current = setTimeout(() => {
        // Chỉ chớp khi đang ở frame idle
        setCurrentFrame((prev) => (prev === 'idle' ? 'blink' : prev));

        // Thời gian nhắm mắt tự nhiên: 150-180ms
        blinkEndTimerRef.current = setTimeout(() => {
          setCurrentFrame((prev) => (prev === 'blink' ? 'idle' : prev));
          scheduleNextBlink();
        }, 170);
      }, delay);
    };

    scheduleNextBlink();

    return () => {
      if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current);
      if (blinkEndTimerRef.current) clearTimeout(blinkEndTimerRef.current);
    };
  }, [tutorState]);

  // ─── Speaking: Lip-sync chuyển động miệng theo nhịp điệu nói ─
  useEffect(() => {
    if (tutorState !== 'speaking') {
      if (speechIntervalRef.current) clearInterval(speechIntervalRef.current);
      // Quay về idle khi dừng nói
      setCurrentFrame('idle');
      return;
    }

    // Nếu có audioLevel thực truyền vào
    if (typeof audioLevel === 'number' && audioLevel > 0) {
      if (audioLevel < 0.12) {
        setCurrentFrame('idle');
      } else if (audioLevel < 0.42) {
        setCurrentFrame('mouth_small');
      } else {
        setCurrentFrame('mouth_wide');
      }
      return;
    }

    // Mô phỏng nhịp điệu phát âm tự nhiên của con người (4-5 âm tiết / giây):
    // Xen kẽ nhịp nhàng giữa khép miệng, hé mở và mở rộng với các khoảng ngắt tự nhiên
    const speechPattern: AvatarFrame[] = [
      'mouth_small',
      'mouth_wide',
      'mouth_small',
      'idle',
      'mouth_small',
      'mouth_wide',
      'mouth_wide',
      'mouth_small',
      'idle',
    ];
    let stepIndex = 0;

    const runSpeechStep = () => {
      const nextFrame = speechPattern[stepIndex % speechPattern.length];
      setCurrentFrame(nextFrame);
      stepIndex++;

      // Thời gian mỗi âm tiết biến thiên nhẹ (110ms - 170ms) để cử động chân thật
      const syllableDuration = 110 + Math.floor(Math.random() * 60);
      speechIntervalRef.current = setTimeout(runSpeechStep, syllableDuration);
    };

    runSpeechStep();

    return () => {
      if (speechIntervalRef.current) clearTimeout(speechIntervalRef.current);
    };
  }, [tutorState, audioLevel]);

  return (
    <div className={`ai-character-avatar-container ${className}`}>
      {/* Wrapper có subtle breathing effect */}
      <div className="ai-character-breathing-layer">
        {FRAMES.map((f) => {
          const isActive = currentFrame === f.key;
          return (
            <picture key={f.key}>
              <source srcSet={f.src} type="image/webp" />
              <img
                src={f.fallbackSrc}
                alt={f.alt}
                className={`ai-avatar-frame ${isActive ? 'active' : 'inactive'}`}
                draggable={false}
              />
            </picture>
          );
        })}
      </div>

      {/* Ánh sáng và viền bóng nhẹ nhàng */}
      <div className="ai-avatar-vignette" />
    </div>
  );
}
