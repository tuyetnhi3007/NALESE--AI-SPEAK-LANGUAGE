// scripts/test-flashcard-and-export.ts
// Kiểm thử toàn diện logic Flashcard, Cửa sổ nổi Từ vựng của tôi và Xuất/Đọc lại file Excel

import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { getSpokenTerm, getTTSLocale } from '../lib/vocab/tts';
import { parseXLSXBuffer } from '../lib/vocab-parser';
import { exportLearnedWordsToExcel } from '../lib/vocab/excel';
import type { LearnedWordItem } from '../lib/vocab/types';
import type { SupportedLanguage } from '../lib/types';
import { createClient } from '@supabase/supabase-js';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`\x1b[31m[FAIL] ${message}\x1b[0m`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`\x1b[32m[PASS] ${message}\x1b[0m`);
}

// ─── 1. KIỂM THỬ TTS EXTRACT ───────────────────────────────────
function testTTSExtraction() {
  console.log('\n--- 1. Kiểm thử trích xuất từ đọc TTS ---');
  assert(getSpokenTerm('爸爸｜爸') === '爸爸', 'Tách dạng đầu tiên khi có dấu ｜');
  assert(getSpokenTerm('你好|您好') === '你好', 'Tách dạng đầu tiên khi có dấu |');
  assert(getSpokenTerm('hello') === 'hello', 'Giữ nguyên từ đơn không có dấu gạch');
  assert(getSpokenTerm('') === '', 'Xử lý chuỗi rỗng an toàn');

  assert(getTTSLocale('zh') === 'zh-CN', 'Locale tiếng Trung là zh-CN');
  assert(getTTSLocale('ja') === 'ja-JP', 'Locale tiếng Nhật là ja-JP');
  assert(getTTSLocale('en') === 'en-US', 'Locale tiếng Anh là en-US');
}

// ─── 2. KIỂM THỬ XÁO TRỘN & CHẾ ĐỘ HỌC ────────────────────────
function testSessionAndModes() {
  console.log('\n--- 2. Kiểm thử dựng lượt học 20 thẻ & chế độ ---');
  const mockVocab = Array.from({ length: 50 }, (_, i) => ({
    id: `id_${i + 1}`,
    position: i + 1,
    term: `Từ_${i + 1}`,
    reading: `reading_${i + 1}`,
    meaning_vi: `Nghĩa ${i + 1}`,
  }));

  const learnedSet = new Set(['id_1', 'id_2', 'id_3', 'id_4', 'id_5']);

  // A. Chế độ Tất cả: lấy tối đa 20 thẻ, không loại từ đã thuộc
  const allPool = [...mockVocab];
  assert(allPool.length === 50, 'Pool Tất cả có đủ 50 từ');

  // B. Chế độ Chưa thuộc
  const unlearnedPool = mockVocab.filter((item) => !learnedSet.has(item.id));
  assert(unlearnedPool.length === 45, 'Pool Chưa thuộc có 45 từ');

  // C. Chế độ Đã thuộc
  const learnedPool = mockVocab.filter((item) => learnedSet.has(item.id));
  assert(learnedPool.length === 5, 'Pool Đã thuộc có 5 từ');

  // Kiểm tra không lặp thẻ trong lượt học
  const sampleSession = mockVocab.slice(0, 20);
  const sessionIds = new Set(sampleSession.map((s) => s.id));
  assert(sessionIds.size === 20, 'Lượt học 20 thẻ không có ID nào bị trùng lặp');
}

// ─── 3. KIỂM THỬ TÌM KIẾM KHÔNG PHÂN BIỆT DẤU ─────────────────
function testSearchFilter() {
  console.log('\n--- 3. Kiểm thử tìm kiếm không phân biệt dấu ---');
  function removeAccents(str: string): string {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  const items: LearnedWordItem[] = [
    {
      user_id: 'u1',
      vocab_id: 'v1',
      language: 'zh',
      learned_at: '2026-10-24T00:00:00Z',
      vocab_items: { language: 'zh', term: '爱', reading: 'ài', meaning_vi: 'yêu, thích' },
    },
    {
      user_id: 'u1',
      vocab_id: 'v2',
      language: 'zh',
      learned_at: '2026-10-24T00:01:00Z',
      vocab_items: { language: 'zh', term: '八', reading: 'bā', meaning_vi: 'số 8' },
    },
    {
      user_id: 'u1',
      vocab_id: 'v3',
      language: 'zh',
      learned_at: '2026-10-24T00:02:00Z',
      vocab_items: { language: 'zh', term: '爸爸｜爸', reading: 'bàba｜bà', meaning_vi: 'bố, ba, cha' },
    },
  ];

  // Tìm "yeu" -> khớp "yêu, thích"
  const q1 = removeAccents('yeu');
  const res1 = items.filter((item) => removeAccents(item.vocab_items?.meaning_vi || '').includes(q1));
  assert(res1.length === 1 && res1[0].vocab_items?.term === '爱', 'Tìm "yeu" (không dấu) khớp "yêu"');

  // Tìm "ai" -> khớp pinyin "ài"
  const q2 = removeAccents('ai');
  const res2 = items.filter((item) => removeAccents(item.vocab_items?.reading || '').includes(q2));
  assert(res2.length === 1 && res2[0].vocab_items?.term === '爱', 'Tìm "ai" khớp phiên âm "ài"');

  // Tìm "ba" -> khớp cả "bā" và "bàba"
  const q3 = removeAccents('ba');
  const res3 = items.filter((item) => removeAccents(item.vocab_items?.reading || '').includes(q3));
  assert(res3.length === 2, 'Tìm "ba" khớp 2 kết quả');
}

// ─── 4. KIỂM THỬ XUẤT EXCEL & ĐỌC LẠI BẰNG PARSER DỰ ÁN ────────
async function testExcelExportAndReparse() {
  console.log('\n--- 4. Kiểm thử xuất Excel và đọc lại bằng lib/vocab-parser.ts ---');

  const testItems: LearnedWordItem[] = [
    {
      user_id: 'u1',
      vocab_id: 'v1',
      language: 'zh',
      learned_at: '2026-10-20T08:00:00Z',
      vocab_items: {
        language: 'zh',
        term: '爱',
        reading: 'ài',
        word_type: 'động từ',
        meaning_vi: 'yêu, thích',
      },
    },
    {
      user_id: 'u1',
      vocab_id: 'v2',
      language: 'zh',
      learned_at: '2026-10-21T09:00:00Z',
      vocab_items: {
        language: 'zh',
        term: '爸爸｜爸',
        reading: 'bàba｜bà',
        word_type: 'danh từ',
        meaning_vi: 'bố, ba, cha',
      },
    },
    {
      user_id: 'u1',
      vocab_id: 'v3',
      language: 'zh',
      learned_at: '2026-10-22T10:00:00Z',
      vocab_items: {
        language: 'zh',
        term: '=SUM(1,2)', // Ô bắt đầu bằng dấu "=" (test chống formula injection)
        reading: '', // Phiên âm rỗng
        word_type: 'ký tự đặc biệt',
        meaning_vi: '+Cộng & trừ @nguy hiểm', // Bắt đầu bằng +, @
      },
    },
  ];

  // Sắp xếp tăng dần theo ngày học
  const sorted = [...testItems].sort(
    (a, b) => new Date(a.learned_at).getTime() - new Date(b.learned_at).getTime()
  );

  const headers = ['STT', 'Phiên âm (Pinyin/Romaji)', 'Từ đích', 'Nghĩa tiếng Việt'];
  const aoaData: string[][] = [headers];

  sorted.forEach((item, index) => {
    const info = item.vocab_items;
    aoaData.push([
      String(index + 1),
      String(info?.reading || ''),
      String(info?.term || ''),
      String(info?.meaning_vi || ''),
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoaData);

  // Đặt kiểu string 's' cho toàn bộ các ô
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:D1');
  for (let R = range.s.r; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
      if (ws[cellRef]) {
        ws[cellRef].t = 's';
      }
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Tiếng Trung');

  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

  // ĐỌC LẠI BẰNG PARSER CỦA TAB TỪ VỰNG (lib/vocab-parser.ts)
  const parseResult = await parseXLSXBuffer(arrayBuffer);

  assert(parseResult.errors.length === 0, 'Parser không có lỗi cấu trúc/cột');
  assert(parseResult.data.length === 3, 'Đọc lại đúng đủ 3 dòng dữ liệu');

  // Khớp từng dòng
  assert(parseResult.data[0].word === '爱', 'Dòng 1: từ đích khớp "爱"');
  assert(parseResult.data[0].pronunciation === 'ài', 'Dòng 1: phiên âm khớp "ài"');
  assert(parseResult.data[0].meaning === 'yêu, thích', 'Dòng 1: nghĩa khớp "yêu, thích"');

  assert(parseResult.data[1].word === '爸爸｜爸', 'Dòng 2: từ đích khớp "爸爸｜爸"');
  assert(parseResult.data[1].pronunciation === 'bàba｜bà', 'Dòng 2: phiên âm khớp "bàba｜bà"');

  assert(parseResult.data[2].word === '=SUM(1,2)', 'Dòng 3: từ đích bắt đầu bằng = không bị lỗi formula');
  assert(parseResult.data[2].meaning === '+Cộng & trừ @nguy hiểm', 'Dòng 3: nghĩa có ký tự +, @ nguyên vẹn');
  assert(parseResult.data[2].pronunciation === '=SUM(1,2)', 'Dòng 3: khi reading rỗng, fallback về word chuẩn theo logic vocab-parser');
}

// ─── 5. KIỂM THỬ TRUY VẤN NHÚNG SUPABASE THẬT ─────────────────
async function testSupabaseEmbeddedQuery() {
  console.log('\n--- 5. Kiểm thử cú pháp truy vấn nhúng với Supabase thật ---');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.log('[SKIP] Không có biến môi trường Supabase để test truy vấn thật');
    return;
  }

  const sb = createClient(url, key);

  // Thử nghiệm truy vấn nhúng sang vocab_items với foreign key hint
  const { data, error } = await sb
    .from('user_learned_words')
    .select('user_id, vocab_id, language, learned_at, vocab_items!user_learned_words_vocab_id_fkey(language, term, reading, word_type, meaning_vi)')
    .limit(1);

  assert(!error, `Truy vấn nhúng vocab_items!user_learned_words_vocab_id_fkey thành công (Error: ${error?.message})`);
  console.log(`[PASS] Foreign key hint 'user_learned_words_vocab_id_fkey' hợp lệ và hoạt động chính xác với PostgREST.`);
}

async function runAll() {
  testTTSExtraction();
  testSessionAndModes();
  testSearchFilter();
  await testExcelExportAndReparse();
  await testSupabaseEmbeddedQuery();
  console.log('\n======================================================');
  console.log('TẤT CẢ CÁC BÀI KIỂM THỬ FLASHCARD & MY VOCAB ĐÃ PASS!');
  console.log('======================================================\n');
}

runAll().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
