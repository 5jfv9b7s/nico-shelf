import { esc } from '../lib.js';
import { eligibleRows } from '../app/analytics/data.js';
import { targetRecords, TREE_CATEGORIES } from '../app/analytics/classification-data.js';
import { number, percent } from './analysis-charts.js';

export function classificationNumberInput(field, label, value, attrs) {
  return (
    '<label class="control-label">' +
    esc(label) +
    '<input type="number" data-analysis-field="' +
    field +
    '" value="' +
    esc(Number.isFinite(value) ? value : '') +
    '" ' +
    attrs +
    '></label>'
  );
}
export function classificationSection(label, body) {
  return (
    '<fieldset class="analysis-rule-section"><legend>' +
    label +
    '</legend><div class="analysis-controls">' +
    body +
    '</div></fieldset>'
  );
}
export function classificationTargetControls(state, rows, select) {
  const a = state.analysis;
  let target = select(
    'treeTarget',
    '分類したい条件',
    [
      ['playlist', 'マイリストへの所属'],
      ['favorite', 'アプリ内のお気に入り'],
      ['views', '再生数の区分'],
    ],
    a.treeTarget,
  );
  if (a.treeTarget === 'playlist')
    target += select(
      'treePlaylist',
      '分類対象のマイリスト',
      [
        ['', 'マイリストを選択してください'],
        ...state.library.playlists.map((p) => [String(p.id), `${p.name}（ID: ${p.id}）`]),
      ],
      a.treePlaylist,
    );
  if (a.treeTarget === 'views')
    target += classificationNumberInput(
      'treeThreshold',
      '対象とする再生数（この値以上）',
      a.treeThreshold,
      'min="0" max="1000000000000" step="any"',
    );
  try {
    const data = targetRecords(eligibleRows(rows, a).rows, a);
    const positive = data.records.filter((r) => r.target).length;
    target +=
      '<p class="analysis-description analysis-rule-wide">' +
      esc(data.label) +
      '：対象 ' +
      positive +
      '曲 ／ 対象外 ' +
      (data.records.length - positive) +
      '曲' +
      (data.missingTarget ? ' ／ 分類対象の欠損 ' + data.missingTarget + '曲' : '') +
      '。名前の意味は推測せず、保存された状態で判定します。</p>';
  } catch {
    /* The empty target selector is explained by its label. */
  }
  target +=
    '<p class="analysis-description analysis-rule-wide">上の対象マイリストは分析する曲の範囲、ここで選ぶものは分類したい条件です。対象・対象外の両方の曲を含めてください。対象外は「嫌い」を意味しません。</p>';
  return classificationSection('分類対象を選ぶ', target);
}

export function classificationCategoryControls(a) {
  const categories =
    '<fieldset class="analysis-features analysis-rule-fields"><legend>説明変数（分類項目）</legend>' +
    Object.entries(TREE_CATEGORIES)
      .map(
        ([key, label]) =>
          '<label><input type="checkbox" data-analysis-field="treeCategories" value="' +
          key +
          '"' +
          (a.treeCategories.includes(key) ? ' checked' : '') +
          '><span>' +
          label +
          '</span></label>',
      )
      .join('') +
    '<p class="analysis-description">学習用の曲で3回以上観測した項目の頻度上位40個を使います。各分割の中で選び直します。タグや分類の未観測は、実際にその特徴がないことを保証しません。</p></fieldset>';
  return categories;
}

export function classificationEvaluationPanel(r, { panel, table }) {
  const metrics = r.metrics;
  const pct = (value) => (value === null ? '—' : percent(value));
  const metricCards = [
    ['正解率', metrics.accuracy],
    ['多数派だけで予測した正解率', r.baseline.accuracy],
    ['バランス正解率', metrics.balancedAccuracy],
    ['適合率（対象）', metrics.precision],
    ['再現率（対象）', metrics.recall],
    ['F1（対象）', metrics.f1],
  ];
  if (r.probability)
    metricCards.push(
      ['ROC-AUC', r.probability.auc, 'number'],
      ['LogLoss（小さいほど良い）', r.probability.logLoss, 'number'],
      ['Brier（小さいほど良い）', r.probability.brier, 'number'],
    );
  const evaluation = panel(
    '学習に使っていない曲での評価',
    '<p class="analysis-description">' +
      r.folds +
      '分割交差検証で全' +
      r.n +
      '曲を1回ずつ評価しました。学習用の曲だけで欠損補完・分類項目の選択・' +
      (r.method === 'logistic' ? '標準化・係数推定' : '分岐・枝刈り') +
      'を行っています。</p>' +
      '<div class="analysis-classification-metrics">' +
      metricCards
        .map(
          ([label, value, kind]) =>
            '<div><span>' +
            label +
            '</span><strong>' +
            (kind === 'number' ? number(value) : pct(value)) +
            '</strong></div>',
        )
        .join('') +
      '</div>' +
      table(
        ['実際の分類', '予測：対象', '予測：対象外'],
        [
          ['対象', String(metrics.tp), String(metrics.fn)],
          ['対象外', String(metrics.fp), String(metrics.tn)],
        ],
        '混同行列（交差検証の予測を合計）',
      ) +
      '<details class="analysis-help"><summary>評価の読み方と注意点</summary><p>正解率は全体で正解した割合、適合率は対象と予測した曲のうち実際も対象だった割合、再現率は実際の対象を見つけた割合です。F1は適合率と再現率の調和平均、バランス正解率は対象・対象外それぞれの正解率の平均です。計算できない値は「—」です。</p><p>多数派の基準も各分割の学習用の曲から決めています。同じ作者・シリーズなどの関連曲が学習側と評価側に分かれる可能性があります。これは現在のライブラリ内での探索的な評価で、未知の曲への性能や「好きになる確率」ではありません。条件を繰り返し選び直して最も高い評価だけを採用すると、楽観的になり得ます。</p></details>',
  );
  return evaluation;
}
