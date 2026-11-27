import { esc } from '../lib.js';
import { METRICS } from '../app/analytics/data.js';
import { number, percent } from './analysis-charts.js';
import {
  classificationTargetControls,
  classificationCategoryControls,
  classificationEvaluationPanel,
  classificationNumberInput as input,
  classificationSection as section,
} from './analysis-classification.js';

export function logisticControls(state, rows, select) {
  const a = state.analysis;
  const parameters =
    input(
      'logisticLambda',
      'L2正則化の強さ（λ）',
      a.logisticLambda,
      'min="0.0001" max="100" step="any"',
    ) +
    input(
      'logisticCutoff',
      '分類の閾値（この確率以上を対象）',
      a.logisticCutoff,
      'min="0.0001" max="0.9999" step="any"',
    ) +
    select(
      'treeFolds',
      '学習用・評価用の分割',
      [
        [3, '層化3分割交差検証'],
        [5, '層化5分割交差検証'],
      ],
      a.treeFolds,
    ) +
    select(
      'logisticIterations',
      '最大反復回数',
      [
        [100, '100回'],
        [300, '300回'],
        [600, '600回'],
      ],
      a.logisticIterations,
    ) +
    '<p class="analysis-description analysis-rule-wide">λを大きくすると係数を強く抑えます。閾値は確率から対象・対象外を決める境界です。全項目を学習用の平均・標準偏差で標準化します。</p>';
  return (
    classificationTargetControls(state, rows, select) +
    section('モデルと評価の設定', parameters) +
    classificationCategoryControls(a)
  );
}

export function logisticResult(r, { panel, table }, selection) {
  const ordered = [...r.coefficients].sort(
    (a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient),
  );
  const max = Math.max(1e-9, ...ordered.map((c) => Math.abs(c.coefficient)));
  const bars =
    '<figure class="logistic-coefficients"><figcaption>標準化係数：左は負、右は正。絶対値の大きい上位15項目。</figcaption>' +
    ordered
      .slice(0, 15)
      .map(
        (c) =>
          '<div class="logistic-coefficient-row"><span>' +
          esc(c.label) +
          '</span><div class="logistic-coefficient-track" aria-hidden="true"><i class="' +
          (c.coefficient >= 0 ? 'positive' : 'negative') +
          '" style="width:' +
          (Math.abs(c.coefficient) / max) * 50 +
          '%"></i></div><strong>' +
          number(c.coefficient) +
          '</strong></div>',
      )
      .join('') +
    '</figure>';
  const coefficients = panel(
    'どの項目が分類と関連するか',
    '<p class="analysis-description">分類対象：' +
      esc(r.target.label) +
      '。係数は全' +
      r.n +
      '曲から別途学習した説明用モデルです。上の交差検証のモデルとは区別します。</p>' +
      (ordered.length
        ? bars +
          table(
            ['項目', 'オッズ比の比較単位', '標準化係数', '比較用係数', 'オッズ比'],
            ordered.map((c) => [
              esc(c.label),
              c.type === 'category' ? '未観測 → 観測' : '分析尺度で+1標準偏差',
              number(c.coefficient, 6),
              number(c.comparison, 6),
              c.oddsRatio === null ? '数値範囲外' : number(c.oddsRatio, 6),
            ]),
            '正則化した係数とオッズ比',
          )
        : '<p class="empty-sm">有効な説明項目がなく、学習用の対象割合だけを使っています。</p>') +
      '<details class="analysis-help"><summary>係数・オッズ比の読み方</summary><p>正の係数は対象側、負の係数は対象外側への関連を表します。オッズ比は他の項目をモデル上で固定した比較で、数値は分析尺度の1標準偏差、分類項目は未観測から観測ありへの変化です。確率そのものの倍率ではありません。</p><p>係数は正則化で縮小されています。似た項目を重ねると係数が分かれたり符号が変わったりするため、因果効果や重要度順位とは解釈しません。p値や信頼区間は算出していません。対数変換した項目の比較単位も変換後です。オッズ比が数値範囲外の場合も、比較用係数はCSVに残します。</p></details>',
  );
  const calibration = panel(
    '予測確率と実際の対象割合',
    '<p class="analysis-description">交差検証の予測を確率帯ごとに集計します。件数が少ない帯は不安定です。値が近いことだけで、未知の曲への確率が正しいとは保証できません。</p>' +
      table(
        ['予測確率の帯', '曲数', '平均予測確率', '実際の対象割合'],
        r.probability.bins.map((b) => [
          percent(b.low) + '〜' + percent(b.high) + (b.high === 1 ? '（上端含む）' : '未満'),
          String(b.n),
          percent(b.mean),
          percent(b.actual),
        ]),
        '交差検証の確率帯別集計',
      ) +
      '<p class="analysis-description">学習用の対象割合だけを確率にした基準：LogLoss ' +
      number(r.baselineProbability.logLoss) +
      ' ／ Brier ' +
      number(r.baselineProbability.brier) +
      '。</p>' +
      '<p class="analysis-description">LogLossとBrierは小さいほど確率予測の誤差が小さい指標です。ROC-AUCは確率の順位による識別の指標で、確率の正しさとは別です。</p>',
  );
  const groups = panel(
    '交差検証の判定から曲を確認',
    '<div class="analysis-group-grid">' +
      r.groups
        .map(
          (group, i) =>
            '<button type="button" class="analysis-group' +
            (selection?.type === 'group' && selection.index === i ? ' is-active' : '') +
            '" data-analysis-group="' +
            i +
            '"><strong>' +
            group.label +
            ' <span>' +
            group.ids.length +
            '曲</span></strong><small>選ぶと曲一覧を表示</small></button>',
        )
        .join('') +
      '</div><p class="analysis-description">評価用に学習から外した曲への予測です。閾値 ' +
      number(r.options.logisticCutoff) +
      '以上を対象としています。条件や閾値を結果に合わせて調整し続けると、評価が楽観的になり得ます。</p>',
  );
  const details = panel(
    '学習状態とデータ処理',
    '<p class="analysis-description">説明用モデル：' +
      (r.converged ? '収束' : '未収束') +
      ' ／ ' +
      r.iterations +
      '反復 ／ 項目 ' +
      r.coefficients.length +
      '個 ／ 数値の欠損補完 ' +
      r.imputed +
      'セル ／ 切片（標準化後）' +
      number(r.intercept, 6) +
      '。</p>' +
      table(
        ['分割', '学習曲', '評価曲', '項目数', '反復回数', '学習状態', 'LogLoss'],
        r.foldResults.map((f) => [
          String(f.fold),
          String(f.trainN),
          String(f.testN),
          String(f.features),
          String(f.iterations),
          f.converged ? '収束' : '未収束',
          number(f.probability.logLoss),
        ]),
        '交差検証の学習状態',
      ) +
      (r.blocked.length
        ? '<p class="analysis-description">分類対象から直接分かるため除外：' +
          esc(r.blocked.map((key) => METRICS[key].label).join('、')) +
          '</p>'
        : '') +
      (r.dropped.length
        ? '<p class="analysis-description">説明用モデルで欠損のみ・一定値のため除外：' +
          esc(r.dropped.join('、')) +
          '</p>'
        : '') +
      '<p class="analysis-description">切片を除く係数にL2正則化を使います。欠損補完・分類項目の辞書・標準化は各分割の学習用だけで決めています。予測確率は選んだ分類条件に関するモデルの推定であり、「好きになる確率」ではありません。</p>',
  );
  return (
    r.warnings.map((w) => '<p class="analysis-warning" role="status">' + esc(w) + '</p>').join('') +
    classificationEvaluationPanel(r, { panel, table }) +
    coefficients +
    calibration +
    groups +
    details
  );
}
