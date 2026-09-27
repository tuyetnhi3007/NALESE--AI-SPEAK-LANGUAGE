// ============================================================
// lib/types.ts — Shared TypeScript types across NALESE
// ============================================================

export type SupportedLanguage = 'en' | 'zh' | 'ja';
export type LanguageLevel = 'beginner' | 'intermediate' | 'advanced';
export type TutorVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
export type MicMode = 'auto'; // Chỉ dùng auto-detect silence
export type AppTab = 'voice' | 'vocab' | 'topics';

export interface VocabEntry {
  index: number;
  pronunciation: string; // Pinyin, Romaji, or IPA
  word: string;          // Target language character/word
  meaning: string;       // Vietnamese meaning
}

// Đánh giá cấp độ âm tố (Phoneme level - bảo tồn nguyên vẹn kết quả từ provider)
export interface PhonemeAssessment {
  phoneme: string;         // e.g. "sh", "en", "3" (tone)
  accuracyScore: number;   // 0 - 100
  errorType?: 'None' | 'Mispronunciation' | 'Omission' | 'Insertion' | 'ToneError';
}

// Đánh giá cấp độ âm tiết / Chữ Hán (Syllable level do Application Layer tổng hợp)
export interface SyllableAssessment {
  character: string;       // Chữ Hán chuẩn (e.g. "什")
  pinyin: string;          // Pinyin chuẩn có dấu (e.g. "shén")
  accuracyScore: number;   // Điểm chính xác âm tiết đã được tổng hợp (0 - 100)
  errorType: 'None' | 'Mispronunciation' | 'Omission' | 'Insertion' | 'ToneError';
  phonemes?: PhonemeAssessment[]; // Chi tiết từng âm tố nguyên bản
  note?: string;           // Ghi chú lỗi nếu có
}

// Kết quả tổng thể phiên đánh giá phát âm
export interface PronunciationAssessmentResult {
  provider: 'azure' | 'gemini' | 'unassessed';
  referenceText: string;   // Câu mục tiêu đối chiếu
  overallScore: number | null; // Điểm tổng thể (null nếu unassessed)
  accuracyScore?: number;  // Điểm phát âm
  fluencyScore?: number;   // Điểm trôi chảy
  completenessScore?: number; // Điểm hoàn thiện
  syllables: SyllableAssessment[]; // Mảng âm tiết đã được tổng hợp
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  original: string;         // Câu gốc (nguồn duy nhất cho TTS và dòng 1 History)
  romanization?: string;    // Phiên âm (Pinyin/Romaji/IPA) - CHỈ hiển thị giao diện dòng 2
  translation?: string;     // Dịch tiếng Việt - CHỈ hiển thị giao diện dòng 3
  text?: string;            // Backward-compatible alias cho original
  audioBase64?: string;
  pronunciationResult?: PronunciationAssessmentResult; // Kết quả đánh giá phát âm cho USER
  pronunciationScore?: number | null; // Điểm tổng thể phát âm (0-100 hoặc null)
  timestamp: number;
  toolResults?: ToolResult[];
}

export interface ToolResult {
  toolName: string;
  result: string;
}

// Voice chat API request — hỗ trợ cả text (Web Speech API) và audio (Whisper)
export interface VoiceChatRequest {
  // Một trong hai phải có: text (từ Web Speech API) hoặc audioBase64 (Whisper fallback)
  text?: string;          // Transcript từ Web Speech API (miễn phí, ưu tiên)
  audioBase64?: string;   // Base64-encoded audio blob (Whisper fallback)
  language: SupportedLanguage;
  level: LanguageLevel;
  topic?: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  voice: TutorVoice;
  speed?: number;
  vocabContext?: VocabEntry[]; // Vocabulary context từ file upload
  apiKey?: string;             // Client-provided API key
  skipPronunciation?: boolean; // Tối ưu hóa: đánh giá phát âm ở endpoint song song
  stream?: boolean;            // Tối ưu hóa: stream từng token qua SSE
}

// Voice chat API response
export interface VoiceChatResponse {
  userTranscript: string;
  userPinyin?: string;         // Pinyin tương ứng với câu người dùng nói (tiếng Trung)
  userRomanization?: string;   // Romaji/Pinyin tương ứng với câu người dùng nói (đa ngôn ngữ)
  pronunciationResult?: PronunciationAssessmentResult; // Kết quả phát âm
  pronunciationScore?: number | null; // Điểm phát âm tổng thể (0-100)
  assistantOriginal: string;    // Câu gốc từ AI dành riêng cho TTS và hiển thị dòng 1
  assistantRomanization?: string;
  assistantTranslation?: string;
  assistantText?: string;       // Backward-compatible alias
  audioBase64: string;         // TTS output audio (mp3)
  toolResults?: ToolResult[];
  latencyMs: number;
  error?: string;
  sttProvider?: string;        // Provider đã dùng: 'groq' | 'web-speech' | 'openai-whisper'
  llmProvider?: string;        // Provider đã dùng: 'gemini' | 'openai'
  ttsProvider?: string;        // Provider đã dùng: 'browser-tts' | 'openai-tts'
}

// Exercise types — mở rộng cho Topic Exercises
export type ExerciseType =
  | 'multiple-choice'
  | 'fill-blank'
  | 'translation'
  | 'listening'
  | 'sentence-ordering'
  | 'speaking'
  | 'error-correction'
  | 'vocabulary';

export interface ExerciseQuestion {
  id: string;
  type: ExerciseType;
  question: string;
  options?: string[];           // Cho multiple-choice
  words?: string[];             // Cho sentence-ordering (các từ bị xáo trộn)
  correctAnswer: string;        // Đáp án đúng
  explanation: string;          // Giải thích bằng tiếng Việt
  audioText?: string;           // Text để đọc qua TTS (cho listening/speaking)
  vocabRef?: VocabEntry;
}

export interface ExerciseSet {
  title: string;
  language: SupportedLanguage;
  topic: string;
  level: LanguageLevel;
  questions: ExerciseQuestion[];
  generatedAt: number;
}

// Topic exercise request
export interface TopicExerciseRequest {
  language: SupportedLanguage;
  topic: string;
  level: LanguageLevel;
  apiKey?: string;
}

// App settings (persisted in localStorage)
export interface AppSettings {
  apiKey: string;
  voice: TutorVoice;
  speed: number;
  level: LanguageLevel;
}
