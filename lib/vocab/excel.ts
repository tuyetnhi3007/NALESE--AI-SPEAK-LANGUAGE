// lib/vocab/excel.ts
// Tiện ích xuất file Excel từ vựng đã thuộc bằng thư viện xlsx

import * as XLSX from 'xlsx';
import type { SupportedLanguage } from '@/lib/types';
import type { LearnedWordItem } from './types';

function getSheetTitle(lang: SupportedLanguage): string {
  switch (lang) {
    case 'zh':
      return 'Tiếng Trung';
    case 'ja':
      return 'Tiếng Nhật';
    case 'en':
    default:
      return 'Tiếng Anh';
  }
}

/**
 * Xuất danh sách từ đã thuộc ra file Excel (.xlsx)
 * - Định dạng tương thích hoàn toàn với File của tôi ở tab Từ Vựng:
 *   STT | Phiên âm (Pinyin/Romaji) | Từ đích | Nghĩa tiếng Việt
 * - Tên sheet: Tiếng Trung / Tiếng Nhật / Tiếng Anh
 * - Tất cả ô được đặt kiểu string (type 's') để tránh lỗi formula injection
 * - Sắp xếp theo ngày học tăng dần (cũ nhất -> mới nhất)
 */
export function exportLearnedWordsToExcel(
  items: LearnedWordItem[],
  lang: SupportedLanguage
): void {
  if (!items || items.length === 0) {
    throw new Error('Không có từ vựng nào để xuất file');
  }

  // Sắp xếp theo ngày học tăng dần (cũ nhất -> mới nhất)
  const sortedItems = [...items].sort((a, b) => {
    return new Date(a.learned_at).getTime() - new Date(b.learned_at).getTime();
  });

  // Xây dựng mảng dữ liệu (AOA - Array of Arrays)
  const headers = ['STT', 'Phiên âm (Pinyin/Romaji)', 'Từ đích', 'Nghĩa tiếng Việt'];
  const aoaData: string[][] = [headers];

  sortedItems.forEach((item, index) => {
    const info = item.vocab_items;
    const stt = String(index + 1);
    const reading = String(info?.reading || '');
    const term = String(info?.term || '');
    const meaning = String(info?.meaning_vi || '');

    aoaData.push([stt, reading, term, meaning]);
  });

  // Tạo worksheet
  const ws = XLSX.utils.aoa_to_sheet(aoaData);

  // Đặt kiểu chuỗi (type: 's') cho TOÀN BỘ ô để chống formula injection
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:D1');
  for (let R = range.s.r; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
      if (ws[cellRef]) {
        ws[cellRef].t = 's';
      }
    }
  }

  // Thiết lập độ rộng cột
  ws['!cols'] = [
    { wch: 8 },  // STT
    { wch: 26 }, // Phiên âm
    { wch: 24 }, // Từ đích
    { wch: 40 }, // Nghĩa tiếng Việt
  ];

  // Tạo workbook
  const wb = XLSX.utils.book_new();
  const sheetName = getSheetTitle(lang);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  // Xuất binary buffer
  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  // Tên file: tu-vung-da-thuoc-<lang>-<yyyy-mm-dd>.xlsx
  const today = new Date().toISOString().slice(0, 10);
  const fileName = `tu-vung-da-thuoc-${lang}-${today}.xlsx`;

  // Tải file về máy khách
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
