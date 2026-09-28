// ============================================================
// components/hooks/useContinuousLipSync.ts — Lip-sync liên tục (openness 0→1)
//
// Thay thế useLipSync cũ (3 trạng thái rời rạc) bằng giá trị "openness"
// liên tục, giúp chuyển động môi mượt mà tự nhiên, KHÔNG BAO GIỜ nháy.
//
// 2 chế độ:
// 1. Web Audio API (AnalyserNode): phân tích phổ 100Hz-4kHz, tính RMS.
// 2. Fallback Simulation: chuỗi giá trị openness mục tiêu ngẫu nhiên
//    (cho speechSynthesis browser, không lấy được audio stream).
//
// Đầu ra: openness (0→1) → ánh xạ tích lũy sang opacity 2 lớp:
//   smallOpacity = clamp(openness / 0.5, 0, 1)
//   wideOpacity  = clamp((openness - 0.5) / 0.5, 0, 1)
// ============================================================

import { useEffect, useRef, useCallback } from 'react';

// ============================================================
// HẰNG SỐ CÓ THỂ ĐIỀU CHỈNH — ĐẶT Ở ĐẦU FILE ĐỂ TINH CHỈNH
// ============================================================
export const CLIPSYNC_CONSTANTS = {
  // ─── 1. Web Audio API Voice Frequency Band ─────────────────
  MIN_VOICE_FREQ_HZ: 100,
  MAX_VOICE_FREQ_HZ: 4000,
  FFT_SIZE: 256,
  SMOOTHING_TIME_CONSTANT: 0.6,

  // ─── 2. Noise Gate ─────────────────────────────────────────
  NOISE_GATE: 0.04,

  // ─── 3. Attack / Release bất đối xứng ─────────────────────
  // Attack nhanh (miệng mở nhanh): ~60-80ms → hệ số ~0.5
  // Release chậm (miệng khép chậm): ~120-180ms → hệ số ~0.18
  ATTACK_COEFF: 0.5,
  RELEASE_COEFF: 0.18,

  // ─── 4. Jitter ngẫu nhiên (biến thiên nhỏ, tần số thấp) ──
  JITTER_AMPLITUDE: 0.05,
  JITTER_INTERVAL_MS: 120, // Đổi jitter mục tiêu mỗi 120ms

  // ─── 5. Easing nhẹ ─────────────────────────────────────────
  // easeOutQuad khi mở, easeInOutSine khi khép
  // Áp lên openness trước khi map ra opacity

  // ─── 6. Audio End Fadeout ──────────────────────────────────
  FADEOUT_MS: 200, // Giảm openness về 0 trong ~200ms khi kết thúc

  // ─── 7. Fallback TTS Simulation ────────────────────────────
  FALLBACK: {
    MIN_TARGET_INTERVAL_MS: 90,
    MAX_TARGET_INTERVAL_MS: 170,
    // Phân bố xác suất mục tiêu openness:
    // 35% khoảng 0.2-0.5, 30% khoảng 0.5-0.9,
    // 20% khoảng 0.05-0.2, 15% gần 0
    DIST_MID_LOW: 0.35,     // 0.2-0.5
    DIST_MID_HIGH: 0.30,    // 0.5-0.9
    DIST_LOW: 0.20,          // 0.05-0.2
    DIST_NEAR_ZERO: 0.15,    // 0-0.05
  },
};

// Re-export MouthState cho compatibility
export type MouthState = 'closed' | 'small' | 'wide';

// ─── Easing functions ───────────────────────────────────────
function easeOutQuad(t: number): number {
  return t * (2 - t);
}

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export interface UseContinuousLipSyncOptions {
  isSpeaking: boolean;
  audioElement?: HTMLAudioElement | null;
  audioSource?: HTMLAudioElement | MediaStream | null;
  audioLevel?: number;
  onOpennessChange: (
    openness: number,
    smallOpacity: number,
    wideOpacity: number
  ) => void;
}

export function useContinuousLipSync({
  isSpeaking,
  audioElement,
  audioSource,
  audioLevel,
  onOpennessChange,
}: UseContinuousLipSyncOptions) {
  const isSpeakingRef = useRef<boolean>(isSpeaking);
  isSpeakingRef.current = isSpeaking;

  // Giá trị openness hiện tại (thô, trước easing)
  const rawOpennessRef = useRef<number>(0);
  // Giá trị openness target (dùng cho fallback simulation)
  const targetOpennessRef = useRef<number>(0);
  // Jitter hiện tại
  const jitterRef = useRef<number>(0);
  const jitterTargetRef = useRef<number>(0);
  const lastJitterTimeRef = useRef<number>(0);

  // Web Audio API refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | MediaElementAudioSourceNode | null>(null);

  // Animation refs
  const rafIdRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);

  // Fallback timer
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fadeout tracking
  const isFadingOutRef = useRef<boolean>(false);
  const fadeoutStartRef = useRef<number>(0);
  const fadeoutStartOpennessRef = useRef<number>(0);

  // Mode tracking
  const hasAnalyserRef = useRef<boolean>(false);

  // Callback ref cho onOpennessChange (tránh re-render vòng lặp)
  const onOpennessChangeRef = useRef(onOpennessChange);
  onOpennessChangeRef.current = onOpennessChange;

  // ─── Tính & gửi opacity từ openness ────────────────────────
  const applyOpenness = useCallback((openness: number) => {
    // Áp easing
    let eased: number;
    if (openness >= rawOpennessRef.current) {
      // Đang mở → easeOutQuad
      eased = easeOutQuad(openness);
    } else {
      // Đang khép → easeInOutSine
      eased = easeInOutSine(openness);
    }

    // Ánh xạ tích lũy
    const smallOpacity = clamp(eased / 0.5, 0, 1);
    const wideOpacity = clamp((eased - 0.5) / 0.5, 0, 1);

    rawOpennessRef.current = openness;
    onOpennessChangeRef.current(eased, smallOpacity, wideOpacity);
  }, []);

  // ─── Fallback: sinh target openness ngẫu nhiên ────────────
  const generateRandomTarget = useCallback((): number => {
    const rand = Math.random();
    const F = CLIPSYNC_CONSTANTS.FALLBACK;
    if (rand < F.DIST_MID_LOW) {
      return 0.2 + Math.random() * 0.3; // 0.2 - 0.5
    } else if (rand < F.DIST_MID_LOW + F.DIST_MID_HIGH) {
      return 0.5 + Math.random() * 0.4; // 0.5 - 0.9
    } else if (rand < F.DIST_MID_LOW + F.DIST_MID_HIGH + F.DIST_LOW) {
      return 0.05 + Math.random() * 0.15; // 0.05 - 0.2
    } else {
      return Math.random() * 0.05; // 0 - 0.05
    }
  }, []);

  // ─── Dọn dẹp fallback timer ────────────────────────────────
  const clearFallbackTimer = useCallback(() => {
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  // ─── Dừng animation loop ──────────────────────────────────
  const stopAnimationLoop = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  // ─── SETUP Web Audio API ──────────────────────────────────
  const effectiveAudioSource = audioSource || audioElement;

  useEffect(() => {
    if (!effectiveAudioSource) {
      hasAnalyserRef.current = false;
      return;
    }

    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContextClass();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const analyser = ctx.createAnalyser();
      analyser.fftSize = CLIPSYNC_CONSTANTS.FFT_SIZE;
      analyser.smoothingTimeConstant = CLIPSYNC_CONSTANTS.SMOOTHING_TIME_CONSTANT;
      analyserRef.current = analyser;
      hasAnalyserRef.current = true;

      if (effectiveAudioSource instanceof HTMLAudioElement) {
        const source = ctx.createMediaElementSource(effectiveAudioSource);
        source.connect(analyser);
        analyser.connect(ctx.destination);
        sourceNodeRef.current = source;
      } else if (effectiveAudioSource instanceof MediaStream) {
        const source = ctx.createMediaStreamSource(effectiveAudioSource);
        source.connect(analyser);
        sourceNodeRef.current = source;
      }
    } catch (err) {
      console.warn('[useContinuousLipSync] Web Audio API init failed:', err);
      hasAnalyserRef.current = false;
    }

    return () => {
      if (sourceNodeRef.current) {
        try { sourceNodeRef.current.disconnect(); } catch {}
        sourceNodeRef.current = null;
      }
    };
  }, [effectiveAudioSource]);

  // ─── MAIN ANIMATION LOOP ─────────────────────────────────
  useEffect(() => {
    if (!isSpeaking) {
      // Khi dừng nói → fadeout mượt rồi về 0
      clearFallbackTimer();

      if (rawOpennessRef.current > 0.01) {
        isFadingOutRef.current = true;
        fadeoutStartRef.current = performance.now();
        fadeoutStartOpennessRef.current = rawOpennessRef.current;

        const fadeoutLoop = (now: number) => {
          if (!isFadingOutRef.current) return;
          const elapsed = now - fadeoutStartRef.current;
          const progress = clamp(elapsed / CLIPSYNC_CONSTANTS.FADEOUT_MS, 0, 1);
          const newOpenness = fadeoutStartOpennessRef.current * (1 - progress);

          applyOpenness(newOpenness);

          if (progress < 1) {
            rafIdRef.current = requestAnimationFrame(fadeoutLoop);
          } else {
            applyOpenness(0);
            isFadingOutRef.current = false;
            rafIdRef.current = null;
          }
        };

        stopAnimationLoop();
        rafIdRef.current = requestAnimationFrame(fadeoutLoop);
      } else {
        applyOpenness(0);
      }

      return () => {
        isFadingOutRef.current = false;
        stopAnimationLoop();
      };
    }

    // ─── Bắt đầu nói ─────────────────────────────────────────
    isFadingOutRef.current = false;
    lastFrameTimeRef.current = performance.now();

    const hasAnalyser = hasAnalyserRef.current && analyserRef.current;

    // Chuẩn bị data arrays nếu có Web Audio
    let dataArray: Uint8Array<ArrayBuffer> | null = null;
    let minBin = 0;
    let maxBin = 0;

    if (hasAnalyser && analyserRef.current) {
      const analyser = analyserRef.current;
      const bufferLength = analyser.frequencyBinCount;
      dataArray = new Uint8Array(bufferLength) as Uint8Array<ArrayBuffer>;
      const sampleRate = audioCtxRef.current?.sampleRate || 44100;
      const hzPerBin = sampleRate / analyser.fftSize;
      minBin = Math.max(0, Math.floor(CLIPSYNC_CONSTANTS.MIN_VOICE_FREQ_HZ / hzPerBin));
      maxBin = Math.min(bufferLength - 1, Math.ceil(CLIPSYNC_CONSTANTS.MAX_VOICE_FREQ_HZ / hzPerBin));
    }

    // Nếu fallback: bắt đầu sinh target
    if (!hasAnalyser) {
      const scheduleNextTarget = () => {
        if (!isSpeakingRef.current) return;

        targetOpennessRef.current = generateRandomTarget();

        const delay =
          CLIPSYNC_CONSTANTS.FALLBACK.MIN_TARGET_INTERVAL_MS +
          Math.random() * (CLIPSYNC_CONSTANTS.FALLBACK.MAX_TARGET_INTERVAL_MS -
            CLIPSYNC_CONSTANTS.FALLBACK.MIN_TARGET_INTERVAL_MS);

        fallbackTimerRef.current = setTimeout(scheduleNextTarget, delay);
      };

      // Bắt đầu ngay với hé môi nhẹ
      targetOpennessRef.current = 0.3;
      const initialDelay = CLIPSYNC_CONSTANTS.FALLBACK.MIN_TARGET_INTERVAL_MS;
      fallbackTimerRef.current = setTimeout(scheduleNextTarget, initialDelay);
    }

    // ─── rAF Loop ────────────────────────────────────────────
    const animationLoop = (now: number) => {
      if (!isSpeakingRef.current && !isFadingOutRef.current) {
        rafIdRef.current = null;
        return;
      }

      const dt = Math.min(now - lastFrameTimeRef.current, 50); // Cap dt ở 50ms
      lastFrameTimeRef.current = now;

      let targetOpenness: number;

      if (hasAnalyser && analyserRef.current && dataArray) {
        // ─── Web Audio API path ──────────────────────────────
        analyserRef.current.getByteFrequencyData(dataArray);

        let sumSquares = 0;
        let binCount = 0;
        for (let i = minBin; i <= maxBin; i++) {
          const val = dataArray[i] / 255;
          sumSquares += val * val;
          binCount++;
        }
        const rms = binCount > 0 ? Math.sqrt(sumSquares / binCount) : 0;

        // Noise gate
        targetOpenness = rms < CLIPSYNC_CONSTANTS.NOISE_GATE ? 0 : clamp(rms * 2.5, 0, 1);
      } else if (typeof audioLevel === 'number' && audioLevel > 0) {
        // ─── Manual audioLevel override ─────────────────────
        targetOpenness = clamp(audioLevel, 0, 1);
      } else {
        // ─── Fallback simulation ────────────────────────────
        targetOpenness = targetOpennessRef.current;
      }

      // ─── Attack/Release bất đối xứng ─────────────────────
      const current = rawOpennessRef.current;
      const coeff = targetOpenness > current
        ? CLIPSYNC_CONSTANTS.ATTACK_COEFF
        : CLIPSYNC_CONSTANTS.RELEASE_COEFF;

      // Áp dụng smoothing theo dt (frame-rate independent)
      const alpha = 1 - Math.pow(1 - coeff, dt / 16.67); // Normalized to 60fps
      let smoothed = current + (targetOpenness - current) * alpha;

      // ─── Jitter nhẹ ngẫu nhiên ────────────────────────────
      if (now - lastJitterTimeRef.current > CLIPSYNC_CONSTANTS.JITTER_INTERVAL_MS) {
        jitterTargetRef.current = (Math.random() - 0.5) * 2 * CLIPSYNC_CONSTANTS.JITTER_AMPLITUDE;
        lastJitterTimeRef.current = now;
      }
      // Smooth jitter
      jitterRef.current += (jitterTargetRef.current - jitterRef.current) * 0.3;
      
      // Chỉ thêm jitter khi openness > 0.1 (tránh jitter khi miệng khép)
      if (smoothed > 0.1) {
        smoothed = clamp(smoothed + jitterRef.current, 0, 1);
      }

      applyOpenness(smoothed);

      rafIdRef.current = requestAnimationFrame(animationLoop);
    };

    rafIdRef.current = requestAnimationFrame(animationLoop);

    return () => {
      clearFallbackTimer();
      stopAnimationLoop();
    };
  }, [isSpeaking, audioLevel, applyOpenness, generateRandomTarget, clearFallbackTimer, stopAnimationLoop]);

  // ─── Visibility change: tạm dừng khi tab ẩn ──────────────
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        stopAnimationLoop();
        clearFallbackTimer();
        applyOpenness(0);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [stopAnimationLoop, clearFallbackTimer, applyOpenness]);

  // ─── Cleanup khi unmount ──────────────────────────────────
  useEffect(() => {
    return () => {
      stopAnimationLoop();
      clearFallbackTimer();
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        try { audioCtxRef.current.close(); } catch {}
      }
    };
  }, [stopAnimationLoop, clearFallbackTimer]);

  // ─── Public API ───────────────────────────────────────────
  const getOpenness = useCallback((): number => {
    return rawOpennessRef.current;
  }, []);

  // Legacy API: map openness → MouthState rời rạc cho useBlink
  const getCurrentMouth = useCallback((): MouthState => {
    const o = rawOpennessRef.current;
    if (o < 0.15) return 'closed';
    if (o < 0.5) return 'small';
    return 'wide';
  }, []);

  return {
    getOpenness,
    getCurrentMouth,
  };
}
