/**
 * Find related videos inside the currently signed-in user's library.
 *
 * This is a deterministic, explainable metadata matcher: not an audio model,
 * not a recommendation API, and never a query to other users' collections.
 * Metadata may be sparse or wrong, so we describe shared signals rather than
 * claiming that songs actually sound alike.
 */
import { array } from '../lib.js';
import { canonicalVoices, composerNames, genreLabels, moodLabels } from '../discovery.js';

const GENERIC_TAGS = new Set([
  'vocaloid', 'vocaloidオリジナル曲', 'utau', 'utauオリジナル曲',
  'cevio', 'cevioai', 'synthesizerv', 'ボカロ', 'ボーカロイド',
  '音楽', '音楽・サウンド', 'ニコニコ動画', '初音ミク', '重音テト',
  '音街ウナ', '足立レイ', '歌ってみた', '作業用bgm',
]);

function normalizedTag(value) {
  return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase();
}

function informativeTags(video) {
  const matches = new Map();
  for (const raw of [...array(video.tags), ...array(video.vocadb_tags)]) {
    const text = String(raw ?? '').trim();
    const normalized = normalizedTag(text);
    if (!normalized || GENERIC_TAGS.has(normalized) || normalized.length > 80) continue;
    if (!matches.has(normalized)) matches.set(normalized, text);
  }
  return matches;
}

function intersection(left, right) {
  const values = new Set(right);
  return [...new Set(left)].filter((item) => values.has(item));
}

function namedOverlap(left, right) {
  const rightNames = new Map(right.map((name) => [String(name).trim().toLocaleLowerCase(), name]));
  return [...new Set(left.map((name) => String(name).trim().toLocaleLowerCase()))]
    .filter((name) => name && rightNames.has(name)).map((name) => rightNames.get(name));
}

/**
 * @param {Object} source - A video row from buildLibraryRows()
 * @param {Object[]} videos - Only the current authenticated user's rows
 * @param {{limit?: number}} options
 * @returns {{video: Object, score: number, reasons: string[]}[]}
 */
export function recommendRelatedVideos(source, videos, { limit = 8 } = {}) {
  if (!source?.id || !Array.isArray(videos) || !videos.length) return [];

  // Pre-compute rare-tag frequency once per request. Common tags are less useful.
  const documentFrequency = new Map();
  const tagsById = new Map();
  for (const video of videos) {
    const tags = informativeTags(video);
    tagsById.set(video.id, tags);
    for (const key of tags.keys()) {
      documentFrequency.set(key, (documentFrequency.get(key) ?? 0) + 1);
    }
  }

  const sourceVoices = canonicalVoices(source);
  const sourceCreators = composerNames(source);
  const sourceGenres = genreLabels(source);
  const sourceMoods = moodLabels(source);
  const sourceTags = tagsById.get(source.id) ?? informativeTags(source);
  const results = [];

  for (const video of videos) {
    if (!video?.id || video.id === source.id) continue;

    const reasons = [];
    let score = 0;

    const voices = intersection(sourceVoices, canonicalVoices(video));
    if (voices.length) {
      score += 3.5 * Math.min(2, voices.length);
      reasons.push(`歌唱キャラ：${voices.slice(0, 2).join('・')}`);
    }

    const creators = namedOverlap(sourceCreators, composerNames(video));
    if (creators.length) {
      score += 2.2 * Math.min(2, creators.length);
      reasons.push(`作者・投稿者：${creators.slice(0, 2).join('・')}`);
    }

    const genres = intersection(sourceGenres, genreLabels(video));
    if (genres.length) {
      score += 1.6 * Math.min(2, genres.length);
      reasons.push(`ジャンル：${genres.slice(0, 2).join('・')}`);
    }

    const moods = intersection(sourceMoods, moodLabels(video));
    if (moods.length) {
      score += 1.3 * Math.min(2, moods.length);
      reasons.push(`雰囲気：${moods.slice(0, 2).join('・')}`);
    }

    const candidateTags = tagsById.get(video.id) ?? informativeTags(video);
    const commonTags = [...sourceTags.keys()].filter((tag) => candidateTags.has(tag));
    if (commonTags.length) {
      const rankedTags = commonTags.sort((a, b) =>
        (documentFrequency.get(a) ?? 0) - (documentFrequency.get(b) ?? 0));
      const selectedTags = rankedTags.slice(0, 3);
      const corpusSize = Math.max(1, videos.length);
      for (const tag of selectedTags) {
        const frequency = documentFrequency.get(tag) ?? 1;
        score += Math.min(2.5, 0.6 + Math.log((corpusSize + 1) / (frequency + 1)));
      }
      reasons.push(`共通タグ：${selectedTags.map((tag) => sourceTags.get(tag)).join('・')}`);
    }

    // Do not invent matches for videos with no meaningful shared metadata.
    if (score > 0) results.push({ video, score: Math.round(score * 100) / 100, reasons });
  }

  return results
    .sort((a, b) => b.score - a.score || a.video.id.localeCompare(b.video.id))
    .slice(0, Math.max(0, Math.min(30, Math.trunc(limit) || 0)));
}
