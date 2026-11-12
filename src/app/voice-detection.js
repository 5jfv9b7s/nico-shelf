/**
 * Explainable vocal-synth singer recognition.
 *
 * Preserve original DB fields. A name in a description may refer to the
 * original singer, an illustrator or an unrelated link, so unlabelled prose is
 * ONLY a suggestion. Only explicit credit lines, credited titles, singer tags,
 * or manually/imported singer fields participate in statistical counts.
 *
 * This is intentionally a small, reviewable dictionary, not NLP or audio
 * analysis. Extend it only with clear aliases and regression tests.
 */
import { array } from '../lib.js';

export const VOICE_RULES = Object.freeze([
  ['音街ウナ', /音街\s*ウナ|otomachi\s*una/i],
  ['重音テト', /重音\s*テト|kasane\s*teto/i],
  ['初音ミク', /初音\s*ミク|hatsune\s*miku/i],
  ['足立レイ', /足立\s*レイ|adachi\s*rei/i],
  ['宮舞モカ', /宮舞\s*モカ|miyamai\s*moca/i],
  ['東北きりたん', /東北\s*きりたん|tohoku\s*kiritan/i],
  ['結月ゆかり', /結月\s*ゆかり|yuzuki\s*yukari/i],
  ['琴葉茜', /琴葉\s*茜/i],
  ['琴葉葵', /琴葉\s*葵/i],
  ['可不', /可不(?!可|能)/i],
  ['星界', /星界/i],
  ['つくよみちゃん', /つくよみちゃん/i],
  ['ナースロボ＿タイプＴ', /ナースロボ[_＿\s]*タイプ[tｔＴ]/i],
  ['ずんだもん', /ずんだもん/i],
  ['小春六花', /小春\s*六花/i],
  ['花隈千冬', /花隈\s*千冬/i],
  ['夏色花梨', /夏色\s*花梨/i],
  ['GUMI', /\bGUMI\b|megpoid/i],
  ['IA', /\bIA\b/i],
  ['鏡音リン', /鏡音\s*リン/i],
  ['鏡音レン', /鏡音\s*レン/i],
  ['巡音ルカ', /巡音\s*ルカ/i],
  ['MEIKO', /\bMEIKO\b/i],
  ['KAITO', /\bKAITO\b/i],
  ['東北イタコ', /東北\s*イタコ|tohoku\s*itako/i],
  ['四国めたん', /四国\s*めたん/i],
  ['九州そら', /九州\s*そら/i],
  ['中国うさぎ', /中国\s*うさぎ/i],
  ['歌愛ユキ', /歌愛\s*ユキ/i],
  ['v flower', /v[_\s-]*flower|ブイフラワ|vフラワ/i],
  ['鳴花ヒメ', /鳴花\s*ヒメ/i],
  ['鳴花ミコト', /鳴花\s*ミコト/i],
  ['紲星あかり', /紲星\s*あかり/i],
  ['弦巻マキ', /弦巻\s*マキ/i],
  ['桜乃そら', /桜乃\s*そら/i],
  ['彩澄りりせ', /彩澄\s*(?:りりせ|リリセ)/i],
  ['さとうささら', /さとう\s*ささら/i],
  ['すずきつづみ', /すずき\s*つづみ/i],
  ['波音リツ', /波音\s*リツ/i],
  ['雪歌ユフ', /雪歌\s*ユフ/i],
  ['桃音モモ', /桃音\s*モモ/i],
  ['唄音ウタ', /唄音\s*ウタ|デフォ子/i],
  ['亞北ネル', /[亞亜]北\s*ネル/i],
  ['弱音ハク', /弱音\s*ハク/i],
  ['裏命', /裏命/i],
  ['羽累', /羽累/i],
  ['狐子', /狐子/i],
  ['神威がくぽ', /神威\s*がくぽ|がくっぽいど/i],
  ['夢ノ結唱 POPY', /夢ノ結唱\s*POPY/i],
  ['夢ノ結唱 ROSE', /夢ノ結唱\s*ROSE/i],
  // Do not detect the singer OИE inside words such as ZONE.
  ['OИE', /(?<![A-Za-z0-9_])O[ИN]E(?![A-Za-z0-9_])/i],
  ['VY1', /\bVY1\b/i],
  ['VY2', /\bVY2\b/i],

]);

function splitSingerFields(input) {
  return String(input ?? '').split(/[,、;；\n/&＋+]+/).map((part) => part.trim()).filter(Boolean);
}

export function canonicalVoice(value) {
  const original = String(value ?? '').trim();
  if (!original) return '';
  if (/^(?:flower|v[_\s-]?flower)$/i.test(original)) return 'v flower';
  if (/^デフォ子$/.test(original)) return '唄音ウタ';
  if (/^あかり$/.test(original)) return original; // Too ambiguous to infer a character.
  const matched = VOICE_RULES.find(([, expression]) => expression.test(original));
  if (matched) return matched[0];
  return original
    .replace(/^(?:synthesizer\s*v(?:\s*ai)?|cevio\s*ai|vocaloid\s*[456]?|utau)\s*[:：-]?\s*/i, '')
    .replace(/\s*\((?:unknown|不明)\)\s*$/i, '')
    .replace(/\s*[-–]\s*(?:sv|ai)\s*$/i, '')
    .trim() || original;
}

/** All occurrences, including separate names on a single duet credit line. */
export function namesInText(input) {
  const text = String(input ?? '');
  const matches = [];
  for (const [name, expression] of VOICE_RULES) {
    const global = new RegExp(expression.source, `${expression.flags.replaceAll('g', '')}g`);
    for (const match of text.matchAll(global)) {
      matches.push({ name, matchedText: match[0], index: match.index });
    }
  }
  return matches.sort((a, b) => a.index - b.index);
}

/** Save an engine variant only if the text explicitly identifies it. */
export function voiceVariant(name, text) {
  const input = String(text ?? '').normalize('NFKC');
  if (name === '音街ウナ') {
    if (/音街\s*ウナ\s*[-_\s]*(?:spicy)|una\s+spicy/i.test(input)) return '音街ウナ Spicy';
    if (/音街\s*ウナ\s*[-_\s]*(?:sugar)|una\s+sugar/i.test(input)) return '音街ウナ Sugar';
    if (/synthesizer\s*v(?:\s*ai)?\s*音街\s*ウナ/i.test(input)) return 'Synthesizer V AI 音街ウナ';
    if (/音街\s*ウナ\s*[-_\s]*sv/i.test(input)) return '音街ウナ-SV';
  }
  if (name === '重音テト' && /重音\s*テト\s*[-_\s]*sv|synthesizer\s*v(?:\s*ai)?\s*重音\s*テト/i.test(input)) {
    return '重音テトSV';
  }
  return name;
}

function titleCreditsSinger(title, match) {
  const before = title.slice(Math.max(0, match.index - 32), match.index);
  const after = title.slice(match.index + match.matchedText.length, match.index + match.matchedText.length + 20);
  // Treat a sequence after a credited slash/feat. as one singer field:
  // "曲 / 音街ウナと星界" or "feat. 初音ミク・鏡音リン".
  const creditedSegment = title.slice(0, match.index)
    .match(/(?:feat(?:uring)?\.?|ft\.?|[／/|｜])([\s\S]{0,75})$/i)?.[1] ?? '';
  const mentioned = namesInText(creditedSegment);
  const separatorsOnly = mentioned.length > 0 &&
    mentioned.reduce((remaining, entry) => remaining.replace(entry.matchedText, ''), creditedSegment)
      .replace(/[\sと＆&,、・+＋×xX]/g, '') === '';
  return separatorsOnly || /(?:feat(?:uring)?\.?|ft\.?|vocal(?:s)?|歌唱|ボーカル|歌|唄|vo\.?|cv\.?|with)\s*[:：.\-]?\s*$/i.test(before)
    || /[／/|｜]\s*$/.test(before)
    || /[【［\[(（]\s*$/.test(before) && /^\s*[】］\])）]/.test(after)
    || /^\s*(?:が歌う|に歌ってもらった|が歌ってみた|cover|カバー)/i.test(after);
}

const VOCAL_CREDIT = /^(?:歌唱|歌声|唄|ボーカル|ヴォーカル|vocal(?:s)?|vo\.?|singer|voice|使用音源|歌声合成|歌手)(?:\s*(?:&|and|・|／|\/|\+|、)\s*(?:chorus|コーラス))?\s*[:：/／=\-]\s*/i;
const UNRELATED_CREDIT = /^(?:原曲|本家|original|original\s+song|参考|リンク|イラスト|絵|作画|動画|movie|mix|作曲|作詞|music|illustration|illust|guest)\s*[:：/／=\-]/i;

function descriptionLines(description) {
  return String(description ?? '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** An ordinary tag can mention a character without saying who sang. */
function isCreditedTag(tag, match) {
  const remainder = tag.replace(match.matchedText, '').replace(/[\s_＿・-]/g, '');
  return remainder === '' || /^(?:sv|spicy|sugar|歌唱|カバー曲?|オリジナル曲?|utauオリジナル曲?|vocaloidオリジナル曲?)$/i.test(remainder)
    || /^(?:synthesizerv(?:ai)?)/i.test(remainder);
}

/**
 * @returns {{accepted: Evidence[], suggestions: Evidence[]}}
 * Evidence includes {name, variant, source, confidence, excerpt}.
 */
const evidenceCache = new WeakMap();

export function detectVoiceEvidence(video) {
  if (!video || typeof video !== 'object') return { accepted: [], suggestions: [] };
  // A signature avoids stale cached data after a local metadata refresh.
  const signature = [video.title, video.description, video.userMeta?.verified_voice,
    ...array(video.voices), ...array(video.tags), ...array(video.vocadb_tags)].join('\u001f');
  const cached = evidenceCache.get(video);
  if (cached?.signature === signature) return cached.result;
  const accepted = new Map();
  const suggestions = new Map();
  const add = (name, source, excerpt, confidence = 'high', variant = name) => {
    const entry = { name, variant, source, excerpt: String(excerpt ?? '').slice(0, 120), confidence };
    const map = confidence === 'suggestion' ? suggestions : accepted;
    const key = confidence === 'suggestion' ? name : `${name}\u001f${variant}`;
    const existing = map.get(key);
    if (!existing || (existing.confidence !== 'high' && confidence === 'high')) map.set(key, entry);
  };

  const manual = String(video?.userMeta?.verified_voice ?? '').trim();
  if (manual) {
    for (const value of splitSingerFields(manual)) {
      const matches = namesInText(value);
      if (!matches.length) add(canonicalVoice(value), '手動確定', value, 'high', value);
      for (const match of matches) add(match.name, '手動確定', value, 'high', matches.length === 1 ? value : voiceVariant(match.name, value));
    }
    const result = { accepted: [...accepted.values()], suggestions: [] };
    evidenceCache.set(video, { signature, result });
    return result;
  }

  // Existing imported/VocaDB-derived credits have priority over heuristics.
  for (const field of array(video?.voices)) {
    const raw = String(field ?? '').trim();
    if (!raw || /^(?:unknown|不明|未判定)$/i.test(raw)) continue;
    const matches = namesInText(raw);
    if (!matches.length) add(canonicalVoice(raw), '保存済み歌唱者情報', raw, 'high', raw);
    for (const match of matches) {
      add(match.name, '保存済み歌唱者情報', raw, 'high', matches.length === 1 ? raw : voiceVariant(match.name, raw));
    }
  }

  for (const tag of [...array(video?.tags), ...array(video?.vocadb_tags)]) {
    const text = String(tag ?? '').trim();
    for (const match of namesInText(text)) {
      const confidence = isCreditedTag(text, match) ? 'medium' : 'suggestion';
      add(match.name, 'タグ', text, confidence, voiceVariant(match.name, text));
    }
  }

  const title = String(video?.title ?? '').trim();
  for (const match of namesInText(title)) {
    add(match.name, 'タイトル', title, titleCreditsSinger(title, match) ? 'high' : 'suggestion', voiceVariant(match.name, title));
  }

  const lines = descriptionLines(video?.description);
  for (const line of lines) {
    if (UNRELATED_CREDIT.test(line)) continue;
    const credit = line.match(VOCAL_CREDIT);
    if (!credit) continue;
    const voicePart = line.slice(credit[0].length).split(/\s+(?:絵|イラスト|動画|作詞|作曲|mix|illust|movie|music)\s*[:：]/i)[0];
    for (const match of namesInText(voicePart)) add(match.name, '概要欄の歌唱クレジット', line, 'high', voiceVariant(match.name, voicePart));
  }

  // Loose description mentions are review candidates, NEVER automatic singers.
  const remaining = lines.filter((line) => !VOCAL_CREDIT.test(line) && !UNRELATED_CREDIT.test(line));
  for (const line of remaining.slice(0, 100)) {
    for (const match of namesInText(line)) add(match.name, '概要欄の言及（要確認）', line, 'suggestion', match.name);
  }
  const found = [...accepted.values()];
  const trustedNames = new Set(found.filter((item) => item.source === '保存済み歌唱者情報').map((item) => item.name));
  const acceptedResults = found.filter((item) => !trustedNames.has(item.name) || item.source === '保存済み歌唱者情報');
  for (const entry of acceptedResults) suggestions.delete(entry.name);
  const result = { accepted: acceptedResults, suggestions: [...suggestions.values()] };
  evidenceCache.set(video, { signature, result });
  return result;
}
