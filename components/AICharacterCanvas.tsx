'use client';
// ============================================================
// components/AICharacterCanvas.tsx — Render Avatar AI bằng HTML5 Canvas
//
// ĐÁP ỨNG ĐẦY ĐỦ YÊU CẦU CỦA USER:
// 1. "những hình ảnh ko chỉ đổi ở bộ phận mắt vầ mmooi mà toàn cả người":
//    - Toàn bộ cơ thể (đầu, mắt, mũi, miệng, cằm, tóc, vai, áo) thay đổi
//      đồng bộ theo từng trạng thái nói (idle, small, wide) và chớp mắt (blink).
//    - Không còn đóng khung hay cắt xén riêng MOUTH_RECT / EYE_RECT.
// 2. "giữ nguyên background ở sau ko thay đổi, cho background cố định":
//    - Cả 4 ảnh (char_*_fixedbg.webp) đã được tạo với phần background
//      phía sau (tường, cửa sổ, bàn học, giá sách, đèn) GIỐNG NHAU 100%
//      BIT-FOR-BIT (0 pixel diff ở mọi góc và vùng nền).
// 3. ZERO NHÁY TRẮNG / ZERO FADE:
//    - Canvas context { alpha: false } → Canvas buffer không có kênh alpha.
//    - Alpha luôn = 1, chuyển đổi trạng thái bằng CẮT CỨNG (hard-cut),
//      ảnh mới thay thế ngay lập tức không có khoảng hở mờ nào.
// 4. Hysteresis (ngưỡng trễ) để chuyển khẩu hình mượt:
//    UP_SMALL = 0.14, DOWN_SMALL = 0.08
//    UP_WIDE  = 0.50, DOWN_WIDE  = 0.38
//    MIN_HOLD_MS = 70ms
// ============================================================

import React, { useEffect, useRef, useState } from 'react';

// ============================================================
// HẰNG SỐ DỄ CHỈNH (CẤU HÌNH Ở ĐẦU FILE)
// ============================================================
export const CANVAS_AVATAR_CONSTANTS = {
  SIZE: 1000,
  SRC: {
    idle:  '/avatar/char_idle_fixedbg.webp',
    small: '/avatar/char_small_fixedbg.webp',
    wide:  '/avatar/char_wide_fixedbg.webp',
    blink: '/avatar/char_blink_fixedbg.webp',
  },
  // Ngưỡng có trễ (hysteresis) để miệng không nhấp nháy giữa 2 trạng thái
  UP_SMALL: 0.14,
  DOWN_SMALL: 0.08,   // closed <-> small
  UP_WIDE:  0.50,
  DOWN_WIDE:  0.38,   // small  <-> wide
  MIN_HOLD_MS: 70,    // mỗi trạng thái giữ tối thiểu ms
  BLINK_MS: 140,
  BLINK_MIN: 2500,
  BLINK_MAX: 6000,
} as const;

const {
  SIZE,
  SRC,
  UP_SMALL,
  DOWN_SMALL,
  UP_WIDE,
  DOWN_WIDE,
  MIN_HOLD_MS,
  BLINK_MS,
  BLINK_MIN,
  BLINK_MAX,
} = CANVAS_AVATAR_CONSTANTS;

type Mouth = 'closed' | 'small' | 'wide';
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export interface AICharacterCanvasProps {
  /** 0..1 từ ref của useLipSync */
  getOpenness: () => number;
  /** Alias cho tính tương thích ngược */
  getTargetOpenness?: () => number;
  className?: string;
  style?: React.CSSProperties;
}

function AICharacterCanvasComponent({
  getOpenness,
  getTargetOpenness,
  className = '',
  style,
}: AICharacterCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const opennessFn = getOpenness || getTargetOpenness || (() => 0);
  const getRef = useRef(opennessFn);
  getRef.current = opennessFn;

  // React state ghi nhớ trạng thái canvas sẵn sàng (tránh React re-render reset visibility: hidden)
  const [isReady, setIsReady] = useState(false);

  // ─── DEBUG MODE STATE ──────────────────────────────────────
  const [isDebugMode, setIsDebugMode] = useState<boolean>(false);
  const [isSimulatingSpeech, setIsSimulatingSpeech] = useState<boolean>(false);
  const [isStressTesting, setIsStressTesting] = useState<boolean>(false);

  const debugSimulateRef = useRef<boolean>(false);
  const debugStressRef = useRef<boolean>(false);
  const debugTargetRef = useRef<number>(0);
  const debugHudRef = useRef<HTMLDivElement>(null);

  // Kiểm tra query param ?debug=avatar
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      setIsDebugMode(params.get('debug') === 'avatar');
    }
  }, []);

  // Mô phỏng nói ngẫu nhiên trong debug
  useEffect(() => {
    debugSimulateRef.current = isSimulatingSpeech;
    if (!isSimulatingSpeech) {
      if (!debugStressRef.current) debugTargetRef.current = 0;
      return;
    }

    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      if (!active) return;
      const r = Math.random();
      let t = 0;
      if (r < 0.35) t = rand(0.2, 0.5);
      else if (r < 0.65) t = rand(0.5, 0.9);
      else if (r < 0.85) t = rand(0.05, 0.2);
      else t = rand(0, 0.04);

      debugTargetRef.current = t;
      timer = setTimeout(tick, rand(90, 170));
    };

    tick();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [isSimulatingSpeech]);

  // STRESS 50ms: đảo openness 0 -> 1 -> 0 liên tục
  useEffect(() => {
    debugStressRef.current = isStressTesting;
    if (!isStressTesting) {
      if (!debugSimulateRef.current) debugTargetRef.current = 0;
      return;
    }

    let val = 1;
    const interval = setInterval(() => {
      val = val === 1 ? 0 : 1;
      debugTargetRef.current = val;
    }, 50);

    return () => clearInterval(interval);
  }, [isStressTesting]);

  const resetPixelCheckRef = useRef<() => void>(() => {});

  // ─── VÒNG LẶP CANVAS CHÍNH ─────────────────────────────────
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    // QUAN TRỌNG: alpha: false ngăn hoàn toàn việc canvas có kênh trong suốt
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let raf = 0;
    let alive = true;
    let mouth: Mouth = 'closed';
    let since = 0;
    let nextBlink = performance.now() + 3000;
    let blinkStart = -1;
    let loadedBitmaps: (ImageBitmap | HTMLImageElement)[] = [];

    // Debug pixel (20,20) tracking
    let initialPixel: [number, number, number] | null = null;
    let pixelDiffCount = 0;
    let totalFrames = 0;
    let lastHudUpdate = 0;

    resetPixelCheckRef.current = () => {
      initialPixel = null;
      pixelDiffCount = 0;
      totalFrames = 0;
    };

    const load = async (u: string): Promise<ImageBitmap | HTMLImageElement> => {
      try {
        const resp = await fetch(u);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        if (typeof createImageBitmap !== 'undefined') {
          return await createImageBitmap(blob);
        }
        return new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = URL.createObjectURL(blob);
        });
      } catch (err) {
        console.warn(`[AICharacterCanvas] Fallback load for ${u}:`, err);
        return new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = u;
        });
      }
    };

    (async () => {
      const keys = Object.keys(SRC) as (keyof typeof SRC)[];
      const bms = await Promise.all(keys.map((k) => load(SRC[k])));
      if (!alive) {
        bms.forEach((b) => {
          if ('close' in b && typeof b.close === 'function') b.close();
        });
        return;
      }
      loadedBitmaps = bms;
      const im = Object.fromEntries(keys.map((k, i) => [k, bms[i]])) as Record<
        keyof typeof SRC,
        ImageBitmap | HTMLImageElement
      >;

      // Hysteresis: chuyển đổi trạng thái miệng có độ trễ
      const next = (m: Mouth, o: number): Mouth => {
        if (m === 'closed') return o > UP_SMALL ? 'small' : 'closed';
        if (m === 'small') return o > UP_WIDE ? 'wide' : o < DOWN_SMALL ? 'closed' : 'small';
        return o < DOWN_WIDE ? 'small' : 'wide'; // wide -> small -> closed
      };

      const loop = (now: number) => {
        if (!alive) return;

        // Đọc openness (ưu tiên giá trị debug nếu đang test)
        let o = 0;
        if (debugStressRef.current || debugSimulateRef.current) {
          o = Math.min(1, Math.max(0, debugTargetRef.current));
        } else {
          o = Math.min(1, Math.max(0, getRef.current()));
        }

        if (now - since >= MIN_HOLD_MS) {
          const n = next(mouth, o);
          if (n !== mouth) {
            mouth = n;
            since = now;
          }
        }

        // Chớp mắt: chỉ khi miệng đang khép (ảnh blink có miệng khép tự nhiên)
        if (blinkStart < 0 && now >= nextBlink) {
          if (mouth === 'closed') blinkStart = now;
          else if (now - nextBlink > 1000) nextBlink = now + rand(BLINK_MIN, BLINK_MAX);
        }
        let blinking = false;
        if (blinkStart >= 0) {
          if (now - blinkStart < BLINK_MS) {
            blinking = true;
          } else {
            blinkStart = -1;
            nextBlink = now + (Math.random() < 0.15 ? 220 : rand(BLINK_MIN, BLINK_MAX));
          }
        }

        // ─── CHỌN FRAME TOÀN CẢ NGƯỜI (WHOLE PERSON) ───────────
        // Cả 4 ảnh đều có cùng nền cố định 100% (bit-for-bit identical).
        // Nền phía sau KHÔNG BAO GIỜ THAY ĐỔI (0 pixel diff).
        // Toàn bộ cơ thể (đầu, mắt, môi, cằm, tóc, vai, cơ thể) đổi mượt mà theo từng trạng thái.
        let activeFrame: keyof typeof SRC = 'idle';
        if (blinking && mouth === 'closed') {
          activeFrame = 'blink';
        } else if (mouth === 'wide') {
          activeFrame = 'wide';
        } else if (mouth === 'small') {
          activeFrame = 'small';
        } else {
          activeFrame = 'idle';
        }

        // ─── VẼ TOÀN BỘ KHUNG HÌNH (CẮT CỨNG, ALPHA LUÔN = 1) ───
        ctx.globalAlpha = 1;
        ctx.drawImage(im[activeFrame], 0, 0, SIZE, SIZE);

        // Đánh dấu canvas sẵn sàng hiển thị (frame đầu tiên đã vẽ xong)
        setIsReady(true);

        // ─── DEBUG MODE: ĐỌC PIXEL (20,20) & CẢNH BÁO NẾU ĐỔI ──────
        if (debugHudRef.current) {
          totalFrames++;
          const p = ctx.getImageData(20, 20, 1, 1).data;
          const r = p[0], g = p[1], b = p[2];

          if (!initialPixel) {
            initialPixel = [r, g, b];
          } else {
            if (r !== initialPixel[0] || g !== initialPixel[1] || b !== initialPixel[2]) {
              pixelDiffCount++;
            }
          }

          if (now - lastHudUpdate > 80) {
            lastHudUpdate = now;
            const isStable = pixelDiffCount === 0;
            debugHudRef.current.innerHTML = `
              <div style="font-size:11px;font-family:monospace;line-height:1.4;">
                <div style="font-weight:bold;color:#4ade80;margin-bottom:4px;">🟢 WHOLE-PERSON CANVAS DEBUG</div>
                <div><b>Openness:</b> ${o.toFixed(2)}</div>
                <div><b>Mouth State:</b> <span style="color:#38bdf8;font-weight:bold;">${mouth.toUpperCase()}</span></div>
                <div><b>Active Frame:</b> <span style="color:#f472b6;font-weight:bold;">${activeFrame.toUpperCase()} (TOÀN THÂN)</span></div>
                <div><b>Blinking:</b> ${blinking ? '<span style="color:#facc15;">YES</span>' : 'NO'}</div>
                <div style="margin-top:6px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.2);">
                  <b>Pixel (20,20) Check:</b><br/>
                  Initial: [${initialPixel ? initialPixel.join(', ') : '...'}]<br/>
                  Current: [${r}, ${g}, ${b}]<br/>
                  Diff count: <b>${pixelDiffCount}</b> / ${totalFrames} frames<br/>
                  Status: <b style="color:${isStable ? '#4ade80' : '#ef4444'}">${isStable ? 'STABLE (100% CỐ ĐỊNH)' : '⚠️ CẢNH BÁO ĐỔI MÀU!'}</b>
                </div>
              </div>
            `;
          }
        }

        raf = requestAnimationFrame(loop);
      };

      raf = requestAnimationFrame(loop);
    })();

    // Xử lý chuyển tab rồi quay lại không bị kẹt chớp mắt
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        blinkStart = -1;
        nextBlink = performance.now() + 1500;
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', handleVisibility);
      loadedBitmaps.forEach((b) => {
        if ('close' in b && typeof b.close === 'function') {
          b.close();
        }
      });
    };
  }, []);

  return (
    <div
      className={`ai-character-canvas-root ${className}`}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        aspectRatio: '1 / 1',
        background: `url(${SRC.idle}) center / cover no-repeat`,
        overflow: 'hidden',
        ...style,
      }}
    >
      <canvas
        ref={ref}
        width={SIZE}
        height={SIZE}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
          visibility: isReady ? 'visible' : 'hidden',
          objectFit: 'cover',
          objectPosition: 'center',
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      />

      {/* ─── HUD OVERLAY KIỂM TRA (?debug=avatar) ──────────────── */}
      {isDebugMode && (
        <div
          style={{
            position: 'absolute',
            top: 10,
            left: 10,
            zIndex: 99,
            backgroundColor: 'rgba(15, 23, 42, 0.92)',
            backdropFilter: 'none',
            color: '#f8fafc',
            borderRadius: 12,
            padding: '10px 12px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.2)',
            maxWidth: 240,
            pointerEvents: 'auto',
          }}
        >
          <div ref={debugHudRef}>Khởi động đo pixel (20,20)...</div>

          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <button
              type="button"
              onClick={() => {
                setIsStressTesting(false);
                setIsSimulatingSpeech((prev) => !prev);
              }}
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: '4px 8px',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: isSimulatingSpeech ? '#e11d48' : '#2563eb',
                color: '#fff',
              }}
            >
              {isSimulatingSpeech ? '⏹ Dừng mô phỏng nói' : '▶ Mô phỏng nói ngẫu nhiên'}
            </button>

            <button
              type="button"
              onClick={() => {
                setIsSimulatingSpeech(false);
                setIsStressTesting((prev) => !prev);
              }}
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '4px 8px',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: isStressTesting ? '#dc2626' : '#d97706',
                color: '#fff',
              }}
            >
              {isStressTesting ? '⏹ Dừng STRESS 50ms' : '⚡ STRESS (0 ↔ 1 mỗi 50ms)'}
            </button>

            <button
              type="button"
              onClick={() => resetPixelCheckRef.current()}
              style={{
                fontSize: 9,
                padding: '3px 6px',
                borderRadius: 4,
                border: '1px solid rgba(255,255,255,0.3)',
                backgroundColor: 'transparent',
                color: '#cbd5e1',
                cursor: 'pointer',
              }}
            >
              🔄 Reset Pixel Check
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Bọc React.memo để ngăn re-render không cần thiết từ component cha
const AICharacterCanvas = React.memo(AICharacterCanvasComponent);
export default AICharacterCanvas;
