'use client';
// ============================================================
// components/AudioWaveformVisualizer.tsx
// Dải sóng âm thanh (Web Audio API + Canvas) + Nút micro tròn 88px ở giữa
// Màu đặc var(--accent) #C2693A (opacity 0.8), không gradient
// Thanh rộng 3px, cách nhau 4px, đầu bo tròn
// ============================================================

import React, { useEffect, useRef, useCallback } from 'react';
import { Mic, Volume2, Square } from 'lucide-react';
import type { TutorState } from './AICharacterAvatar';

export interface AudioWaveformVisualizerProps {
  tutorState: TutorState;
  mediaStream: MediaStream | null;
  onMainButtonClick: () => void;
  silenceCountdown: number | null;
  isSpeechSupported: boolean;
}

// Mảng offset độ cao tự nhiên cố định (không đều tăm tắp như sóng thật)
const NATURAL_OFFSETS = [
  6, 8, 5, 11, 7, 12, 8, 14, 9, 13, 7, 15,
  10, 14, 8, 12, 7, 13, 8, 10, 6, 9, 5, 7,
];

export default function AudioWaveformVisualizer({
  tutorState,
  mediaStream,
  onMainButtonClick,
  silenceCountdown,
  isSpeechSupported,
}: AudioWaveformVisualizerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Web Audio API refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const freqDataRef = useRef<Uint8Array | null>(null);
  const animIdRef = useRef<number>(0);

  // 48 thanh: 24 thanh bên trái, 24 thanh bên phải
  const TOTAL_BARS = 48;
  const barHeightsRef = useRef<Float32Array>(new Float32Array(TOTAL_BARS).fill(8));

  // Kết nối Web Audio API khi có mediaStream
  useEffect(() => {
    if (sourceRef.current) {
      try { sourceRef.current.disconnect(); } catch {}
      sourceRef.current = null;
    }

    if (!mediaStream || !mediaStream.active) {
      analyserRef.current = null;
      freqDataRef.current = null;
      return;
    }

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.78;
      const source = ctx.createMediaStreamSource(mediaStream);
      source.connect(analyser);
      analyserRef.current = analyser;
      sourceRef.current = source;
      freqDataRef.current = new Uint8Array(analyser.frequencyBinCount);
    } catch (err) {
      console.warn('[AudioWaveform] Web Audio API init error:', err);
    }

    return () => {
      if (sourceRef.current) {
        try { sourceRef.current.disconnect(); } catch {}
        sourceRef.current = null;
      }
    };
  }, [mediaStream]);

  // Vòng lặp render Canvas
  useEffect(() => {
    let isCancelled = false;

    const render = (timestamp: number) => {
      if (isCancelled) return;

      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) {
        animIdRef.current = requestAnimationFrame(render);
        return;
      }

      const rect = container.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      if (width <= 0 || height <= 0) {
        animIdRef.current = requestAnimationFrame(render);
        return;
      }

      // Xử lý devicePixelRatio để canvas sắc nét
      const dpr = window.devicePixelRatio || 1;
      const targetW = Math.floor(width * dpr);
      const targetH = Math.floor(height * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        animIdRef.current = requestAnimationFrame(render);
        return;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;

      // Nút micro đường kính 88px (bán kính 44px). Chừa khoảng trống 16px quanh nút => bán kính vùng cấm 60px
      const clearanceRadius = 60;
      const padLeft = Math.max(8, width * 0.02);
      const padRight = Math.max(8, width * 0.02);

      const barsPerSide = TOTAL_BARS / 2; // 24 thanh mỗi bên
      const leftStart = padLeft;
      const leftEnd = cx - clearanceRadius;
      const rightStart = cx + clearanceRadius;
      const rightEnd = width - padRight;

      const dxLeft = Math.max(2, (leftEnd - leftStart) / (barsPerSide - 1));
      const dxRight = Math.max(2, (rightEnd - rightStart) / (barsPerSide - 1));
      const barWidth = 3; // Rộng 3px theo yêu cầu

      const minH = 6;
      const maxH = Math.min(height - 16, 92);

      // Lấy dữ liệu tần số từ AnalyserNode
      const isListening = tutorState === 'listening' || tutorState === 'waiting';
      const analyser = analyserRef.current;
      const freqData = freqDataRef.current;
      if (isListening && analyser && freqData) {
        analyser.getByteFrequencyData(freqData as unknown as Uint8Array<ArrayBuffer>);
      }

      const currentHeights = barHeightsRef.current;
      const timeSec = timestamp * 0.001;

      // Màu đặc var(--accent) với opacity 0.8, KHÔNG gradient
      ctx.fillStyle = 'rgba(194, 105, 58, 0.8)';

      for (let i = 0; i < TOTAL_BARS; i++) {
        let x = 0;
        let sideIndex = 0;
        const isLeftSide = i < barsPerSide;

        if (isLeftSide) {
          x = leftStart + i * dxLeft;
          sideIndex = i;
        } else {
          const rIndex = i - barsPerSide;
          x = rightStart + rIndex * dxRight;
          sideIndex = 23 - rIndex;
        }

        let targetBarH = minH;

        if (isListening && freqData) {
          // Trạng thái đang ghi âm: nhảy theo giọng nói thật
          const binIndex = Math.min(freqData.length - 1, 2 + Math.floor(sideIndex * 1.8));
          const val = freqData[binIndex] / 255;
          const boosted = Math.pow(val, 1.2) * 1.6;
          const clamped = Math.min(1, Math.max(0, boosted));
          targetBarH = minH + clamped * (maxH - minH);
        } else if (tutorState === 'speaking') {
          // Trạng thái AI đang nói (TTS): animation giả lập mượt mà
          const syllable = Math.max(0.15, Math.sin(timeSec * 3.5) * Math.cos(timeSec * 1.7) + 0.6);
          const wave = Math.sin(timeSec * 7.5 + i * 0.35) * 0.45 + Math.cos(timeSec * 10 - i * 0.25) * 0.35 + 0.55;
          targetBarH = minH + syllable * wave * (maxH * 0.72 - minH);
        } else if (tutorState === 'thinking') {
          // Đang xử lý
          const pulse = Math.sin(timeSec * 4 - i * 0.25) * 0.5 + 0.5;
          targetBarH = minH + Math.pow(pulse, 2.5) * 20;
        } else {
          // Sẵn sàng: các thanh độ cao khác nhau nhẹ như sóng thật, thở rất nhẹ
          const baseNatural = NATURAL_OFFSETS[sideIndex % NATURAL_OFFSETS.length];
          const breathe = Math.sin(timeSec * 1.6 + i * 0.2) * 2;
          targetBarH = Math.max(minH, baseNatural + breathe);
        }

        // Lerp mượt mà
        const lerpFactor = isListening ? 0.32 : 0.18;
        currentHeights[i] += (targetBarH - currentHeights[i]) * lerpFactor;
        const h = Math.max(minH, currentHeights[i]);

        // Vẽ thanh dọc bo tròn 2 đầu đối xứng qua tâm cy
        const topY = cy - h / 2;
        const radius = barWidth / 2;

        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(x - barWidth / 2, topY, barWidth, h, radius);
        } else {
          ctx.moveTo(x - radius, topY + radius);
          ctx.arc(x, topY + radius, radius, Math.PI, 0, false);
          ctx.lineTo(x + radius, topY + h - radius);
          ctx.arc(x, topY + h - radius, radius, 0, Math.PI, false);
          ctx.closePath();
        }
        ctx.fill();
      }

      ctx.restore();
      animIdRef.current = requestAnimationFrame(render);
    };

    animIdRef.current = requestAnimationFrame(render);

    return () => {
      isCancelled = true;
      cancelAnimationFrame(animIdRef.current);
    };
  }, [tutorState]);

  // Dọn dẹp AudioContext khi unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animIdRef.current);
      if (sourceRef.current) {
        try { sourceRef.current.disconnect(); } catch {}
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        try { audioCtxRef.current.close(); } catch {}
      }
    };
  }, []);

  // Icon bên trong nút micro
  const renderIcon = useCallback(() => {
    if (tutorState === 'thinking') {
      return (
        <span className="flex items-center gap-1.5" aria-label="Đang xử lý">
          {[0, 0.15, 0.3].map((delay) => (
            <span
              key={delay}
              className="block w-2.5 h-2.5 rounded-full bg-white animate-bounce"
              style={{ animationDelay: `${delay}s` }}
            />
          ))}
        </span>
      );
    }
    if (tutorState === 'speaking') {
      return <Volume2 size={36} className="text-white" />;
    }
    if (tutorState === 'listening' || tutorState === 'waiting') {
      return <Square size={28} className="text-white fill-white" />;
    }
    return <Mic size={36} className="text-white" />;
  }, [tutorState]);

  const isRecording = tutorState === 'listening' || tutorState === 'waiting';

  return (
    <div ref={containerRef} className="waveform-container select-none">
      {/* Canvas vẽ các thanh dải sóng */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />

      {/* Vòng pulse mảnh lan tỏa quanh nút khi đang ghi âm */}
      {isRecording && (
        <div className="waveform-pulse-wrapper">
          <div className="waveform-pulse-line waveform-pulse-line-1" />
          <div className="waveform-pulse-line waveform-pulse-line-2" />
        </div>
      )}

      {/* Nút micro tròn đường kính 88px ở chính giữa */}
      <button
        type="button"
        id="main-voice-mic-button"
        onClick={onMainButtonClick}
        disabled={!isSpeechSupported && tutorState === 'idle'}
        aria-label={isRecording ? 'Dừng ghi âm' : tutorState === 'speaking' ? 'Dừng phát' : 'Bắt đầu nói'}
        className={`waveform-mic-btn ${isRecording ? 'recording' : ''}`}
      >
        {renderIcon()}
      </button>
    </div>
  );
}
