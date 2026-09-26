'use client';
// ============================================================
// components/TopicRoleplay.tsx — Language & Topic selector with
// scenario briefings and one-click voice roleplay launcher
// ============================================================

import React, { useState } from 'react';
import { Play, ChevronRight, Globe, Sparkles, BookOpen } from 'lucide-react';
import { TOPICS, LANGUAGES } from '@/lib/prompts';
import type { SupportedLanguage } from '@/lib/types';

interface TopicRoleplayProps {
  selectedLanguage: SupportedLanguage;
  onLanguageChange: (lang: SupportedLanguage) => void;
  onStartRoleplay: (topic: string) => void;
  activeTopic?: string;
}

// Suggested phrases per language and topic
const PHRASES: Record<SupportedLanguage, Record<string, { phrase: string; pronunciation: string; meaning: string }[]>> = {
  en: {
    travel: [
      { phrase: "Where is the nearest subway station?", pronunciation: "Where is the nearest subway station?", meaning: "Ga tàu điện ngầm gần nhất ở đâu?" },
      { phrase: "Could you recommend a good restaurant?", pronunciation: "Could you recommend a good restaurant?", meaning: "Bạn có thể giới thiệu nhà hàng ngon không?" },
      { phrase: "How much does this cost?", pronunciation: "How much does this cost?", meaning: "Cái này giá bao nhiêu?" },
    ],
    work: [
      { phrase: "Could you clarify what you mean by that?", pronunciation: "Could you clarify what you mean by that?", meaning: "Bạn có thể làm rõ ý của bạn không?" },
      { phrase: "Let's schedule a follow-up meeting.", pronunciation: "Let's schedule a follow-up meeting.", meaning: "Hãy sắp xếp một cuộc họp tiếp theo." },
    ],
    food: [
      { phrase: "I'd like to order, please.", pronunciation: "I'd like to order, please.", meaning: "Tôi muốn gọi món, xin vui lòng." },
      { phrase: "Do you have any vegetarian options?", pronunciation: "Do you have any vegetarian options?", meaning: "Bạn có món chay không?" },
    ],
    daily_life: [
      { phrase: "What time does the store close?", pronunciation: "What time does the store close?", meaning: "Cửa hàng đóng cửa lúc mấy giờ?" },
      { phrase: "Could you say that again, please?", pronunciation: "Could you say that again, please?", meaning: "Bạn có thể nói lại không?" },
    ],
    custom: [],
    health: [],
    technology: [],
    education: [],
  },
  zh: {
    travel: [
      { phrase: "最近的地铁站在哪里？", pronunciation: "Zuì jìn de dìtiě zhàn zài nǎlǐ?", meaning: "Ga tàu điện ngầm gần nhất ở đâu?" },
      { phrase: "请问，你们有英文菜单吗？", pronunciation: "Qǐngwèn, nǐmen yǒu yīngwén càidān ma?", meaning: "Xin hỏi, bạn có thực đơn tiếng Anh không?" },
      { phrase: "我想买两张票。", pronunciation: "Wǒ xiǎng mǎi liǎng zhāng piào.", meaning: "Tôi muốn mua hai vé." },
    ],
    work: [
      { phrase: "我们下周开个会吧。", pronunciation: "Wǒmen xià zhōu kāi gè huì ba.", meaning: "Tuần tới chúng ta họp nhé." },
      { phrase: "请把报告发给我。", pronunciation: "Qǐng bǎ bàogào fā gěi wǒ.", meaning: "Vui lòng gửi báo cáo cho tôi." },
    ],
    food: [
      { phrase: "我要点菜。", pronunciation: "Wǒ yào diǎn cài.", meaning: "Tôi muốn gọi món." },
      { phrase: "这个多少钱？", pronunciation: "Zhège duōshao qián?", meaning: "Cái này bao nhiêu tiền?" },
    ],
    daily_life: [
      { phrase: "你好！最近怎么样？", pronunciation: "Nǐ hǎo! Zuìjìn zěnmeyàng?", meaning: "Xin chào! Dạo này bạn thế nào?" },
      { phrase: "我听不懂，请再说一遍。", pronunciation: "Wǒ tīng bù dǒng, qǐng zài shuō yī biàn.", meaning: "Tôi không hiểu, vui lòng nói lại." },
    ],
    custom: [],
    health: [],
    technology: [],
    education: [],
  },
  ja: {
    travel: [
      { phrase: "一番近い駅はどこですか？", pronunciation: "Ichiban chikai eki wa doko desu ka?", meaning: "Ga gần nhất ở đâu?" },
      { phrase: "これはいくらですか？", pronunciation: "Kore wa ikura desu ka?", meaning: "Cái này giá bao nhiêu?" },
      { phrase: "写真を撮ってもいいですか？", pronunciation: "Shashin o totte mo ii desu ka?", meaning: "Tôi có thể chụp ảnh không?" },
    ],
    work: [
      { phrase: "来週、打ち合わせをしましょう。", pronunciation: "Raishuu, uchiawase o shimashou.", meaning: "Tuần tới, hãy họp nhau nhé." },
      { phrase: "報告書を送っていただけますか？", pronunciation: "Houkokusho o okutte itadakemasu ka?", meaning: "Bạn có thể gửi báo cáo cho tôi không?" },
    ],
    food: [
      { phrase: "注文してもいいですか？", pronunciation: "Chuumon shite mo ii desu ka?", meaning: "Tôi có thể gọi món không?" },
      { phrase: "これは何ですか？", pronunciation: "Kore wa nan desu ka?", meaning: "Đây là gì?" },
    ],
    daily_life: [
      { phrase: "こんにちは！お元気ですか？", pronunciation: "Konnichiwa! Ogenki desu ka?", meaning: "Xin chào! Bạn có khỏe không?" },
      { phrase: "もう一度言っていただけますか？", pronunciation: "Mou ichido itte itadakemasu ka?", meaning: "Bạn có thể nói lại một lần nữa không?" },
    ],
    custom: [],
    health: [],
    technology: [],
    education: [],
  },
};

export default function TopicRoleplay({
  selectedLanguage,
  onLanguageChange,
  onStartRoleplay,
  activeTopic,
}: TopicRoleplayProps) {
  const [selectedTopic, setSelectedTopic] = useState<string>(activeTopic || '');
  const [showPhrases, setShowPhrases] = useState(false);

  const topic = TOPICS.find((t) => t.id === selectedTopic);
  const phrases = selectedTopic ? (PHRASES[selectedLanguage]?.[selectedTopic] || []) : [];

  const handleStart = () => {
    if (selectedTopic) {
      onStartRoleplay(selectedTopic);
    }
  };

  return (
    <div className="space-y-4">
      {/* Language Selector */}
      <div className="glass-card p-5">
        <h2 className="text-lg font-display font-bold text-white mb-4 flex items-center gap-2">
          <Globe size={18} className="text-purple-400" />
          Language Selection
        </h2>
        <div className="grid grid-cols-3 gap-3">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => onLanguageChange(lang.code)}
              className={`p-4 rounded-2xl border text-center transition-all ${
                selectedLanguage === lang.code
                  ? 'border-purple-500/60 bg-purple-500/15'
                  : 'border-white/8 bg-white/3 hover:border-white/20 hover:bg-white/5'
              }`}
            >
              <div className="text-3xl mb-2">{lang.flag}</div>
              <div className={`font-display font-bold text-sm ${selectedLanguage === lang.code ? 'text-purple-200' : 'text-white/70'}`}>
                {lang.name}
              </div>
              <div className={`text-xs mt-0.5 ${selectedLanguage === lang.code ? 'text-purple-300/70' : 'text-white/30'}`}>
                {lang.nativeName}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Topic Grid */}
      <div className="glass-card p-5">
        <h2 className="text-lg font-display font-bold text-white mb-4 flex items-center gap-2">
          <Sparkles size={18} className="text-purple-400" />
          Choose a Scenario
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {TOPICS.map((t) => (
            <button
              key={t.id}
              onClick={() => { setSelectedTopic(t.id); setShowPhrases(false); }}
              className={`glass-card-hover p-4 rounded-2xl border text-left transition-all ${
                selectedTopic === t.id
                  ? 'border-purple-500/60 bg-purple-500/12'
                  : 'border-white/6 hover:border-purple-500/25'
              }`}
            >
              <div className="text-2xl mb-2">{t.icon}</div>
              <div className={`font-semibold text-sm leading-tight ${selectedTopic === t.id ? 'text-purple-200' : 'text-white/80'}`}>
                {t.name}
              </div>
              <div className="text-xs text-white/35 mt-1 leading-tight line-clamp-2">{t.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Selected Scenario Briefing */}
      {selectedTopic && topic && (
        <div className="glass-card p-5" style={{ border: '1px solid rgba(139,92,246,0.2)' }}>
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <div className="text-2xl mb-1">{topic.icon}</div>
              <h3 className="text-xl font-display font-bold text-white">{topic.name}</h3>
              <p className="text-white/50 text-sm mt-1">{topic.description}</p>
            </div>
            <button
              onClick={handleStart}
              className="btn-primary flex items-center gap-2 flex-shrink-0"
            >
              <Play size={14} fill="currentColor" />
              Start Roleplay
            </button>
          </div>

          {/* Language badge */}
          <div className="flex flex-wrap gap-2 mb-4">
            <span className="px-3 py-1 rounded-full text-xs font-medium"
              style={{ background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.2)', color: '#7dd3fc' }}>
              {LANGUAGES.find((l) => l.code === selectedLanguage)?.flag}{' '}
              {LANGUAGES.find((l) => l.code === selectedLanguage)?.name}
            </span>
            <span className="px-3 py-1 rounded-full text-xs font-medium"
              style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.2)', color: '#6ee7b7' }}>
              🎭 Roleplay Mode
            </span>
          </div>

          {/* Suggested Phrases */}
          {phrases.length > 0 && (
            <div>
              <button
                onClick={() => setShowPhrases(!showPhrases)}
                className="flex items-center gap-2 text-sm font-medium text-purple-300 hover:text-purple-200 transition-colors mb-3"
              >
                <BookOpen size={14} />
                {showPhrases ? 'Hide' : 'Show'} Suggested Phrases
                <ChevronRight size={14} className={`transition-transform ${showPhrases ? 'rotate-90' : ''}`} />
              </button>

              {showPhrases && (
                <div className="space-y-2">
                  {phrases.map((p, i) => (
                    <div key={i} className="p-3 rounded-xl"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <div className="font-medium text-white text-sm">{p.phrase}</div>
                      {p.pronunciation !== p.phrase && (
                        <div className="text-blue-300 text-xs font-mono mt-0.5">{p.pronunciation}</div>
                      )}
                      <div className="text-white/40 text-xs mt-0.5 italic">{p.meaning}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Start prompt */}
          <div className="mt-4 p-3 rounded-xl text-sm"
            style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.15)' }}>
            <span className="text-emerald-400 font-medium">💡 Ready to start?</span>
            <span className="text-white/50 ml-2">
              Click "Start Roleplay" to switch to Voice Tutor and begin your {topic.name} conversation with Luna!
            </span>
          </div>
        </div>
      )}

      {!selectedTopic && (
        <div className="glass-card p-8 text-center">
          <div className="text-4xl mb-3">🎭</div>
          <p className="text-white/40 text-sm">
            Select a language and topic above to see suggested phrases and start a roleplay session.
          </p>
        </div>
      )}
    </div>
  );
}
