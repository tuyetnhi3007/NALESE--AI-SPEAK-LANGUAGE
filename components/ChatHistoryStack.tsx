'use client';
// ============================================================
// components/ChatHistoryStack.tsx — Khung lịch sử hội thoại tối giản
// Bong bóng người dùng nền #F5E6D8, bong bóng AI nền trắng viền #EBDDCF
// Điểm % là chữ nhỏ đổi màu không nền viên thuốc
// Duy nhất vùng danh sách tin nhắn cuộn được (overscroll-behavior: contain)
// ============================================================

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Volume2, RotateCcw, ChevronDown, MessageSquare } from 'lucide-react';
import type { ConversationMessage } from '@/lib/types';

function cleanOriginalString(raw: string): string {
  if (!raw) return '';
  const str = raw.trim();

  if (str.startsWith('{') && str.endsWith('}')) {
    try {
      const parsed = JSON.parse(str);
      if (parsed && parsed.original) return String(parsed.original).trim();
    } catch {}
  }

  const match = str.match(/"original"\s*:\s*"((?:[^"\\]|\\.)*)"/i) || str.match(/"original"\s*:\s*"([^"]*)/i);
  if (match && match[1]) {
    return match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
  }

  let cleaned = str
    .replace(/^\s*\{\s*"original"\s*:\s*"?/i, '')
    .replace(/^\s*\{?\s*/, '')
    .replace(/\s*\}?\s*$/, '')
    .replace(/^"(?:original|response|text)"\s*:\s*"?/i, '')
    .replace(/"?\s*$/, '')
    .replace(/\s*\((?:Gemini|Azure|OpenAI)\)\s*$/i, '')
    .trim();

  return cleaned;
}

// % độ chính xác: chỉ là chữ nhỏ đổi màu, bỏ nền viên thuốc
function getScoreColor(score: number): string {
  if (score >= 80) return '#16A34A'; // Xanh lá >=80%
  if (score >= 60) return '#D97706'; // Cam 60-79%
  return '#DC2626'; // Đỏ <60%
}

interface ChatHistoryStackProps {
  conversation: ConversationMessage[];
  onClearConversation: () => void;
  onReplayAudio: (msg: ConversationMessage) => void;
}

export default function ChatHistoryStack({
  conversation,
  onClearConversation,
  onReplayAudio,
}: ChatHistoryStackProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showAllHistory, setShowAllHistory] = useState(false);

  // Nếu lịch sử > 50 tin, chỉ render 30 tin gần nhất trừ khi người dùng bấm "Xem tin cũ hơn"
  const hasManyMessages = conversation.length > 50;
  const displayedMessages = hasManyMessages && !showAllHistory
    ? conversation.slice(-30)
    : conversation;

  // Tự động cuộn xuống đáy khi có tin nhắn mới (chỉ khi người dùng đang ở gần cuối)
  useEffect(() => {
    if (isAtBottom) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [conversation, isAtBottom]);

  // Lắng nghe sự kiện scroll (dùng passive listener)
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 60;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    setIsAtBottom(atBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
    setIsAtBottom(true);
  }, []);

  return (
    <div className="chat-history-stack">
      {/* Thanh tiêu đề cố định (flex: 0 0 auto) */}
      <div className="chat-history-header">
        <div className="flex items-center gap-1.5">
          <MessageSquare size={13} className="text-[var(--muted)]" />
          <span className="text-[13px] text-[var(--muted)] font-normal">Lịch sử hội thoại</span>
          {conversation.length > 0 && (
            <span className="text-[12px] text-[var(--muted)] opacity-70">({conversation.length})</span>
          )}
        </div>
        {conversation.length > 0 && (
          <button
            type="button"
            onClick={onClearConversation}
            className="flex items-center gap-1 text-[12px] text-[var(--muted)] hover:text-[var(--text)] transition-colors p-1"
          >
            <RotateCcw size={11} /> Xóa
          </button>
        )}
      </div>

      {/* Vùng danh sách tin nhắn: PHẦN TỬ DUY NHẤT CÓ THANH CUỘN */}
      <div
        ref={scrollRef}
        className="chat-stack-container"
        onScroll={handleScroll}
      >
        {/* Nút xem tin cũ hơn nếu lịch sử > 50 tin */}
        {hasManyMessages && !showAllHistory && (
          <div className="text-center py-2">
            <button
              type="button"
              onClick={() => setShowAllHistory(true)}
              className="text-[12px] text-[var(--muted)] hover:text-[var(--accent)] underline"
            >
              Xem {conversation.length - 30} tin cũ hơn...
            </button>
          </div>
        )}

        {displayedMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[180px] text-center p-6">
            <p className="text-[13px] text-[var(--muted)]">
              Nhấn nút micro và bắt đầu nói.<br />
              AI sẽ trả lời sau 3 giây im lặng.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {displayedMessages.map((msg) => {
              const originalText = cleanOriginalString(msg.original || msg.text || '');

              if (msg.role === 'user') {
                const userPinyin = msg.pinyin || msg.romanization || '';
                const score = typeof msg.pronunciationScore === 'number'
                  ? msg.pronunciationScore
                  : (msg.pronunciationResult?.overallScore ?? null);

                return (
                  <div key={msg.id} className="chat-msg-row user-row">
                    <div className="chat-bubble-user">
                      {/* 1. Chữ gốc 16px màu var(--text) */}
                      <p className="text-[16px] text-[var(--text)] leading-snug font-medium line-clamp-3">
                        {originalText}
                      </p>

                      {/* 2. Phiên âm 13px màu var(--muted) */}
                      {userPinyin && (
                        <p className="text-[13px] text-[var(--muted)] leading-snug font-mono mt-1 line-clamp-3">
                          {userPinyin}
                        </p>
                      )}

                      {/* 3. Bản dịch tiếng Việt 13px màu var(--muted), không in nghiêng */}
                      {msg.translation && (
                        <p className="text-[13px] text-[var(--muted)] leading-snug not-italic mt-1 line-clamp-3">
                          {msg.translation}
                        </p>
                      )}

                      {/* Footer tin nhắn: giờ + % độ chính xác (chỉ chữ đổi màu, không nền) */}
                      <div className="flex items-center justify-between gap-2 mt-2 pt-1 border-t border-[var(--border)]/40 text-[12px]">
                        <span className="text-[var(--muted)]">
                          {new Date(msg.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {typeof score === 'number' && (
                          <span
                            className="font-medium text-[12px]"
                            style={{ color: getScoreColor(score) }}
                            title={`Điểm phát âm: ${Math.round(score)}%`}
                          >
                            Độ chính xác: {Math.round(score)}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }

              // Assistant message
              const assistantPinyin = msg.pinyin || msg.romanization || '';
              return (
                <div key={msg.id} className="chat-msg-row assistant-row">
                  <div className="chat-bubble-assistant">
                    {/* 1. Chữ gốc 16px màu var(--text) */}
                    <p className="text-[16px] text-[var(--text)] leading-snug font-medium line-clamp-3">
                      {originalText}
                    </p>

                    {/* 2. Phiên âm 13px màu var(--muted) */}
                    {assistantPinyin && (
                      <p className="text-[13px] text-[var(--muted)] leading-snug font-mono mt-1 line-clamp-3">
                        {assistantPinyin}
                      </p>
                    )}

                    {/* 3. Bản dịch tiếng Việt 13px màu var(--muted), không in nghiêng */}
                    {msg.translation && (
                      <p className="text-[13px] text-[var(--muted)] leading-snug not-italic mt-1 line-clamp-3">
                        {msg.translation}
                      </p>
                    )}

                    {/* Footer: giờ + nút phát lại 12px màu var(--muted) */}
                    <div className="flex items-center gap-3 mt-2 pt-1 border-t border-[var(--border)]/40 text-[12px] text-[var(--muted)]">
                      <span>
                        {new Date(msg.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <button
                        type="button"
                        onClick={() => onReplayAudio(msg)}
                        className="flex items-center gap-1 hover:text-[var(--accent)] transition-colors ml-auto text-[12px]"
                      >
                        <Volume2 size={12} /> Phát lại
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* Nút "Tin nhắn mới" absolute ở đáy vùng tin nhắn */}
      {!isAtBottom && conversation.length > 0 && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="chat-scroll-bottom"
        >
          <ChevronDown size={14} />
          <span>Tin nhắn mới</span>
        </button>
      )}
    </div>
  );
}
