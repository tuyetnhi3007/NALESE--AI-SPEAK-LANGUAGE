// ============================================================
// scripts/test-import-vocab.ts
// Unit & Integration tests for import-vocab logic and sample files
// ============================================================

import path from 'path';
import {
  normalizeHeader,
  loadMappingConfig,
  readFileRows,
  mapColumnHeaders,
  parseVocabRows,
  deduplicateInFile,
  mergeWithExistingRecord,
  fetchAllExistingVocab,
  isPlaceholderValue,
  runImport,
} from './import-vocab';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`\x1b[31mFAIL: ${message}\x1b[0m`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`\x1b[32mPASS: ${message}\x1b[0m`);
}

async function testHeaderNormalization() {
  console.log('\n--- 1. Kiểm thử chuẩn hóa tên cột (normalizeHeader) ---');
  assert(normalizeHeader('No.') === 'no', 'No. khớp no');
  assert(normalizeHeader('No') === 'no', 'No khớp no');
  assert(normalizeHeader('STT.') === 'stt', 'STT. khớp stt');
  assert(normalizeHeader('  Từ vựng   ') === 'tu vung', 'Khoảng trắng và dấu tiếng Việt được chuẩn hóa');
  assert(normalizeHeader('Loại từ') === 'loai tu', 'Loại từ được chuẩn hóa');
  assert(normalizeHeader('Nghĩa tiếng Việt.') === 'nghia tieng viet', 'Nghĩa tiếng Việt. được chuẩn hóa');
  assert(normalizeHeader('Hiragana') === 'hiragana', 'Hiragana chuẩn hóa');
}

async function testPositionResolution() {
  console.log('\n--- 2. Kiểm thử xử lý thứ tự (position): STT trống, trùng, không phải số, nhảy cách ---');

  const config = loadMappingConfig('en');
  const headers = ['STT', 'Word', 'Meaning', 'Type'];
  const { fieldMap, unmappedHeaders } = mapColumnHeaders(headers, config);

  // A. STT trống
  console.log('>>> Trường hợp A: STT trống');
  const rowsEmptySTT = [
    { STT: '1', Word: 'one', Meaning: 'một', Type: 'num' },
    { STT: '', Word: 'two', Meaning: 'hai', Type: 'num' },   // STT trống
    { STT: '3', Word: 'three', Meaning: 'ba', Type: 'num' },
  ];
  const resA = parseVocabRows(rowsEmptySTT, fieldMap, unmappedHeaders);
  assert(resA.validItems.length === 3, 'Cả 3 dòng đều hợp lệ');
  assert(resA.validItems[0].position === 1, 'Dòng 1 có position = 1');
  assert(resA.validItems[1].position === 2, 'Dòng 2 có STT trống -> gán position = 2 (thứ tự dòng)');
  assert(resA.validItems[2].position === 3, 'Dòng 3 có position = 3');

  // B. STT trùng
  console.log('\n>>> Trường hợp B: STT trùng');
  const rowsDuplicateSTT = [
    { STT: '1', Word: 'apple', Meaning: 'táo', Type: 'noun' },
    { STT: '2', Word: 'banana', Meaning: 'chuối', Type: 'noun' },
    { STT: '2', Word: 'orange', Meaning: 'cam', Type: 'noun' }, // Trùng STT 2
    { STT: '4', Word: 'grape', Meaning: 'nho', Type: 'noun' },
  ];
  const resB = parseVocabRows(rowsDuplicateSTT, fieldMap, unmappedHeaders);
  assert(resB.validItems.length === 4, 'Cả 4 dòng đều hợp lệ');
  assert(resB.positionWarnings.length > 0, 'Có cảnh báo khi phát hiện STT trùng');
  assert(resB.validItems[0].position === 1, 'Apple giữ position 1');
  assert(resB.validItems[1].position === 2, 'Banana giữ position 2');
  assert(resB.validItems[2].position === 3, 'Orange trùng STT 2 -> tự động dùng thứ tự dòng = 3');
  assert(resB.validItems[3].position === 4, 'Grape giữ position 4');
  const positionsB = new Set(resB.validItems.map((i) => i.position));
  assert(positionsB.size === 4, 'Tất cả 4 position đều duy nhất, không trùng nhau');

  // C. STT không phải số
  console.log('\n>>> Trường hợp C: STT không phải số ("abc", "NaN", "-1")');
  const rowsNonNumericSTT = [
    { STT: 'abc', Word: 'cat', Meaning: 'mèo', Type: 'noun' },
    { STT: 'NaN', Word: 'dog', Meaning: 'chó', Type: 'noun' },
    { STT: '-5', Word: 'bird', Meaning: 'chim', Type: 'noun' },
  ];
  const resC = parseVocabRows(rowsNonNumericSTT, fieldMap, unmappedHeaders);
  assert(resC.validItems.length === 3, 'Cả 3 dòng đều hợp lệ');
  assert(resC.validItems[0].position === 1, 'Cat có STT "abc" -> dùng thứ tự dòng 1');
  assert(resC.validItems[1].position === 2, 'Dog có STT "NaN" -> dùng thứ tự dòng 2');
  assert(resC.validItems[2].position === 3, 'Bird có STT "-5" -> dùng thứ tự dòng 3');

  // D. STT nhảy cách
  console.log('\n>>> Trường hợp D: STT nhảy cách (1, 5, 12, 50)');
  const rowsJumpingSTT = [
    { STT: '1', Word: 'first', Meaning: 'đầu tiên', Type: 'adj' },
    { STT: '5', Word: 'fifth', Meaning: 'thứ năm', Type: 'adj' },
    { STT: '12', Word: 'twelfth', Meaning: 'thứ mười hai', Type: 'adj' },
    { STT: '50', Word: 'fiftieth', Meaning: 'thứ năm mươi', Type: 'adj' },
  ];
  const resD = parseVocabRows(rowsJumpingSTT, fieldMap, unmappedHeaders);
  assert(resD.validItems[0].position === 1, 'Giữ nguyên STT 1');
  assert(resD.validItems[1].position === 5, 'Giữ nguyên STT nhảy cách 5');
  assert(resD.validItems[2].position === 12, 'Giữ nguyên STT nhảy cách 12');
  assert(resD.validItems[3].position === 50, 'Giữ nguyên STT nhảy cách 50');
}

async function testPlaceholderValues() {
  console.log('\n--- 3. Kiểm thử giá trị giữ chỗ (Placeholder values) ---');

  // 1. Kiểm tra unit test hàm isPlaceholderValue
  assert(isPlaceholderValue('-') === true, 'Dấu gạch ngang "-" là placeholder');
  assert(isPlaceholderValue('–') === true, 'Dấu gạch ngang en-dash "–" là placeholder');
  assert(isPlaceholderValue('—') === true, 'Dấu gạch ngang em-dash "—" là placeholder');
  assert(isPlaceholderValue('N/A') === true, '"N/A" là placeholder');
  assert(isPlaceholderValue('  n/a  ') === true, '"  n/a  " (sau khi trim và lower) là placeholder');
  assert(isPlaceholderValue('null') === true, '"null" là placeholder');
  assert(isPlaceholderValue('NULL') === true, '"NULL" là placeholder');
  assert(isPlaceholderValue('none') === true, '"none" là placeholder');
  assert(isPlaceholderValue('None') === true, '"None" là placeholder');
  assert(isPlaceholderValue('noun') === false, '"noun" không phải placeholder');
  assert(isPlaceholderValue('/laɪt/') === false, '"/laɪt/" không phải placeholder');
  assert(isPlaceholderValue('') === false, 'Chuỗi rỗng ban đầu không tính là placeholder');

  // 2. Kiểm thử khi parse hàng dữ liệu có placeholder
  const config = loadMappingConfig('en');
  const headers = ['STT', 'Word', 'Type', 'Pronounce', 'Meaning', 'Level', 'Ghi chú'];
  const { fieldMap, unmappedHeaders } = mapColumnHeaders(headers, config);

  const rowsWithPlaceholders = [
    {
      STT: '1',
      Word: 'test-word',     // Cột term có dấu gạch ngang -> KHÔNG được coi là placeholder
      Type: '-',             // Cột word_type có "-" -> coi là rỗng
      Pronounce: 'N/A',      // Cột reading có "N/A" -> coi là rỗng
      Meaning: 'nghĩa - phụ', // Cột meaning có dấu gạch ngang -> KHÔNG được coi là placeholder
      Level: 'none',         // Cột level có "none" -> coi là null
      'Ghi chú': 'null',     // Cột extra có "null" -> bị bỏ qua khỏi extra
    },
    {
      STT: '2',
      Word: 'hello',
      Type: 'noun',
      Pronounce: '—',        // Em-dash -> coi là rỗng
      Meaning: 'xin chào',
      Level: 'A1',
      'Ghi chú': '–',        // En-dash -> bị bỏ qua khỏi extra
    },
  ];

  const { validItems, placeholderCount } = parseVocabRows(rowsWithPlaceholders, fieldMap, unmappedHeaders);

  assert(validItems.length === 2, 'Cả 2 dòng đều hợp lệ');

  // Dòng 1:
  assert(validItems[0].term === 'test-word', 'Term "test-word" giữ nguyên, không bị ảnh hưởng bởi dấu "-"');
  assert(validItems[0].meaning_vi === 'nghĩa - phụ', 'Meaning "nghĩa - phụ" giữ nguyên');
  assert(validItems[0].word_type === '', 'Word_type "-" được chuyển thành rỗng ""');
  assert(validItems[0].reading === '', 'Reading "N/A" được chuyển thành rỗng ""');
  assert(validItems[0].level === null, 'Level "none" được chuyển thành null');
  assert(Object.keys(validItems[0].extra).length === 0, 'Extra "null" được loại bỏ hoàn toàn khỏi object extra');

  // Dòng 2:
  assert(validItems[1].reading === '', 'Reading "—" (em-dash) được chuyển thành rỗng ""');
  assert(Object.keys(validItems[1].extra).length === 0, 'Extra "–" (en-dash) được loại bỏ hoàn toàn khỏi object extra');

  // Tổng số ô giữ chỗ đã bỏ:
  // Dòng 1: Type (-), Pronounce (N/A), Level (none), Ghi chú (null) = 4
  // Dòng 2: Pronounce (—), Ghi chú (–) = 2
  // Tổng: 6 ô
  assert(placeholderCount === 6, `Đã đếm chính xác 6 ô giữ chỗ đã loại bỏ (thực tế: ${placeholderCount})`);
}

async function testEnSample() {
  console.log('\n--- 4. Kiểm thử file mẫu tiếng Anh (en-sample.csv) ---');
  const filePath = path.join(__dirname, 'vocab-mappings', '__samples__', 'en-sample.csv');
  const mappingPath = path.join(__dirname, 'vocab-mappings', 'en.json');

  // Test dạng lệnh chính với --mapping
  const resDefault = await runImport({
    filePath,
    mappingPath,
    dryRun: true,
    mergeDuplicates: false,
  });

  assert(resDefault.totalRows === 4, 'Đọc được 4 dòng từ file');
  assert(resDefault.validRows === 4, 'Cả 4 dòng đều hợp lệ cú pháp');
  assert(resDefault.duplicatesCount === 1, 'Phát hiện đúng 1 cặp trùng lặp (từ "book")');
  assert(resDefault.finalRows === 3, 'Sau khử trùng còn 3 dòng (light noun, light verb, book)');

  const lightNoun = resDefault.dedupedItems.find((i) => i.term === 'light' && i.word_type === 'noun');
  const lightVerb = resDefault.dedupedItems.find((i) => i.term === 'light' && i.word_type === 'verb');
  const book = resDefault.dedupedItems.find((i) => i.term === 'book');

  assert(Boolean(lightNoun), 'Có dòng "light" với word_type là "noun"');
  assert(Boolean(lightVerb), 'Có dòng "light" với word_type là "verb"');
  assert(lightNoun?.meaning_vi === 'ánh sáng', 'Nghĩa của light noun chính xác');
  assert(lightVerb?.meaning_vi === 'thắp sáng', 'Nghĩa của light verb chính xác');
  assert(book?.meaning_vi === 'quyển sách', 'Mặc định giữ nghĩa dòng đầu của từ book');

  // Test --merge-duplicates
  const resMerged = await runImport({
    filePath,
    mappingPath,
    dryRun: true,
    mergeDuplicates: true,
  });

  const bookMerged = resMerged.dedupedItems.find((i) => i.term === 'book');
  assert(bookMerged?.meaning_vi === 'quyển sách; sách vở', 'Đã nối nghĩa thành "quyển sách; sách vở"');
}

async function testZhSample() {
  console.log('\n--- 5. Kiểm thử file mẫu tiếng Trung (zh-sample.csv & zh-sample.xlsx) ---');
  const csvPath = path.join(__dirname, 'vocab-mappings', '__samples__', 'zh-sample.csv');
  const xlsxPath = path.join(__dirname, 'vocab-mappings', '__samples__', 'zh-sample.xlsx');
  const mappingPath = path.join(__dirname, 'vocab-mappings', 'zh.json');

  // Test CSV
  const resCsv = await runImport({
    filePath: csvPath,
    mappingPath,
    dryRun: true,
  });

  assert(resCsv.totalRows === 3, 'Đọc được 3 dòng tiếng Trung CSV');
  assert(resCsv.finalRows === 3, '3 dòng CSV hợp lệ, không trùng');
  for (const item of resCsv.dedupedItems) {
    assert(item.word_type === '', `Từ "${item.term}" không có cột loại từ nên word_type là chuỗi rỗng`);
  }

  // Test XLSX tiếng Trung 4 cột
  const resXlsx = await runImport({
    filePath: xlsxPath,
    mappingPath,
    dryRun: true,
  });

  assert(resXlsx.totalRows === 4, 'Đọc được 4 dòng tiếng Trung XLSX');
  assert(resXlsx.finalRows === 4, '4 dòng XLSX hợp lệ');
  assert(resXlsx.dedupedItems[0].term === '你好', 'Từ vựng tiếng Trung đầu tiên là 你好');
}

async function testJaSample() {
  console.log('\n--- 6. Kiểm thử file mẫu tiếng Nhật (ja-sample.csv) ---');
  const filePath = path.join(__dirname, 'vocab-mappings', '__samples__', 'ja-sample.csv');
  const mappingPath = path.join(__dirname, 'vocab-mappings', 'ja.json');

  const res = await runImport({
    filePath,
    mappingPath,
    dryRun: true,
  });

  assert(res.totalRows === 3, 'Đọc được 3 dòng tiếng Nhật');
  assert(res.finalRows === 3, '3 dòng hợp lệ');

  const taberu = res.dedupedItems.find((i) => i.term === '食べる');
  assert(Boolean(taberu), 'Tìm thấy từ 食べる');
  assert(taberu?.extra?.Hiragana === 'たべる', 'Hiragana được lưu chính xác vào extra');
  assert(taberu?.extra?.['Ví dụ'] === 'リンゴを食べる', 'Ví dụ được lưu chính xác vào extra');
  assert(taberu?.level === 'N5', 'Level N5 được đọc chính xác');
}

async function testSampleValidXlsx() {
  console.log('\n--- 7. Kiểm thử sample-valid.xlsx với en.json: kiểm tra "free" và "happy" không trùng position ---');
  const validPath = path.join(__dirname, 'vocab-mappings', '__samples__', 'sample-valid.xlsx');
  const mappingPath = path.join(__dirname, 'vocab-mappings', 'en.json');

  const res = await runImport({
    filePath: validPath,
    mappingPath,
    dryRun: true,
  });

  assert(res.totalRows === 5, 'Đọc được 5 dòng từ sheet của file sample-valid.xlsx');
  assert(res.validRows === 4, 'Bỏ qua dòng tiêu đề lặp, giữ 4 dòng từ vựng hợp lệ');
  assert(res.finalRows === 4, '4 dòng từ vựng sau khử trùng');

  const book = res.dedupedItems.find((i) => i.term === 'book');
  const runItem = res.dedupedItems.find((i) => i.term === 'run');
  const free = res.dedupedItems.find((i) => i.term === 'free');
  const happy = res.dedupedItems.find((i) => i.term === 'happy');

  assert(book?.position === 1, 'Book có position = 1');
  assert(runItem?.position === 2, 'Run có position = 2');
  assert(free?.position === 3, 'Free (ô STT trống) có position = 3 (thứ tự dòng), KHÔNG bị gán 4');
  assert(happy?.position === 4, 'Happy có position = 4');
  assert(free?.position !== happy?.position, 'Free và Happy KHÔNG cùng mang position 4!');
}

async function testMissingMeaningSample() {
  console.log('\n--- 8. Kiểm thử file mẫu thiếu cột nghĩa (dừng và báo lỗi) ---');
  const invalidPath = path.join(__dirname, 'vocab-mappings', '__samples__', 'sample-missing-meaning.xlsx');
  const mappingPath = path.join(__dirname, 'vocab-mappings', 'en.json');
  let threwError = false;
  let errorMessage = '';

  try {
    await runImport({
      filePath: invalidPath,
      mappingPath,
      dryRun: true,
    });
  } catch (err: any) {
    threwError = true;
    errorMessage = err.message;
  }

  assert(threwError, 'Script ném lỗi và dừng lại khi thiếu cột nghĩa');
  assert(
    errorMessage.includes('File thiếu cột nghĩa tiếng Việt bắt buộc (meaning_vi)'),
    `Thông báo lỗi tiếng Việt chính xác: "${errorMessage}"`
  );
}

async function testPaginationAndSafetyCheck2500() {
  console.log('\n--- 9. Kiểm thử Mock Database có 2500 dòng: Phân trang 1000 dòng có .order("id"), chốt an toàn và không ghi đè nghĩa/phiên âm ---');

  // 1. Tạo 2500 dòng giả lập trong cơ sở dữ liệu
  const TOTAL_ROWS = 2500;
  const mockDatabase: any[] = [];
  for (let i = 1; i <= TOTAL_ROWS; i++) {
    mockDatabase.push({
      id: `uuid-${i}`,
      language: 'en',
      position: i,
      term: `word_${i}`,
      word_type: 'noun',
      reading: `/reading_${i}/`,
      meaning_vi: `nghĩa gốc ban đầu của từ ${i}`,
      level: null,
      extra: null,
    });
  }

  const rangeCalls: { from: number; to: number }[] = [];
  const orderCalls: { col: string; opts: any }[] = [];

  // Tạo mock Supabase client hỗ trợ .order('id', { ascending: true })
  const mockSupabase = {
    from: (_table: string) => ({
      select: (_fields: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.count === 'exact' && opts?.head === true) {
          return {
            eq: (_col: string, _val: string) => ({
              count: mockDatabase.length,
              error: null,
            }),
          };
        }
        return {
          eq: (_col: string, _val: string) => ({
            order: (col: string, orderOpts: any) => {
              orderCalls.push({ col, opts: orderOpts });
              return {
                range: async (from: number, to: number) => {
                  rangeCalls.push({ from, to });
                  const slice = mockDatabase.slice(from, to + 1);
                  return { data: slice, error: null };
                },
              };
            },
          }),
        };
      },
    }),
  };

  // 2. Kiểm thử phân trang fetchAllExistingVocab
  const fetchedRows = await fetchAllExistingVocab(mockSupabase, 'en', 1000);
  assert(fetchedRows.length === 2500, 'Đọc đủ 2500 dòng hiện có qua phân trang');
  assert(rangeCalls.length === 3, 'Đã phân trang thành đúng 3 lần gọi range (0-999, 1000-1999, 2000-2499)');
  assert(orderCalls.length === 3, 'order("id") được gọi chính xác 3 lần cho cả 3 trang');
  assert(orderCalls[0].col === 'id' && orderCalls[0].opts?.ascending === true, 'Đã sắp xếp .order("id", { ascending: true })');

  // 3a. Kiểm thử chốt an toàn 1: Khi số dòng đọc được khác count thì dừng và ném lỗi
  const mockSupabaseUnmatched = {
    from: (_table: string) => ({
      select: (_fields: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.count === 'exact' && opts?.head === true) {
          return {
            eq: (_col: string, _val: string) => ({
              count: 2500, // Count báo 2500
              error: null,
            }),
          };
        }
        return {
          eq: (_col: string, _val: string) => ({
            order: () => ({
              range: async (from: number, to: number) => {
                // Nhưng range chỉ trả về thiếu dòng (ví dụ 2400)
                const slice = mockDatabase.slice(from, Math.min(to + 1, 2400));
                return { data: slice, error: null };
              },
            }),
          }),
        };
      },
    }),
  };

  let safetyCheckTriggered = false;
  let safetyErrorMsg = '';
  try {
    await fetchAllExistingVocab(mockSupabaseUnmatched, 'en', 1000);
  } catch (err: any) {
    safetyCheckTriggered = true;
    safetyErrorMsg = err.message;
  }
  assert(safetyCheckTriggered, 'Chốt an toàn 1 kích hoạt khi số dòng đọc được khác kết quả count');
  assert(safetyErrorMsg.includes('[CHỐT AN TOÀN]'), `Thông báo chốt an toàn chuẩn xác: "${safetyErrorMsg}"`);

  // 3b. Kiểm thử khi một trang trả về error (dừng và báo ngay, không bỏ qua)
  const mockSupabaseError = {
    from: (_table: string) => ({
      select: (_fields: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.count === 'exact' && opts?.head === true) {
          return {
            eq: (_col: string, _val: string) => ({
              count: 2500,
              error: null,
            }),
          };
        }
        return {
          eq: (_col: string, _val: string) => ({
            order: () => ({
              range: async (from: number, _to: number) => {
                if (from >= 1000) {
                  return { data: null, error: { message: 'Database connection timeout on page 2' } };
                }
                return { data: mockDatabase.slice(0, 1000), error: null };
              },
            }),
          }),
        };
      },
    }),
  };

  let pageErrorTriggered = false;
  let pageErrorMsg = '';
  try {
    await fetchAllExistingVocab(mockSupabaseError, 'en', 1000);
  } catch (err: any) {
    pageErrorTriggered = true;
    pageErrorMsg = err.message;
  }
  assert(pageErrorTriggered, 'Kiểm tra error: Phát hiện lỗi trang đọc và dừng lại ném lỗi ngay');
  assert(pageErrorMsg.includes('Database connection timeout on page 2'), 'Thông báo lỗi chi tiết của trang được truyền ra');

  // 3c. Test mock: ID trùng nằm hoàn toàn trong trang cuối cùng (trang 3)
  console.log('\n>>> Kiểm thử: ID trùng nằm hoàn toàn trong trang cuối cùng (trang 3)');
  const mockSupabaseDupLastPage = {
    from: (_table: string) => ({
      select: (_fields: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.count === 'exact' && opts?.head === true) {
          return {
            eq: (_col: string, _val: string) => ({
              count: 2500,
              error: null,
            }),
          };
        }
        return {
          eq: (_col: string, _val: string) => ({
            order: () => ({
              range: async (from: number, to: number) => {
                const slice = mockDatabase.slice(from, to + 1).map((r) => ({ ...r }));
                // Ở trang cuối cùng (from = 2000), cố tình tạo ID trùng lặp hoàn toàn trong trang này
                if (from === 2000) {
                  slice[slice.length - 1].id = slice[0].id;
                }
                return { data: slice, error: null };
              },
            }),
          }),
        };
      },
    }),
  };

  let dupLastPageTriggered = false;
  let dupLastPageMsg = '';
  try {
    await fetchAllExistingVocab(mockSupabaseDupLastPage, 'en', 1000);
  } catch (err: any) {
    dupLastPageTriggered = true;
    dupLastPageMsg = err.message;
  }
  assert(dupLastPageTriggered, 'Chốt an toàn kích hoạt khi ID trùng nằm hoàn toàn trong trang cuối cùng');
  assert(dupLastPageMsg.includes('[CHỐT AN TOÀN]'), 'Thông báo lỗi có chứa [CHỐT AN TOÀN]');
  assert(dupLastPageMsg.includes('ID bị trùng lặp'), `Thông báo lỗi ID trùng lặp trang cuối chuẩn xác: "${dupLastPageMsg}"`);

  // 3d. Test mock: ID trùng giữa trang 1 và trang 3
  console.log('\n>>> Kiểm thử: ID trùng giữa trang 1 và trang 3');
  const crossPageDupId = 'uuid-cross-page-1-and-3';
  const mockSupabaseDupCrossPages = {
    from: (_table: string) => ({
      select: (_fields: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.count === 'exact' && opts?.head === true) {
          return {
            eq: (_col: string, _val: string) => ({
              count: 2500,
              error: null,
            }),
          };
        }
        return {
          eq: (_col: string, _val: string) => ({
            order: () => ({
              range: async (from: number, to: number) => {
                const slice = mockDatabase.slice(from, to + 1).map((r) => ({ ...r }));
                // Trang 1: dòng đầu tiên có ID crossPageDupId
                if (from === 0) {
                  slice[0].id = crossPageDupId;
                }
                // Trang 3: dòng cuối cùng cũng mang ID crossPageDupId
                if (from === 2000) {
                  slice[slice.length - 1].id = crossPageDupId;
                }
                return { data: slice, error: null };
              },
            }),
          }),
        };
      },
    }),
  };

  let dupCrossTriggered = false;
  let dupCrossMsg = '';
  try {
    await fetchAllExistingVocab(mockSupabaseDupCrossPages, 'en', 1000);
  } catch (err: any) {
    dupCrossTriggered = true;
    dupCrossMsg = err.message;
  }
  assert(dupCrossTriggered, 'Chốt an toàn kích hoạt khi ID trùng giữa trang 1 và trang 3');
  assert(dupCrossMsg.includes('[CHỐT AN TOÀN]'), 'Thông báo lỗi có chứa [CHỐT AN TOÀN]');
  assert(dupCrossMsg.includes(crossPageDupId), `Thông báo lỗi chỉ ra đích danh ID trùng lặp giữa trang 1 và 3 (${crossPageDupId})`);

  // 4. Kiểm thử cập nhật: Không có dòng nào trong 2500 dòng bị ghi đè meaning_vi hay reading
  console.log('\n>>> Kiểm thử bảo toàn dữ liệu khi merge 2500 dòng (không có --overwrite):');
  let overwrittenMeaningCount = 0;
  let overwrittenReadingCount = 0;
  let updatedLevelCount = 0;
  let preservedIdCount = 0;

  for (let i = 0; i < TOTAL_ROWS; i++) {
    const existing = mockDatabase[i];
    // Dữ liệu mới nạp có meaning và reading hoàn toàn khác + có thêm level 'B1'
    const incoming = {
      rowNumber: i + 2,
      position: i + 1,
      term: existing.term,
      word_type: existing.word_type,
      reading: `/MODIFIED_READING_${i + 1}/`,
      meaning_vi: `NGHĨA MỚI HOÀN TOÀN ${i + 1}`,
      level: 'B1',
      extra: {},
    };

    // Merge không có cờ overwrite
    const merged = mergeWithExistingRecord(existing, incoming, false);

    if (merged.meaning_vi !== existing.meaning_vi) {
      overwrittenMeaningCount++;
    }
    if (merged.reading !== existing.reading) {
      overwrittenReadingCount++;
    }
    if (merged.level === 'B1') {
      updatedLevelCount++;
    }
    if (merged.id === existing.id) {
      preservedIdCount++;
    }
  }

  assert(preservedIdCount === TOTAL_ROWS, `ID của toàn bộ 2500 dòng được giữ nguyên`);
  assert(overwrittenMeaningCount === 0, 'CHÍNH XÁC: 0/2500 dòng bị ghi đè meaning_vi');
  assert(overwrittenReadingCount === 0, 'CHÍNH XÁC: 0/2500 dòng bị ghi đè reading');
  assert(updatedLevelCount === 2500, 'Điền thành công trường level đang trống cho cả 2500 dòng');
}

async function testMultiSheetReading() {
  console.log('\n--- 10. Kiểm thử file mẫu Excel nhiều sheet (sample-multisheet.xlsx) ---');
  const multiPath = path.join(__dirname, 'vocab-mappings', '__samples__', 'sample-multisheet.xlsx');
  const mappingPath = path.join(__dirname, 'vocab-mappings', 'en.json');

  // A. Chạy KHÔNG CÓ --all-sheets: chỉ đọc sheet đầu tiên ("Bai 1")
  console.log('>>> A. Chạy mặc định (không có --all-sheets)');
  const resSingle = await runImport({
    filePath: multiPath,
    mappingPath,
    dryRun: true,
  });

  assert(resSingle.totalRows === 3, 'Chỉ đọc 3 dòng từ sheet đầu tiên ("Bai 1")');
  assert(resSingle.validRows === 3, 'Cả 3 dòng của sheet đầu hợp lệ');
  assert(resSingle.finalRows === 3, '3 từ vựng sau nạp');
  assert(resSingle.allSheetNames?.length === 3, 'File có đủ 3 sheet');
  assert(resSingle.processedSheetNames?.length === 1 && resSingle.processedSheetNames[0] === 'Bai 1', 'Chỉ sheet "Bai 1" được xử lý');

  // B. Chạy CÓ --all-sheets: đọc tất cả các sheet, bỏ qua sheet "Huong dan", khử trùng apple, liên tục position
  console.log('\n>>> B. Chạy với --all-sheets');
  const resAll = await runImport({
    filePath: multiPath,
    mappingPath,
    dryRun: true,
    allSheets: true,
  });

  assert(resAll.totalRows === 8, 'Tổng số dòng đọc được từ 3 sheet là 8 dòng');
  assert(resAll.validRows === 6, 'Có 6 dòng từ vựng hợp lệ từ 2 sheet dữ liệu (3 từ Bai 1, 3 từ Bai 2)');
  assert(resAll.duplicatesCount === 1, 'Phát hiện đúng 1 từ trùng lặp giữa 2 sheet (từ "apple")');
  assert(resAll.finalRows === 5, 'Sau khử trùng còn 5 từ (hello, apple, book, cat, dog)');

  // Kiểm tra bảng tổng kết sheet
  assert(resAll.sheetsSummary?.length === 3, 'Báo cáo đủ 3 sheet');
  const bai1Stat = resAll.sheetsSummary?.find((s) => s.sheetName === 'Bai 1');
  const bai2Stat = resAll.sheetsSummary?.find((s) => s.sheetName === 'Bai 2');
  const huongDanStat = resAll.sheetsSummary?.find((s) => s.sheetName === 'Huong dan');

  assert(bai1Stat?.status === 'valid' && bai1Stat.finalRows === 3, 'Bai 1 có 3 dòng nạp thành công');
  assert(bai2Stat?.status === 'valid' && bai2Stat.finalRows === 2 && bai2Stat.duplicateRowsCount === 1, 'Bai 2 có 1 dòng bị trùng lặp, 2 dòng được nạp');
  assert(huongDanStat?.status === 'skipped', 'Sheet "Huong dan" bị bỏ qua do thiếu cột bắt buộc');

  // Kiểm tra position liên tục
  const hello = resAll.dedupedItems.find((i) => i.term === 'hello');
  const apple = resAll.dedupedItems.find((i) => i.term === 'apple');
  const book = resAll.dedupedItems.find((i) => i.term === 'book');
  const cat = resAll.dedupedItems.find((i) => i.term === 'cat');
  const dog = resAll.dedupedItems.find((i) => i.term === 'dog');

  assert(hello?.position === 1, 'Hello có position 1');
  assert(apple?.position === 2, 'Apple có position 2');
  assert(book?.position === 3, 'Book có position 3');
  assert(cat?.position === 5, 'Cat từ Bai 2 được chuyển STT trùng thành position liên tục 5');
  assert(dog?.position === 6, 'Dog từ Bai 2 được chuyển STT trùng thành position liên tục 6');

  // Kiểm tra extra["Sheet"]
  assert(hello?.extra['Sheet'] === 'Bai 1', 'Hello ghi nhận Sheet = Bai 1');
  assert(cat?.extra['Sheet'] === 'Bai 2', 'Cat ghi nhận Sheet = Bai 2');

  // C. Chạy với --all-sheets và --no-sheet-name
  console.log('\n>>> C. Chạy với --all-sheets và --no-sheet-name');
  const resNoSheetName = await runImport({
    filePath: multiPath,
    mappingPath,
    dryRun: true,
    allSheets: true,
    noSheetName: true,
  });

  const helloNoSheet = resNoSheetName.dedupedItems.find((i) => i.term === 'hello');
  assert(helloNoSheet?.extra['Sheet'] === undefined, 'Khi bật --no-sheet-name thì extra không có khóa "Sheet"');

  // D. Chạy với --all-sheets và --merge-duplicates: nối nghĩa của apple
  console.log('\n>>> D. Chạy với --all-sheets và --merge-duplicates');
  const resMerged = await runImport({
    filePath: multiPath,
    mappingPath,
    dryRun: true,
    allSheets: true,
    mergeDuplicates: true,
  });

  const appleMerged = resMerged.dedupedItems.find((i) => i.term === 'apple');
  assert(appleMerged?.meaning_vi === 'quả táo; trái táo tây', 'Nghĩa của từ apple giữa 2 sheet được nối thành công: "quả táo; trái táo tây"');
}

async function main() {
  console.log('====================================================');
  console.log('BẮT ĐẦU CHẠY BỘ KIỂM THỬ IMPORT TỪ VỰNG');
  console.log('====================================================');

  await testHeaderNormalization();
  await testPositionResolution();
  await testPlaceholderValues();
  await testEnSample();
  await testZhSample();
  await testJaSample();
  await testSampleValidXlsx();
  await testMissingMeaningSample();
  await testPaginationAndSafetyCheck2500();
  await testMultiSheetReading();

  console.log('\n\x1b[32m====================================================');
  console.log('TẤT CẢ CÁC BÀI KIỂM THỬ ĐÃ VƯỢT QUA 100% THÀNH CÔNG!');
  console.log('====================================================\x1b[0m\n');
}

main().catch((err) => {
  console.error('\x1b[31mKiểm thử thất bại:\x1b[0m', err);
  process.exit(1);
});
