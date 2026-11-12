/**
 * Dependency-free trend chart. Values are percentages of all videos within
 * each group. All data is local to the authenticated user's library.
 * The SVG is accessible as a labelled chart; every point also has a title.
 */
import { esc, formatCount } from '../lib.js';
import { compareTrendEndpoints } from '../app/trends.js';
import { colorForFacet } from '../app/character-colors.js';

const percentage = (value) => `${value.toFixed(1)}%`;

export const TREND_CHART_STYLES = Object.freeze({
  matrix: 'ヒートマップを中心に表示',
  line: '上位項目の推移（折れ線）',
  spotlight: '選んだ項目を比較（横棒）',
});

function buildLines(result, highlighted) {
  const { cells } = result;
  const categories = result.categories;
  const width = Math.max(680, 120 + cells.length * 92);
  const height = 294;
  const left = 58;
  const right = width - 28;
  const top = 26;
  const bottom = 216;
  const x = (index) => cells.length === 1 ? (left + right) / 2 : left + (right - left) * index / (cells.length - 1);
  const y = (value) => bottom - (bottom - top) * value / 100;

  const gridLines = [0, 25, 50, 75, 100].map((value) => `
    <line x1="${left}" y1="${y(value)}" x2="${right}" y2="${y(value)}" stroke="#3a4f66" stroke-width="1" stroke-dasharray="3 5" />
    <text x="${left - 10}" y="${y(value) + 4}" text-anchor="end" class="trend-axis-label">${value}%</text>`).join('');

  const series = categories.map((name, seriesIndex) => {
    const color = colorForFacet(name, result.facet, seriesIndex);
    const muted = highlighted && highlighted !== name;
    const coords = cells.map((group, index) => ({
      group, px: x(index), py: y(group.values[name].percent),
    }));
    const path = coords.map(({ px, py }, index) => `${index ? 'L' : 'M'} ${px.toFixed(2)} ${py.toFixed(2)}`).join(' ');
    const circles = coords.map(({ group, px, py }) => `
      <circle cx="${px}" cy="${py}" r="${muted ? 3 : 5}" fill="${color}" stroke="#142239" stroke-width="2">
        <title>${esc(group.label)} ／ ${esc(name)}：${percentage(group.values[name].percent)}（${group.values[name].count}曲 / ${group.total}曲）</title>
      </circle>`).join('');
    return `<g opacity="${muted ? '0.2' : '1'}">
      <path d="${path}" fill="none" stroke="${color}" stroke-width="${muted ? 2 : 3.2}" stroke-linecap="round" stroke-linejoin="round" />${circles}
    </g>`;
  }).join('');

  const labels = cells.map((group, index) => `<text x="${x(index)}" y="${bottom + 23}" class="trend-axis-label" text-anchor="middle"><title>${esc(group.label)}</title>${esc(group.label.length > 12 ? `${group.label.slice(0, 11)}…` : group.label)}</text>`).join('');

  return `<div class="trend-chart-scroll" tabindex="0" aria-label="割合推移グラフ。横方向にスクロールできます">
    <svg class="trend-line-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(categories.join('、'))}のグループ別割合の折れ線グラフ">
      ${gridLines}${series}${labels}
    </svg>
  </div>`;
}

function buildSpotlight(result, focus) {
  const category = result.categories.includes(focus) ? focus : result.categories[0];
  return `<div class="trend-spotlight-active">現在比較中：<strong>${esc(category)}</strong>${focus ? '' : '（未選択のため先頭の項目を表示）'}</div>
  <div class="trend-spotlight-list" aria-label="${esc(category)}の割合の比較">
    ${result.cells.map((group) => {
      const point = group.values[category];
      return `<div class="trend-spotlight-row">
        <span class="trend-spotlight-name" title="${esc(group.label)}">${esc(group.label)}</span>
        <span class="trend-spotlight-track"><span class="trend-spotlight-fill" style="width:${point.percent.toFixed(2)}%;background:${colorForFacet(category, result.facet)}"></span></span>
        <b class="trend-spotlight-number">${percentage(point.percent)} <small>（${point.count}/${group.total}曲）</small></b>
      </div>`;
    }).join('')}
  </div>`;
}

/** Coverage is shown explicitly to avoid overinterpreting weak classifications. */
function buildCoverage(result) {
  return `<div class="trend-coverage-chart">
    <h4>歌唱者・分類情報がある動画の割合 <small>（現在選択中の分析項目）</small></h4>
    ${result.cells.map((group) => {
      const coverage = group.total ? 100 * group.classified / group.total : 0;
      return `<div class="trend-coverage-row"><span>${esc(group.label)}</span>
        <span class="trend-coverage-track"><span style="width:${coverage.toFixed(2)}%"></span></span>
        <b>${percentage(coverage)}</b><small>${group.classified}/${group.total}曲</small></div>`;
    }).join('')}
  </div>`;
}

export function renderTrendChart(result, { style = 'line', focus = '' } = {}) {
  if (!result.categories.length || !result.cells.length) return '';
  const selected = result.categories.includes(focus) ? focus : '';
  const plottedCategories = result.categories;
  const legend = plottedCategories.map((category, index) => `
    <button type="button" class="trend-legend-item ${selected === category ? 'is-active' : ''}"
      data-trend-focus="${esc(category)}" aria-pressed="${selected === category}">
      <span class="trend-legend-color" style="background:${colorForFacet(category, result.facet, index)}"></span>${esc(category)}
    </button>`).join('');
  const changes = compareTrendEndpoints(result).filter((item) => Math.abs(item.delta) >= 0.05);
  const biggestRise = changes.filter((item) => item.delta > 0).sort((a, b) => b.delta - a.delta)[0];
  const biggestFall = changes.filter((item) => item.delta < 0).sort((a, b) => a.delta - b.delta)[0];
  const sentence = (item, sign) => item ? `${item.category} ${sign}${Math.abs(item.delta).toFixed(1)}pt` : '該当なし';

  return `<section class="trend-visualization" aria-label="好みの変遷を視覚化">
    <div class="trend-chart-heading"><div>
      <h3>割合の推移を比較</h3>
      <p>各グループの全動画に対する割合。<strong>${result.categories.length}項目</strong>を表示。凡例はスクロールできます。</p>
    </div><label class="control-label">強調する項目
      <select id="trend-focus-select"><option value="">全項目</option>${result.categories.map((name) =>
        `<option value="${esc(name)}" ${selected === name ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>
    </label><label class="control-label">グラフ形式
      <select id="trend-chart-style"><option value="matrix" ${style === 'matrix' ? 'selected' : ''}>ヒートマップ中心</option>
      <option value="line" ${style === 'line' ? 'selected' : ''}>折れ線</option>
      <option value="spotlight" ${style === 'spotlight' ? 'selected' : ''}>横棒で比較</option></select>
    </label></div>
    ${style !== 'matrix' ? `<div class="trend-legend" aria-label="注目する項目を選択">${legend}
      ${selected ? '<button class="trend-legend-clear" type="button" id="trend-focus-reset">全体を表示</button>' : ''}
    </div>
    ${style === 'spotlight' ? buildSpotlight(result, selected) : buildLines(result, selected)}` : '<p class="trend-notice">下のヒートマップで各項目を比較できます。折れ線・横棒は「グラフ形式」から表示できます。</p>'}
    ${buildCoverage(result)}
    ${result.cells.length >= 2 ? `<div class="trend-observation" aria-label="観察できる変化">
      <span>上昇：<strong>${esc(sentence(biggestRise, '+'))}</strong></span>
      <span>下降：<strong>${esc(sentence(biggestFall, '−'))}</strong></span>
      <small>${esc(result.cells[0].label)} → ${esc(result.cells.at(-1).label)}。各グループの動画数や分類率が異なるため、傾向は参考値です。</small>
    </div>` : ''}
    <p class="trend-notice">※ 投稿年は聴いた時期ではありません。ジャンル・雰囲気は文字情報からの推定で、実際の曲調を保証しません。折れ線の色を選ぶと注目項目を強調できます。</p>
  </section>`;
}
