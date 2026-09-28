// ============================================================
// components/hooks/useLipSync.ts — Nguồn Openness cho AICharacterCanvas
//
// 1. Trả về hàm getOpenness() đọc trực tiếp từ useRef (0..1), ZERO React re-render.
// 2. Nếu có audio stream thực (HTMLAudioElement / MediaStream):
//    Dùng AnalyserNode (fftSize 256, dải 100Hz-4kHz, noise gate 0.04, làm mượt EMA alpha ~0.4).
// 3. Nếu TTS dùng speechSynthesis (không lấy được audio stream):
//    Trong lúc đang nói, cứ 90-170ms đặt lại openness ngẫu nhiên:
//    - 35% trong khoảng 0.2 - 0.5
//    - 30% trong khoảng 0.5 - 0.9
//    - 20% trong khoảng 0.05 - 0.2
//    - 15% gần 0 (0 - 0.04)
// 4. Khi audio/TTS kết thúc: chỉ đặt openness = 0.
//    Tuyệt đối không ẩn, không unmount, không đổi ảnh, không đổi state của avatar.
// ============================================================

import { useEffect, useRef, useCallback } from 'react';

// ============================================================
// HẰNG SỐ DỄ CHỈNH
// ============================================================
export const LIPSYNC_CONSTANTS = {
  // Web Audio Analyser
  MIN_VOICE_FREQ_HZ: 100,
  MAX_VOICE_FREQ_HZ: 4000,
  FFT_SIZE: 256,
  SMOOTHING_TIME_CONSTANT: 0.6,
  NOISE_GATE: 0.04,
  EMA_ALPHA: 0.4, // Hệ số làm mượt Exponential Moving Average

  // TTS Simulation (SpeechSynthesis)
  TTS_INTERVAL_MIN_MS: 90,
  TTS_INTERVAL_MAX_MS: 170,
  DIST_MID_LOW: 0.35,   // 35% trong 0.2-0.5
  DIST_MID_HIGH: 0.30,  // 30% trong 0.5-0.9
  DIST_LOW: 0.20,       // 20% trong 0.05-0.2
  DIST_NEAR_ZERO: 0.15, // 15% gần 0
} as const;

export type MouthState = 'closed' | 'small' | 'wide';

export interface UseLipSyncOptions {
  /** Có đang phát âm thanh AI không */
  isSpeaking: boolean;
  /** Nguồn thẻ audio (nếu dùng HTML5 audio) */
  audioElement?: HTMLAudioElement | null;
  /** Nguồn audio source hoặc MediaStream */
  audioSource?: HTMLAudioElement | MediaStream | null;
  /** Âm lượng tùy chọn truyền vào thủ công (0 đến 1) */
  audioLevel?: number;
}

const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export function useLipSync({
  isSpeaking,
  audioElement,
  audioSource,
  audioLevel,
}: UseLipSyncOptions) {
  const opennessRef = useRef<number>(0);
  const isSpeakingRef = useRef<boolean>(isSpeaking);
  isSpeakingRef.current = isSpeaking;

  // Web Audio refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | MediaElementAudioSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const emaRef = useRef<number>(0);

  // TTS simulation timer ref
  const ttsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hàm trả về openness đọc từ ref
  const getOpenness = useCallback((): number => {
    return opennessRef.current;
  }, []);

  // Alias getTargetOpenness để tương thích ngược
  const getTargetOpenness = getOpenness;

  // ─── 1. XỬ LÝ AUDIO LEVEL TRỰC TIẾP (nếu có) ─────────────────
  useEffect(() => {
    if (typeof audioLevel === 'number') {
      opennessRef.current = clamp(audioLevel);
    }
  }, [audioLevel]);

  // ─── 2. WEB AUDIO API (ANALYSER NODE VỚI EMA ~0.4) ────────────
  const activeSource = audioSource || audioElement;

  useEffect(() => {
    if (!activeSource || typeof window === 'undefined') return;

    let isCancelled = false;
    let dataArray: Uint8Array<ArrayBuffer> | null = null;

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = audioCtxRef.current || new AudioCtx();
      audioCtxRef.current = ctx;

      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const analyser = ctx.createAnalyser();
      analyser.fftSize = LIPSYNC_CONSTANTS.FFT_SIZE;
      analyser.smoothingTimeConstant = LIPSYNC_CONSTANTS.SMOOTHING_TIME_CONSTANT;
      analyserRef.current = analyser;

      if (activeSource instanceof MediaStream) {
        sourceNodeRef.current = ctx.createMediaStreamSource(activeSource);
        sourceNodeRef.current.connect(analyser);
      } else if (activeSource instanceof HTMLAudioElement) {
        sourceNodeRef.current = ctx.createMediaElementSource(activeSource);
        sourceNodeRef.current.connect(analyser);
        analyser.connect(ctx.destination);
      }

      const bufferLength = analyser.frequencyBinCount;
      dataArray = new Uint8Array(bufferLength) as Uint8Array<ArrayBuffer>;

      // Xác định dải tần 100Hz - 4kHz
      const binWidth = ctx.sampleRate / LIPSYNC_CONSTANTS.FFT_SIZE;
      const minBin = Math.max(0, Math.floor(LIPSYNC_CONSTANTS.MIN_VOICE_FREQ_HZ / binWidth));
      const maxBin = Math.min(bufferLength - 1, Math.ceil(LIPSYNC_CONSTANTS.MAX_VOICE_FREQ_HZ / binWidth));

      const analyzeLoop = () => {
        if (isCancelled) return;

        if (isSpeakingRef.current && dataArray && analyserRef.current) {
          analyserRef.current.getByteFrequencyData(dataArray);

          let sum = 0;
          let count = 0;
          for (let i = minBin; i <= maxBin; i++) {
            sum += dataArray[i];
            count++;
          }
          const avg = count > 0 ? sum / (count * 255) : 0;

          let normalized = 0;
          if (avg >= LIPSYNC_CONSTANTS.NOISE_GATE) {
            normalized = clamp((avg - LIPSYNC_CONSTANTS.NOISE_GATE) / (1 - LIPSYNC_CONSTANTS.NOISE_GATE));
          }

          // Làm mượt nhẹ bằng EMA hệ số ~0.4
          emaRef.current = emaRef.current * (1 - LIPSYNC_CONSTANTS.EMA_ALPHA) + normalized * LIPSYNC_CONSTANTS.EMA_ALPHA;
          opennessRef.current = emaRef.current;
        } else if (!isSpeakingRef.current) {
          emaRef.current = 0;
          opennessRef.current = 0;
        }

        rafRef.current = requestAnimationFrame(analyzeLoop);
      };

      rafRef.current = requestAnimationFrame(analyzeLoop);
    } catch (err) {
      console.warn('[useLipSync] Web Audio init skipped/failed, using simulation fallback:', err);
    }

    return () => {
      isCancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      try {
        sourceNodeRef.current?.disconnect();
        analyserRef.current?.disconnect();
      } catch {}
    };
  }, [activeSource]);

  // ─── 3. TTS SIMULATION FALLBACK (SpeechSynthesis) ──────────────
  // Khi dùng speechSynthesis của trình duyệt (không có Web Audio stream)
  useEffect(() => {
    if (activeSource) return;

    if (ttsTimerRef.current) {
      clearTimeout(ttsTimerRef.current);
      ttsTimerRef.current = null;
    }

    if (!isSpeaking) {
      // Khi TTS kết thúc: chỉ đặt openness = 0
      opennessRef.current = 0;
      return;
    }

    let isMounted = true;

    const scheduleNext = () => {
      if (!isMounted || !isSpeakingRef.current) {
        opennessRef.current = 0;
        return;
      }

      // Xác suất phân bố:
      // 35% trong [0.2, 0.5]
      // 30% trong [0.5, 0.9]
      // 20% trong [0.05, 0.2]
      // 15% gần 0
      const r = Math.random();
      let target: number;
      if (r < LIPSYNC_CONSTANTS.DIST_MID_LOW) {
        target = rand(0.2, 0.5);
      } else if (r < LIPSYNC_CONSTANTS.DIST_MID_LOW + LIPSYNC_CONSTANTS.DIST_MID_HIGH) {
        target = rand(0.5, 0.9);
      } else if (r < 1 - LIPSYNC_CONSTANTS.DIST_NEAR_ZERO) {
        target = rand(0.05, 0.2);
      } else {
        target = rand(0, 0.04);
      }

      opennessRef.current = clamp(target);

      const delay = rand(
        LIPSYNC_CONSTANTS.TTS_INTERVAL_MIN_MS,
        LIPSYNC_CONSTANTS.TTS_INTERVAL_MAX_MS
      );
      ttsTimerRef.current = setTimeout(scheduleNext, delay);
    };

    // Đặt openness ban đầu khi bắt đầu nói
    opennessRef.current = rand(0.3, 0.6);
    const initialDelay = rand(
      LIPSYNC_CONSTANTS.TTS_INTERVAL_MIN_MS,
      LIPSYNC_CONSTANTS.TTS_INTERVAL_MAX_MS
    );
    ttsTimerRef.current = setTimeout(scheduleNext, initialDelay);

    return () => {
      isMounted = false;
      if (ttsTimerRef.current) {
        clearTimeout(ttsTimerRef.current);
        ttsTimerRef.current = null;
      }
      opennessRef.current = 0;
    };
  }, [isSpeaking, activeSource]);

  return {
    getOpenness,
    getTargetOpenness,
    opennessRef,
  };
}
