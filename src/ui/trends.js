import { esc, formatCount } from '../lib.js';
import {
  calculateTrend, compareTrendEndpoints, orderTrendPlaylists,
  TREND_AXES, TREND_FACETS, videosForTrendCell,
} from '../app/trends.js';

const optionHtml = (entries, selected) => entries.map(([value, label]) =>
  `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`
).join('');

/** Read-only trend view; events are handled by the existing app event controller. */
export function renderTrends({ state, rows, cards, hero }) {
  const config = state.trends;
  const trend = calculateTrend(state.library, rows, config);
  const playlists = orderTrendPlaylists(state.library.playlists, config);
  const selectedPlaylist = playlists.find((playlist) => playlist.id === config.playlistId) ?? playlists[0];
  const axisDescriptions = {
    playlist: '各マイリストの登録済み動画を比較します。同じ動画が複数のリストにあれば、それぞれに数えます。',
    position: '選択したリストの現在の表示順を4区間に分割します。保存した日付順ではありません。',
    published: '動画の投稿年による比較です。マイリストへ追加した年や、聴き始めた年ではありません。',
  };
  const selected = config.selected;
  const selectedVideos = selected
    ? videosForTrendCell(trend, selected.group, selected.category)
    : [];
  const activeGroup = trend.groups.find((group) => group.key === selected?.group);
  const endpoints = compareTrendEndpoints(trend);
  const percentage = (value) => `${value.toFixed(1)}%`;

  return `${hero('MUSIC JOURNEY', '音楽の変遷', 'マイリストや投稿年を軸に、歌唱者・ジャンル・雰囲気の傾向を見比べる。')}
    <section class="panel trend-panel">
      <div class="trend-controls" aria-label="変遷分析の条件">
        <label class="control-label">比較の軸<select id="trend-axis">${optionHtml(Object.entries(TREND_AXES), config.axis)}</select></label>
        <label class="control-label">分析項目<select id="trend-facet">${optionHtml(Object.entries(TREND_FACETS), config.facet)}</select></label>
        ${config.axis === 'position' ? `<label class="control-label">対象マイリスト<select id="trend-playlist">${optionHtml(playlists.map((p) => [p.id, p.name]), selectedPlaylist?.id)}</select></label>` : ''}
        ${config.axis !== 'published' ? `<label class="trend-checkbox"><input type="checkbox" id="trend-include-other" ${config.includeOther ? 'checked' : ''}/>番号のないリストも含める</label>` : ''}
      </div>
      <p class="trend-notice">${esc(axisDescriptions[config.axis])} ${config.axis === 'playlist' ? '番号のない「最近のお気に入り」などは、初期状態では比較から除外します。' : ''}</p>
      ${trend.groups.length ? `
        <div class="trend-metrics"><span>比較グループ <b>${trend.cells.length}</b></span><span>項目 <b>${trend.categories.length}</b></span>${config.axis === 'published' ? `<span>投稿日を確認できた動画 <b>${trend.groups.reduce((sum, group) => sum + group.total, 0)}/${rows.length}</b></span>` : ''}<span>分類率は各グループの全動画を分母に計算</span></div>
        <div class="trend-scroll" tabindex="0" aria-label="分析ヒートマップ（横スクロール可能）">
          <table class="trend-matrix" style="min-width:${Math.max(600, 205 + trend.cells.length * 135)}px">
            <thead><tr><th scope="col">${esc(TREND_FACETS[config.facet])}</th>
              ${trend.cells.map((group) => `<th scope="col" title="${esc(group.label)}"><span>${esc(group.label)}</span><small>${formatCount(group.total)}曲</small></th>`).join('')}
            </tr></thead>
            <tbody>${trend.categories.map((category) => `<tr><th scope="row" title="${esc(category)}">${esc(category)}</th>
              ${trend.cells.map((group) => {
                const { count, percent } = group.values[category];
                const active = selected?.group === group.key && selected.category === category;
                return `<td><button type="button" class="trend-cell ${active ? 'is-selected' : ''}" data-trend-group="${esc(group.key)}" data-trend-category="${esc(category)}" ${count ? '' : 'disabled'}
                  aria-label="${esc(group.label)}の${esc(category)}：${count}曲、${percentage(percent)}">
                  <span class="trend-cell-fill" style="width:${Math.min(100, percent).toFixed(2)}%"></span>
                  <span class="trend-cell-text">${percentage(percent)} <small>(${count})</small></span></button></td>`;
              }).join('')}</tr>`).join('')}
              <tr class="trend-coverage"><th scope="row">判定情報がある動画</th>${trend.cells.map((group) => `<td>${group.total ? percentage(100 * group.classified / group.total) : '—'} <small>(${group.classified}/${group.total})</small></td>`).join('')}</tr>
            </tbody>
          </table>
        </div>
        <p class="trend-notice">色付きのセルを押すと該当動画を表示します。1曲に複数の歌唱者・タグがある場合、複数項目に計上されるため、割合の合計は100%にならないことがあります。${['genre', 'mood'].includes(config.facet) ? '分類は保存済みタグからの推定であり、音声解析ではありません。' : ''}</p>
        ${endpoints.length ? `<div class="trend-differences"><h3>最初と最後のグループの差 <small>（パーセントポイント）</small></h3>
          <div class="trend-delta-list">${endpoints.slice(0, 5).map((item) => `<div><span>${esc(item.category)}</span><b class="${item.delta > 0 ? 'positive' : item.delta < 0 ? 'negative' : ''}">${item.delta > 0 ? '+' : ''}${item.delta.toFixed(1)} pt</b></div>`).join('')}</div>
          <p class="trend-notice">${esc(trend.cells[0].label)} → ${esc(trend.cells.at(-1).label)}。母数や未分類の割合に影響されるため、好みの変化を断定する数字ではありません。</p>
        </div>` : ''}
      ` : '<div class="empty-sm">比較に使える動画やマイリストがありません。</div>'}
    </section>
    ${selected && activeGroup ? `<section class="panel trend-selected">
      <div class="panel-title"><div><span class="section-eyebrow">SELECTED MUSIC</span><h2>${esc(activeGroup.label)} × ${esc(selected.category)}（${selectedVideos.length}曲）</h2></div><button class="btn subtle" id="trend-clear">選択解除</button></div>
      ${selectedVideos.length ? cards(selectedVideos.slice(0, 20)) : '<div class="empty-sm">該当する動画はありません</div>'}
      ${selectedVideos.length > 20 ? `<p class="trend-notice">先頭20曲を表示しています（全${selectedVideos.length}曲）。</p>` : ''}
    </section>` : ''}
    <section class="panel trend-help"><span class="section-eyebrow">HOW TO READ</span><h2>データの読み方</h2>
      <p>「マイリスト別」はリスト間の構成比、「リスト内の表示順」は取得した並び順の区間、「動画の投稿年別」は作品が公開された年の比較です。どれも<strong>ユーザーが実際に曲を聴いた日時</strong>を示しません。</p>
    </section>`;
}
