import { array } from '../lib.js';
import {
  canonicalVoices,
  composerNames,
  genreLabels,
  moodLabels,
  rawVoices,
} from '../discovery.js';

const HEADERS = [
  '動画ID',
  '曲名・動画タイトル',
  '動画URL',
  '歌唱キャラ',
  '歌唱者の原表記',
  '作者・投稿者',
  'ジャンル（タグ推定）',
  '雰囲気（タグ推定）',
  '投稿日',
  '再生数',
  '再生時間（秒）',
  '所属マイリスト',
  '所属数',
  'お気に入り',
  '評価',
  '個人タグ',
  'メモ',
];

/**
 * Excel can execute formulas even from a quoted CSV cell. Escape dangerous
 * leading characters, including when whitespace precedes them.
 */
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

export function makeLibraryCsv(rows) {
  const lines = [HEADERS];
  for (const row of rows) {
    lines.push([
      row.id,
      row.title,
      `https://www.nicovideo.jp/watch/${encodeURIComponent(row.id)}`,
      canonicalVoices(row).join(' / '),
      rawVoices(row).join(' / '),
      composerNames(row).join(' / '),
      genreLabels(row).join(' / '),
      moodLabels(row).join(' / '),
      row.published_at ? String(row.published_at).slice(0, 10) : '',
      row.views ?? '',
      row.duration ?? '',
      array(row.memberships)
        .map((item) => item.name)
        .join(' / '),
      array(row.memberships).length,
      row.userMeta?.favorite ? 'はい' : 'いいえ',
      row.userMeta?.rating ?? 0,
      row.userMeta?.personal_tags ?? '',
      row.userMeta?.memo ?? '',
    ]);
  }
  // UTF-8 BOM helps Excel recognize Japanese text without Shift-JIS conversion.
  return '\uFEFF' + lines.map((line) => line.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
