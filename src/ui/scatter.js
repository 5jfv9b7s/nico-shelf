/** Accessible, dependency-free SVG scatter plot with a per-video drill-down. */
import { esc, formatCount } from '../lib.js';
import { voiceStats } from '../discovery.js';
import { colorForCharacter, hasCharacterColor, UNCLASSIFIED_COLOR } from '../app/character-colors.js';
import {
  createScatterData, readableMetric, scatterTicks, SCATTER_METRICS,
} from '../app/scatter.js';

const SVG_SIZE = { width: 920, height: 510, left: 100, right: 888, top: 28, bottom: 442 };

function axisExtent(values) {
  const minimum = values.reduce((low, value) => Math.min(low, value), Infinity);
  const maximum = values.reduce((high, value) => Math.max(high, value), -Infinity);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return [0, 1];
  if (minimum === maximum) return [minimum - 0.5, maximum + 0.5];
  const pad = (maximum - minimum) * 0.045;
  return [minimum - pad, maximum + pad];
}

function axisSvg(result, key, scale, low, high) {
  const vertical = key === 'y';
  const metric = result[vertical ? 'y' : 'x'];
  const chart = SVG_SIZE;
  const ticks = scatterTicks(low, high, metric, 5);
  const inverse = SCATTER_METRICS[metric].logarithmic
    ? (plotValue) => Math.max(0, 10 ** plotValue - 1)
    : (plotValue) => plotValue;
  return ticks.map((tick) => {
    const coordinate = scale(tick);
    if (vertical) {
      return `<line x1="${chart.left}" y1="${coordinate}" x2="${chart.right}" y2="${coordinate}" class="scatter-grid-line" />
        <text x="${chart.left - 12}" y="${coordinate + 4}" text-anchor="end" class="scatter-axis-label">${esc(readableMetric(inverse(tick), metric))}</text>`;
    }
    return `<line x1="${coordinate}" y1="${chart.top}" x2="${coordinate}" y2="${chart.bottom}" class="scatter-grid-line" />
      <text x="${coordinate}" y="${chart.bottom + 24}" text-anchor="middle" class="scatter-axis-label">${esc(readableMetric(inverse(tick), metric))}</text>`;
  }).join('');
}

function pointJitter(id, salt) {
  // Small deterministic offset makes identical data points easier to spot.
  let hash = salt;
  for (const character of String(id)) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  return (hash % 101 - 50) / 28;
}

function renderPoints(result) {
  const plot = SVG_SIZE;
  const xBounds = axisExtent(result.points.map((point) => point.xPlot));
  const yBounds = axisExtent(result.points.map((point) => point.yPlot));
  const xScale = (value) => plot.left + (value - xBounds[0]) / (xBounds[1] - xBounds[0]) * (plot.right - plot.left);
  const yScale = (value) => plot.bottom - (value - yBounds[0]) / (yBounds[1] - yBounds[0]) * (plot.bottom - plot.top);

  const points = result.points.map((point) => {
    const color = point.colorVoice ? colorForCharacter(point.colorVoice) : UNCLASSIFIED_COLOR;
    const title = `${point.video.title || point.id}\n${point.voices.join(' / ') || '歌唱者不明'}\n` +
      `${SCATTER_METRICS[result.x].label}: ${readableMetric(point.xValue, result.x)}\n` +
      `${SCATTER_METRICS[result.y].label}: ${readableMetric(point.yValue, result.y)}`;
    const outlined = point.voices.length > 1;
    return `<circle data-scatter-video="${esc(point.id)}" tabindex="0" role="button"
      aria-label="${esc(title.replaceAll('\n', '、'))}（詳細を表示）"
      cx="${(xScale(point.xPlot) + pointJitter(point.id, 17)).toFixed(2)}" cy="${(yScale(point.yPlot) + pointJitter(point.id, 47)).toFixed(2)}"
      r="${outlined ? 4.6 : 3.5}" fill="${color}" fill-opacity="0.73"
      stroke="${outlined ? '#EAF6FF' : '#0D182A'}" stroke-width="${outlined ? 1.25 : 0.55}">
      <title>${esc(title)}</title></circle>`;
  }).join('');

  return `<div class="scatter-chart-scroll" tabindex="0" aria-label="散布図。横方向にスクロールできます">
    <svg class="scatter-svg" viewBox="0 0 ${plot.width} ${plot.height}" role="group" aria-label="${esc(SCATTER_METRICS[result.x].label)}と${esc(SCATTER_METRICS[result.y].label)}の散布図。点を選ぶと動画詳細を開きます">
      ${axisSvg(result, 'y', yScale, ...yBounds)}
      ${axisSvg(result, 'x', xScale, ...xBounds)}
      <line x1="${plot.left}" y1="${plot.bottom}" x2="${plot.right}" y2="${plot.bottom}" class="scatter-axis-line" />
      <line x1="${plot.left}" y1="${plot.top}" x2="${plot.left}" y2="${plot.bottom}" class="scatter-axis-line" />
      <text x="${(plot.left + plot.right) / 2}" y="${plot.height - 9}" text-anchor="middle" class="scatter-axis-title">${esc(SCATTER_METRICS[result.x].label)}${SCATTER_METRICS[result.x].logarithmic ? '（対数目盛）' : ''}</text>
      <text transform="translate(22,${(plot.top + plot.bottom) / 2}) rotate(-90)" text-anchor="middle" class="scatter-axis-title">${esc(SCATTER_METRICS[result.y].label)}${SCATTER_METRICS[result.y].logarithmic ? '（対数目盛）' : ''}</text>
      ${points}
    </svg>
  </div>`;
}

function metricOptions(value) {
  return Object.entries(SCATTER_METRICS).map(([key, metric]) =>
    `<option value="${esc(key)}" ${key === value ? 'selected' : ''}>${esc(metric.label)}</option>`).join('');
}

/** The plot uses the signed-in user's already-loaded metadata; no API calls. */
export function renderScatter({ state, rows, hero }) {
  const { x, y, voice } = state.scatter;
  const legendLimit = state.scatter.legendLimit ?? 30;
  const result = createScatterData(rows, { x, y, voice });
  const voices = voiceStats(rows, 'canonical', 100).map(([name]) => name);
  const correlation = result.correlation === null ? '算出不可' : result.correlation.toFixed(2);
  const uniqueMissing = result.eligible - result.points.length;
  // Include duet partners in the legend, even when the point is coloured by
  // the first singer. Clicking a partner filters and recolours matching points.
  const singerFrequency = new Map();
  for (const point of result.points) {
    for (const singer of new Set(point.voices.length ? point.voices : [''])) {
      singerFrequency.set(singer, (singerFrequency.get(singer) || 0) + 1);
    }
  }
  const legendNames = [...singerFrequency].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  return `${hero('DATA EXPLORER', '楽曲の散布図', '保存している動画情報から、再生数・反応・動画時間・投稿時期の関係を眺める。')}
    <section class="panel scatter-panel">
      <div class="scatter-controls" aria-label="散布図の表示条件">
        <label class="control-label">横軸（X）<select id="scatter-x">${metricOptions(x)}</select></label>
        <label class="control-label">縦軸（Y）<select id="scatter-y">${metricOptions(y)}</select></label>
        <label class="control-label">歌唱キャラクターで絞る<select id="scatter-voice"><option value="">すべての曲</option>${voices.map((name) => `<option value="${esc(name)}" ${voice === name ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label>
        <button id="scatter-reset" class="btn subtle" type="button">表示条件をリセット</button>
      </div>
      <div class="scatter-metrics">
        <span>描画できた動画：<strong>${formatCount(result.points.length)}</strong> / ${formatCount(result.eligible)}曲</span>
        <span>情報不足で非表示：<strong>${formatCount(Math.max(0, uniqueMissing))}</strong>曲</span>
        <span>順位相関 ρ：<strong>${correlation}</strong></span>
      </div>
      ${result.points.length ? renderPoints(result) : '<div class="empty-sm">選択した軸の動画情報が不足しています。別の軸を選択するか、メタデータを補完してください。</div>'}
      <div class="scatter-legend"><div class="scatter-legend-header"><span class="scatter-legend-title">歌唱キャラクター（凡例を押すと絞り込み。デュエットの相手も掲載）</span>
        <label class="control-label compact">凡例の表示数<select id="scatter-legend-limit">${[[15,'上位15'],[30,'上位30'],['all','全員']].map(([n,label]) =>
          `<option value="${n}" ${legendLimit===n?'selected':''}>${label}</option>`).join('')}</select></label></div>
        <div class="scatter-legend-items">${legendNames.slice(0, legendLimit === 'all' ? undefined : legendLimit).map((name) =>
          name ? `<button type="button" class="scatter-legend-entry ${voice === name ? 'is-active' : ''}" data-scatter-voice="${esc(name)}" title="${hasCharacterColor(name) ? '設定色（公式HEX値とは限りません）' : '名前から割り当てた自動色'}"><i style="background:${colorForCharacter(name)}"></i>${esc(name)}</button>`
            : `<span class="scatter-legend-entry"><i style="background:${UNCLASSIFIED_COLOR}"></i>歌唱者不明</span>`).join('')}</div>
        ${legendNames.length > (legendLimit === 'all' ? Infinity : legendLimit) ? `<small>ほか${legendNames.length - legendLimit}種類。全員表示に切り替えられます。</small>` : ''}
      </div>
      <p class="trend-notice">点にカーソルを重ねると動画名と数値を表示し、クリックすると詳細を開きます。複数歌唱者の曲は白い輪郭で表示し、色は先頭の歌唱者を採用します。設定色のない歌唱者には名前に基づく安定した自動色を使います（公式カラーではありません）。再生数・コメント数・いいね数は0も扱える対数目盛を使用。順位相関は2つの数値の傾向を示すだけで、因果関係や曲の好みを証明しません。投稿時期は聴取した時期ではありません。</p>
    </section>`;
}
