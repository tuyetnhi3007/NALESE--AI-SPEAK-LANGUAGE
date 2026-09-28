// ============================================================
// components/hooks/useBlink.ts — Hook điều khiển chớp mắt tự nhiên (v2)
//
// CẢI TIẾN v2:
// 1. Chớp mắt mượt: opacity 0 → 1 trong ~50ms, giữ ~60ms, 1 → 0 trong ~90ms
//    (tổng ~200ms). KHÔNG dùng bước nhảy tức thời.
// 2. CHỈ chớp khi openness < 0.15 (miệng gần khép).
//    Nếu đang nói, hoãn tới khi miệng gần khép (tối đa 1 giây, rồi bỏ qua).
// 3. Khoảng cách 2.5-6s, thỉnh thoảng (~15%) chớp đôi.
// 4. Hỗ trợ prefers-reduced-motion.
// 5. Tạm dừng khi tab ẩn.
// ============================================================

import { useEffect, useRef, useCallback } from 'react';

// ============================================================
// HẰNG SỐ CÓ THỂ ĐIỀU CHỈNH — ĐẶT Ở ĐẦU FILE ĐỂ TINH CHỈNH
// ============================================================
export const BLINK_CONSTANTS = {
  // ─── 1. Thời lượng chớp mắt (ms) ──────────────────────────
  FADE_IN_MS: 50,     // Nhắm mắt: opacity 0 → 1
  HOLD_MS: 60,        // Giữ nhắm
  FADE_OUT_MS: 90,    // Mở mắt: opacity 1 → 0
  // Tổng ~200ms cho 1 lần chớp

  // ─── 2. Khoảng cách giữa các lần chớp (ms) ───────────────
  MIN_INTERVAL_MS: 2500,
  MAX_INTERVAL_MS: 6000,

  // ─── 3. Chớp đôi (Double Blink) ──────────────────────────
  DOUBLE_BLINK_CHANCE: 0.15,
  DOUBLE_BLINK_GAP_MS: 200,

  // ─── 4. Ngưỡng openness cho phép chớp ────────────────────
  MAX_OPENNESS_FOR_BLINK: 0.15,

  // ─── 5. Hoãn chớp khi đang mở miệng ─────────────────────
  MAX_POSTPONE_MS: 1000,
  POSTPONE_CHECK_INTERVAL_MS: 80,

  // ─── 6. Chế độ giảm chuyển động ──────────────────────────
  REDUCED_MOTION_INTERVAL_MS: 9000,
};

export interface UseBlinkOptions {
  isSpeaking: boolean;
  getOpenness: () => number;
  onBlinkOpacity: (opacity: number) => void;
}

export function useBlink({
  isSpeaking,
  getOpenness,
  onBlinkOpacity,
}: UseBlinkOptions) {
  const isSpeakingRef = useRef<boolean>(isSpeaking);
  isSpeakingRef.current = isSpeaking;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postponeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postponedDurationRef = useRef<number>(0);
  const blinkRafRef = useRef<number | null>(null);

  const isBlinkingRef = useRef<boolean>(false);
  const isTabHiddenRef = useRef<boolean>(false);
  const isReducedMotionRef = useRef<boolean>(false);

  // Callback refs to avoid re-render loops
  const onBlinkOpacityRef = useRef(onBlinkOpacity);
  onBlinkOpacityRef.current = onBlinkOpacity;
  const getOpennessRef = useRef(getOpenness);
  getOpennessRef.current = getOpenness;

  // ─── Dọn sạch timer ──────────────────────────────────────
  const clearAllTimers = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (postponeTimerRef.current) {
      clearTimeout(postponeTimerRef.current);
      postponeTimerRef.current = null;
    }
    if (blinkRafRef.current !== null) {
      cancelAnimationFrame(blinkRafRef.current);
      blinkRafRef.current = null;
    }
  }, []);

  // ─── Thực thi 1 lần chớp mượt (3 pha: fade-in, hold, fade-out) ─
  const executeSmoothBlink = useCallback(
    (onComplete?: () => void) => {
      isBlinkingRef.current = true;

      const startTime = performance.now();
      const fadeInEnd = startTime + BLINK_CONSTANTS.FADE_IN_MS;
      const holdEnd = fadeInEnd + BLINK_CONSTANTS.HOLD_MS;
      const fadeOutEnd = holdEnd + BLINK_CONSTANTS.FADE_OUT_MS;

      const blinkFrame = (now: number) => {
        if (now < fadeInEnd) {
          // Phase 1: Fade in (nhắm mắt)
          const progress = (now - startTime) / BLINK_CONSTANTS.FADE_IN_MS;
          onBlinkOpacityRef.current(Math.min(1, progress));
          blinkRafRef.current = requestAnimationFrame(blinkFrame);
        } else if (now < holdEnd) {
          // Phase 2: Hold (giữ nhắm)
          onBlinkOpacityRef.current(1);
          blinkRafRef.current = requestAnimationFrame(blinkFrame);
        } else if (now < fadeOutEnd) {
          // Phase 3: Fade out (mở mắt)
          const progress = (now - holdEnd) / BLINK_CONSTANTS.FADE_OUT_MS;
          onBlinkOpacityRef.current(Math.max(0, 1 - progress));
          blinkRafRef.current = requestAnimationFrame(blinkFrame);
        } else {
          // Hoàn tất
          onBlinkOpacityRef.current(0);
          isBlinkingRef.current = false;
          blinkRafRef.current = null;
          if (onComplete) onComplete();
        }
      };

      blinkRafRef.current = requestAnimationFrame(blinkFrame);
    },
    []
  );

  // ─── Lên lịch chớp tiếp theo ─────────────────────────────
  const scheduleNextBlink = useCallback(() => {
    clearAllTimers();
    if (isTabHiddenRef.current) return;

    postponedDurationRef.current = 0;

    let delay: number;
    if (isReducedMotionRef.current) {
      delay = BLINK_CONSTANTS.REDUCED_MOTION_INTERVAL_MS;
    } else {
      delay =
        BLINK_CONSTANTS.MIN_INTERVAL_MS +
        Math.random() * (BLINK_CONSTANTS.MAX_INTERVAL_MS - BLINK_CONSTANTS.MIN_INTERVAL_MS);
    }

    timerRef.current = setTimeout(() => {
      triggerBlinkCycle();
    }, delay);
  }, [clearAllTimers]);

  // ─── Vòng lặp kích hoạt chớp mắt ────────────────────────
  const triggerBlinkCycle = useCallback(() => {
    if (isTabHiddenRef.current) return;

    const openness = getOpennessRef.current();

    // CHỈ chớp khi openness < 0.15 (miệng gần khép)
    if (openness >= BLINK_CONSTANTS.MAX_OPENNESS_FOR_BLINK) {
      if (postponedDurationRef.current < BLINK_CONSTANTS.MAX_POSTPONE_MS) {
        postponedDurationRef.current += BLINK_CONSTANTS.POSTPONE_CHECK_INTERVAL_MS;
        postponeTimerRef.current = setTimeout(
          triggerBlinkCycle,
          BLINK_CONSTANTS.POSTPONE_CHECK_INTERVAL_MS
        );
        return;
      }
      // Hoãn quá 1s → bỏ qua lượt chớp này
      scheduleNextBlink();
      return;
    }

    // Miệng khép → thực hiện chớp
    executeSmoothBlink(() => {
      // Kiểm tra chớp đôi (~15%)
      const shouldDoubleBlink =
        !isReducedMotionRef.current &&
        Math.random() < BLINK_CONSTANTS.DOUBLE_BLINK_CHANCE;

      if (shouldDoubleBlink) {
        timerRef.current = setTimeout(() => {
          if (getOpennessRef.current() < BLINK_CONSTANTS.MAX_OPENNESS_FOR_BLINK) {
            executeSmoothBlink(() => {
              scheduleNextBlink();
            });
          } else {
            scheduleNextBlink();
          }
        }, BLINK_CONSTANTS.DOUBLE_BLINK_GAP_MS);
      } else {
        scheduleNextBlink();
      }
    });
  }, [executeSmoothBlink, scheduleNextBlink]);

  // ─── Kiểm tra prefers-reduced-motion ─────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      isReducedMotionRef.current = mediaQuery.matches;

      const handler = (e: MediaQueryListEvent) => {
        isReducedMotionRef.current = e.matches;
      };
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    } catch {}
  }, []);

  // ─── Bắt đầu chu kỳ chớp mắt ────────────────────────────
  useEffect(() => {
    scheduleNextBlink();
    return () => {
      clearAllTimers();
      onBlinkOpacityRef.current(0);
    };
  }, [scheduleNextBlink, clearAllTimers]);

  // ─── Quản lý tab ẩn/hiện ─────────────────────────────────
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        isTabHiddenRef.current = true;
        clearAllTimers();
        if (isBlinkingRef.current) {
          isBlinkingRef.current = false;
          onBlinkOpacityRef.current(0);
        }
      } else {
        isTabHiddenRef.current = false;
        scheduleNextBlink();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [clearAllTimers, scheduleNextBlink]);

  return {
    isBlinking: isBlinkingRef.current,
  };
}
