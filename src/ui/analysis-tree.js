import { esc } from '../lib.js';
import { eligibleRows, METRICS } from '../app/analytics/data.js';
import {
  targetRecords,
  blockedTreeFeatures,
  TREE_CATEGORIES,
} from '../app/analytics/classification-data.js';
import { number, percent } from './analysis-charts.js';

function input(field, label, value, attrs) {
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
function section(label, body) {
  return (
    '<fieldset class="analysis-rule-section"><legend>' +
    label +
    '</legend><div class="analysis-controls">' +
    body +
    '</div></fieldset>'
  );
}
export function treeControls(state, rows, select) {
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
        ...state.library.playlists.map((p) => [String(p.id), p.name]),
      ],
      a.treePlaylist,
    );
  if (a.treeTarget === 'views')
    target += input(
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
  const parameters =
    select(
      'treeCriterion',
      '分岐基準',
      [
        ['gini', 'ジニ不純度'],
        ['entropy', 'エントロピー'],
      ],
      a.treeCriterion,
    ) +
    select(
      'treeDepth',
      '最大深さ',
      Array.from({ length: 8 }, (_, i) => [i + 1, String(i + 1)]),
      a.treeDepth,
    ) +
    input('treeMinLeaf', '葉に必要な最小曲数', a.treeMinLeaf, 'min="1" max="1000" step="1"') +
    input('treeAlpha', '枝刈りの強さ（α）', a.treeAlpha, 'min="0" max="1" step="0.001"') +
    select(
      'treeFolds',
      '学習用・評価用の分割',
      [
        [3, '層化3分割交差検証'],
        [5, '層化5分割交差検証'],
      ],
      a.treeFolds,
    ) +
    '<p class="analysis-description analysis-rule-wide">深さを小さく、最小曲数・枝刈りを大きくすると単純な木になります。評価では各曲を学習から外して1回ずつ予測します。</p>';
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
  return (
    section('分類対象を選ぶ', target) + section('木の大きさと評価方法', parameters) + categories
  );
}

export function treeFeatureBlocked(key, target) {
  return blockedTreeFeatures(target).includes(key);
}

export function treeResult(r, { panel, table }, expansion = {}) {
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
  const evaluation = panel(
    '学習に使っていない曲での評価',
    '<p class="analysis-description">' +
      r.folds +
      '分割交差検証で全' +
      r.n +
      '曲を1回ずつ評価しました。学習用の曲だけで欠損補完・分類項目の選択・分岐・枝刈りを行っています。</p>' +
      '<div class="analysis-classification-metrics">' +
      metricCards
        .map(
          ([label, value]) =>
            '<div><span>' + label + '</span><strong>' + pct(value) + '</strong></div>',
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
  function nodeMarkup(node, edge = '') {
    const stats = node.n + '曲 ／ 対象 ' + node.positive + '・対象外 ' + node.negative;
    const view =
      '<button type="button" class="btn subtle analysis-node-select" data-analysis-node="' +
      node.id +
      '">この' +
      node.n +
      '曲を見る</button>';
    const edgeHtml = edge ? '<span class="analysis-tree-edge">' + esc(edge) + '</span>' : '';
    if (!node.left)
      return (
        '<li>' +
        edgeHtml +
        '<article class="analysis-tree-leaf"><strong>予測：' +
        (node.prediction ? '対象' : '対象外') +
        '</strong><p>' +
        stats +
        ' ／ 葉内の対象割合 ' +
        percent(node.score) +
        '</p>' +
        view +
        '</article></li>'
      );
    const condition =
      node.featureType === 'category'
        ? node.label + ' を観測したか'
        : node.label + ' ≤ ' + number(node.threshold, 6) + (node.unit ? ' ' + node.unit : '');
    const open = Object.hasOwn(expansion, node.id) ? expansion[node.id] : node.depth < 2;
    return (
      '<li>' +
      edgeHtml +
      '<details class="analysis-tree-node" data-analysis-tree-branch="' +
      node.id +
      '"' +
      (open ? ' open' : '') +
      '><summary><strong>' +
      esc(condition) +
      '</strong><span>' +
      stats +
      '</span></summary><div class="analysis-tree-node-content">' +
      view +
      '<ol>' +
      nodeMarkup(node.left, node.featureType === 'category' ? '未観測' : 'はい（≤）') +
      nodeMarkup(node.right, node.featureType === 'category' ? '観測あり' : 'いいえ（>）') +
      '</ol></div></details></li>'
    );
  }
  const diagram = panel(
    '分類の分岐図',
    '<p class="analysis-description">分類対象：' +
      esc(r.target.label) +
      '。全' +
      r.n +
      '曲で作成した説明用の木です。上の評価に使った木とは別です。深さ ' +
      r.depth +
      ' ／ 葉 ' +
      r.leaves +
      '個。分岐を開き、ボタンから該当曲を表示できます。</p>' +
      '<ol class="analysis-decision-tree">' +
      nodeMarkup(r.tree) +
      '</ol><p class="analysis-description">葉内の割合は、その葉に入った学習曲での比率です。校正された確率や因果効果ではありません。境界の表示は丸めています。正確な値はCSVで確認できます。</p>',
  );
  const details = panel(
    '分割ごとの評価とデータ処理',
    table(
      ['分割', '学習曲', '評価曲', '説明項目数', '正解率', '対象の再現率'],
      r.foldResults.map((fold) => [
        String(fold.fold),
        String(fold.trainN),
        String(fold.testN),
        String(fold.features),
        percent(fold.metrics.accuracy),
        percent(fold.metrics.recall),
      ]),
      '交差検証の各分割',
    ) +
      '<p class="analysis-description">全曲で作った木の説明項目 ' +
      r.features.length +
      '個 ／ 数値の欠損補完 ' +
      r.imputed +
      'セル ／ 上位40個から省略した分類項目 ' +
      r.omittedCategories +
      '個。数値の欠損は学習用の中央値で補完します。数値に対数変換は使いません。</p>' +
      (r.blocked.length
        ? '<p class="analysis-description">分類対象から直接分かるため除外：' +
          esc(r.blocked.map((key) => METRICS[key].label).join('、')) +
          '</p>'
        : '') +
      (r.dropped.length
        ? '<p class="analysis-description">全曲の木で欠損のみ・一定値のため除外：' +
          esc(r.dropped.join('、')) +
          '</p>'
        : ''),
  );
  return (
    r.warnings
      .map((warning) => '<p class="analysis-warning" role="status">' + esc(warning) + '</p>')
      .join('') +
    evaluation +
    diagram +
    details
  );
}
