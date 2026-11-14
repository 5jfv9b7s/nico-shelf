import { csvCell } from '../csv-export.js';
import { metricLabel, ANALYSIS_METHODS } from './data.js';

export function analysisCsv(result) {
  const label = (key) => metricLabel(key, result.options.logCounts);
  const lines = [
    ['分析', ANALYSIS_METHODS[result.method]],
    ['対象曲数', result.n],
    ['マイリストID', result.options.playlist || 'すべて'],
    ['歌唱者', result.options.voice || 'すべて'],
    ['欠損除外', result.missing ?? 'ペアごと'],
    ['件数の対数変換', result.options.logCounts ? 'ln(1+x)' : 'なし'],
  ];
  if (result.method === 'correlation') {
    lines.push(
      ['相関方式', result.ranked ? 'Spearman' : 'Pearson'],
      ['項目1', '項目2', '相関係数', '有効曲数'],
    );
    result.keys.forEach((key, i) =>
      result.keys.forEach((other, j) => {
        if (j >= i)
          lines.push([label(key), label(other), result.cells[i][j].r, result.cells[i][j].n]);
      }),
    );
  } else if (result.method === 'regression' || result.method === 'multiple') {
    lines.push(
      ['目的変数', label(result.target)],
      ['R²（使用曲への当てはまり）', result.r2],
      ['調整済みR²', result.adjustedR2],
      ['RMSE（分析尺度）', result.rmse],
      ['項目', '係数', '標準誤差', '標準化係数', 'VIF'],
    );
    result.coefficients.forEach((c, i) =>
      lines.push([i ? label(result.keys[i - 1]) : '切片', c.value, c.se, c.beta, c.vif]),
    );
    lines.push([], ['動画ID', 'タイトル', '実測（分析尺度）', '当てはめ値（分析尺度）', '残差']);
    result.points.forEach((p) => lines.push([p.id, p.title, p.y, p.fitted, p.residual]));
  } else if (result.method === 'pca') {
    lines.push(['主成分', '固有値', '寄与率']);
    result.explained.forEach((v, i) => lines.push(['PC' + (i + 1), result.eigenvalues[i], v]));
    lines.push([], ['項目', 'PC1重み', 'PC2重み', 'PC1負荷量', 'PC2負荷量']);
    result.keys.forEach((key, j) =>
      lines.push([
        label(key),
        result.vectors[0][j],
        result.vectors[1][j],
        ...result.loadings[j].slice(0, 2),
      ]),
    );
    lines.push([], ['動画ID', 'タイトル', 'PC1得点', 'PC2得点']);
    result.points.forEach((p) => lines.push([p.id, p.title, p.x, p.y]));
  } else if (result.method === 'rules') {
    lines.push(
      ['分類根拠のある曲数', result.classified],
      ['省略項目数', result.omittedItems],
      ['表示ルール数（上位50）', result.rules.length],
      ['条件A', '条件B', '共起曲数', '支持度', '確信度', 'リフト'],
    );
    result.rules.forEach((r) =>
      lines.push([r.from, r.to, r.count, r.support, r.confidence, r.lift]),
    );
  } else {
    lines.push(
      ['方法', result.clusterMethod],
      ['完全データ曲数', result.complete],
      ['標本外', result.sampled],
      ['動画ID', 'タイトル', 'グループ', '表示用PC1', '表示用PC2'],
    );
    result.points.forEach((p) => lines.push([p.id, p.title, p.group + 1, p.x, p.y]));
    lines.push([], ['グループ', '曲数', '項目', '標準化平均']);
    result.groups.forEach((g) =>
      g.profile.forEach((p) => lines.push([g.group + 1, g.count, label(p.key), p.z])),
    );
  }
  // Trusted numeric outputs stay numeric; untrusted text keeps formula protection.
  return (
    '\uFEFF' +
    lines
      .map((line) =>
        line
          .map((v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : csvCell(v)))
          .join(','),
      )
      .join('\r\n') +
    '\r\n'
  );
}
