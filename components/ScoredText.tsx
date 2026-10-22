'use client';
// ============================================================
// components/ScoredText.tsx — Component hiển thị văn bản có tô đỏ từ phát âm sai
// - Từ sai: màu var(--danger), đậm 600, gạch chân dạng sóng (underline wavy)
// - Từ đúng: giữ màu var(--text)
// - Hover hoặc chạm vào từ sai: hiện tooltip nhỏ (nền trắng, viền var(--border), chữ 13px) với nội dung issue
// - Không có words: hiển thị chữ bình thường, không báo lỗi
// ============================================================

import React, { useState } from 'react';
import type { PronunciationWord } from '@/lib/types';

interface ScoredTextProps {
  text: string;
  words?: PronunciationWord[];
  className?: string;
}

interface ScoredWordItemProps {
  word: PronunciationWord;
  displayText?: string;
}

function ScoredWordItem({ word, displayText }: ScoredWordItemProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const textToShow = displayText || word.text;

  if (word.correct || !word.issue) {
    return <span className="text-[var(--text)]">{textToShow}</span>;
  }

  return (
    <span
      className="relative inline-block cursor-pointer select-none group"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onClick={(e) => {
        e.stopPropagation();
        setShowTooltip((prev) => !prev);
      }}
      tabIndex={0}
      onFocus={() => setShowTooltip(true)}
      onBlur={() => setShowTooltip(false)}
    >
      <span
        className="font-semibold text-[var(--danger)]"
        style={{
          textDecoration: 'underline wavy',
          textDecorationColor: 'var(--danger)',
          textUnderlineOffset: '4px',
        }}
      >
        {textToShow}
      </span>

      {/* Tooltip nhỏ khi hover hoặc chạm */}
      {showTooltip && (
        <span
          className="absolute bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2 z-30 px-2.5 py-1 rounded-lg bg-white border border-[var(--border)] shadow-md text-[13px] text-[var(--text)] font-normal whitespace-nowrap pointer-events-none animate-in fade-in zoom-in-95 duration-150"
          style={{ minWidth: 'max-content' }}
        >
          {word.issue}
          {/* Mũi tên nhỏ bên dưới tooltip */}
          <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-[1px] border-4 border-transparent border-t-white" />
        </span>
      )}
    </span>
  );
}

function isWordBoundaryChar(char: string | undefined): boolean {
  if (!char) return true;
  return !/[\p{L}\p{N}_]/u.test(char);
}

function findNextWordIndex(text: string, word: string, fromIndex: number): number {
  const hasSpace = text.includes(' ');
  const lowerText = text.toLowerCase();
  const lowerWord = word.toLowerCase();

  if (!hasSpace) {
    // Ngôn ngữ tượng hình viết liền (tiếng Trung, tiếng Nhật) — khớp theo vị trí tuần tự từ fromIndex
    return lowerText.indexOf(lowerWord, fromIndex);
  }

  // Ngôn ngữ có khoảng trắng (tiếng Anh) — kiểm tra ranh giới từ để tránh khớp nhầm substring
  let pos = fromIndex;
  while (pos < text.length) {
    const idx = lowerText.indexOf(lowerWord, pos);
    if (idx === -1) return -1;
    const before = idx === 0 ? undefined : text[idx - 1];
    const after = idx + word.length >= text.length ? undefined : text[idx + word.length];
    if (isWordBoundaryChar(before) && isWordBoundaryChar(after)) {
      return idx;
    }
    pos = idx + 1;
  }
  return -1;
}

export default function ScoredText({ text, words, className = '' }: ScoredTextProps) {
  // Khi không có words hoặc words rỗng: hiển thị chữ bình thường, không báo lỗi
  if (!words || words.length === 0) {
    return <span className={className}>{text}</span>;
  }

  // Khớp từng từ trong words theo vị trí tuần tự (sequential index) từ trái sang phải
  const elements: React.ReactNode[] = [];
  let cursor = 0;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let idx = -1;

    // 1. Nếu từ có sẵn offset/index chính xác và hợp lệ
    if (
      typeof w.offset === 'number' &&
      w.offset >= cursor &&
      text.slice(w.offset, w.offset + w.text.length).toLowerCase() === w.text.toLowerCase()
    ) {
      idx = w.offset;
    } else {
      // 2. Khớp tuần tự từ vị trí cursor hiện tại (xử lý chính xác từ lặp lại)
      idx = findNextWordIndex(text, w.text, cursor);
    }

    if (idx !== -1) {
      if (idx > cursor) {
        // Ký tự đệm ở giữa hoặc từ không bị chấm sai (hiển thị chữ thường)
        elements.push(
          <span key={`interstitial-${cursor}-${idx}`} className="text-[var(--text)]">
            {text.slice(cursor, idx)}
          </span>
        );
      }
      const matchedSlice = text.slice(idx, idx + w.text.length);
      elements.push(<ScoredWordItem key={`word-${i}-${idx}`} word={w} displayText={matchedSlice} />);
      cursor = idx + w.text.length;
    }
    // Khi idx === -1 (từ không có trong câu / không khớp đúng ranh giới):
    // Bỏ qua từ này để từ trong câu hiển thị như từ đúng (không tô đỏ), không làm lệch các từ phía sau.
  }

  if (cursor < text.length) {
    elements.push(
      <span key={`tail-${cursor}`} className="text-[var(--text)]">
        {text.slice(cursor)}
      </span>
    );
  }

  return <span className={className}>{elements}</span>;
}
