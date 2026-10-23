// ============================================================
// lib/vocab-parser.ts — Parse 4-column Excel/CSV vocabulary files
// Format: [STT, Pinyin/Pronunciation, Target Language Word, Vietnamese Meaning]
// ============================================================

import type { VocabEntry } from './types';

export interface ParseResult {
  success: boolean;
  data: VocabEntry[];
  errors: string[];
  rowCount: number;
}

/**
 * Checks if a header string corresponds to "Loại từ" or "Type" (case-insensitive, unaccented).
 */
function isWordTypeHeader(header?: string): boolean {
  if (!header) return false;
  const normalized = header
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return normalized === 'loai tu' || normalized === 'type';
}

/**
 * Validates and maps a raw row to a VocabEntry.
 * Only extracts column 5 as word_type if hasWordTypeHeader is true.
 */
function mapRowToEntry(
  row: string[],
  rowIndex: number,
  hasWordTypeHeader = false
): { entry?: VocabEntry; error?: string } {
  // Filter out completely empty rows
  if (row.every((cell) => !cell || cell.toString().trim() === '')) {
    return {};
  }

  if (row.length < 4) {
    return {
      error: `Row ${rowIndex + 1}: Expected 4 columns, found ${row.length}. Check your file format.`,
    };
  }

  const [indexCol, pronunciation, word, meaning, col5] = row.map((c) => c?.toString().trim() || '');

  // Index column can be a number or auto-generated
  const index = parseInt(indexCol, 10) || rowIndex;

  if (!word) {
    return { error: `Row ${rowIndex + 1}: Target language word (column 3) is empty.` };
  }
  if (!meaning) {
    return { error: `Row ${rowIndex + 1}: Vietnamese meaning (column 4) is empty.` };
  }

  const word_type = hasWordTypeHeader && col5 ? col5 : undefined;

  return {
    entry: {
      index,
      pronunciation: pronunciation || word, // Fall back to word if pronunciation missing
      word,
      meaning,
      ...(word_type ? { word_type } : {}),
    },
  };
}

/**
 * Parses a CSV string into VocabEntry array.
 * Uses PapaParse-style logic for robust CSV handling.
 */
export function parseCSVText(csvText: string): ParseResult {
  // Dynamic import of papaparse happens client-side; we do manual parse here for server-safety
  const lines = csvText.split(/\r?\n/);
  const errors: string[] = [];
  const data: VocabEntry[] = [];

  // Detect and skip header row
  const firstLine = lines[0]?.toLowerCase() || '';
  const isHeader =
    firstLine.includes('stt') ||
    firstLine.includes('index') ||
    firstLine.includes('pinyin') ||
    firstLine.includes('pronunciation') ||
    firstLine.includes('meaning');

  let hasWordTypeHeader = false;
  if (isHeader && lines.length > 0) {
    const headerCols = parseCSVLine(lines[0]);
    hasWordTypeHeader = isWordTypeHeader(headerCols[4]);
  }

  const startRow = isHeader ? 1 : 0;

  for (let i = startRow; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple CSV split (handles quoted fields)
    const cols = parseCSVLine(line);
    const { entry, error } = mapRowToEntry(cols, i, hasWordTypeHeader);
    if (error) errors.push(error);
    if (entry) data.push(entry);
  }

  return { success: errors.length === 0, data, errors, rowCount: data.length };
}

/** Simple RFC 4180 CSV line parser */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/**
 * Parses an XLSX file ArrayBuffer into VocabEntry array.
 * Uses the 'xlsx' library (SheetJS) for full Excel support.
 */
export async function parseXLSXBuffer(buffer: ArrayBuffer): Promise<ParseResult> {
  // Dynamic import to avoid SSR issues
  const XLSX = await import('xlsx');
  
  const errors: string[] = [];
  const data: VocabEntry[] = [];

  try {
    const workbook = XLSX.read(buffer, { type: 'array' });
    
    // Use the first sheet
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return { success: false, data: [], errors: ['Excel file has no sheets.'], rowCount: 0 };
    }
    
    const sheet = workbook.Sheets[sheetName];
    // Convert to array of arrays (raw: true preserves all data types)
    const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as string[][];

    // Detect header row
    const firstRow = rows[0]?.map((c) => c?.toString().trim()) || [];
    const firstRowLower = firstRow.map((c) => c.toLowerCase());
    const isHeader =
      firstRowLower.some((c) => ['stt', 'index', 'pinyin', 'pronunciation', 'meaning', 'word'].includes(c));

    const hasWordTypeHeader = isHeader && isWordTypeHeader(firstRow[4]);
    const startRow = isHeader ? 1 : 0;

    for (let i = startRow; i < rows.length; i++) {
      const { entry, error } = mapRowToEntry(rows[i].map(String), i, hasWordTypeHeader);
      if (error) errors.push(error);
      if (entry) data.push(entry);
    }
  } catch (e) {
    return {
      success: false,
      data: [],
      errors: [`Failed to parse Excel file: ${e instanceof Error ? e.message : 'Unknown error'}`],
      rowCount: 0,
    };
  }

  return { success: errors.length === 0, data, errors, rowCount: data.length };
}

/**
 * Generates a sample CSV string that users can download as a template.
 */
export function generateSampleCSV(): string {
  const header = 'STT,Pinyin/Pronunciation,Target Word,Vietnamese Meaning';
  const rows = [
    '1,nǐ hǎo,你好,Xin chào',
    '2,xiè xiè,谢谢,Cảm ơn',
    '3,zài jiàn,再见,Tạm biệt',
    '4,duì bu qǐ,对不起,Xin lỗi',
    '5,wǒ ài nǐ,我爱你,Tôi yêu bạn',
    '6,arigatou,ありがとう,Cảm ơn (tiếng Nhật)',
    '7,konnichiwa,こんにちは,Xin chào (tiếng Nhật)',
    '8,thank you,thank you,Cảm ơn (tiếng Anh)',
  ];
  return [header, ...rows].join('\n');
}
