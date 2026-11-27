import { esc } from '../lib.js';
import { METRICS } from '../app/analytics/data.js';
import { blockedTreeFeatures } from '../app/analytics/classification-data.js';
import { percent } from './analysis-charts.js';
import { decisionTreeDiagram } from './decision-tree-diagram.js';
import {
  classificationTargetControls,
  classificationCategoryControls,
  classificationEvaluationPanel,
} from './analysis-classification.js';

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
  return (
    classificationTargetControls(state, rows, select) +
    section('木の大きさと評価方法', parameters) +
    classificationCategoryControls(a)
  );
}

export function treeFeatureBlocked(key, target) {
  return blockedTreeFeatures(target).includes(key);
}

export function treeResult(r, { panel, table }, expansion = {}, selection = null) {
  const evaluation = classificationEvaluationPanel(r, { panel, table });
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
      decisionTreeDiagram(r, expansion, selection) +
      '<p class="analysis-description">葉内の割合は、その葉に入った学習曲での比率です。校正された確率や因果効果ではありません。境界の表示は丸めています。正確な値はCSVで確認できます。</p>',
    'analysis-tree-diagram',
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
