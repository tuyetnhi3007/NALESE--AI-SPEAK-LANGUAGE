// lib/vocab/service.ts
// Lớp truy xuất dữ liệu từ vựng và trạng thái đã thuộc từ Supabase

import { createClient } from '@/lib/supabase/client';
import type { SupportedLanguage } from '@/lib/types';
import type { FlashcardItem, LearnedCounts, LearnedWordItem } from './types';

// Cache trong bộ nhớ theo ngôn ngữ
const vocabCache = new Map<SupportedLanguage, FlashcardItem[]>();

/**
 * Xóa cache khi người dùng đăng xuất hoặc làm mới
 */
export function clearVocabCache(): void {
  vocabCache.clear();
}

/**
 * 1. Đọc toàn bộ từ vựng theo ngôn ngữ từ bảng public.vocab_items
 * - Chỉ chọn các cột id, position, term, reading, word_type, meaning_vi
 * - Lọc theo language
 * - order('id', { ascending: true })
 * - Phân trang range 1000 dòng/lần cho tới khi hết
 * - Kiểm tra count khớp, kiểm tra error từng trang, kiểm tra không có id lặp
 * - Cache trong bộ nhớ
 */
export async function fetchVocabByLanguage(
  lang: SupportedLanguage,
  supabaseClient?: any
): Promise<FlashcardItem[]> {
  if (vocabCache.has(lang)) {
    return vocabCache.get(lang)!;
  }

  const supabase = supabaseClient || createClient();

  // Đếm tổng số dòng
  const { count, error: countErr } = await supabase
    .from('vocab_items')
    .select('*', { count: 'exact', head: true })
    .eq('language', lang);

  if (countErr) {
    throw new Error(`Lỗi đếm số lượng từ vựng ${lang}: ${countErr.message}`);
  }

  const totalExpected = count ?? 0;
  if (totalExpected === 0) {
    vocabCache.set(lang, []);
    return [];
  }

  const PAGE_SIZE = 1000;
  const allRows: FlashcardItem[] = [];
  const seenIds = new Set<string>();

  for (let from = 0; from < totalExpected; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE - 1, totalExpected - 1);
    const { data, error } = await supabase
      .from('vocab_items')
      .select('id, position, term, reading, word_type, meaning_vi')
      .eq('language', lang)
      .order('id', { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Lỗi đọc trang ${from}-${to} của ngôn ngữ ${lang}: ${error.message}`);
    }

    if (!data || data.length === 0) {
      break;
    }

    for (const item of data) {
      if (seenIds.has(item.id)) {
        throw new Error(`Phát hiện id lặp (${item.id}) khi đọc bảng vocab_items`);
      }
      seenIds.add(item.id);
      allRows.push({
        id: item.id,
        position: item.position,
        term: item.term || '',
        reading: item.reading || '',
        word_type: item.word_type || '',
        meaning_vi: item.meaning_vi || '',
      });
    }
  }

  if (allRows.length !== totalExpected) {
    throw new Error(
      `Số dòng đọc được (${allRows.length}) không khớp với tổng số lượng dự kiến (${totalExpected})`
    );
  }

  vocabCache.set(lang, allRows);
  return allRows;
}

/**
 * 2. Lấy danh sách vocab_id đã thuộc của tài khoản hiện tại theo ngôn ngữ
 */
export async function fetchLearnedIds(
  lang: SupportedLanguage,
  supabaseClient?: any
): Promise<Set<string>> {
  const supabase = supabaseClient || createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return new Set<string>();
  }

  const { count, error: countErr } = await supabase
    .from('user_learned_words')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('language', lang);

  if (countErr) {
    throw new Error(`Lỗi đếm từ đã thuộc (${lang}): ${countErr.message}`);
  }

  const total = count ?? 0;
  const idSet = new Set<string>();
  if (total === 0) return idSet;

  const PAGE_SIZE = 1000;
  for (let from = 0; from < total; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE - 1, total - 1);
    const { data, error } = await supabase
      .from('user_learned_words')
      .select('vocab_id')
      .eq('user_id', user.id)
      .eq('language', lang)
      .range(from, to);

    if (error) {
      throw new Error(`Lỗi đọc danh sách từ đã thuộc: ${error.message}`);
    }

    if (data) {
      for (const row of data) {
        if (row.vocab_id) {
          idSet.add(row.vocab_id);
        }
      }
    }
  }

  return idSet;
}

/**
 * 3. Đánh dấu đã thuộc (idempotent, không dùng policy update)
 */
export async function markLearned(
  lang: SupportedLanguage,
  vocabId: string,
  supabaseClient?: any
): Promise<void> {
  const supabase = supabaseClient || createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Cần đăng nhập để lưu từ đã thuộc');

  const { error } = await supabase.from('user_learned_words').upsert(
    {
      user_id: user.id,
      vocab_id: vocabId,
      language: lang,
    },
    {
      onConflict: 'user_id,vocab_id',
      ignoreDuplicates: true,
    }
  );

  if (error && error.code !== '23505') {
    throw new Error(`Lỗi khi đánh dấu từ đã thuộc: ${error.message}`);
  }
}

/**
 * 4. Bỏ đánh dấu đã thuộc
 */
export async function unmarkLearned(
  lang: SupportedLanguage,
  vocabId: string,
  supabaseClient?: any
): Promise<void> {
  const supabase = supabaseClient || createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Cần đăng nhập để bỏ từ đã thuộc');

  const { error } = await supabase
    .from('user_learned_words')
    .delete()
    .eq('user_id', user.id)
    .eq('vocab_id', vocabId);

  if (error) {
    throw new Error(`Lỗi khi bỏ đánh dấu từ: ${error.message}`);
  }
}

/**
 * 5. Đếm số lượng từ đã thuộc theo từng ngôn ngữ
 */
export async function fetchLearnedCounts(supabaseClient?: any): Promise<LearnedCounts> {
  const supabase = supabaseClient || createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { zh: 0, ja: 0, en: 0, total: 0 };
  }

  const [zhRes, jaRes, enRes] = await Promise.all([
    supabase
      .from('user_learned_words')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('language', 'zh'),
    supabase
      .from('user_learned_words')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('language', 'ja'),
    supabase
      .from('user_learned_words')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('language', 'en'),
  ]);

  const zh = zhRes.count ?? 0;
  const ja = jaRes.count ?? 0;
  const en = enRes.count ?? 0;

  return {
    zh,
    ja,
    en,
    total: zh + ja + en,
  };
}

/**
 * 6. Lấy danh sách từ đã thuộc chi tiết (kèm thông tin từ vựng) cho cửa sổ "Từ vựng của tôi"
 * Sử dụng truy vấn nhúng: vocab_items!user_learned_words_vocab_id_fkey(language, term, reading, word_type, meaning_vi)
 */
export async function fetchLearnedWordsDetailed(
  lang: SupportedLanguage,
  supabaseClient?: any
): Promise<LearnedWordItem[]> {
  const supabase = supabaseClient || createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { count, error: countErr } = await supabase
    .from('user_learned_words')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('language', lang);

  if (countErr) {
    throw new Error(`Lỗi đếm từ đã thuộc chi tiết (${lang}): ${countErr.message}`);
  }

  const total = count ?? 0;
  if (total === 0) return [];

  const PAGE_SIZE = 1000;
  const results: LearnedWordItem[] = [];
  const seenIds = new Set<string>();

  for (let from = 0; from < total; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE - 1, total - 1);
    const { data, error } = await supabase
      .from('user_learned_words')
      .select(
        'user_id, vocab_id, language, learned_at, vocab_items!user_learned_words_vocab_id_fkey(language, term, reading, word_type, meaning_vi)'
      )
      .eq('user_id', user.id)
      .eq('language', lang)
      .order('learned_at', { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(`Lỗi tải danh sách từ đã thuộc: ${error.message}`);
    }

    if (data) {
      for (const item of data) {
        if (seenIds.has(item.vocab_id)) {
          continue;
        }
        seenIds.add(item.vocab_id);
        results.push({
          user_id: item.user_id,
          vocab_id: item.vocab_id,
          language: item.language as SupportedLanguage,
          learned_at: item.learned_at,
          vocab_items: Array.isArray(item.vocab_items) ? item.vocab_items[0] : item.vocab_items,
        });
      }
    }
  }

  return results;
}
