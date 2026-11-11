/**
 * Render the metadata-based discovery dialog.
 *
 * DOM event handlers live in app/events.js. These templates must only render
 * data from the current user's loaded library and must escape external text.
 */
import { esc } from '../lib.js';
import { buildLibraryRows } from '../app/library.js';
import { recommendRelatedVideos } from '../app/related-videos.js';
import { safeThumb } from './media.js';

function renderRecommendation({ video, reasons }) {
  const thumbnail = safeThumb(video.thumb);
  const image = thumbnail
    ? `<img class="related-thumb" alt="" src="${esc(thumbnail)}" loading="lazy" referrerpolicy="no-referrer" />`
    : '<div class="related-thumb related-placeholder">♫</div>';

  const reasonBadges = reasons.map((reason) =>
    `<span class="related-reason">${esc(reason)}</span>`
  ).join('');

  return `<div class="related-item">
    ${image}
    <div class="related-body">
      <button class="related-title" data-detail="${esc(video.id)}">${esc(video.title || video.id)}</button>
      <small>${esc(video.uploader || video.id)}</small>
      <p>${reasonBadges}</p>
      <a class="link-text" href="https://www.nicovideo.jp/watch/${encodeURIComponent(video.id)}"
         target="_blank" rel="noopener noreferrer">ニコニコで見る ↗</a>
    </div>
  </div>`;
}

export function renderRelatedDialog(library, sourceId) {
  const videos = buildLibraryRows(library);
  const source = videos.find((video) => video.id === sourceId);
  if (!source) return '';

  const recommendations = recommendRelatedVideos(source, videos, { limit: 10 });
  const content = recommendations.length
    ? `<div class="related-list">${recommendations.map(renderRecommendation).join('')}</div>`
    : '<div class="empty-sm">共通する歌唱者・作者・タグなどが見つかりませんでした。メタデータを補完すると候補が増える場合があります。</div>';

  return `<div class="modal-head">
    <div class="eyebrow">DISCOVER / RELATED VIDEOS</div>
    <h2>この曲に近い曲を探す</h2>
    <p>起点：${esc(source.title || source.id)}</p>
  </div>
  <div class="related-note">
    同じ歌唱者・作者・タグ・ジャンル・雰囲気をもとに、<b>あなたのライブラリ内</b>から選びます。
    音を聴いて比較した結果ではありません。
  </div>
  ${content}
  <div class="related-footer">
    <button class="btn subtle" data-detail="${esc(source.id)}">← 元の曲の詳細へ戻る</button>
  </div>`;
}
