// ============================================================
// scripts/import-vocab.ts
// Script nạp từ vựng vào Supabase public.vocab_items
// Hỗ trợ CSV / XLSX, chuẩn hóa tên cột, mapping linh hoạt,
// chống trùng (language, term, reading, word_type),
// cảnh báo trùng trong cùng file, xử lý position duy nhất,
// xử lý giá trị giữ chỗ (placeholders),
// phân trang 1000 dòng có .order('id') và chốt an toàn (count, unique ID, error),
// và chế độ --dry-run an toàn.
// ============================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

export interface VocabMappingConfig {
  language: string;
  name: string;
  sheet?: string;
  columns: {
    position: string[];
    term: string[];
    word_type: string[];
    reading: string[];
    meaning_vi: string[];
    level: string[];
  };
  extra: string[];
}

export interface ParsedVocabItem {
  rowNumber: number;
  position: number;
  term: string;
  word_type: string;
  reading: string;
  meaning_vi: string;
  level: string | null;
  extra: Record<string, any>;
  sheetName?: string;
}

export interface DuplicateGroup {
  dedupeKey: string;
  term: string;
  word_type: string;
  reading: string;
  rows: ParsedVocabItem[];
}

/**
 * 3. Chuẩn hóa tên cột khi khớp:
 * Bỏ dấu câu (ví dụ dấu chấm: "No." -> "no"), bỏ khoảng trắng thừa,
 * không phân biệt chữ hoa thường và dấu tiếng Việt.
 */
export function normalizeHeader(header: string): string {
  if (!header) return '';
  return header
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Bỏ dấu tiếng Việt
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '') // Bỏ dấu câu như . , ; : - _ (ví dụ "No." -> "no")
    .replace(/\s+/g, ' ') // Gom khoảng trắng thừa
    .trim();
}

/**
 * 2. Giá trị giữ chỗ (Placeholder values):
 * Với các cột reading, word_type, level, extra, coi các giá trị
 * "-", "–", "—", "N/A", "n/a", "null", "none" (sau khi trim, không phân biệt hoa thường) là ô trống.
 * Không áp dụng cho term và meaning_vi.
 */
export const PLACEHOLDER_SET = new Set(['-', '–', '—', 'n/a', 'null', 'none']);

export function isPlaceholderValue(val: any): boolean {
  if (val == null) return false;
  const str = String(val).trim().toLowerCase();
  return PLACEHOLDER_SET.has(str);
}

/**
 * Tải file cấu hình mapping từ đường dẫn file trực tiếp hoặc mã ngôn ngữ (en, zh, ja)
 */
export function loadMappingConfig(mappingOrLang: string, customDir?: string): VocabMappingConfig {
  let resolvedPath = mappingOrLang;

  if (!fs.existsSync(resolvedPath)) {
    const defaultDir = customDir || path.join(__dirname, 'vocab-mappings');
    const p1 = path.join(defaultDir, mappingOrLang);
    const p2 = path.join(defaultDir, `${mappingOrLang.toLowerCase()}.json`);
    const p3 = path.join(process.cwd(), mappingOrLang);

    if (fs.existsSync(p1)) resolvedPath = p1;
    else if (fs.existsSync(p2)) resolvedPath = p2;
    else if (fs.existsSync(p3)) resolvedPath = p3;
  }

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Không tìm thấy file mapping: "${mappingOrLang}". Vui lòng kiểm tra lại đường dẫn.`);
  }

  const raw = fs.readFileSync(resolvedPath, 'utf-8');
  return JSON.parse(raw) as VocabMappingConfig;
}

export interface SheetData {
  sheetName: string;
  headers: string[];
  rows: Record<string, any>[];
}

export interface ReadFileResult {
  isMultiSheetCapable: boolean;
  totalSheetsInFile: number;
  allSheetNames: string[];
  sheets: SheetData[];
}

/**
 * Đọc file CSV hoặc Excel:
 * - Hỗ trợ đọc toàn bộ sheet với options.allSheets = true
 * - Mặc định đọc 1 sheet theo options.sheet hoặc sheet đầu tiên
 * - Báo cáo tổng số sheet và tên từng sheet
 */
export function readFileSheets(
  filePath: string,
  options?: { allSheets?: boolean; sheet?: string }
): ReadFileResult {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.csv') {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = Papa.parse<Record<string, any>>(content, {
      header: true,
      skipEmptyLines: 'greedy',
    });
    const headers = parsed.meta.fields || [];
    return {
      isMultiSheetCapable: false,
      totalSheetsInFile: 1,
      allSheetNames: ['CSV'],
      sheets: [{ sheetName: 'CSV', headers, rows: parsed.data }],
    };
  } else if (ext === '.xlsx' || ext === '.xls') {
    const fileBuffer = fs.readFileSync(filePath);
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const allSheetNames = workbook.SheetNames || [];

    if (allSheetNames.length === 0) {
      throw new Error(`File Excel không chứa bất kỳ sheet nào: ${filePath}`);
    }

    if (options?.allSheets) {
      // Đọc toàn bộ các sheet theo đúng thứ tự trong file
      const sheets: SheetData[] = [];
      for (const sName of allSheetNames) {
        const worksheet = workbook.Sheets[sName];
        const rows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '' });
        const headers: string[] = rows.length > 0 ? Object.keys(rows[0]) : [];
        sheets.push({ sheetName: sName, headers, rows });
      }
      return {
        isMultiSheetCapable: true,
        totalSheetsInFile: allSheetNames.length,
        allSheetNames,
        sheets,
      };
    } else {
      // Mặc định: đọc một sheet (theo options.sheet nếu hợp lệ, ngược lại dùng sheet đầu tiên)
      let targetSheetName = options?.sheet;
      if (!targetSheetName || !allSheetNames.includes(targetSheetName)) {
        targetSheetName = allSheetNames[0];
      }
      const worksheet = workbook.Sheets[targetSheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '' });
      const headers: string[] = rows.length > 0 ? Object.keys(rows[0]) : [];
      return {
        isMultiSheetCapable: true,
        totalSheetsInFile: allSheetNames.length,
        allSheetNames,
        sheets: [{ sheetName: targetSheetName, headers, rows }],
      };
    }
  } else {
    throw new Error(`Định dạng file không được hỗ trợ: ${ext}. Vui lòng dùng .csv hoặc .xlsx/.xls`);
  }
}

/**
 * Đọc file CSV hoặc Excel và trả về mảng các dòng (mỗi dòng là một object key-value)
 */
export function readFileRows(
  filePath: string,
  targetSheet?: string
): {
  headers: string[];
  rows: Record<string, any>[];
  sheetName: string;
  totalSheetsInFile: number;
  allSheetNames: string[];
} {
  const result = readFileSheets(filePath, { allSheets: false, sheet: targetSheet });
  const sheet = result.sheets[0];
  return {
    headers: sheet.headers,
    rows: sheet.rows,
    sheetName: sheet.sheetName,
    totalSheetsInFile: result.totalSheetsInFile,
    allSheetNames: result.allSheetNames,
  };
}

/**
 * Ánh xạ danh sách cột của file theo file mapping cấu hình
 */
export function mapColumnHeaders(
  actualHeaders: string[],
  config: VocabMappingConfig
): {
  fieldMap: Record<string, string>; // actualHeader -> targetField ('position' | 'term' | 'word_type' | 'reading' | 'meaning_vi' | 'level' | 'extra')
  unmappedHeaders: string[];
} {
  const fieldMap: Record<string, string> = {};
  const unmappedHeaders: string[] = [];

  // Tạo bảng tra cứu từ các từ đồng nghĩa đã chuẩn hóa
  const synonymLookup = new Map<string, string>();
  for (const [targetField, synonyms] of Object.entries(config.columns)) {
    for (const syn of synonyms) {
      synonymLookup.set(normalizeHeader(syn), targetField);
    }
  }

  const extraNormalized = new Set((config.extra || []).map((e) => normalizeHeader(e)));

  for (const header of actualHeaders) {
    const norm = normalizeHeader(header);
    if (!norm) continue;

    if (synonymLookup.has(norm)) {
      fieldMap[header] = synonymLookup.get(norm)!;
    } else if (extraNormalized.has(norm)) {
      fieldMap[header] = 'extra';
    } else {
      unmappedHeaders.push(header);
    }
  }

  return { fieldMap, unmappedHeaders };
}

export interface ParseVocabOptions {
  sheetName?: string;
  includeSheetName?: boolean;
  startLineOrder?: number;
  usedPositions?: Set<number>;
}

/**
 * Chuyển đổi các dòng thô trong file thành mảng ParsedVocabItem.
 * - Xử lý thứ tự (position): STT trống/sai số dùng thứ tự dòng liên tục, khử trùng position.
 * - Xử lý giá trị giữ chỗ (reading, word_type, level, extra): "-", "–", "—", "N/A", "null", "none" -> coi là rỗng.
 * - Hỗ trợ gán Sheet vào extra nếu includeSheetName = true.
 */
export function parseVocabRows(
  rows: Record<string, any>[],
  fieldMap: Record<string, string>,
  unmappedHeaders: string[],
  options?: ParseVocabOptions
): {
  validItems: ParsedVocabItem[];
  invalidRows: { rowNumber: number; reason: string; sheetName?: string }[];
  positionWarnings: string[];
  placeholderCount: number;
} {
  const sheetName = options?.sheetName;
  const includeSheetName = options?.includeSheetName ?? false;
  const startLineOrder = options?.startLineOrder ?? 1;
  const usedPositions = options?.usedPositions ?? new Set<number>();

  const rawItems: {
    rowNumber: number;
    sheetName?: string;
    rawPositionStr: string;
    term: string;
    word_type: string;
    reading: string;
    meaning_vi: string;
    level: string | null;
    extra: Record<string, any>;
  }[] = [];
  const invalidRows: { rowNumber: number; reason: string; sheetName?: string }[] = [];
  let placeholderCount = 0;

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    const rowNumber = idx + 2; // Dòng 1 là header, dữ liệu bắt đầu từ dòng 2

    let rawPositionStr = '';
    let term = '';
    let word_type = '';
    let reading = '';
    let meaning_vi = '';
    let level: string | null = null;
    const extra: Record<string, any> = {};
    if (includeSheetName && sheetName) {
      extra['Sheet'] = sheetName;
    }
    let rowPlaceholderCount = 0;

    for (const [colName, val] of Object.entries(row)) {
      const targetField = fieldMap[colName];
      const strVal = val != null ? String(val).trim() : '';

      if (targetField === 'position') {
        rawPositionStr = strVal;
      } else if (targetField === 'term') {
        term = strVal; // Không áp dụng giá trị giữ chỗ cho term
      } else if (targetField === 'word_type') {
        if (isPlaceholderValue(strVal)) {
          rowPlaceholderCount++;
          word_type = '';
        } else {
          word_type = strVal;
        }
      } else if (targetField === 'reading') {
        if (isPlaceholderValue(strVal)) {
          rowPlaceholderCount++;
          reading = '';
        } else {
          reading = strVal;
        }
      } else if (targetField === 'meaning_vi') {
        meaning_vi = strVal; // Không áp dụng giá trị giữ chỗ cho meaning_vi
      } else if (targetField === 'level') {
        if (isPlaceholderValue(strVal)) {
          rowPlaceholderCount++;
          level = null;
        } else {
          level = strVal || null;
        }
      } else if (targetField === 'extra') {
        if (strVal) {
          if (isPlaceholderValue(strVal)) {
            rowPlaceholderCount++;
          } else {
            extra[colName] = strVal;
          }
        }
      } else {
        // Cột không nằm trong mapping chuẩn được đưa vào extra nếu có giá trị
        if (strVal) {
          if (isPlaceholderValue(strVal)) {
            rowPlaceholderCount++;
          } else {
            extra[colName] = strVal;
          }
        }
      }
    }

    // 1. Kiểm tra trường bắt buộc
    if (!term) {
      invalidRows.push({ rowNumber, sheetName, reason: 'Thiếu từ vựng (term/word)' });
      continue;
    }
    if (!meaning_vi) {
      invalidRows.push({ rowNumber, sheetName, reason: `Từ "${term}" thiếu nghĩa tiếng Việt (meaning_vi)` });
      continue;
    }

    // Bỏ qua nếu là dòng tiêu đề lặp lại giữa file
    const normTerm = normalizeHeader(term);
    const normMeaning = normalizeHeader(meaning_vi);
    const isRepeatedHeader =
      (normTerm === 'tu vung' || normTerm === 'word' || normTerm === 'term') &&
      (normMeaning === 'nghia' || normMeaning === 'meaning' || normMeaning === 'nghia tieng viet');
    if (isRepeatedHeader) {
      continue;
    }

    placeholderCount += rowPlaceholderCount;

    rawItems.push({
      rowNumber,
      sheetName,
      rawPositionStr,
      term,
      word_type,
      reading,
      meaning_vi,
      level,
      extra,
    });
  }

  // 2. Xử lý thứ tự (position):
  const validItems: ParsedVocabItem[] = [];
  const positionWarnings: string[] = [];

  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i];
    const lineOrder = startLineOrder + i; // Thứ tự dòng liên tục (bắt đầu từ startLineOrder)

    let finalPos: number;

    if (raw.rawPositionStr) {
      const parsedNum = parseInt(raw.rawPositionStr, 10);
      if (!isNaN(parsedNum) && String(parsedNum) === raw.rawPositionStr && parsedNum > 0) {
        finalPos = parsedNum;
      } else {
        // Không phải số hợp lệ -> dùng thứ tự dòng liên tục
        finalPos = lineOrder;
      }
    } else {
      // Ô STT trống -> dùng thứ tự dòng liên tục
      finalPos = lineOrder;
    }

    // Kiểm tra trùng lặp position với các dòng trước đó trong cùng lần nạp
    if (usedPositions.has(finalPos)) {
      const duplicatePos = finalPos;
      // Dùng thứ tự dòng liên tục
      let fallbackPos = lineOrder;
      if (usedPositions.has(fallbackPos)) {
        let candidate = 1;
        while (usedPositions.has(candidate)) {
          candidate++;
        }
        fallbackPos = candidate;
      }

      const sheetPrefix = raw.sheetName ? `Sheet "${raw.sheetName}", ` : '';
      positionWarnings.push(
        `${sheetPrefix}dòng ${raw.rowNumber} (từ "${raw.term}"): STT ${duplicatePos} bị trùng lặp. Đã chuyển sang thứ tự liên tục (${fallbackPos}).`
      );
      finalPos = fallbackPos;
    }

    usedPositions.add(finalPos);

    validItems.push({
      rowNumber: raw.rowNumber,
      sheetName: raw.sheetName,
      position: finalPos,
      term: raw.term,
      word_type: raw.word_type, // Thiếu cột loại từ hoặc placeholder thì là chuỗi rỗng ""
      reading: raw.reading,     // Thiếu phiên âm hoặc placeholder thì là chuỗi rỗng ""
      meaning_vi: raw.meaning_vi,
      level: raw.level,
      extra: raw.extra,
    });
  }

  return { validItems, invalidRows, positionWarnings, placeholderCount };
}

/**
 * 4. Xử lý trùng lặp TRONG CÙNG FILE:
 * Quy tắc chống trùng: UNIQUE (term, reading, word_type).
 * Cùng term nhưng khác word_type là HỢP LỆ (ví dụ "light" noun vs verb), không coi là trùng.
 * Khi trùng: in cảnh báo liệt kê số dòng và nghĩa.
 * Mặc định: giữ dòng đầu, bỏ các dòng sau.
 * Nếu có tùy chọn mergeDuplicates: nối các nghĩa bằng "; ".
 */
export function deduplicateInFile(
  items: ParsedVocabItem[],
  mergeDuplicates: boolean
): {
  dedupedItems: ParsedVocabItem[];
  duplicates: DuplicateGroup[];
} {
  const groups = new Map<string, ParsedVocabItem[]>();

  for (const item of items) {
    const key = `${item.term.trim().toLowerCase()}|${item.reading.trim().toLowerCase()}|${item.word_type.trim().toLowerCase()}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(item);
  }

  const dedupedItems: ParsedVocabItem[] = [];
  const duplicates: DuplicateGroup[] = [];

  for (const [key, groupRows] of groups.entries()) {
    if (groupRows.length > 1) {
      duplicates.push({
        dedupeKey: key,
        term: groupRows[0].term,
        word_type: groupRows[0].word_type,
        reading: groupRows[0].reading,
        rows: groupRows,
      });

      if (mergeDuplicates) {
        // Nối nghĩa bằng "; "
        const mergedMeanings = groupRows
          .map((r) => r.meaning_vi.trim())
          .filter(Boolean)
          .join('; ');

        // Gộp extra
        const mergedExtra: Record<string, any> = {};
        for (const r of groupRows) {
          Object.assign(mergedExtra, r.extra);
        }

        const first = groupRows[0];
        dedupedItems.push({
          ...first,
          meaning_vi: mergedMeanings,
          extra: mergedExtra,
        });
      } else {
        // Mặc định: giữ dòng đầu, bỏ các dòng sau
        dedupedItems.push(groupRows[0]);
      }
    } else {
      dedupedItems.push(groupRows[0]);
    }
  }

  return { dedupedItems, duplicates };
}

/**
 * 5. Cập nhật dòng đã có:
 * Chỉ điền các trường đang trống (word_type, level, extra, position).
 * KHÔNG ghi đè meaning_vi hay reading đã có trừ khi có --overwrite.
 * Không xóa dữ liệu, không đổi id.
 */
export function mergeWithExistingRecord(
  existing: any,
  incoming: ParsedVocabItem,
  overwrite: boolean
): any {
  return {
    id: existing.id,
    language: existing.language,
    term: existing.term,
    // Nếu có overwrite: cập nhật reading mới; nếu không: chỉ điền nếu đang trống
    reading: overwrite ? (incoming.reading || existing.reading) : (existing.reading || incoming.reading),
    // word_type: nếu có overwrite: cập nhật mới; nếu không: chỉ điền nếu đang trống
    word_type: overwrite ? incoming.word_type : (existing.word_type || incoming.word_type),
    // meaning_vi: KHÔNG ghi đè trừ khi có overwrite
    meaning_vi: overwrite ? incoming.meaning_vi : existing.meaning_vi,
    // level: điền nếu đang trống
    level: overwrite ? incoming.level : (existing.level || incoming.level),
    // position: giữ nguyên hoặc cập nhật nếu overwrite
    position: overwrite ? incoming.position : (existing.position ?? incoming.position),
    // extra: gộp extra
    extra: {
      ...(existing.extra || {}),
      ...(incoming.extra || {}),
      ...(overwrite ? incoming.extra : (existing.extra || {})),
    },
  };
}

/**
 * 1 & 3. Phân trang khi đọc dòng hiện có (Phương án A):
 * Đọc toàn bộ các dòng hiện có của một ngôn ngữ từ bảng public.vocab_items
 * theo từng 1000 dòng (range) cho tới khi hết.
 * - Thêm .order('id', { ascending: true }) để đảm bảo thứ tự phân trang ổn định.
 * - Kiểm tra trường error của từng lần đọc (nếu có lỗi thì dừng và báo, không bỏ qua).
 * - Sau khi đọc xong, kiểm tra số dòng khớp count (Chốt an toàn 1).
 * - Kiểm tra không có id bị lặp trong allRows; nếu có thì dừng và báo lỗi (Chốt an toàn 2).
 */
export async function fetchAllExistingVocab(
  supabase: any,
  language: string,
  pageSize = 1000
): Promise<any[]> {
  // 1. Đếm tổng số dòng hiện có bằng truy vấn count chính xác
  const { count, error: countErr } = await supabase
    .from('vocab_items')
    .select('*', { count: 'exact', head: true })
    .eq('language', language);

  if (countErr) {
    throw new Error(`Lỗi đếm số lượng từ vựng hiện có: ${countErr.message || JSON.stringify(countErr)}`);
  }

  const totalExpected = count ?? 0;
  console.log(`- Đang đọc dữ liệu hiện có trong DB (tổng cộng: ${totalExpected} dòng, phân trang ${pageSize} dòng/lần)...`);

  const allRows: any[] = [];
  const seenIds = new Set<string>();

  if (totalExpected === 0) {
    return allRows;
  }

  // 2. Phân trang đọc từng 1000 dòng cho tới khi hết với thứ tự ổn định (.order('id', { ascending: true }))
  for (let from = 0; from < totalExpected; from += pageSize) {
    const to = Math.min(from + pageSize - 1, totalExpected - 1);
    const { data: pageData, error: pageErr } = await supabase
      .from('vocab_items')
      .select('*')
      .eq('language', language)
      .order('id', { ascending: true })
      .range(from, to);

    // Kiểm tra trường error của từng lần đọc: nếu có lỗi thì dừng và báo ngay, không bỏ qua
    if (pageErr) {
      throw new Error(`Lỗi đọc phân trang từ vựng (${from} - ${to}): ${pageErr.message || JSON.stringify(pageErr)}`);
    }

    if (!pageData || !Array.isArray(pageData)) {
      throw new Error(`Lỗi đọc phân trang từ vựng (${from} - ${to}): Không nhận được dữ liệu hợp lệ.`);
    }

    // Gộp dữ liệu trang vừa đọc vào allRows
    allRows.push(...pageData);

    // Kiểm tra id lặp chạy SAU KHI GỘP dữ liệu trang vừa đọc vào allRows
    const pageDuplicateIds: string[] = [];
    for (const row of pageData) {
      if (row && row.id) {
        if (seenIds.has(row.id)) {
          pageDuplicateIds.push(row.id);
        } else {
          seenIds.add(row.id);
        }
      }
    }

    if (pageDuplicateIds.length > 0) {
      throw new Error(
        `[CHỐT AN TOÀN] Phát hiện ${pageDuplicateIds.length} ID bị trùng lặp sau khi gộp trang (${from} - ${to}) (ví dụ: ${pageDuplicateIds.slice(0, 3).join(', ')}). Dừng toàn bộ tiến trình và KHÔNG ghi gì vào cơ sở dữ liệu.`
      );
    }
  }

  // 3. Chốt an toàn 1: số dòng đọc được phải khớp với kết quả count của chính truy vấn đó
  if (allRows.length !== totalExpected) {
    throw new Error(
      `[CHỐT AN TOÀN] Số dòng đọc được (${allRows.length}) khác với kết quả count (${totalExpected}). Dừng toàn bộ tiến trình và KHÔNG ghi gì vào cơ sở dữ liệu.`
    );
  }

  // 4. Chốt an toàn 2: chạy lại một lần sau vòng lặp trên toàn bộ allRows
  const finalSeenIds = new Set<string>();
  const finalDuplicateIds: string[] = [];
  for (const row of allRows) {
    if (row && row.id) {
      if (finalSeenIds.has(row.id)) {
        finalDuplicateIds.push(row.id);
      } else {
        finalSeenIds.add(row.id);
      }
    }
  }

  if (finalDuplicateIds.length > 0) {
    throw new Error(
      `[CHỐT AN TOÀN] Phát hiện ${finalDuplicateIds.length} ID bị trùng lặp trong toàn bộ dữ liệu đã đọc (ví dụ: ${finalDuplicateIds.slice(0, 3).join(', ')}). Dừng toàn bộ tiến trình và KHÔNG ghi gì vào cơ sở dữ liệu.`
    );
  }

  return allRows;
}

export interface SheetSummaryItem {
  sheetName: string;
  totalRowsRead: number;
  validRows: number;
  invalidRowsCount: number;
  duplicateRowsCount: number;
  finalRows: number;
  status: 'valid' | 'skipped';
  skipReason?: string;
}

export interface RunImportResult {
  success: boolean;
  totalRows: number;
  validRows: number;
  finalRows: number;
  duplicatesCount?: number;
  placeholderCount: number;
  dedupedItems: ParsedVocabItem[];
  insertCount?: number;
  updateCount?: number;
  allSheetNames?: string[];
  processedSheetNames?: string[];
  sheetsSummary?: SheetSummaryItem[];
}

/**
 * Chạy quy trình import từ vựng
 */
export async function runImport(options: {
  filePath: string;
  mappingPath?: string;
  language?: string;
  dryRun?: boolean;
  mergeDuplicates?: boolean;
  overwrite?: boolean;
  allSheets?: boolean;
  sheet?: string;
  noSheetName?: boolean;
}): Promise<RunImportResult> {
  const {
    filePath,
    mappingPath,
    dryRun = true,
    mergeDuplicates = false,
    overwrite = false,
    allSheets = false,
    sheet,
    noSheetName = false,
  } = options;

  console.log('========================================================================');
  console.log('NALESE — SCRIPT NẠP TỪ VỰNG (VOCABULARY IMPORTER)');
  console.log('========================================================================');
  console.log(`- File nguồn: ${filePath}`);
  console.log(`- Chế độ: ${dryRun ? '\x1b[33m[DRY-RUN] (Không ghi vào database)\x1b[0m' : '\x1b[32m[GHI THẬT DATABASE]\x1b[0m'}`);
  console.log(`- Chế độ đọc sheet: ${allSheets ? 'TẤT CẢ CÁC SHEET (--all-sheets)' : (sheet ? `Sheet đơn ("${sheet}")` : 'Mặc định (Sheet đầu tiên hoặc theo mapping)')}`);
  console.log(`- Trùng lặp trong file: ${mergeDuplicates ? 'Nối nghĩa ("; ")' : 'Mặc định (Giữ dòng đầu, bỏ dòng sau)'}`);
  console.log(`- Cập nhật dòng có sẵn: ${overwrite ? 'Ghi đè (--overwrite)' : 'Chỉ điền trường trống (Bảo toàn nghĩa/phiên âm cũ)'}`);
  console.log(`- Quy tắc chống trùng: UNIQUE (language, term, reading, word_type)\n`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`File không tồn tại: ${filePath}`);
  }

  // Tải cấu hình mapping:
  let config: VocabMappingConfig;
  let lang = options.language;

  if (mappingPath) {
    config = loadMappingConfig(mappingPath);
    lang = config.language;
    console.log(`- File mapping chỉ định: ${mappingPath}`);
  } else {
    if (!lang) {
      const filename = path.basename(filePath).toLowerCase();
      if (filename.includes('en') || filename.includes('anh')) lang = 'en';
      else if (filename.includes('zh') || filename.includes('trung') || filename.includes('cn')) lang = 'zh';
      else if (filename.includes('ja') || filename.includes('nhat') || filename.includes('jp')) lang = 'ja';
      else {
        lang = 'en';
        console.log(`- Không chỉ định ngôn ngữ hay mapping, tự động chọn: "${lang}"`);
      }
    }
    config = loadMappingConfig(lang);
  }

  console.log(`1. CẤU HÌNH MAPPING: [${config.name.toUpperCase()} - ${lang}]`);

  // Đọc file theo chế độ single sheet hoặc multi-sheet
  const targetSheetOption = sheet || config.sheet;
  const fileResult = readFileSheets(filePath, { allSheets, sheet: targetSheetOption });

  if (fileResult.isMultiSheetCapable) {
    console.log(`- File Excel có ${fileResult.totalSheetsInFile} sheet: [${fileResult.allSheetNames.map((s) => `"${s}"`).join(', ')}]`);
    if (allSheets) {
      console.log(`- Đang xử lý tất cả ${fileResult.sheets.length} sheet theo thứ tự trong file.`);
    } else {
      console.log(`- Sheet được chọn đọc: "${fileResult.sheets[0].sheetName}" (dùng --all-sheets để đọc mọi sheet)`);
    }
  } else {
    console.log(`- Định dạng file: CSV (1 bảng dữ liệu)`);
  }

  const sheetSummaryList: SheetSummaryItem[] = [];
  const allValidItems: ParsedVocabItem[] = [];
  const allInvalidRows: { rowNumber: number; reason: string; sheetName?: string }[] = [];
  const allPositionWarnings: string[] = [];
  const usedPositions = new Set<number>();
  let totalPlaceholderCount = 0;
  let totalRawRowsCount = 0;
  let cumulativeLineOrder = 1;
  const processedSheetNames: string[] = [];

  for (const sheetItem of fileResult.sheets) {
    totalRawRowsCount += sheetItem.rows.length;

    // Ánh xạ cột của sheet này
    const { fieldMap, unmappedHeaders } = mapColumnHeaders(sheetItem.headers, config);
    const mappedTargets = new Set(Object.values(fieldMap));

    const missingCols: string[] = [];
    if (!mappedTargets.has('term')) missingCols.push('term (từ vựng)');
    if (!mappedTargets.has('meaning_vi')) missingCols.push('meaning_vi (nghĩa tiếng Việt)');

    if (missingCols.length > 0) {
      if (allSheets) {
        console.log(
          `\n\x1b[33m[CẢNH BÁO BỎ QUA SHEET] Sheet "${sheetItem.sheetName}" không có đủ cột bắt buộc (thiếu: ${missingCols.join(', ')}). Bỏ qua sheet này.\x1b[0m`
        );
        sheetSummaryList.push({
          sheetName: sheetItem.sheetName,
          totalRowsRead: sheetItem.rows.length,
          validRows: 0,
          invalidRowsCount: sheetItem.rows.length,
          duplicateRowsCount: 0,
          finalRows: 0,
          status: 'skipped',
          skipReason: `Thiếu ${missingCols.join(', ')}`,
        });
        continue;
      } else {
        if (!mappedTargets.has('term')) {
          throw new Error('File thiếu cột từ vựng bắt buộc (term/word). Vui lòng kiểm tra lại cấu trúc file.');
        }
        if (!mappedTargets.has('meaning_vi')) {
          throw new Error('File thiếu cột nghĩa tiếng Việt bắt buộc (meaning_vi). Vui lòng kiểm tra lại cấu trúc file.');
        }
      }
    }

    processedSheetNames.push(sheetItem.sheetName);

    // In thông tin cột nếu là sheet đầu tiên hoặc chế độ 1 sheet
    if (processedSheetNames.length === 1) {
      console.log('\n2. KẾT QUẢ ÁNH XẠ CỘT (Mẫu từ sheet đầu tiên):');
      for (const [col, target] of Object.entries(fieldMap)) {
        console.log(`   * "${col}" -> [${target}]`);
      }
      if (unmappedHeaders.length > 0) {
        console.log(`   * Các cột đưa vào extra: ${unmappedHeaders.join(', ')}`);
      }
    }

    // Parse các dòng của sheet này
    const { validItems, invalidRows, positionWarnings, placeholderCount } = parseVocabRows(
      sheetItem.rows,
      fieldMap,
      unmappedHeaders,
      {
        sheetName: sheetItem.sheetName,
        includeSheetName: !noSheetName && (allSheets || Boolean(sheet)),
        startLineOrder: cumulativeLineOrder,
        usedPositions,
      }
    );

    cumulativeLineOrder += validItems.length;
    totalPlaceholderCount += placeholderCount;
    allValidItems.push(...validItems);
    allInvalidRows.push(...invalidRows);
    allPositionWarnings.push(...positionWarnings);

    sheetSummaryList.push({
      sheetName: sheetItem.sheetName,
      totalRowsRead: sheetItem.rows.length,
      validRows: validItems.length,
      invalidRowsCount: invalidRows.length,
      duplicateRowsCount: 0,
      finalRows: validItems.length,
      status: 'valid',
    });
  }

  if (allValidItems.length === 0) {
    throw new Error('Không có dòng từ vựng hợp lệ nào trong file (tất cả các sheet đều rỗng hoặc thiếu cột bắt buộc).');
  }

  if (allInvalidRows.length > 0) {
    console.log(`\n\x1b[33m[CẢNH BÁO DÒNG KHÔNG HỢP LỆ] Bỏ qua ${allInvalidRows.length} dòng:\x1b[0m`);
    for (const inv of allInvalidRows) {
      const prefix = inv.sheetName ? `Sheet "${inv.sheetName}", ` : '';
      console.log(`   - ${prefix}dòng ${inv.rowNumber}: ${inv.reason}`);
    }
  }

  if (allPositionWarnings.length > 0) {
    console.log(`\n\x1b[33m[CẢNH BÁO THỨ TỰ (POSITION)] Đã xử lý ${allPositionWarnings.length} trường hợp STT trùng/lệch:\x1b[0m`);
    for (const warn of allPositionWarnings) {
      console.log(`   * ${warn}`);
    }
  }

  // Khử trùng lặp trên toàn bộ dữ liệu mọi sheet
  const { dedupedItems, duplicates } = deduplicateInFile(allValidItems, mergeDuplicates);
  if (duplicates.length > 0) {
    console.log(`\n\x1b[33m[CẢNH BÁO TRÙNG LẶP DỮ LIỆU] Phát hiện ${duplicates.length} mục trùng (cùng term, reading, word_type):\x1b[0m`);
    for (const dup of duplicates) {
      console.log(`   * Từ: "${dup.term}" | Loại từ: "${dup.word_type || '(trống)'}" | Phiên âm: "${dup.reading || '(trống)'}" (${dup.rows.length} lần):`);
      for (const r of dup.rows) {
        const sheetPrefix = r.sheetName ? `Sheet "${r.sheetName}", ` : '';
        console.log(`       - ${sheetPrefix}dòng ${r.rowNumber}: "${r.meaning_vi}"`);
      }
      const first = dup.rows[0];
      const firstPrefix = first.sheetName ? `Sheet "${first.sheetName}", dòng ${first.rowNumber}` : `dòng ${first.rowNumber}`;
      if (mergeDuplicates) {
        console.log(`       -> Đã nối nghĩa thành: "${dup.rows.map((r) => r.meaning_vi.trim()).join('; ')}"`);
      } else {
        console.log(`       -> Mặc định: Giữ dòng đầu (${firstPrefix}), bỏ qua ${dup.rows.length - 1} dòng sau.`);
      }
    }
  } else {
    console.log('\n[KIỂM TRA TRÙNG TRONG FILE] Không có dòng nào trùng lặp (cùng term, reading, word_type).');
  }

  // Cập nhật thống kê từng sheet sau khử trùng
  const finalSheetCountMap = new Map<string, number>();
  for (const item of dedupedItems) {
    const sName = item.sheetName || (fileResult.sheets[0] ? fileResult.sheets[0].sheetName : 'default');
    finalSheetCountMap.set(sName, (finalSheetCountMap.get(sName) || 0) + 1);
  }

  for (const stat of sheetSummaryList) {
    if (stat.status === 'valid') {
      const kept = finalSheetCountMap.get(stat.sheetName) || 0;
      stat.finalRows = kept;
      stat.duplicateRowsCount = stat.validRows - kept;
    }
  }

  // Bảng tổng kết theo sheet
  console.log(`\n3. BẢNG TỔNG KẾT THEO SHEET:`);
  console.log('--------------------------------------------------------------------------------------------------------');
  console.log(' STT | Tên Sheet             | Đọc được | Hợp lệ | Bị bỏ / Lỗi | Trùng lặp | Được nạp | Trạng thái');
  console.log('--------------------------------------------------------------------------------------------------------');
  let sumRead = 0;
  let sumValid = 0;
  let sumInvalid = 0;
  let sumDup = 0;
  let sumFinal = 0;

  sheetSummaryList.forEach((stat, idx) => {
    sumRead += stat.totalRowsRead;
    sumValid += stat.validRows;
    sumInvalid += stat.invalidRowsCount;
    sumDup += stat.duplicateRowsCount;
    sumFinal += stat.finalRows;

    const sttCol = String(idx + 1).padStart(3);
    const nameCol = stat.sheetName.padEnd(21).slice(0, 21);
    const readCol = String(stat.totalRowsRead).padStart(8);
    const validCol = String(stat.validRows).padStart(6);
    const invCol = String(stat.invalidRowsCount).padStart(11);
    const dupCol = String(stat.duplicateRowsCount).padStart(9);
    const finalCol = String(stat.finalRows).padStart(8);
    const statusCol = stat.status === 'skipped' ? `Bỏ qua (${stat.skipReason || ''})` : 'Đã nạp';

    console.log(` ${sttCol} | ${nameCol} | ${readCol} | ${validCol} | ${invCol} | ${dupCol} | ${finalCol} | ${statusCol}`);
  });

  console.log('--------------------------------------------------------------------------------------------------------');
  console.log(
    `     | TỔNG CỘNG             | ${String(sumRead).padStart(8)} | ${String(sumValid).padStart(6)} | ${String(sumInvalid).padStart(11)} | ${String(sumDup).padStart(9)} | ${String(sumFinal).padStart(8)} |`
  );
  console.log('--------------------------------------------------------------------------------------------------------');
  console.log(`- Số ô giữ chỗ đã loại bỏ (reading, word_type, level, extra): ${totalPlaceholderCount}`);

  // In mẫu dữ liệu đã chuẩn bị
  console.log('\n4. MẪU DỮ LIỆU CHUẨN BỊ NẠP (PREVIEW):');
  const fileHasWordType = dedupedItems.some((item) => Boolean(item.word_type));
  const previewCount = Math.min(dedupedItems.length, 5);
  for (let i = 0; i < previewCount; i++) {
    const item = dedupedItems[i];
    const typePart = fileHasWordType ? `${item.word_type || '(trống)'}, ` : '';
    const readingPart = item.reading || '(trống)';
    console.log(`   [${item.position}] ${item.term} (${typePart}${readingPart}): "${item.meaning_vi}"${item.level ? ' [' + item.level + ']' : ''}`);
    if (Object.keys(item.extra).length > 0) {
      console.log(`       Extra: ${JSON.stringify(item.extra)}`);
    }
  }

  if (dryRun) {
    console.log('\n\x1b[32m[DRY-RUN HOÀN TẤT] Script chạy thành công ở chế độ chạy thử, KHÔNG có dữ liệu nào bị ghi vào cơ sở dữ liệu.\x1b[0m');
    return {
      success: true,
      totalRows: totalRawRowsCount,
      validRows: allValidItems.length,
      finalRows: dedupedItems.length,
      duplicatesCount: duplicates.length,
      placeholderCount: totalPlaceholderCount,
      dedupedItems,
      allSheetNames: fileResult.allSheetNames,
      processedSheetNames,
      sheetsSummary: sheetSummaryList,
    };
  }

  // Nếu KHÔNG PHẢI dry-run (chạy thật), kết nối Supabase và upsert
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Chạy thật cần NEXT_PUBLIC_SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY trong môi trường.');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  console.log('\n5. TIẾN HÀNH UPSERT VÀO SUPABASE (public.vocab_items)...');

  // Đọc danh sách từ hiện có theo ngôn ngữ có phân trang 1000 dòng, .order('id') + chốt an toàn
  const existingRows = await fetchAllExistingVocab(supabase, lang);
  console.log(`- Đã đọc xong ${existingRows.length} dòng hiện có từ database.`);
  console.log(
    '[DEBUG] Bản ghi DB thiếu id:',
    existingRows.filter((row: any) => !row.id).length
  );

  console.log(
    '[DEBUG] Ví dụ bản ghi DB:',
    existingRows.slice(0, 2).map((row: any) => ({
      id: row.id,
      language: row.language,
      term: row.term,
      reading: row.reading,
      word_type: row.word_type,
    }))
  );

  const existingMap = new Map<string, any>();
  for (const row of existingRows) {
    const key = `${(row.term || '').trim().toLowerCase()}|${(row.reading || '').trim().toLowerCase()}|${(row.word_type || '').trim().toLowerCase()}`;
    existingMap.set(key, row);
  }

  let insertCount = 0;
  let updateCount = 0;
  const recordsToUpsert = [];

  for (const item of dedupedItems) {
    const key = `${item.term.trim().toLowerCase()}|${item.reading.trim().toLowerCase()}|${item.word_type.trim().toLowerCase()}`;
    const existing = existingMap.get(key);

    if (existing) {
      // 5. Đã có trong DB: điền các trường trống, không đổi nghĩa/phiên âm trừ khi overwrite
      const merged = mergeWithExistingRecord(existing, item, overwrite);
      recordsToUpsert.push(merged);
      updateCount++;
    } else {
      // Từ mới hoàn toàn: gán UUID v4 để đồng nhất schema batch với bản ghi cập nhật, tránh lỗi PostgREST gán NULL cho id
      recordsToUpsert.push({
        id: crypto.randomUUID(),
        language: lang,
        position: item.position,
        term: item.term,
        word_type: item.word_type || '',
        reading: item.reading || '',
        meaning_vi: item.meaning_vi,
        level: item.level || null,
        extra: Object.keys(item.extra).length > 0 ? item.extra : null,
      });
      insertCount++;
    }
  }

  // Batch upsert (tối đa 250 dòng / batch để tránh timeout kết nối mạng khi nạp khối dữ liệu lớn)
  const BATCH_SIZE = 250;
  const totalBatches = Math.ceil(recordsToUpsert.length / BATCH_SIZE);
  console.log(`\n- Tiến hành nạp ${recordsToUpsert.length} bản ghi vào database qua ${totalBatches} batch...`);

  for (let i = 0; i < recordsToUpsert.length; i += BATCH_SIZE) {
    const batchIndex = Math.floor(i / BATCH_SIZE) + 1;
    const batch = recordsToUpsert.slice(i, i + BATCH_SIZE).map((row: any) => ({
      ...row,
      id: row.id || crypto.randomUUID(),
    }));

    let lastError: any = null;
    const maxRetries = 4;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const { error: upsertErr } = await supabase
          .from('vocab_items')
          .upsert(batch, { onConflict: 'language,term,reading,word_type' });

        if (!upsertErr) {
          lastError = null;
          break;
        }

        lastError = upsertErr;
        console.warn(`  [Cảnh báo] Batch ${batchIndex}/${totalBatches} lần thử ${attempt} gặp lỗi: ${upsertErr.message}. Đang thử lại sau ${attempt * 1500}ms...`);
      } catch (err: any) {
        lastError = err;
        console.warn(`  [Cảnh báo] Batch ${batchIndex}/${totalBatches} lần thử ${attempt} ngoại lệ: ${err.message}. Đang thử lại sau ${attempt * 1500}ms...`);
      }

      if (attempt < maxRetries) {
        await new Promise((res) => setTimeout(res, attempt * 1500));
      }
    }

    if (lastError) {
      throw new Error(`Lỗi upsert batch ${batchIndex}/${totalBatches}: ${lastError.message || JSON.stringify(lastError)}`);
    }

    console.log(`  + [Batch ${batchIndex}/${totalBatches}] Nạp thành công ${batch.length} dòng (Lũy kế: ${Math.min(i + BATCH_SIZE, recordsToUpsert.length)}/${recordsToUpsert.length})`);
  }

  console.log(`\n\x1b[32m[THÀNH CÔNG] Đã cập nhật xong database: ${insertCount} từ mới, ${updateCount} từ cập nhật.\x1b[0m`);
  return {
    success: true,
    totalRows: totalRawRowsCount,
    validRows: allValidItems.length,
    finalRows: dedupedItems.length,
    insertCount,
    updateCount,
    placeholderCount: totalPlaceholderCount,
    dedupedItems,
    allSheetNames: fileResult.allSheetNames,
    processedSheetNames,
    sheetsSummary: sheetSummaryList,
  };
}

// ============================================================
// CLI Argument Parsing
// ============================================================
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log(`
Cách sử dụng:
  npx tsx scripts/import-vocab.ts --file <đường dẫn> --mapping <file mapping> [options]

Tùy chọn:
  --file <path>           Đường dẫn file từ vựng (.csv hoặc .xlsx) [Bắt buộc]
  --mapping <file>        File mapping JSON (ví dụ: scripts/vocab-mappings/en.json hoặc en.json hoặc en)
  --lang <en|zh|ja>       Ngôn ngữ (chỉ dùng khi không có --mapping)
  --all-sheets            Đọc toàn bộ các sheet có cấu trúc hợp lệ trong file Excel
  --sheet <name>          Chỉ đọc sheet chỉ định theo tên
  --no-sheet-name         Không thêm tên sheet vào trường extra
  --dry-run               Chạy thử nghiệm, KHÔNG ghi vào DB (mặc định)
  --write                 Chạy ghi thật vào database (cần SUPABASE_SERVICE_ROLE_KEY)
  --merge-duplicates      Nối nghĩa bằng "; " nếu trùng (term, reading, word_type) trong dữ liệu
  --overwrite             Ghi đè meaning_vi và reading nếu từ đã tồn tại trong DB
  --help, -h              Hiển thị hướng dẫn này

Ví dụ dạng lệnh chính:
  # Đọc 1 sheet mặc định:
  npx tsx scripts/import-vocab.ts --file scripts/vocab-mappings/__samples__/sample-valid.xlsx --mapping scripts/vocab-mappings/en.json --dry-run

  # Đọc toàn bộ các sheet:
  npx tsx scripts/import-vocab.ts --file scripts/vocab-mappings/__samples__/sample-multisheet.xlsx --mapping scripts/vocab-mappings/en.json --all-sheets --dry-run
`);
    process.exit(0);
  }

  let filePath = '';
  let mappingPath = '';
  let language = '';
  let dryRun = true; // Mặc định là dry-run an toàn
  let mergeDuplicates = false;
  let overwrite = false;
  let allSheets = false;
  let sheet = '';
  let noSheetName = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--file') {
      filePath = args[++i];
    } else if (arg === '--mapping') {
      mappingPath = args[++i];
    } else if (arg === '--lang') {
      language = args[++i];
    } else if (arg === '--all-sheets') {
      allSheets = true;
    } else if (arg === '--sheet') {
      sheet = args[++i];
    } else if (arg === '--no-sheet-name') {
      noSheetName = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--write') {
      dryRun = false;
    } else if (arg === '--merge-duplicates') {
      mergeDuplicates = true;
    } else if (arg === '--overwrite') {
      overwrite = true;
    } else if (!arg.startsWith('-') && !filePath) {
      filePath = arg;
    }
  }

  if (!filePath) {
    console.error('\x1b[31mLỗi: Vui lòng cung cấp đường dẫn file qua tham số --file <đường dẫn>.\x1b[0m');
    process.exit(1);
  }

  runImport({
    filePath,
    mappingPath,
    language,
    dryRun,
    mergeDuplicates,
    overwrite,
    allSheets,
    sheet,
    noSheetName,
  }).catch((err) => {
    console.error(`\n\x1b[31m[LỖI]: ${err.message}\x1b[0m`);
    process.exit(1);
  });
}
