import { esc } from '../lib.js';

export const GROUP_COLORS = [
  '#53d7c3',
  '#96b6ff',
  '#d9a0f5',
  '#f4c779',
  '#ef98a4',
  '#88d99a',
  '#99d9ee',
  '#c7b99b',
];
export function number(value, digits = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value !== 0 && Math.abs(value) < 0.0001
    ? value.toExponential(2)
    : value.toLocaleString('ja-JP', { maximumFractionDigits: digits });
}
export const percent = (value) => number(value * 100, 1) + '%';

export function niceAxis(values) {
  let low = Math.min(...values),
    high = Math.max(...values);
  const span = high - low || Math.max(1, Math.abs(high) * 0.1);
  low -= span * 0.06;
  high += span * 0.06;
  const rough = (high - low) / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].find((v) => v * power >= rough) * power;
  low = Math.floor(low / step) * step;
  high = Math.ceil(high / step) * step;
  const ticks = Array.from({ length: Math.round((high - low) / step) + 1 }, (_, i) => {
    const value = low + i * step;
    return Math.abs(value) < step * 1e-10 ? 0 : Number(value.toPrecision(12));
  });
  return { low, high, ticks, digits: Math.max(0, 1 - Math.floor(Math.log10(step))) };
}

export function pointChart(points, { xLabel, yLabel, line, selectedGroup = null, summary } = {}) {
  if (!points.length) return '<p class="empty-sm">表示できる曲がありません。</p>';
  const w = 720,
    h = 390,
    left = 80,
    right = 695,
    top = 25,
    bottom = 325;
  const xb = niceAxis(points.map((p) => p.x)),
    yb = niceAxis(points.map((p) => p.y));
  const chartSummary =
    summary ||
    points.length +
      '曲。横軸は' +
      xLabel +
      '、値は' +
      number(Math.min(...points.map((p) => p.x))) +
      'から' +
      number(Math.max(...points.map((p) => p.x))) +
      '。縦軸は' +
      yLabel +
      '、値は' +
      number(Math.min(...points.map((p) => p.y))) +
      'から' +
      number(Math.max(...points.map((p) => p.y))) +
      '。';
  const sx = (x) => left + ((x - xb.low) / (xb.high - xb.low)) * (right - left);
  const sy = (y) => bottom - ((y - yb.low) / (yb.high - yb.low)) * (bottom - top);
  const ticks =
    xb.ticks
      .map(
        (x) =>
          '<text x="' +
          sx(x) +
          '" y="348" text-anchor="middle">' +
          number(x, xb.digits) +
          '</text>',
      )
      .join('') +
    yb.ticks
      .map(
        (y) =>
          '<line x1="' +
          left +
          '" x2="' +
          right +
          '" y1="' +
          sy(y) +
          '" y2="' +
          sy(y) +
          '" class="analysis-gridline"/>' +
          '<text x="69" y="' +
          (sy(y) + 4) +
          '" text-anchor="end">' +
          number(y, yb.digits) +
          '</text>',
      )
      .join('');
  let path = '';
  if (line) {
    // Clip the model segment to the observed chart bounds before drawing.
    const [b0, b1] = line;
    let low = xb.low,
      high = xb.high;
    if (b1 !== 0) {
      const cuts = [(yb.low - b0) / b1, (yb.high - b0) / b1].sort((a, b) => a - b);
      low = Math.max(low, cuts[0]);
      high = Math.min(high, cuts[1]);
    }
    if (low <= high && b0 + b1 * low >= yb.low && b0 + b1 * low <= yb.high)
      path =
        '<line x1="' +
        sx(low) +
        '" y1="' +
        sy(b0 + b1 * low) +
        '" x2="' +
        sx(high) +
        '" y2="' +
        sy(b0 + b1 * high) +
        '" class="analysis-fit"/>';
  }
  const dots = points
    .map((p) => {
      const color = GROUP_COLORS[p.group ?? 0];
      const title =
        p.title +
        ' / ' +
        xLabel +
        ': ' +
        number(p.x) +
        ' / ' +
        yLabel +
        ': ' +
        number(p.y) +
        (p.group !== undefined ? ' / グループ' + (p.group + 1) : '');
      return (
        '<circle cx="' +
        sx(p.x) +
        '" cy="' +
        sy(p.y) +
        '" r="4" fill="' +
        color +
        '" fill-opacity="' +
        (selectedGroup === null || selectedGroup === p.group ? '0.78' : '0.12') +
        '" data-scatter-video="' +
        esc(p.id) +
        '" tabindex="0" role="button" aria-label="' +
        esc(title + '。曲の詳細を開く') +
        '"><title>' +
        esc(title) +
        '</title></circle>'
      );
    })
    .join('');
  return (
    '<figure class="analysis-chart"><div class="analysis-plot-scroll" tabindex="0" aria-label="グラフを横にスクロールできます"><svg class="analysis-plot" viewBox="0 0 ' +
    w +
    ' ' +
    h +
    '" role="group" aria-label="' +
    esc(xLabel + 'と' + yLabel + 'の散布図。' + chartSummary) +
    '">' +
    '<desc>' +
    esc('各点は1曲です。Tabで点を選び、EnterまたはSpaceで曲の詳細を開けます。' + chartSummary) +
    '</desc>' +
    ticks +
    '<path d="M80 25V325H695" class="analysis-axis"/>' +
    path +
    dots +
    '<text x="387" y="380" text-anchor="middle">' +
    esc(xLabel) +
    '</text>' +
    '<text transform="translate(17,175) rotate(-90)" text-anchor="middle">' +
    esc(yLabel) +
    '</text></svg></div><figcaption class="analysis-chart-summary">' +
    esc(chartSummary) +
    '</figcaption></figure>'
  );
}

/** Draw only the branches above the chosen cut; each leaf is a collapsed group. */
export function dendrogram(tree) {
  const leaves = [];
  function collect(node) {
    if (node.group !== undefined) leaves.push(node);
    else {
      collect(node.left);
      collect(node.right);
    }
  }
  collect(tree);
  const treeSummary =
    leaves.length +
    '群を平均連結法で統合した樹形図。群内の枝は省略。' +
    leaves.map((leaf) => '群' + (leaf.group + 1) + 'は' + leaf.size + '曲').join('、') +
    '。最終統合距離は' +
    number(tree.height) +
    '。';
  const width = Math.max(640, leaves.length * 95),
    height = 280,
    base = 220;
  const max = tree.height || 1;
  const positions = new Map(
    leaves.map((leaf, i) => [
      leaf.group,
      55 + (i * (width - 110)) / Math.max(1, leaves.length - 1),
    ]),
  );
  const parts = [];
  function draw(node) {
    if (node.group !== undefined) {
      const x = positions.get(node.group);
      parts.push(
        '<text x="' +
          x +
          '" y="244" text-anchor="middle">群' +
          (node.group + 1) +
          '（' +
          node.size +
          '曲）</text>',
      );
      return { x, y: base };
    }
    const a = draw(node.left),
      b = draw(node.right),
      y = base - (node.height / max) * 190;
    parts.push(
      '<path d="M' +
        a.x +
        ' ' +
        a.y +
        'V' +
        y +
        'H' +
        b.x +
        'V' +
        b.y +
        '" class="analysis-tree-branch"/>' +
        '<text x="' +
        (a.x + b.x) / 2 +
        '" y="' +
        (y - 6) +
        '" text-anchor="middle">' +
        number(node.height, 2) +
        '</text>',
    );
    return { x: (a.x + b.x) / 2, y };
  }
  draw(tree);
  return (
    '<div class="analysis-plot-scroll" tabindex="0" aria-label="樹形図を横にスクロールできます"><svg class="analysis-tree" viewBox="0 0 ' +
    width +
    ' ' +
    height +
    '" role="img" aria-label="' +
    esc(treeSummary) +
    '"><desc>' +
    esc(treeSummary) +
    '</desc>' +
    parts.join('') +
    '</svg></div>'
  );
}
