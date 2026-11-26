import { csvCell } from '../csv-export.js';
import { metricLabel, ANALYSIS_METHODS } from './data.js';

export function analysisCsv(result) {
  const label = (key) => metricLabel(key, result.options.logCounts);
  const lines = [
    ['分析', ANALYSIS_METHODS[result.method]],
    ['対象曲数', result.n],
    [
      'マイリストID',
      result.options.playlists?.length
        ? result.options.playlists.join(' / ')
        : result.options.playlist || 'すべて',
    ],
    ['歌唱者', result.options.voice || 'すべて'],
    [
      '欠損除外',
      result.method === 'rules'
        ? '曲は残す・欠損属性には項目を作らない'
        : (result.missing ?? 'ペアごと'),
    ],
    [
      '件数の対数変換',
      result.method === 'tree'
        ? 'なし（元の数値）'
        : result.method === 'rules'
          ? 'なし（元の数値を区間化）'
          : result.options.logCounts
            ? 'ln(1+x)'
            : 'なし',
    ],
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
      ['残差自由度', result.df],
      ['95%区間のt臨界値', result.critical95],
      ['項目', '係数', '標準誤差', '95%区間 下限', '95%区間 上限', '標準化係数', 'VIF'],
    );
    result.coefficients.forEach((c, i) =>
      lines.push([
        i ? label(result.keys[i - 1]) : '切片',
        c.value,
        c.se,
        c.ciLow,
        c.ciHigh,
        c.beta,
        c.vif,
      ]),
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
  } else if (result.method === 'tree') {
    lines.push(
      ['分類対象', result.target.label],
      ['分類対象の種類', result.target.kind],
      ['分類対象マイリストID', result.target.playlistId],
      ['対象', result.positive],
      ['対象外', result.negative],
      ['分岐基準', result.options.treeCriterion],
      ['最大深さ', result.options.treeDepth],
      ['最小葉件数', result.options.treeMinLeaf],
      ['枝刈りα', result.options.treeAlpha],
      ['評価', '各曲を学習から外して1回ずつ予測する層化交差検証'],
      ['分割数', result.folds],
      ['補完と分類項目の選択', '各分割の学習用データだけで決定'],
      ['数値の欠損', '学習用の中央値で補完'],
      ['分類項目の上限', '学習用で3回以上観測した頻度上位40個'],
      ['対象を直接定義するため除外した項目', result.blocked.join(' / ')],
      ['全曲の木で欠損のみ・一定値のため除外した項目', result.dropped.join(' / ')],
      ...result.warnings.map((w) => ['注意', w]),
      ['指標', '交差検証', '学習用の多数派による基準'],
      ...['accuracy', 'balancedAccuracy', 'precision', 'recall', 'specificity', 'f1'].map((key) => [
        key,
        result.metrics[key],
        result.baseline[key],
      ]),
      [],
      ['混同行列', '予測：対象', '予測：対象外'],
      ['実際：対象', result.metrics.tp, result.metrics.fn],
      ['実際：対象外', result.metrics.fp, result.metrics.tn],
      [],
      ['分割', '学習曲数', '評価曲数', '説明項目数', '正解率', '対象の再現率'],
      ...result.foldResults.map((f) => [
        f.fold,
        f.trainN,
        f.testN,
        f.features,
        f.metrics.accuracy,
        f.metrics.recall,
      ]),
      [],
      [
        '動画ID',
        'タイトル',
        '実際の分類（1=対象）',
        '交差検証の予測',
        '評価用の分割',
        '交差検証の葉内対象割合',
        '多数派による予測',
      ],
      ...result.predictions.map((p) => [
        p.id,
        p.title,
        p.actual,
        p.predicted,
        p.fold,
        p.score,
        p.baseline,
      ]),
      [],
      ['全曲で作った説明用の木（上の評価とは別）'],
      [
        'ノードID',
        '深さ',
        '曲数',
        '対象',
        '対象外',
        '予測',
        '葉内対象割合',
        '分岐項目',
        '境界（以下が左）',
        '左ノード',
        '右ノード',
        '動画ID（JSON）',
      ],
      ...result.nodes.map((node) => [
        node.id,
        node.depth,
        node.n,
        node.positive,
        node.negative,
        node.prediction,
        node.score,
        node.label || '葉',
        node.threshold ?? '',
        node.left?.id ?? '',
        node.right?.id ?? '',
        JSON.stringify(node.ids),
      ]),
      [],
      ['全曲の木の説明項目', '種類', '単位', '補完の中央値'],
      ...result.features.map((f) => [f.label, f.type, f.unit || '', f.median ?? '']),
    );
  } else if (result.method === 'rules') {
    lines.push(
      ['方式', result.mode === 'apriori' ? 'Apriori' : '簡易分析'],
      ['分類根拠のある曲数', result.classified],
      ['省略項目数', result.omittedItems],
      ['使用属性', result.dataset.fields.join(' / ')],
      ['最大項目集合サイズ（左右の合計）', result.maximum],
      ['探索完了サイズ', result.completeSize],
      ['探索状態', result.partial ? '上限到達・部分結果' : '完了'],
      ...result.warnings.map((w) => ['注意', w]),
      ['最低共起曲数', result.minCount],
      ['最低支持度', result.options.support],
      ['最低確信度', result.options.confidence],
      ['最低リフト', result.minLift],
      ['リフトの比較', result.mode === 'apriori' ? '以上' : '超'],
      ['結論部に含む属性', result.options.ruleConsequentField || '指定なし'],
      ['結論部に含む項目キー', result.options.ruleConsequentItem || '指定なし'],
      ['再生数の区切り', result.dataset.bins.views.join(',')],
      ['投稿年の区切り', result.dataset.bins.published.join(',')],
      ['動画時間の区切り（秒）', result.dataset.bins.duration.join(',')],
      ['該当ルール数（生成済みの範囲）', result.totalRules],
      ['表示上限', result.limit],
      ['表示ルール数', result.rules.length],
      [
        'ルールの並べ順',
        result.sort === 'lift'
          ? 'リフトが高い順'
          : result.sort === 'confidence'
            ? '確信度が高い順'
            : '共起曲数が多い順',
      ],
      [
        '条件A',
        '結論B',
        '共起曲数',
        '支持度',
        '確信度',
        'リフト',
        '条件Aの曲数',
        '結論Bの曲数',
        '条件Aの項目（JSON）',
        '結論Bの項目（JSON）',
        '該当動画ID（JSON）',
      ],
    );
    result.rules.forEach((r) =>
      lines.push([
        r.from,
        r.to,
        r.count,
        r.support,
        r.confidence,
        r.lift,
        r.fromCount,
        r.toCount,
        JSON.stringify(r.fromItems),
        JSON.stringify(r.toItems),
        JSON.stringify(r.ids),
      ]),
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
    lines.push(
      [],
      ['k比較の対象曲数', result.n],
      ['シルエットの評価曲数', result.silhouetteN],
      ['k', '群内平方和', 'シルエット係数', '最小群', '最大群', '収束'],
    );
    result.comparison.forEach((row) =>
      lines.push([
        row.k,
        row.inertia,
        row.silhouette,
        row.minSize,
        row.maxSize,
        row.converged === null ? '対象外' : row.converged ? 'はい' : 'いいえ',
      ]),
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

function ruleDataset(result) {
  if (result.method !== 'rules' || !result.dataset)
    throw new Error('先に相関ルールを分析してください');
  return result.dataset;
}

function sourceLabels(dataset) {
  const labels = dataset.items.map((item) => item.label);
  // ARFF requires distinct attribute names, even for adversarial playlist names.
  return new Set(labels).size === labels.length
    ? labels
    : labels.map((label, i) => 'item' + (i + 1) + ' ' + label);
}

/** Observed presence only. A CSV 0 means no observed item, including missing metadata. */
export function ruleSourceCsv(result) {
  const dataset = ruleDataset(result);
  const lines = [['動画ID', 'タイトル', ...sourceLabels(dataset)]];
  for (const transaction of dataset.transactions) {
    const present = new Set(transaction.items);
    lines.push([
      transaction.id,
      transaction.title,
      ...dataset.items.map((_, i) => (present.has(i) ? 1 : 0)),
    ]);
  }
  return (
    '\uFEFF' +
    lines
      .map((line) =>
        line.map((value) => (typeof value === 'number' ? String(value) : csvCell(value))).join(','),
      )
      .join('\r\n') +
    '\r\n'
  );
}

const arffQuote = (value) =>
  "'" +
  String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t') +
  "'";
/** Single-valued nominal attributes prevent absent items from becoming Weka rules. */
export function ruleSourceArff(result) {
  const dataset = ruleDataset(result);
  if (!dataset.items.length)
    throw new Error('出力できる頻出項目がありません。最低支持度や共起曲数を下げてください');
  const lines = [
    '% NICO SHELF association source; UTF-8; one row per eligible unique video.',
    '% present = observed presence; ? = absent OR metadata missing (never a negative item).',
    '% Same top-80 frequent items and all transactions as the browser analysis.',
    '% Weka Apriori: treatZeroAsMissing=false (present is nominal index 0).',
    '% For comparison use positive items only, matching support/confidence/minCount and max size.',
    '% n=' +
      dataset.transactions.length +
      '; minCount=' +
      dataset.minCount +
      '; omittedItems=' +
      dataset.omittedItems,
    '% bands=' + JSON.stringify(dataset.bins),
    '@relation nico_shelf_rules',
    '',
    ...sourceLabels(dataset).map((label) => '@attribute ' + arffQuote(label) + ' {present}'),
    '',
    '@data',
  ];
  for (const transaction of dataset.transactions) {
    const present = new Set(transaction.items);
    lines.push(dataset.items.map((_, i) => (present.has(i) ? 'present' : '?')).join(','));
  }
  return lines.join('\n') + '\n';
}
