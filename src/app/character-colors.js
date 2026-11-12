/**
 * NICO SHELF's character palette, shared by every singer-coloured chart.
 *
 * Most hexadecimal values are *UI approximations* based on the character's
 * recognisable image colours; they are not advertised as official HEX codes.
 * Miku's familiar #39C5BB is an exception. Keep aliases in voice-detection.js,
 * not here; use canonicalVoice() before looking up the swatch.
 *
 * This file is deliberately editable without touching chart code.
 */
import { canonicalVoice } from './voice-detection.js';

export const CHARACTER_COLORS = Object.freeze({
  '初音ミク': '#39C5BB',
  '重音テト': '#D95669',
  // 紫〜青紫の髪・帽子を基準に選んだグラフ用の近似色。公式HEX指定ではない。
  '音街ウナ': '#8575D8',
  '足立レイ': '#FF6B35',
  // 公式デザインの青緑のアクセントを基準に選んだ近似色。公式HEX指定ではない。
  '宮舞モカ': '#5DABC5',
  '東北きりたん': '#B65C5A',
  '東北ずん子': '#6DBA62',
  'ずんだもん': '#91D56B',
  '結月ゆかり': '#B78ADA',
  '琴葉茜': '#E88F9E',
  '琴葉葵': '#6DAFE6',
  '可不': '#C7CCD6',
  '星界': '#6C92E8',
  'つくよみちゃん': '#C0A1DF',
  'ナースロボ＿タイプＴ': '#8AC8CE',
  '小春六花': '#94C6B0',
  '花隈千冬': '#8FB7C7',
  '夏色花梨': '#D8A66A',
  'GUMI': '#8ACF55',
  'IA': '#E6B3D6',
  '鏡音リン': '#F5A034',
  '鏡音レン': '#E9CA45',
  '巡音ルカ': '#E998C1',
  'MEIKO': '#E15E6D',
  'KAITO': '#568CDF',
  // 追加の歌声キャラクター。いずれもUI用近似色（公式HEX値とは限らない）。
  '東北イタコ': '#86C5D6',
  '四国めたん': '#A78CD7',
  '九州そら': '#8FD2E6',
  '中国うさぎ': '#E5A6B9',
  '歌愛ユキ': '#B96D7A',
  'v flower': '#9677C8',
  '鳴花ヒメ': '#EF96B4',
  '鳴花ミコト': '#80A7D8',
  '紲星あかり': '#E7A7A1',
  '弦巻マキ': '#E6C169',
  '桜乃そら': '#AC98CF',
  'さとうささら': '#E7BE75',
  'すずきつづみ': '#7FAFCE',
  '波音リツ': '#D98E4F',
  '雪歌ユフ': '#A6CDE2',
  '桃音モモ': '#E2A0B6',
  '唄音ウタ': '#A7B4C6',
  '亞北ネル': '#EAC75D',
  '弱音ハク': '#C6D3E1',
  '裏命': '#AAA6DC',
  '羽累': '#E5989B',
  '狐子': '#87C9BD',
  '神威がくぽ': '#9375B5',
  'Lily': '#E9BF5D',
  '夢ノ結唱 POPY': '#E89FC1',
  '夢ノ結唱 ROSE': '#A75F81',
  'OИE': '#F3B75E',
  'VY1': '#A5C46F',
  'VY2': '#B2A9B0',

});

export const UNCLASSIFIED_COLOR = '#8FA4BC';

/** Whether a colour was intentionally configured for a character. */
export function hasCharacterColor(name) {
  return Object.hasOwn(CHARACTER_COLORS, canonicalVoice(name));
}

/**
 * A deterministic fallback for unconfigured singers, so they are not all gray.
 * The result is a *generated chart colour*, not an official character colour.
 * Empty / unclassified singer values stay neutral.
 */
export function colorForCharacter(name) {
  const character = canonicalVoice(name);
  if (!character) return UNCLASSIFIED_COLOR;
  if (hasCharacterColor(character)) return CHARACTER_COLORS[character];

  let hash = 2166136261;
  for (const symbol of character) {
    hash ^= symbol.codePointAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const hue = hash % 360;
  return hslToHex(hue, 56, 67);
}

function hslToHex(hue, saturation, lightness) {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const segment = hue / 60;
  const secondary = chroma * (1 - Math.abs(segment % 2 - 1));
  const [r, g, b] = segment < 1 ? [chroma, secondary, 0]
    : segment < 2 ? [secondary, chroma, 0]
    : segment < 3 ? [0, chroma, secondary]
    : segment < 4 ? [0, secondary, chroma]
    : segment < 5 ? [secondary, 0, chroma]
    : [chroma, 0, secondary];
  const offset = l - chroma / 2;
  return '#' + [r, g, b].map((component) =>
    Math.round((component + offset) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Genre/mood/creator graphs retain a stable but non-character colour cycle. */
const CATEGORY_COLORS = Object.freeze(['#69DED0', '#F2BA76', '#9CA9FF', '#F48EAA', '#9BCF89', '#91C0E8', '#E2BAE7']);
export function colorForFacet(name, facet, index = 0) {
  return facet === 'voice'
    ? colorForCharacter(name)
    : CATEGORY_COLORS[Math.abs(index) % CATEGORY_COLORS.length];
}
