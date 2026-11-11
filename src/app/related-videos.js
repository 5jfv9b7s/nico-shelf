/**
 * Explainable discovery from the current user's library.
 *
 * "Sound and mood" is a metadata-driven discovery mode, not audio analysis.
 * Every candidate and every similarity signal is derived from library rows
 * supplied by the caller. No external service and no other users' data.
 */
import { array } from '../lib.js';
import { canonicalVoices, composerNames, genreLabels, moodLabels } from '../discovery.js';

export const RELATED_MODES = Object.freeze({
  balanced: 'バランス',
  musical: 'ジャンル・雰囲気重視',
  explore: '別の作者・投稿者を発掘',
});

const MODE_WEIGHTS = Object.freeze({
  balanced: { voice: 3.5, creator: 2.2, genre: 1.6, mood: 1.3, tag: 1 },
  musical:  { voice: 0.35, creator: 0.35, genre: 3.2, mood: 3, tag: 1.7 },
  explore:  { voice: 3.5, creator: 0, genre: 2.2, mood: 1.7, tag: 1.2 },
});

// General platform, voice-platform and creator-category tags are weak evidence.
// Keep this list conservative so niche musical tags are not discarded.
const GENERIC_TAGS = new Set([
  'vocaloid', 'vocaloidオリジナル曲', 'vocaloid新曲リンク',
  'utau', 'utauオリジナル曲', 'utauカバー曲',
  'cevio', 'cevioai', 'synthesizerv', 'ボカロ', 'ボーカロイド',
  'ボカロオリジナル曲', 'オリジナル曲', 'ニコニコインディーズ',
  '音楽', '音楽・サウンド', 'ニコニコ動画', '初音ミク', '重音テト',
  '音街ウナ', '足立レイ', '歌ってみた', '作業用bgm',
]);

const normalizeText = (value) =>
  String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase();

function informativeTags(video) {
  const matches = new Map();
  for (const raw of [...array(video.tags), ...array(video.vocadb_tags)]) {
    const label = String(raw ?? '').trim();
    const normalized = normalizeText(label);
    if (!normalized || GENERIC_TAGS.has(normalized) || normalized.length > 80) continue;
    if (!matches.has(normalized)) matches.set(normalized, label);
  }
  return matches;
}

function commonValues(left, right) {
  const rightSet = new Set(right);
  return [...new Set(left)].filter((value) => rightSet.has(value));
}

/** Case-insensitive comparison that preserves the candidate's original spelling. */
function sharedNames(left, right) {
  const rightLabels = new Map(right.map((name) => [normalizeText(name), name]));
  return [...new Set(left.map(normalizeText))]
    .filter((name) => name && rightLabels.has(name))
    .map((name) => rightLabels.get(name));
}

const addSignal = (reasons, label, items, points, maxItems = 2) => {
  if (!items.length) return 0;
  reasons.push(`${label}：${items.slice(0, maxItems).join('・')}`);
  return points * Math.min(maxItems, items.length);
};

/**
 * @param {object} source Video row from buildLibraryRows().
 * @param {object[]} videos Rows only from the authenticated user's library.
 * @param {{limit?: number, mode?: 'balanced'|'musical'|'explore', unratedOnly?: boolean}} options
 * @returns {{video: object, score: number, reasons: string[]}[]}
 */
export function recommendRelatedVideos(source, videos, options = {}) {
  if (!source?.id || !Array.isArray(videos) || videos.length === 0) return [];

  const mode = Object.hasOwn(RELATED_MODES, options.mode) ? options.mode : 'balanced';
  const weight = MODE_WEIGHTS[mode];
  const limit = Math.max(0, Math.min(30, Number.isFinite(options.limit) ? Math.trunc(options.limit) : 8));
  if (limit === 0) return [];

  const tagFrequency = new Map();
  const tagsById = new Map();
  for (const video of videos) {
    if (!video?.id) continue;
    const tags = informativeTags(video);
    tagsById.set(video.id, tags);
    for (const key of tags.keys()) tagFrequency.set(key, (tagFrequency.get(key) ?? 0) + 1);
  }

  const sourceVoices = canonicalVoices(source);
  const sourceNames = composerNames(source);
  const sourceGenres = genreLabels(source);
  const sourceMoods = moodLabels(source);
  const sourceTags = tagsById.get(source.id) ?? informativeTags(source);
  const matches = [];

  for (const video of videos) {
    if (!video?.id || video.id === source.id) continue;
    if (options.unratedOnly && Number(video.userMeta?.rating ?? 0) > 0) continue;

    const names = sharedNames(sourceNames, composerNames(video));
    // 'Explore' means no known shared author/uploader; missing credits cannot
    // prove a different author, so avoid an absolute claim in the UI.
    if (mode === 'explore' && names.length) continue;

    const voices = commonValues(sourceVoices, canonicalVoices(video));
    const genres = commonValues(sourceGenres, genreLabels(video));
    const moods = commonValues(sourceMoods, moodLabels(video));
    const candidateTags = tagsById.get(video.id) ?? informativeTags(video);
    const sharedTags = [...sourceTags.keys()]
      .filter((tag) => candidateTags.has(tag))
      .sort((a, b) => (tagFrequency.get(a) ?? 0) - (tagFrequency.get(b) ?? 0) || a.localeCompare(b));

    // Genre/mood discovery must not suggest a song just because its singer
    // or uploader matches. At least one musical metadata signal is required.
    if (mode === 'musical' && !(genres.length || moods.length || sharedTags.length)) continue;

    const reasons = [];
    let score = 0;
    score += addSignal(reasons, '歌唱キャラ', voices, weight.voice);
    score += addSignal(reasons, '作者・投稿者', names, weight.creator);
    score += addSignal(reasons, 'ジャンル', genres, weight.genre);
    score += addSignal(reasons, '雰囲気', moods, weight.mood);

    if (sharedTags.length) {
      const selected = sharedTags.slice(0, 3);
      const corpusSize = Math.max(1, videos.length);
      for (const tag of selected) {
        const frequency = tagFrequency.get(tag) ?? 1;
        score += weight.tag * Math.min(2.5, 0.6 + Math.log((corpusSize + 1) / (frequency + 1)));
      }
      reasons.push(`共通タグ：${selected.map((tag) => sourceTags.get(tag)).join('・')}`);
    }

    // An overlap of generic tags alone never creates a candidate.
    if (score > 0) matches.push({ video, score: Math.round(score * 100) / 100, reasons });
  }

  return matches
    .sort((a, b) => b.score - a.score || a.video.id.localeCompare(b.video.id))
    .slice(0, limit);
}
