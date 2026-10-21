'use client';
// ============================================================
// components/ResumeExerciseBar.tsx — Thanh "Tiếp tục làm bài"
// Dùng chung cho tab Bài Tập Chủ Đề (và có thể tái sử dụng cho tab Từ Vựng)
// ============================================================

import React from 'react';
import { PlayCircle, Trash2 } from 'lucide-react';

interface ResumeExerciseBarProps {
  title?: string;
  subtitle: string;
  onResume: () => void;
  onDiscard: () => void;
  resumeButtonRef?: React.RefObject<HTMLButtonElement | null>;
}

export default function ResumeExerciseBar({
  title = 'Bài tập đang làm dở',
  subtitle,
  onResume,
  onDiscard,
  resumeButtonRef,
}: ResumeExerciseBarProps) {
  return (
    <div
      onClick={onResume}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onResume();
        }
      }}
      className="w-full flex flex-col min-[560px]:flex-row items-stretch min-[560px]:items-center justify-between gap-3 cursor-pointer transition-colors duration-150"
      style={{
        backgroundColor: '#FFF7EE',
        border: '1.5px solid var(--accent)',
        borderRadius: '12px',
        padding: '14px 20px',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--bubble-user)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = '#FFF7EE';
      }}
    >
      {/* Bên trái: Icon PlayCircle + 2 dòng chữ */}
      <div className="flex items-center gap-3 min-w-0">
        <PlayCircle
          size={24}
          style={{ color: 'var(--accent)' }}
          className="flex-shrink-0"
        />
        <div className="flex flex-col min-w-0">
          <span
            className="truncate leading-tight"
            style={{
              fontSize: '15px',
              fontWeight: 600,
              color: 'var(--text)',
            }}
          >
            {title}
          </span>
          <span
            className="truncate mt-0.5 leading-tight"
            style={{
              fontSize: '13px',
              color: 'var(--muted)',
            }}
          >
            {subtitle}
          </span>
        </div>
      </div>

      {/* Bên phải: Nút Bỏ bài + Nút Tiếp tục */}
      <div
        className="flex items-center gap-3 flex-shrink-0 w-full min-[560px]:w-auto justify-end"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onDiscard}
          className="px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer rounded-md flex items-center gap-1"
          style={{ color: 'var(--muted)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--danger)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--muted)')}
        >
          <Trash2 size={13} />
          <span>Bỏ bài</span>
        </button>

        <button
          ref={resumeButtonRef as any}
          type="button"
          onClick={onResume}
          className="flex-1 min-[560px]:flex-initial flex items-center justify-center font-semibold text-white rounded-lg transition-colors cursor-pointer"
          style={{
            height: '40px',
            padding: '0 20px',
            backgroundColor: 'var(--accent)',
            border: 'none',
            fontSize: '14px',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent)')}
        >
          Tiếp tục
        </button>
      </div>
    </div>
  );
}
