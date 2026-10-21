// ============================================================
// lib/ai/errors.ts — Phân loại lỗi và quản lý Cooldown dùng chung
// ============================================================

export type GoogleErrorKind =
  | 'KEY_INVALID'
  | 'DAILY_QUOTA_EXCEEDED'
  | 'AI_BUSY'
  | 'UNKNOWN';

export interface GoogleClassifiedError {
  kind: GoogleErrorKind;
  status?: number;
  message: string;
  reason?: string;
  quotaId?: string;
  retryDelaySec?: number;
  resetHours?: number;
}

/**
 * Phân tích đối tượng lỗi từ Google Generative AI (Status, Message, errorDetails)
 */
export function classifyGoogleError(err: any): GoogleClassifiedError {
  const status =
    typeof err?.status === 'number'
      ? err.status
      : typeof err?.status === 'string'
      ? parseInt(err.status, 10)
      : undefined;

  const message = String(err?.message || '');
  const errorDetails = Array.isArray(err?.errorDetails) ? err.errorDetails : [];

  // 1. Kiểm tra lỗi API key sai hoặc hết hạn (401, 403, hoặc message / reason API_KEY_INVALID)
  const isKeyInvalid =
    status === 401 ||
    status === 403 ||
    (status === 400 && message.includes('API key not valid')) ||
    errorDetails.some((d: any) => d?.reason === 'API_KEY_INVALID');

  if (isKeyInvalid) {
    return {
      kind: 'KEY_INVALID',
      status,
      message,
      reason: 'API_KEY_INVALID',
    };
  }

  // 2. Trích xuất quotaId và retryDelay từ errorDetails
  let quotaId: string | undefined = undefined;
  let retryDelaySec: number | undefined = undefined;

  for (const detail of errorDetails) {
    if (detail?.['@type']?.includes('QuotaFailure') && Array.isArray(detail?.violations)) {
      for (const v of detail.violations) {
        if (v?.quotaId) quotaId = v.quotaId;
      }
    }
    if (detail?.['@type']?.includes('RetryInfo') && detail?.retryDelay) {
      const rawDelay = String(detail.retryDelay).replace('s', '');
      const parsedSec = parseInt(rawDelay, 10);
      if (!isNaN(parsedSec)) {
        retryDelaySec = parsedSec;
      }
    }
  }

  // Nếu trong error message có chứa thông tin retry in XhYmZs
  if (retryDelaySec === undefined) {
    const retryMatch = message.match(/retry in\s+(\d+)h(\d+)m/i);
    if (retryMatch) {
      const hours = parseInt(retryMatch[1], 10) || 0;
      const mins = parseInt(retryMatch[2], 10) || 0;
      retryDelaySec = hours * 3600 + mins * 60;
    }
  }

  const resetHours = retryDelaySec ? Math.max(1, Math.round(retryDelaySec / 3600)) : undefined;

  // 3. Kiểm tra lỗi hết hạn ngạch NGÀY (Daily Quota Exceeded)
  const isDailyQuota =
    status === 429 &&
    Boolean(
      (quotaId && /PerDay/i.test(quotaId)) ||
      /PerDay/i.test(message) ||
      /per day/i.test(message) ||
      (typeof retryDelaySec === 'number' && retryDelaySec > 3600)
    );

  if (isDailyQuota) {
    return {
      kind: 'DAILY_QUOTA_EXCEEDED',
      status,
      message,
      quotaId,
      retryDelaySec,
      resetHours,
    };
  }

  // 4. Kiểm tra AI bận: 503 (high demand), 429 rate limit theo phút, timeout, abort
  const isTimeout =
    message.includes('quá thời gian') ||
    message.includes('timeout') ||
    message.includes('Timeout') ||
    err?.name === 'AbortError';

  const isMinuteRateLimit = status === 429 && !isDailyQuota;
  const is503 = status === 503 || message.includes('503') || message.includes('high demand') || message.includes('Service Unavailable');

  if (is503 || isMinuteRateLimit || isTimeout) {
    return {
      kind: 'AI_BUSY',
      status,
      message,
      reason: is503 ? '503_SERVICE_UNAVAILABLE' : isMinuteRateLimit ? '429_RATE_LIMIT' : 'TIMEOUT',
      retryDelaySec,
      resetHours,
    };
  }

  return { kind: 'UNKNOWN', status, message, retryDelaySec, resetHours };
}

// ============================================================
// Bộ nhớ Cooldown dùng chung theo model trong tiến trình Node.js
// ============================================================

const modelCooldowns = new Map<string, number>();
const modelResetHours = new Map<string, number>();

const MAX_DAILY_COOLDOWN_MS = 6 * 3600 * 1000; // Tối đa 6 giờ cho hết hạn ngạch ngày
const BUSY_COOLDOWN_MS = 60000; // 60 giây cho 503/429 phút/timeout

export function isModelInCooldown(modelName: string): boolean {
  const until = modelCooldowns.get(modelName);
  if (!until) return false;
  if (Date.now() >= until) {
    modelCooldowns.delete(modelName);
    modelResetHours.delete(modelName);
    return false;
  }
  return true;
}

export function getModelCooldownRemaining(modelName: string): number {
  const until = modelCooldowns.get(modelName);
  if (!until) return 0;
  return Math.max(0, until - Date.now());
}

export function markModelCooldown(
  modelName: string,
  kind: GoogleErrorKind,
  retryDelaySec?: number
): void {
  // Key sai (401/403): Không cooldown
  if (kind === 'KEY_INVALID') {
    return;
  }

  if (kind === 'DAILY_QUOTA_EXCEEDED') {
    // Cooldown đến hết retryDelay, tối đa 6 giờ
    const delayMs = typeof retryDelaySec === 'number' && retryDelaySec > 0
      ? Math.min(retryDelaySec * 1000, MAX_DAILY_COOLDOWN_MS)
      : MAX_DAILY_COOLDOWN_MS;

    modelCooldowns.set(modelName, Date.now() + delayMs);
    if (retryDelaySec) {
      modelResetHours.set(modelName, Math.max(1, Math.round(retryDelaySec / 3600)));
    }
  } else if (kind === 'AI_BUSY') {
    // 503, 429 theo phút, timeout: giữ 60 giây
    modelCooldowns.set(modelName, Date.now() + BUSY_COOLDOWN_MS);
  }
}

export function areAllModelsInCooldown(models: string[]): boolean {
  if (!models || models.length === 0) return false;
  return models.every((m) => isModelInCooldown(m));
}

export function getEarliestExpiringModel(models: string[]): { model: string; remainingMs: number } | null {
  if (!models || models.length === 0) return null;
  let bestModel = models[0];
  let minRemaining = Infinity;

  for (const m of models) {
    const rem = getModelCooldownRemaining(m);
    if (rem < minRemaining) {
      minRemaining = rem;
      bestModel = m;
    }
  }

  return { model: bestModel, remainingMs: minRemaining === Infinity ? 0 : minRemaining };
}

export function getGlobalDailyResetHours(): number | undefined {
  let maxHours = 0;
  for (const hours of modelResetHours.values()) {
    if (hours > maxHours) maxHours = hours;
  }
  return maxHours > 0 ? maxHours : undefined;
}

export function clearModelCooldown(modelName: string): void {
  modelCooldowns.delete(modelName);
  modelResetHours.delete(modelName);
}

export function clearAllCooldowns(): void {
  modelCooldowns.clear();
  modelResetHours.clear();
}
