import { esc } from '../lib.js';
import { metricLabel } from '../app/analytics/data.js';
import { minimumFactorVariables } from '../app/analytics/factor-settings.js';
import { number, percent, pointChart } from './analysis-charts.js';

export function factorControls(a, select) {
  return (
    select(
      'factorCount',
      '因子数',
      Array.from({ length: 5 }, (_, i) => [
        i + 1,
        i + 1 + '因子（数値' + minimumFactorVariables(i + 1) + '項目以上）',
      ]),
      a.factorCount,
    ) +
    select(
      'factorRotation',
      '因子の回転',
      [
        ['varimax', 'Varimax（直交回転）'],
        ['none', '回転なし'],
      ],
      a.factorRotation,
    ) +
    select(
      'factorIterations',
      '最大反復回数',
      [
        [200, '200回'],
        [500, '500回'],
        [1000, '1000回'],
      ],
      a.factorIterations,
    ) +
    '<p class="analysis-description analysis-rule-wide">抽出は最尤法です。初期項目は再生数・コメント数・ニコニコのマイリスト数、初期因子数は1です。2因子には、値に変化がある項目が5個以上必要です。動画時間や投稿時期などを必要に応じて追加してください。因子数の条件は計算上の下限で、適切さの保証ではありません。</p>'
  );
}

export function factorResult(r, { panel, table }) {
  const labels = r.keys.map((key) => metricLabel(key, r.options.logCounts));
  const names = Array.from({ length: r.count }, (_, i) => 'F' + (i + 1));
  const rotation =
    r.options.factorRotation === 'varimax' ? 'Varimax（直交回転・Kaiser正規化なし）' : '回転なし';
  const warnings = r.warnings
    .map((w) => '<p class="analysis-warning" role="status">' + esc(w) + '</p>')
    .join('');
  const loadings = panel(
    '項目と共通因子の関係',
    '<p class="analysis-description">因子負荷量の正負は関連の向き、絶対値は関係の強さの目安です。絶対値0.5以上を枠で強調します。強調は有意性の検定ではありません。因子に「人気」「曲の良さ」などの名前は自動で付けません。</p>' +
      table(
        ['数値項目', ...names, '共通性（負荷量の二乗和）', '独自分散（Ψ）'],
        r.loadings.map((row, j) => [
          esc(labels[j]),
          ...row.map(
            (value) =>
              '<span class="factor-loading ' +
              (value < 0 ? 'negative' : 'positive') +
              (Math.abs(value) >= 0.5 ? ' is-strong' : '') +
              '">' +
              number(value) +
              '</span>',
          ),
          number(r.communalities[j]),
          number(r.noise[j]),
        ]),
        '因子負荷量・共通性・独自分散',
      ) +
      '<details class="analysis-help"><summary>主成分分析との違い・負荷量の読み方</summary><p>主成分分析は全体の分散を少数の軸にまとめます。因子分析は数値項目の相関を、共通因子と項目ごとの独自分散で説明するモデルです。音源から曲の要素を検出する機能ではありません。</p><p>共通性は各項目で共通因子が説明する分散、独自分散はそのモデルで項目ごとに残る分散です。母標準偏差で標準化した値を使います。未収束時には共通性と独自分散の合計が1から離れることがあります。軸の符号に優劣はありません。回転・対象曲・項目・因子数を変えると負荷量が変わります。</p></details>',
  );
  const contributions = panel(
    '因子が説明する分散',
    table(
      ['因子', '負荷量の二乗和', '二乗和／項目数'],
      r.sums.map((value, i) => [names[i], number(value), percent(r.shares[i])]),
      '各因子の負荷量二乗和',
    ) +
      '<p class="analysis-description">' +
      esc(rotation) +
      '。表示する因子は二乗和が大きい順です。各因子の最大絶対負荷を正の向きにそろえています。直交回転では共通性と二乗和の合計は変わりません。これらを主成分の固有値・寄与率と同じ意味には使いません。</p>',
  );
  const scatter = panel(
    r.count > 1 ? '因子得点の分布（最初の2因子）' : '因子得点の分布（F1）',
    pointChart(r.points, {
      xLabel: 'F1 因子得点',
      yLabel: r.count > 1 ? 'F2 因子得点' : '1因子のため縦軸なし',
      summary:
        r.n +
        '曲の推定因子得点。' +
        (r.count > 1 ? 'F1とF2の2軸を表示します。' : 'F1のみを表示し、全点の縦座標は0です。') +
        '音の近さや曲の評価ではありません。',
    }) +
      '<p class="analysis-description">点を押すと動画の詳細を開けます。得点は推定したモデルでの共通因子の条件付き平均です。得点の分散は1とは限らず、直交回転でも得点同士に相関が残ることがあります。音の類似度や曲の良し悪しではありません。' +
      (r.count > 2 ? 'F3以降の得点もCSVに保存します。' : '') +
      '</p>',
  );
  const representatives = panel(
    '各因子の得点が大きい曲',
    names
      .map(
        (name, k) =>
          '<h3>' +
          name +
          '（絶対値の上位5曲）</h3>' +
          table(
            ['曲名', '動画ID', '因子得点'],
            [...r.points]
              .sort(
                (a, b) =>
                  Math.abs(b.scores[k]) - Math.abs(a.scores[k]) ||
                  String(a.id).localeCompare(String(b.id)),
              )
              .slice(0, 5)
              .map((v) => [
                '<button class="analysis-link" data-detail="' +
                  esc(v.id) +
                  '">' +
                  esc(v.title) +
                  '</button>',
                esc(v.id),
                number(v.scores[k]),
              ]),
            name + 'の得点が大きい曲',
          ),
      )
      .join(''),
  );
  const maxEigen = Math.max(...r.eigenvalues, 1);
  const scree = panel(
    '因子数を考えるための目安',
    '<p class="analysis-description">元の相関行列の固有値です。急な落ち込みや1以上の本数は参考情報です。共通因子の説明量ではなく、因子数の正解を決める基準でもありません。項目・因子数を変えて負荷量と再現誤差を比較してください。</p>' +
      '<figure class="factor-scree"><figcaption>元の相関行列の固有値（大きい順）</figcaption>' +
      r.eigenvalues
        .map(
          (value, i) =>
            '<div><span>第' +
            (i + 1) +
            '固有値</span><span class="factor-scree-track" aria-hidden="true"><i style="width:' +
            (100 * value) / maxEigen +
            '%"></i></span><strong>' +
            number(value) +
            '</strong></div>',
        )
        .join('') +
      '</figure>' +
      table(
        ['参考情報', '値'],
        [
          ['固有値が1以上の本数', String(r.eigenvalues.filter((v) => v >= 1).length)],
          ['モデルの自由度', String(r.df)],
          ['相関の再現誤差（対角以外のRMSR）', number(r.rmsr, 6)],
          ['相関行列の条件数', number(r.condition)],
        ],
        '因子数と相関の再現状態',
      ) +
      '<p class="analysis-description">再現誤差は、この分析に使った曲への当てはまりです。未知の曲への予測精度ではありません。因子を増やすと誤差が減りやすいため、最小誤差だけで選びません。</p>',
  );
  const state = panel(
    '計算条件と状態',
    table(
      ['項目', '設定・結果'],
      [
        ['抽出', '最尤法（Gaussian common-factor model）'],
        ['因子数', String(r.count)],
        ['回転', esc(rotation)],
        ['最尤法', r.converged ? '収束' : '未収束'],
        ['反復回数', String(r.iterations)],
        ['回転の状態', r.rotationConverged ? '完了' : '未収束'],
        ['回転の反復回数', String(r.rotationIterations)],
        ['欠損除外', String(r.missing) + '曲'],
        ['1曲あたりの対数尤度', number(r.logLikelihood.at(-1), 6)],
      ],
      '因子分析の実行情報',
    ) +
      '<p class="analysis-description">選択した全項目がそろった曲を使い、欠損を0で埋めません。曲ごとの再生・聴取履歴や音源は解析しません。結果は現在のライブラリ内の探索的な関連です。最尤法は正規性を仮定したモデルで、局所解や小標本・外れ値・似た項目の影響を受けます。p値・信頼区間・因果効果は算出していません。</p>',
  );
  return warnings + loadings + contributions + scatter + representatives + scree + state;
}
