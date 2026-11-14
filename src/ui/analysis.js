import { esc } from '../lib.js';
import { canonicalVoices } from '../discovery.js';
import { ANALYSIS_METHODS, METRICS, metricLabel } from '../app/analytics/data.js';
import { number, percent, pointChart, dendrogram, GROUP_COLORS } from './analysis-charts.js';

const option = (value, label, current) =>
  '<option value="' +
  esc(value) +
  '"' +
  (String(current) === String(value) ? ' selected' : '') +
  '>' +
  esc(label) +
  '</option>';
function select(field, label, choices, current) {
  return (
    '<label class="control-label">' +
    esc(label) +
    '<select data-analysis-field="' +
    field +
    '">' +
    choices.map(([value, name]) => option(value, name, current)).join('') +
    '</select></label>'
  );
}
function table(headers, rows, caption) {
  return (
    '<div class="analysis-table-scroll" tabindex="0" aria-label="' +
    esc(caption + '。横にスクロールできます') +
    '"><table class="analysis-table"><caption>' +
    esc(caption) +
    '</caption><thead><tr>' +
    headers.map((h) => '<th scope="col">' + esc(h) + '</th>').join('') +
    '</tr></thead><tbody>' +
    rows
      .map(
        (row) =>
          '<tr>' +
          row
            .map((cell, i) => (i ? '<td>' + cell + '</td>' : '<th scope="row">' + cell + '</th>'))
            .join('') +
          '</tr>',
      )
      .join('') +
    '</tbody></table></div>'
  );
}
const panel = (title, body) =>
  '<section class="panel analysis-panel"><h2>' + esc(title) + '</h2>' + body + '</section>';
const metricChoices = Object.entries(METRICS).map(([key, metric]) => [key, metric.label]);
const INTRO = {
  correlation:
    '複数の項目が一緒に増減する傾向を比較します。順位相関は大小の順番、Pearson相関は値の直線的な関係を見ます。',
  regression:
    '1つの説明変数から目的変数への直線を当てはめます。点が線から離れる曲にも注目できます。',
  multiple:
    '複数の説明変数を同時に使い、目的変数との関連を調べます。目的変数は説明変数から自動で除きます。',
  pca: '数値項目を標準化して少数の軸にまとめます。近い点は選択した数値上の特徴が近い曲です。',
  rules: '1曲を1つの組として、歌唱者・ジャンル・雰囲気などが一緒に現れるルールを探します。',
  clusters:
    '選択した数値項目を標準化し、特徴の近い曲をグループ化します。グループ番号に優劣はありません。',
};

function controls(state, rows) {
  const a = state.analysis;
  const voices = [...new Set(rows.flatMap(canonicalVoices))].sort((x, y) =>
    x.localeCompare(y, 'ja'),
  );
  let fields =
    select(
      'playlist',
      '対象マイリスト',
      [['', 'ライブラリ全体'], ...state.library.playlists.map((p) => [String(p.id), p.name])],
      a.playlist,
    ) +
    select('voice', '歌唱キャラクター', [['', 'すべて'], ...voices.map((v) => [v, v])], a.voice);
  if (a.method === 'regression' || a.method === 'multiple') {
    fields += select('y', '目的変数（調べたい値）', metricChoices, a.y);
    if (a.method === 'regression') fields += select('x', '説明変数', metricChoices, a.x);
  }
  if (a.method === 'correlation')
    fields += select(
      'correlation',
      '相関の種類',
      [
        ['spearman', '順位相関（Spearman）'],
        ['pearson', 'Pearson相関'],
      ],
      a.correlation,
    );
  if (a.method === 'clusters')
    fields +=
      select(
        'clusterMethod',
        'グループ化の方法',
        [
          ['kmeans', 'k-means'],
          ['hierarchical', '階層型（平均連結法）'],
        ],
        a.clusterMethod,
      ) +
      select(
        'k',
        'グループ数',
        Array.from({ length: 7 }, (_, i) => [i + 2, String(i + 2)]),
        a.k,
      );
  if (a.method === 'rules')
    fields +=
      select(
        'support',
        '最低支持度（全対象曲に占める割合）',
        [
          [0.01, '1%'],
          [0.02, '2%'],
          [0.05, '5%'],
          [0.1, '10%'],
          [0.2, '20%'],
        ],
        a.support,
      ) +
      select(
        'confidence',
        '最低確信度（条件Aの曲でBも持つ割合）',
        [
          [0.3, '30%'],
          [0.5, '50%'],
          [0.7, '70%'],
          [0.9, '90%'],
        ],
        a.confidence,
      );
  const featureControls = ['correlation', 'multiple', 'pca', 'clusters'].includes(a.method)
    ? '<fieldset class="analysis-features"><legend>' +
      (a.method === 'multiple' ? '説明変数（目的変数は自動除外）' : '分析する数値項目') +
      '</legend>' +
      metricChoices
        .map(
          ([key, label]) =>
            '<label><input type="checkbox" data-analysis-field="features" value="' +
            key +
            '"' +
            (a.features.includes(key) ? ' checked' : '') +
            '/><span>' +
            esc(label) +
            '</span></label>',
        )
        .join('') +
      '</fieldset>'
    : '';
  const toggle =
    a.method === 'rules'
      ? '<label class="analysis-check"><input type="checkbox" data-analysis-field="ruleExtras"' +
        (a.ruleExtras ? ' checked' : '') +
        '/>作者・投稿者と保存済みタグも含める</label>'
      : '<label class="analysis-check"><input type="checkbox" data-analysis-field="logCounts"' +
        (a.logCounts ? ' checked' : '') +
        '/>再生・コメント・マイリスト・いいね数を ln(1+件数) に変換する</label>';
  return panel(
    '分析条件',
    '<p class="analysis-description">' +
      INTRO[a.method] +
      '</p><div class="analysis-controls">' +
      fields +
      '</div>' +
      featureControls +
      toggle +
      '<div class="analysis-actions"><button type="button" class="btn primary" id="analysis-run"' +
      (a.busy ? ' disabled' : '') +
      '>' +
      (a.busy ? '分析中…' : 'この条件で分析する') +
      '</button>' +
      (a.busy
        ? '<button type="button" class="btn subtle" id="analysis-cancel">中止する</button>'
        : '') +
      '<span class="analysis-status" role="status" aria-live="polite">' +
      (a.busy
        ? '計算しています。中止や画面の切り替えもできます。'
        : '計算はこのブラウザ内で行います。') +
      '</span></div>',
  );
}

function correlationResult(r) {
  const label = (key) => METRICS[key].label;
  const rows = r.keys.map((key, i) => [
    esc(label(key)),
    ...r.cells[i].map((cell) => {
      const bg =
        cell.r === null
          ? 'transparent'
          : 'rgba(' +
            (cell.r >= 0 ? '49,165,157,' : '175,106,149,') +
            (0.1 + Math.abs(cell.r) * 0.4) +
            ')';
      return (
        '<div class="analysis-correlation-cell" style="background:' +
        bg +
        '">' +
        number(cell.r) +
        '<small>n=' +
        cell.n +
        '</small></div>'
      );
    }),
  ]);
  return panel(
    (r.ranked ? '順位相関' : 'Pearson相関') + 'の行列',
    '<p class="analysis-description">+1に近いほど同じ方向、−1に近いほど逆方向に動きます。各セルはその2項目がそろった曲のみ使用。3曲未満・値が一定の場合は「—」です。</p>' +
      table(['項目', ...r.keys.map(label)], rows, '相関係数と有効曲数'),
  );
}
function regressionResult(r) {
  const label = (key) => metricLabel(key, r.options.logCounts);
  const multiple = r.method === 'multiple';
  const info =
    '<div class="analysis-stat-row"><span>R² <b>' +
    number(r.r2) +
    '</b></span><span>調整済みR² <b>' +
    number(r.adjustedR2) +
    '</b></span><span>RMSE <b>' +
    number(r.rmse) +
    '</b></span><span>残差自由度 <b>' +
    r.df +
    '</b></span></div>' +
    '<p class="analysis-description">R²・RMSEは分析に使った曲への当てはまりです。未見の曲への予測精度ではありません。対数変換した場合は、係数・当てはめ値・残差も変換後の尺度です。</p>';
  const coefficients = table(
    ['項目', '係数', '標準誤差', '標準化係数', 'VIF'],
    r.coefficients.map((c, i) => [
      esc(i ? label(r.keys[i - 1]) : '切片'),
      number(c.value),
      number(c.se),
      number(c.beta),
      number(c.vif),
    ]),
    '回帰係数',
  );
  const residualRows = [...r.points]
    .sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual))
    .slice(0, 20)
    .map((p) => [
      '<button class="analysis-link" data-detail="' + esc(p.id) + '">' + esc(p.title) + '</button>',
      number(p.y),
      number(p.fitted),
      number(p.residual),
    ]);
  return (
    panel(
      'モデルの当てはまり',
      info +
        (r.warning ? '<p class="analysis-warning">' + esc(r.warning) + '</p>' : '') +
        pointChart(r.points, {
          xLabel: multiple ? '当てはめ値（' + label(r.target) + '）' : label(r.keys[0]),
          yLabel: label(r.target),
          line: multiple ? [0, 1] : r.coefficients.map((c) => c.value),
        }) +
        '<p class="analysis-description">' +
        (multiple ? '線は実測と当てはめ値が一致する位置です。' : '線は当てはめた回帰直線です。') +
        ' 点を選ぶと曲の詳細を開きます。</p>',
    ) +
    panel(
      '係数の読み取り',
      coefficients +
        '<p class="analysis-description">係数は他の説明変数を一定としたときの関連です。標準化係数は尺度をそろえた値で、因果的な重要度ではありません。標準誤差は通常の最小二乗法の仮定に基づく目安です。VIFが大きい項目は重複した情報を持つ可能性があります。</p>',
    ) +
    panel(
      '残差の確認',
      pointChart(
        r.points.map((p) => ({ ...p, x: p.fitted, y: p.residual })),
        { xLabel: '当てはめ値（分析尺度）', yLabel: '残差（実測−当てはめ値）', line: [0, 0] },
      ) +
        table(
          ['曲名（差が大きい上位20曲）', '実測', '当てはめ値', '残差'],
          residualRows,
          '残差が大きい曲',
        ),
    )
  );
}
function pcaResult(r) {
  let cumulative = 0;
  const contribution = r.explained.map((value, i) => {
    cumulative += value;
    return [
      'PC' + (i + 1),
      number(r.eigenvalues[i]),
      percent(value),
      percent(cumulative),
      '<span class="analysis-bar"><i style="width:' + value * 100 + '%"></i></span>',
    ];
  });
  const loadings = r.keys.map((key, j) => [
    esc(metricLabel(key, r.options.logCounts)),
    number(r.vectors[0][j]),
    number(r.vectors[1][j]),
    number(r.loadings[j][0]),
    number(r.loadings[j][1]),
  ]);
  return (
    panel(
      '主成分の地図',
      pointChart(r.points, {
        xLabel: 'PC1（寄与率 ' + percent(r.explained[0]) + '）',
        yLabel: 'PC2（寄与率 ' + percent(r.explained[1]) + '）',
      }) +
        '<p class="analysis-description">選択した項目のうち最初の2軸だけを表示しています。音の類似度ではありません。点を選ぶと曲の詳細を開きます。</p>',
    ) +
    panel(
      'どの程度まとめられたか',
      table(['主成分', '固有値', '寄与率', '累積寄与率', '割合'], contribution, '主成分の寄与率'),
    ) +
    panel(
      '各軸の特徴',
      table(
        ['項目', 'PC1重み', 'PC2重み', 'PC1負荷量', 'PC2負荷量'],
        loadings,
        '主成分の重みと負荷量',
      ) +
        '<p class="analysis-description">重みは軸を作る係数、負荷量は元の標準化項目と主成分の相関です。符号は軸の向きで、良し悪しを示しません。軸の意味はこれらの値を見て解釈します。</p>',
    )
  );
}
function rulesResult(r) {
  const lines = r.rules.map((rule, i) => [
    '<button class="analysis-link" data-analysis-rule="' +
      i +
      '">' +
      esc(rule.from) +
      ' → ' +
      esc(rule.to) +
      '</button>',
    String(rule.count),
    percent(rule.support),
    percent(rule.confidence),
    number(rule.lift),
  ]);
  return panel(
    '一緒に現れる特徴',
    '<p class="analysis-description">全対象 ' +
      r.n +
      '曲のうち分類根拠あり ' +
      r.classified +
      '曲。' +
      '共起が最低' +
      r.minCount +
      '曲あり、リフトが1より大きい1項目→1項目のルールを、リフト順に上位50件表示します。該当' +
      r.totalRules +
      '件。</p>' +
      (r.omittedItems
        ? '<p class="analysis-warning">計算対象は頻度上位80項目です。条件を満たした残り' +
          r.omittedItems +
          '項目は省略しています。</p>'
        : '') +
      (lines.length
        ? table(
            ['ルール（選ぶと曲を表示）', '共起曲数', '支持度', '確信度', 'リフト'],
            lines,
            '相関ルール',
          )
        : '<p class="empty-sm">条件を満たすルールがありません。対象範囲や最低支持度・確信度を変更してください。</p>') +
      '<details class="analysis-help"><summary>支持度・確信度・リフトの読み方</summary><p>支持度はAとBを両方持つ曲の割合。確信度はAを持つ曲でBも持つ割合。リフトは確信度をB全体の割合で割った値です。1より大きいほど、Bの多さだけでは説明しにくい共起です。分類不明の曲も全曲の分母に含めます。</p><p>対象はこのライブラリ内です。因果関係やニコニコ全体の傾向ではありません。同じ分類根拠に由来するタグは強いルールになる場合があります。</p></details>',
  );
}
function clusterResult(r, selection) {
  const cards = r.groups
    .map((g) => {
      const profile = [...g.profile]
        .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
        .slice(0, 2)
        .map((p) => METRICS[p.key].label + (p.z >= 0 ? ' ↑' : ' ↓'))
        .join(' / ');
      return (
        '<button class="analysis-group ' +
        (selection?.type === 'group' && selection.index === g.group ? 'is-active' : '') +
        '" data-analysis-group="' +
        g.group +
        '"><span class="analysis-group-dot" style="background:' +
        GROUP_COLORS[g.group] +
        '"></span><strong>グループ' +
        (g.group + 1) +
        ' <span>' +
        g.count +
        '曲</span></strong><small>' +
        esc(profile) +
        '</small></button>'
      );
    })
    .join('');
  return (
    panel(
      '数値の特徴によるグループ',
      '<div class="analysis-group-grid">' +
        cards +
        '</div>' +
        '<p class="analysis-description">↑↓は分析対象全体の平均に対する傾向です。グループの名前は自動で断定しません。グループを選ぶと曲一覧を表示します。</p>' +
        (r.clusterMethod === 'kmeans'
          ? '<p class="analysis-description">k-means++初期化を5回実行し、群内平方和が最小の結果を採用。群内平方和 ' +
            number(r.inertia) +
            '、反復 ' +
            r.iterations +
            '回。</p>'
          : '') +
        (r.converged === false
          ? '<p class="analysis-warning">反復上限に達しました。グループ数を変えて比較してください。</p>'
          : '') +
        pointChart(r.points, {
          xLabel: '表示用PC1（' + percent(r.explained[0]) + '）',
          yLabel: '表示用PC2（' + percent(r.explained[1]) + '）',
          selectedGroup: selection?.type === 'group' ? selection.index : null,
        }) +
        '<p class="analysis-description">計算には選択した全項目を使用。地図だけを2主成分へ圧縮しています。重なった点も異なるグループに属する場合があります。</p>',
    ) +
    (r.tree
      ? panel(
          '階層的なまとまり',
          dendrogram(r.tree) +
            '<p class="analysis-description">距離は標準化後のユークリッド距離、統合は平均連結法です。選択したグループ内の枝は省略し、群間の統合だけを表示しています。</p>',
        )
      : '') +
    panel(
      'グループごとの特徴',
      table(
        ['グループ', '曲数', ...r.keys.map((key) => METRICS[key].label)],
        r.groups.map((g) => [
          '群' + (g.group + 1),
          String(g.count),
          ...g.profile.map((p) => number(p.z)),
        ]),
        '標準化した項目のグループ平均',
      ) +
        '<p class="analysis-description">0が分析対象全体の平均、+1が標準偏差1つ分高い値です。</p>',
    )
  );
}

function selectedVideos(r, selection, rows) {
  if (!selection) return '';
  const selected =
    selection.type === 'group' ? r.groups?.[selection.index] : r.rules?.[selection.index];
  if (!selected) return '';
  const ids = new Set(selected.ids);
  const matches = rows.filter((row) => ids.has(row.id));
  return panel(
    '選択した項目の曲（' + matches.length + '曲）',
    '<div class="analysis-selected-videos">' +
      matches
        .slice(0, 100)
        .map(
          (v) =>
            '<button class="analysis-video" data-detail="' +
            esc(v.id) +
            '">' +
            esc(v.title || v.id) +
            '<small>' +
            esc(v.id) +
            '</small></button>',
        )
        .join('') +
      '</div>' +
      (matches.length > 100
        ? '<p class="analysis-description">先頭100曲を表示しています。グループ全曲の所属はCSVで確認できます。</p>'
        : ''),
  );
}

export function renderAnalysis({ state, rows, hero }) {
  const a = state.analysis;
  let result = '';
  if (a.result) {
    const r = a.result;
    const exclusions = r.scope.excluded;
    result =
      '<section class="panel analysis-summary"><div><strong>分析対象 ' +
      r.n +
      '曲</strong><p>範囲内・公開状態に問題なし ' +
      r.scope.available +
      '曲 / 欠損除外 ' +
      (r.missing ?? 'ペアごと') +
      ' / 削除・非公開・取得失敗の除外 ' +
      (exclusions.deleted + exclusions.private + exclusions.unconfirmed) +
      '曲 / 重複登録は1曲に集約</p></div><button class="btn subtle" id="analysis-export">結果をCSV保存</button></section>';
    if (r.sampled)
      result +=
        '<p class="analysis-warning">階層型の計算上限は300曲です。有効' +
        r.complete +
        '曲から動画IDに基づく再現可能な標本' +
        r.n +
        '曲を使用し、残り' +
        r.sampled +
        '曲は今回の分析に含めていません。全曲を使う場合はk-meansを選択してください。</p>';
    if (r.dropped?.length)
      result +=
        '<p class="analysis-warning">値が一定のため除外した項目：' +
        esc(r.dropped.map((key) => METRICS[key].label).join('・')) +
        '</p>';
    if (r.method === 'correlation') result += correlationResult(r);
    if (r.method === 'regression' || r.method === 'multiple') result += regressionResult(r);
    if (r.method === 'pca') result += pcaResult(r);
    if (r.method === 'rules') result += rulesResult(r);
    if (r.method === 'clusters') result += clusterResult(r, a.selection);
    result += selectedVideos(r, a.selection, rows);
  }
  return (
    hero('STATISTICS', '統計分析', '曲の特徴や関係を、自分のライブラリから確かめる。') +
    '<div class="analysis-page"><nav class="analysis-methods" aria-label="分析手法">' +
    Object.entries(ANALYSIS_METHODS)
      .map(
        ([key, label]) =>
          '<button class="btn ' +
          (a.method === key ? 'primary' : 'subtle') +
          '" data-analysis-method="' +
          key +
          '" aria-pressed="' +
          (a.method === key) +
          '">' +
          label +
          '</button>',
      )
      .join('') +
    '</nav>' +
    controls(state, rows) +
    '<p class="analysis-footnote">曲の再生履歴・音声は使いません。タグからの分類には未分類・推定が含まれます。結果は選んだライブラリ内の関連を示し、因果関係を証明するものではありません。</p>' +
    (a.error ? '<div class="analysis-warning" role="alert">' + esc(a.error) + '</div>' : '') +
    result +
    (!a.result && !a.busy && !a.error
      ? '<div class="panel empty-sm">対象と項目を選び「この条件で分析する」を押してください。</div>'
      : '') +
    '<p><button class="btn subtle" data-view="scatter">自由に軸を選ぶ散布図へ</button></p></div>'
  );
}
