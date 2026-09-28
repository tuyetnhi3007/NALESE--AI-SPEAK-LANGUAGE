'use client';
// ============================================================
// components/ChatHistoryStack.tsx — Khung lịch sử hội thoại
//
// Thay thế panel "Chuyển ngôn ngữ" cũ.
// Hiệu ứng stack/fade: tin nhắn cũ thu gọn ra phía sau,
// chỉ tin nhắn mới nhất hiển thị rõ. Cuộn lên để xem lại.
//
// Giữ nguyên toàn bộ chức năng hiển thị hiện có:
// - Badge điểm phát âm %
// - Tô đỏ âm phát âm sai
// - Pinyin/Romaji bên dưới chữ
// - Bản dịch tiếng Việt
// - Nút phát lại
// ============================================================

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Volume2, Sparkles, RotateCcw, ChevronDown } from 'lucide-react';
import type { ConversationMessage } from '@/lib/types';

// Re-export cleanOriginalString from VoiceTutor for use here
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

function getScoreBadgeStyle(score: number): string {
  if (score >= 90) return 'score-badge-excellent';
  if (score >= 70) return 'score-badge-good';
  return 'score-badge-poor';
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

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (isAtBottom) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [conversation, isAtBottom]);

  // Track scroll position
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
    <div className="chat-history-stack glass-card">
      {/* Header */}
      <div className="chat-history-header">
        <h3 className="chat-history-title">
          <Sparkles size={14} className="text-purple-500" />
          <span>Lịch sử hội thoại</span>
          {conversation.length > 0 && (
            <span className="chat-history-count">{conversation.length}</span>
          )}
        </h3>
        {conversation.length > 0 && (
          <button onClick={onClearConversation}
            className="chat-history-clear">
            <RotateCcw size={12} /> Xóa
          </button>
        )}
      </div>

      {/* Messages with stack/fade effect */}
      <div
        ref={scrollRef}
        className="chat-stack-container"
        onScroll={handleScroll}
      >
        {conversation.length === 0 ? (
          <div className="chat-stack-empty">
            <div className="text-3xl mb-2">💬</div>
            <p className="text-indigo-900/35 text-sm max-w-xs">
              Nhấn nút micro và bắt đầu nói.<br />
              AI sẽ trả lời sau 3 giây im lặng.
            </p>
          </div>
        ) : (
          <div className="chat-stack-messages">
            {conversation.map((msg, idx) => {
              const originalText = cleanOriginalString(msg.original || msg.text || '');
              const isLast = idx === conversation.length - 1;

              if (msg.role === 'user') {
                const userPinyin = msg.pinyin || msg.romanization || '';
                const score = typeof msg.pronunciationScore === 'number'
                  ? msg.pronunciationScore
                  : (msg.pronunciationResult?.overallScore ?? null);

                return (
                  <div key={msg.id} className={`chat-msg chat-msg-user ${isLast ? 'chat-msg-latest' : ''}`}>
                    {/* Score badge bên trái bubble USER */}
                    {typeof score === 'number' && (
                      <div className={`chat-score-badge ${getScoreBadgeStyle(score)}`}
                        title={`Điểm phát âm: ${Math.round(score)}%`}>
                        {Math.round(score)}%
                      </div>
                    )}

                    <div className="chat-bubble chat-bubble-user">
                      <div className="flex items-start gap-2">
                        <span className="text-base mt-0.5 flex-shrink-0">👤</span>
                        <div className="flex-1 min-w-0">
                          {/* 1. Câu tiếng Trung */}
                          <p className="text-sm leading-relaxed font-semibold">{originalText}</p>

                          {/* 2. Pinyin / Romaji với tô đỏ âm sai */}
                          {msg.pronunciationResult?.syllables && msg.pronunciationResult.syllables.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 mt-1.5">
                              {msg.pronunciationResult.syllables.map((s, si) => {
                                const isError =
                                  s.errorType !== 'None' ||
                                  (typeof s.accuracyScore === 'number' && s.accuracyScore < 70);
                                return (
                                  <span
                                    key={si}
                                    className={`text-xs font-mono tracking-wide transition-colors ${
                                      isError
                                        ? 'chat-syllable-error'
                                        : 'text-white/80'
                                    }`}
                                    title={
                                      s.accuracyScore !== null
                                        ? `${s.character || ''} (${s.pinyin}): ${s.accuracyScore} điểm${
                                            s.errorType !== 'None' ? ` - ${s.errorType}` : ''
                                          }`
                                        : `${s.character || ''} (${s.pinyin})`
                                    }
                                  >
                                    {s.pinyin}
                                  </span>
                                );
                              })}
                            </div>
                          ) : userPinyin ? (
                            <p className="text-xs text-white/80 leading-relaxed mt-1 font-mono">
                              {userPinyin}
                            </p>
                          ) : null}

                          {/* 3. Bản dịch tiếng Việt */}
                          {msg.translation && (
                            <p className="text-xs text-white/90 leading-relaxed mt-1 italic">
                              {msg.translation}
                            </p>
                          )}

                          <div className="flex items-center gap-2 mt-2">
                            <span className="text-xs text-white/50">
                              {new Date(msg.timestamp).toLocaleTimeString('vi-VN')}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }

              // Assistant message
              const assistantPinyin = msg.pinyin || msg.romanization || '';
              return (
                <div key={msg.id} className={`chat-msg chat-msg-assistant ${isLast ? 'chat-msg-latest' : ''}`}>
                  <div className="chat-bubble chat-bubble-assistant">
                    <div className="flex items-start gap-2">
                      <span className="text-base mt-0.5 flex-shrink-0">🤖</span>
                      <div className="flex-1 min-w-0">
                        {/* 1. Câu tiếng Trung */}
                        <p className="text-sm text-indigo-900/90 leading-relaxed font-semibold">
                          {originalText}
                        </p>
                        {/* 2. Pinyin ngay bên dưới */}
                        {assistantPinyin && (
                          <p className="text-sm text-indigo-900/60 leading-relaxed mt-1 font-mono">
                            {assistantPinyin}
                          </p>
                        )}
                        {/* 3. Bản dịch tiếng Việt bên dưới nữa */}
                        {msg.translation && (
                          <p className="text-sm text-indigo-900/75 leading-relaxed mt-1 italic">
                            {msg.translation}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs text-indigo-900/30">
                            {new Date(msg.timestamp).toLocaleTimeString('vi-VN')}
                          </span>
                          <button
                            onClick={() => onReplayAudio(msg)}
                            className="chat-replay-btn"
                          >
                            <Volume2 size={12} /> Phát lại
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* Scroll to bottom indicator */}
      {!isAtBottom && conversation.length > 0 && (
        <button
          onClick={scrollToBottom}
          className="chat-scroll-bottom"
        >
          <ChevronDown size={16} />
          <span>Tin nhắn mới</span>
        </button>
      )}
    </div>
  );
}
