'use client';
// ============================================================
// components/RecordButtonOverlay.tsx — Nút ghi âm floating badge
//
// Overlay lên cạnh dưới khung nhân vật AI (tương tự nút điều khiển
// cuộc gọi video). Phản ứng theo cường độ âm thanh mic thời gian
// thực thông qua Web Audio API (AnalyserNode).
// ============================================================

import React, { useEffect, useRef, useCallback } from 'react';
import { Mic, Volume2, Square } from 'lucide-react';
import type { TutorState } from './AICharacterAvatar';

interface RecordButtonOverlayProps {
  tutorState: TutorState;
  silenceCountdown: number | null;
  isSpeechSupported: boolean;
  onMainButtonClick: () => void;
  mediaStream: MediaStream | null;
}

const STATE_BADGE_CONFIG: Record<TutorState, { label: string; badgeClass: string; helperText: string }> = {
  idle: {
    label: 'SẴN SÀNG',
    badgeClass: 'overlay-status-idle',
    helperText: 'Nhấn để bắt đầu, hệ thống tự nhận diện sau 3 giây im lặng',
  },
  listening: {
    label: '🎤 Đang lắng nghe...',
    badgeClass: 'overlay-status-listening',
    helperText: 'Nói tự nhiên, hệ thống đang lắng nghe bạn',
  },
  waiting: {
    label: '⏳ Đang chờ...',
    badgeClass: 'overlay-status-waiting',
    helperText: '', // Được hiển thị động cùng silenceCountdown
  },
  thinking: {
    label: '🤖 Đang xử lý...',
    badgeClass: 'overlay-status-thinking',
    helperText: 'Đang chấm điểm phát âm & soạn câu trả lời...',
  },
  speaking: {
    label: '🔊 AI đang trả lời...',
    badgeClass: 'overlay-status-speaking',
    helperText: 'Nhấn nút để dừng nghe',
  },
};

export default function RecordButtonOverlay({
  tutorState,
  silenceCountdown,
  isSpeechSupported,
  onMainButtonClick,
  mediaStream,
}: RecordButtonOverlayProps) {
  const isActive = tutorState !== 'idle';
  const badgeState = tutorState === 'waiting' ? 'listening' : tutorState;
  const config = STATE_BADGE_CONFIG[tutorState];

  // ─── Web Audio API: Phân tích cường độ âm thanh mic theo thời gian thực ─
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animRef = useRef<number>(0);
  const volumeRef = useRef<number>(0);
  const micBtnRef = useRef<HTMLButtonElement>(null);
  const rippleContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Teardown kết nối cũ
    if (sourceRef.current) {
      try { sourceRef.current.disconnect(); } catch {}
      sourceRef.current = null;
    }

    if (!mediaStream || !mediaStream.active) {
      analyserRef.current = null;
      return;
    }

    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      const source = ctx.createMediaStreamSource(mediaStream);
      source.connect(analyser);
      analyserRef.current = analyser;
      sourceRef.current = source;
    } catch (e) {
      console.warn('[RecordButtonOverlay] Web Audio API error:', e);
    }

    return () => {
      if (sourceRef.current) {
        try { sourceRef.current.disconnect(); } catch {}
        sourceRef.current = null;
      }
    };
  }, [mediaStream]);

  // Vòng lặp animation: Đọc volume và áp dụng CSS transform/ripple
  useEffect(() => {
    const isListening = tutorState === 'listening' || tutorState === 'waiting';

    const tick = () => {
      if (analyserRef.current && isListening) {
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length) / 255;
        volumeRef.current = rms;
      } else {
        volumeRef.current *= 0.88; // Giảm dần khi ngừng nói
      }

      const v = volumeRef.current;

      // Scale nút mic theo âm lượng
      if (micBtnRef.current) {
        const scale = 1 + v * 0.28;
        micBtnRef.current.style.transform = `scale(${scale})`;
      }

      // Điều khiển độ lan tỏa và độ mờ của vòng sóng ripple
      if (rippleContainerRef.current) {
        const opacity = Math.min(1, v * 2.8);
        const rippleScale = 1.35 + v * 1.3;
        rippleContainerRef.current.style.setProperty('--ripple-opacity', String(opacity));
        rippleContainerRef.current.style.setProperty('--ripple-scale', String(rippleScale));
      }

      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [tutorState]);

  // Dọn dẹp AudioContext khi unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        try { audioCtxRef.current.close(); } catch {}
      }
    };
  }, []);

  const renderIcon = useCallback(() => {
    if (tutorState === 'thinking') {
      return (
        <span className="flex items-center gap-1">
          {[0, 0.15, 0.3].map((d) => (
            <span
              key={d}
              className="block w-2 h-2 rounded-full bg-amber-400 animate-bounce"
              style={{ animationDelay: `${d}s` }}
            />
          ))}
        </span>
      );
    }
    if (tutorState === 'speaking') {
      return <Volume2 size={26} className="text-emerald-500 animate-pulse" />;
    }
    if (tutorState === 'listening' || tutorState === 'waiting') {
      return <Square size={20} className="text-rose-500" fill="currentColor" />;
    }
    return <Mic size={26} className="text-purple-600" />;
  }, [tutorState]);

  return (
    <div className="record-button-overlay">
      <div className="record-overlay-card">
        {/* Nút Mic + Hiệu ứng sóng lan tỏa (Ripples) */}
        <div className="record-overlay-mic-container">
          <div ref={rippleContainerRef} className="record-overlay-ripples">
            {(tutorState === 'listening' || tutorState === 'waiting') && (
              <>
                <div className="overlay-ripple overlay-ripple-1" />
                <div className="overlay-ripple overlay-ripple-2" />
                <div className="overlay-ripple overlay-ripple-3" />
              </>
            )}
          </div>

          <button
            ref={micBtnRef}
            id="mic-button"
            className={`record-overlay-btn ${badgeState}`}
            onClick={onMainButtonClick}
            aria-label={isActive ? 'Dừng' : 'Bắt đầu nói'}
            disabled={!isSpeechSupported && tutorState === 'idle'}
          >
            {renderIcon()}
          </button>
        </div>

        {/* Thông tin trạng thái và hướng dẫn */}
        <div className="record-overlay-info">
          <div className="flex items-center gap-2">
            <span className={`record-overlay-badge ${config.badgeClass}`}>
              {config.label}
            </span>

            {tutorState === 'waiting' && silenceCountdown !== null && (
              <span className="text-xs font-semibold text-amber-600 tabular-nums">
                Gửi sau {silenceCountdown}s im lặng
              </span>
            )}
          </div>

          <p className="record-overlay-helper">
            {tutorState === 'waiting'
              ? 'Hệ thống chuẩn bị gửi câu trả lời...'
              : config.helperText}
          </p>
        </div>
      </div>
    </div>
  );
}
