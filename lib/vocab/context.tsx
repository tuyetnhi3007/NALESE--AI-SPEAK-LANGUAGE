'use client';
// lib/vocab/context.tsx
// Trạng thái dùng chung cho Flashcard và Kho từ vựng đã thuộc

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { SupportedLanguage } from '@/lib/types';
import type { LearnedCounts } from './types';
import {
  fetchLearnedIds,
  fetchLearnedCounts,
  markLearned,
  unmarkLearned,
  clearVocabCache,
} from './service';

interface LearnedVocabContextType {
  learnedIds: Record<SupportedLanguage, Set<string>>;
  counts: LearnedCounts;
  loadingLang: Record<SupportedLanguage, boolean>;
  isLearned: (lang: SupportedLanguage, vocabId: string) => boolean;
  markAsLearned: (lang: SupportedLanguage, vocabId: string) => Promise<boolean>;
  unmarkAsLearned: (lang: SupportedLanguage, vocabId: string) => Promise<boolean>;
  loadLearnedForLang: (lang: SupportedLanguage) => Promise<void>;
  refreshCounts: () => Promise<void>;
}

const DEFAULT_COUNTS: LearnedCounts = { zh: 0, ja: 0, en: 0, total: 0 };

const LearnedVocabContext = createContext<LearnedVocabContextType>({
  learnedIds: { zh: new Set(), ja: new Set(), en: new Set() },
  counts: DEFAULT_COUNTS,
  loadingLang: { zh: false, ja: false, en: false },
  isLearned: () => false,
  markAsLearned: async () => false,
  unmarkAsLearned: async () => false,
  loadLearnedForLang: async () => {},
  refreshCounts: async () => {},
});

export function LearnedVocabProvider({ children }: { children: React.ReactNode }) {
  const [learnedIds, setLearnedIds] = useState<Record<SupportedLanguage, Set<string>>>({
    zh: new Set(),
    ja: new Set(),
    en: new Set(),
  });

  const [counts, setCounts] = useState<LearnedCounts>(DEFAULT_COUNTS);
  const [loadingLang, setLoadingLang] = useState<Record<SupportedLanguage, boolean>>({
    zh: false,
    ja: false,
    en: false,
  });

  const refreshCounts = useCallback(async () => {
    try {
      const res = await fetchLearnedCounts();
      setCounts(res);
    } catch {
      // Bỏ qua lỗi mạng
    }
  }, []);

  const loadLearnedForLang = useCallback(async (lang: SupportedLanguage) => {
    setLoadingLang((prev) => ({ ...prev, [lang]: true }));
    try {
      const ids = await fetchLearnedIds(lang);
      setLearnedIds((prev) => ({ ...prev, [lang]: ids }));
      // Đồng thời cập nhật count
      setCounts((prev) => {
        const next = { ...prev, [lang]: ids.size };
        next.total = next.zh + next.ja + next.en;
        return next;
      });
    } catch (e) {
      console.warn(`Lỗi tải danh sách từ đã thuộc (${lang}):`, e);
    } finally {
      setLoadingLang((prev) => ({ ...prev, [lang]: false }));
    }
  }, []);

  // Lắng nghe đăng nhập/đăng xuất
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        refreshCounts();
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        clearVocabCache();
        setLearnedIds({ zh: new Set(), ja: new Set(), en: new Set() });
        setCounts(DEFAULT_COUNTS);
      } else if (event === 'SIGNED_IN') {
        refreshCounts();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [refreshCounts]);

  const isLearned = useCallback(
    (lang: SupportedLanguage, vocabId: string) => {
      return learnedIds[lang]?.has(vocabId) ?? false;
    },
    [learnedIds]
  );

  const markAsLearned = useCallback(
    async (lang: SupportedLanguage, vocabId: string): Promise<boolean> => {
      // Cập nhật lạc quan
      setLearnedIds((prev) => {
        const currentSet = new Set(prev[lang]);
        currentSet.add(vocabId);
        return { ...prev, [lang]: currentSet };
      });
      setCounts((prev) => {
        const next = { ...prev, [lang]: prev[lang] + 1, total: prev.total + 1 };
        return next;
      });

      try {
        await markLearned(lang, vocabId);
        return true;
      } catch (err) {
        // Hoàn tác nếu lỗi
        setLearnedIds((prev) => {
          const currentSet = new Set(prev[lang]);
          currentSet.delete(vocabId);
          return { ...prev, [lang]: currentSet };
        });
        setCounts((prev) => {
          const next = { ...prev, [lang]: Math.max(0, prev[lang] - 1), total: Math.max(0, prev.total - 1) };
          return next;
        });
        throw err;
      }
    },
    []
  );

  const unmarkAsLearned = useCallback(
    async (lang: SupportedLanguage, vocabId: string): Promise<boolean> => {
      // Cập nhật lạc quan
      setLearnedIds((prev) => {
        const currentSet = new Set(prev[lang]);
        currentSet.delete(vocabId);
        return { ...prev, [lang]: currentSet };
      });
      setCounts((prev) => {
        const next = { ...prev, [lang]: Math.max(0, prev[lang] - 1), total: Math.max(0, prev.total - 1) };
        return next;
      });

      try {
        await unmarkLearned(lang, vocabId);
        return true;
      } catch (err) {
        // Hoàn tác nếu lỗi
        setLearnedIds((prev) => {
          const currentSet = new Set(prev[lang]);
          currentSet.add(vocabId);
          return { ...prev, [lang]: currentSet };
        });
        setCounts((prev) => {
          const next = { ...prev, [lang]: prev[lang] + 1, total: prev.total + 1 };
          return next;
        });
        throw err;
      }
    },
    []
  );

  return (
    <LearnedVocabContext.Provider
      value={{
        learnedIds,
        counts,
        loadingLang,
        isLearned,
        markAsLearned,
        unmarkAsLearned,
        loadLearnedForLang,
        refreshCounts,
      }}
    >
      {children}
    </LearnedVocabContext.Provider>
  );
}

export function useLearnedVocab() {
  return useContext(LearnedVocabContext);
}
