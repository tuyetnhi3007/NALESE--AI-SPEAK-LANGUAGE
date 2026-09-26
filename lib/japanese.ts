// ============================================================
// lib/japanese.ts — Utilities for Japanese Romaji transliteration
// Converts Hiragana/Katakana to Hepburn Romaji as a failsafe
// ============================================================

const KANA_TO_ROMAJI: Record<string, string> = {
  // Hiragana
  'あ': 'a', 'い': 'i', 'う': 'u', 'え': 'e', 'お': 'o',
  'か': 'ka', 'き': 'ki', 'く': 'ku', 'け': 'ke', 'こ': 'ko',
  'さ': 'sa', 'し': 'shi', 'す': 'su', 'せ': 'se', 'そ': 'so',
  'た': 'ta', 'ち': 'chi', 'つ': 'tsu', 'て': 'te', 'と': 'to',
  'な': 'na', 'に': 'ni', 'ぬ': 'nu', 'ね': 'ne', 'の': 'no',
  'は': 'ha', 'ひ': 'hi', 'ふ': 'fu', 'へ': 'he', 'ほ': 'ho',
  'ま': 'ma', 'み': 'mi', 'む': 'mu', 'め': 'me', 'も': 'mo',
  'や': 'ya', 'ゆ': 'yu', 'よ': 'yo',
  'ら': 'ra', 'り': 'ri', 'る': 'ru', 'れ': 're', 'ろ': 'ro',
  'わ': 'wa', 'を': 'o', 'ん': 'n',

  // Voiced & Semi-voiced
  'が': 'ga', 'ぎ': 'gi', 'ぐ': 'gu', 'げ': 'ge', 'ご': 'go',
  'ざ': 'za', 'じ': 'ji', 'ず': 'zu', 'ぜ': 'ze', 'ぞ': 'zo',
  'だ': 'da', 'ぢ': 'ji', 'づ': 'zu', 'で': 'de', 'ど': 'do',
  'ば': 'ba', 'び': 'bi', 'ぶ': 'bu', 'べ': 'be', 'ぼ': 'bo',
  'ぱ': 'pa', 'ぴ': 'pi', 'ぷ': 'pu', 'ぺ': 'pe', 'ぽ': 'po',

  // Compound Hiragana
  'きゃ': 'kya', 'きゅ': 'kyu', 'きょ': 'kyo',
  'しゃ': 'sha', 'しゅ': 'shu', 'しょ': 'sho',
  'ちゃ': 'cha', 'ちゅ': 'chu', 'ちょ': 'cho',
  'にゃ': 'nya', 'にゅ': 'nyu', 'にょ': 'nyo',
  'ひゃ': 'hya', 'ひゅ': 'hyu', 'ひょ': 'hyo',
  'みゃ': 'mya', 'みゅ': 'myu', 'みょ': 'myo',
  'りゃ': 'rya', 'りゅ': 'ryu', 'りょ': 'ryo',
  'ぎゃ': 'gya', 'ぎゅ': 'gyu', 'ぎょ': 'gyo',
  'じゃ': 'ja', 'じゅ': 'ju', 'じょ': 'jo',
  'びゃ': 'bya', 'びゅ': 'byu', 'びょ': 'byo',
  'ぴゃ': 'pya', 'ぴゅ': 'pyu', 'ぴょ': 'pyo',

  // Small kana
  'ぁ': 'a', 'ぃ': 'i', 'ぅ': 'u', 'ぇ': 'e', 'ぉ': 'o',
  'っ': '', // Handled by sokuon logic

  // Punctuation
  '。': '.', '、': ',', '！': '!', '？': '?', ' ': ' ',
};

/**
 * Chuyển Katakana thành Hiragana để dùng chung bảng ánh xạ
 */
function katakanaToHiragana(text: string): string {
  return text.replace(/[\u30A1-\u30F6]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60)
  );
}

/**
 * Kiểm tra xem chuỗi có chứa chữ Nhật (Hiragana, Katakana, hoặc Kanji) không
 */
export function hasJapaneseChars(text: string): boolean {
  return /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(text);
}

/**
 * Chuyển đổi chuỗi Kana sang Romaji chuẩn
 */
export function kanaToRomaji(input: string): string {
  if (!input) return '';
  let normalized = input
    .replace(/こんにちは/g, 'konnichiwa ')
    .replace(/こんばんは/g, 'konbanwa ')
    .replace(/ありがとう(?:ございます)?/g, 'arigatō gozaimasu ')
    .replace(/どうも/g, 'dōmo ')
    .replace(/元気/g, 'genki ')
    .replace(/今日/g, 'kyō ')
    .replace(/天気/g, 'tenki ')
    .replace(/私/g, 'watashi ')
    .replace(/学生/g, 'gakusei ')
    .replace(/朝ご飯/g, 'asagohan ')
    .replace(/昼ご飯/g, 'hirugohan ')
    .replace(/晩ご飯/g, 'bangohan ')
    .replace(/ご飯/g, 'gohan ')
    .replace(/先生/g, 'sensei ')
    .replace(/日本語/g, 'nihongo ')
    .replace(/日本/g, 'nihon ')
    .replace(/勉強/g, 'benkyō ')
    .replace(/名前/g, 'namae ')
    .replace(/友達/g, 'tomodachi ');

  const text = katakanaToHiragana(normalized);
  let result = '';
  let i = 0;

  while (i < text.length) {
    // 1. Kiểm tra sokuon (âm ngắt っ)
    if (text[i] === 'っ' && i + 1 < text.length) {
      const nextTwo = text.slice(i + 1, i + 3);
      const nextOne = text[i + 1];
      const nextRomaji = KANA_TO_ROMAJI[nextTwo] || KANA_TO_ROMAJI[nextOne] || '';
      if (nextRomaji) {
        result += nextRomaji[0];
      }
      i++;
      continue;
    }

    // 2. Kiểm tra compound 2 ký tự (きゃ, しゃ,...)
    if (i + 1 < text.length) {
      const two = text.slice(i, i + 2);
      if (KANA_TO_ROMAJI[two]) {
        result += KANA_TO_ROMAJI[two] + ' ';
        i += 2;
        continue;
      }
    }

    // 3. Ký tự đơn
    const one = text[i];
    if (KANA_TO_ROMAJI[one] !== undefined) {
      const rom = KANA_TO_ROMAJI[one];
      if (rom) {
        result += rom + (rom === '.' || rom === '?' || rom === '!' || rom === ',' ? ' ' : '');
      }
    } else {
      result += one;
    }
    i++;
  }

  // Chuẩn hóa khoảng trắng và viết hoa chữ cái đầu
  let cleaned = result.replace(/\s+/g, ' ').trim();
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return cleaned;
}

/**
 * Đảm bảo chuỗi phiên âm là Romaji (ký tự Latin), tuyệt đối không để Hiragana/Katakana lọt vào UI
 */
export function ensureRomaji(romanization?: string, fallbackOriginal?: string): string {
  const rom = (romanization || '').trim();

  // Nếu romanization đã là chữ cái Latin chuẩn (không chứa ký tự tiếng Nhật)
  if (rom && !hasJapaneseChars(rom) && /[a-zA-Z]/.test(rom)) {
    return rom;
  }

  // Nếu romanization chứa chữ Kana, chuyển đổi nó sang Romaji
  if (rom && hasJapaneseChars(rom)) {
    const converted = kanaToRomaji(rom);
    if (converted && !hasJapaneseChars(converted)) {
      return converted;
    }
  }

  // Nếu romanization rỗng hoặc không chuyển đổi được, thử chuyển từ fallbackOriginal nếu là Kana
  if (fallbackOriginal && hasJapaneseChars(fallbackOriginal)) {
    const converted = kanaToRomaji(fallbackOriginal);
    if (converted && !hasJapaneseChars(converted)) {
      return converted;
    }
  }

  // 4. Nếu vẫn còn chứa ký tự tiếng Nhật (ví dụ Kanji/Kana chưa dịch), TUYỆT ĐỐI KHÔNG hiển thị nó như Romaji
  if (hasJapaneseChars(rom)) {
    return '';
  }

  return rom;
}
