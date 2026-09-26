'use client';
// ============================================================
// components/SettingsContext.tsx — Global UI settings state
//
// Lưu trong localStorage: giọng đọc, tốc độ, trình độ.
// API key KHÔNG còn lưu ở client — tất cả key ở server .env.local
// ============================================================

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { AppSettings, LanguageLevel } from '@/lib/types';

const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '', // Giữ field này để tương thích ngược, nhưng không còn cần thiết
  voice: 'nova',
  speed: 1.0,
  level: 'beginner',
};

interface SettingsContextType {
  settings: AppSettings;
  updateSettings: (updates: Partial<AppSettings>) => void;
  /** Luôn true vì API key được quản lý ở server */
  hasApiKey: boolean;
}

const SettingsContext = createContext<SettingsContextType>({
  settings: DEFAULT_SETTINGS,
  updateSettings: () => {},
  hasApiKey: true,
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('nalese_settings');
      if (saved) {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(saved) });
      }
    } catch {}
  }, []);

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...updates };
      try {
        localStorage.setItem('nalese_settings', JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  return (
    // hasApiKey = true vì key được quản lý qua .env.local
    <SettingsContext.Provider value={{ settings, updateSettings, hasApiKey: true }}>
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => useContext(SettingsContext);
