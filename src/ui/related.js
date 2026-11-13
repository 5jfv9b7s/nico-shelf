/**
 * Related-song discovery UI. All user-supplied metadata is escaped.
 * Mode selection is ephemeral: it never modifies the database or presets.
 */
import { esc } from '../lib.js';
import { buildLibraryRows } from '../app/library.js';
import { RELATED_MODES, recommendRelatedVideos } from '../app/related-videos.js';
import { safeThumb } from './media.js';

const MODE_EXPLANATIONS = {
  balanced: '歌唱者・作者・ジャンル・雰囲気・タグを総合して探します。',
  musical: 'ジャンル・雰囲気・共通タグを優先します。歌声だけの一致では推薦しません。',
  explore: '同じ作者・投稿者と判明している候補を除き、別の作品との出会いを優先します。',
};

function renderRecommendation({ video, reasons }) {
  const thumbnail = safeThumb(video.thumb);
  const image = thumbnail
    ? `<img class="related-thumb" alt="" src="${esc(thumbnail)}" loading="lazy" referrerpolicy="no-referrer" />`
    : '<div class="related-thumb related-placeholder">♫</div>';
  const badges = reasons
    .map((reason) => `<span class="related-reason">${esc(reason)}</span>`)
    .join('');

  return `<article class="related-item">
    ${image}
    <div class="related-body">
      <button class="related-title" data-detail="${esc(video.id)}">${esc(video.title || video.id)}</button>
      <small>${esc(video.uploader || video.id)}</small>
      <div class="related-reasons" aria-label="関連づけた理由">${badges}</div>
      <a class="link-text" href="https://www.nicovideo.jp/watch/${encodeURIComponent(video.id)}"
         target="_blank" rel="noopener noreferrer">ニコニコで見る ↗</a>
    </div>
  </article>`;
}

export function renderRelatedDialog(library, sourceId, options = {}) {
  const videos = buildLibraryRows(library);
  const source = videos.find((video) => video.id === sourceId);
  if (!source) return '';

  const mode = Object.hasOwn(RELATED_MODES, options.mode) ? options.mode : 'balanced';
  const unratedOnly = options.unratedOnly === true;
  const recommendations = recommendRelatedVideos(source, videos, { mode, unratedOnly, limit: 10 });
  const content = recommendations.length
    ? `<div class="related-list">${recommendations.map(renderRecommendation).join('')}</div>`
    : '<div class="empty-sm">この条件で共通点が見つかりませんでした。条件を変えるか、動画メタデータを補完してみてください。</div>';

  return `<div class="modal-head">
    <div class="eyebrow">DISCOVER / RELATED VIDEOS</div>
    <h2>この曲に近い曲を探す</h2>
    <p>起点：${esc(source.title || source.id)}</p>
  </div>
  <div class="related-note">
    <b>あなたのライブラリの中</b>から、登録済みのタグ・歌唱者・作者などを使って比較します。
    実際の音を聴いて似ていると判定したわけではありません。
  </div>
  <div class="related-controls">
    <label class="field-label" for="related-mode">探し方
      <select id="related-mode">
        ${Object.entries(RELATED_MODES)
          .map(
            ([value, label]) =>
              `<option value="${value}" ${value === mode ? 'selected' : ''}>${esc(label)}</option>`,
          )
          .join('')}
      </select>
    </label>
    <label class="check-field related-unrated">
      <input id="related-unrated" type="checkbox" ${unratedOnly ? 'checked' : ''} /> 未評価の曲だけ
    </label>
  </div>
  <p class="related-mode-note">${esc(MODE_EXPLANATIONS[mode])}</p>
  ${mode === 'explore' ? '<p class="related-mode-caveat">※作者・投稿者情報が欠けている曲は、別の作り手と断定できません。</p>' : ''}
  <p class="related-count" aria-live="polite">候補：${recommendations.length}曲（最大10曲）</p>
  ${content}
  <div class="related-footer">
    <button class="btn subtle" data-detail="${esc(source.id)}">← 元の曲の詳細へ戻る</button>
  </div>`;
}
