import { esc } from '../lib.js';
import { eligibleRows } from '../app/analytics/data.js';
import { buildRuleDataset, RULE_FIELDS } from '../app/analytics/rule-data.js';

function input(field, label, value, attributes = '', percent = false) {
  const shown =
    typeof value === 'number' && !Number.isFinite(value)
      ? ''
      : percent
        ? Number((value * 100).toPrecision(12))
        : value;
  return (
    '<label class="control-label">' +
    esc(label) +
    '<input data-analysis-field="' +
    field +
    '" value="' +
    esc(shown) +
    '" ' +
    attributes +
    (percent ? ' data-analysis-percent="true"' : '') +
    '></label>'
  );
}

export function ruleControls(state, rows, select) {
  const a = state.analysis,
    advanced = a.ruleMode === 'apriori';
  let html =
    select(
      'ruleMode',
      '分析方式',
      [
        ['simple', '簡易分析（1項目 → 1項目）'],
        ['apriori', 'Apriori（複数項目）'],
      ],
      a.ruleMode,
    ) +
    input(
      'support',
      '最低支持度（%・全対象曲が分母）',
      a.support,
      'type="number" min="0.000001" max="100" step="any"',
      true,
    ) +
    input(
      'confidence',
      '最低確信度（%）',
      a.confidence,
      'type="number" min="0" max="100" step="any"',
      true,
    ) +
    select(
      'ruleSort',
      'ルールの並べ順',
      [
        ['count', '共起曲数が多い順'],
        ['lift', 'リフトが高い順'],
        ['confidence', '確信度が高い順'],
      ],
      a.ruleSort,
    );
  if (!advanced) return html;
  const fields = Array.isArray(a.ruleFields) ? a.ruleFields : [];
  html +=
    '<fieldset class="analysis-features analysis-rule-fields"><legend>規則に使う属性</legend>' +
    Object.entries(RULE_FIELDS)
      .map(
        ([key, label]) =>
          '<label><input type="checkbox" data-analysis-field="ruleFields" value="' +
          key +
          '"' +
          (fields.includes(key) ? ' checked' : '') +
          '><span>' +
          esc(label) +
          '</span></label>',
      )
      .join('') +
    '<p class="analysis-description">対象マイリストは曲の絞り込みです。「所属マイリスト」を選ぶと、各曲の現在の所属先も規則の項目になります。選択範囲外の所属先も含みます。</p></fieldset>' +
    select(
      'ruleMaxSize',
      '最大項目集合サイズ（左右の合計）',
      [2, 3, 4, 5].map((n) => [n, n + '項目']),
      a.ruleMaxSize,
    ) +
    input(
      'ruleMinCount',
      '最小共起曲数',
      a.ruleMinCount,
      'type="number" min="1" max="1000000" step="1"',
    ) +
    input(
      'ruleMinLift',
      '最低リフト（以上）',
      a.ruleMinLift,
      'type="number" min="0" max="1000000" step="any"',
    ) +
    input('ruleLimit', '最大表示件数', a.ruleLimit, 'type="number" min="1" max="500" step="1"') +
    select(
      'ruleConsequentField',
      '結論部に含む属性',
      [
        ['', '指定なし'],
        ...fields
          .filter((key) => Object.hasOwn(RULE_FIELDS, key))
          .map((key) => [key, RULE_FIELDS[key]]),
      ],
      a.ruleConsequentField,
    );
  let items = [];
  try {
    items = buildRuleDataset(eligibleRows(rows, a).rows, a).items.filter(
      (item) => !a.ruleConsequentField || item.field === a.ruleConsequentField,
    );
  } catch {
    /* Invalid conditions are explained when the analysis runs. */
  }
  html +=
    select(
      'ruleConsequentItem',
      '結論部に含む項目（頻出上位80から）',
      [['', '指定なし'], ...items.map((item) => [item.key, item.label])],
      a.ruleConsequentItem,
    ) +
    '<p class="analysis-description analysis-rule-wide">結論部の指定は「少なくとも1項目含む」条件です。最大4項目なら A・B → C・D も探索します。支持度と共起曲数の両方を満たす項目集合を使います。</p>' +
    '<details class="analysis-help analysis-rule-wide"><summary>数値を分類する区切りを変更する</summary><p>小さい順にカンマで指定します（最大12個）。境界値は上側の区間に入ります。欠損値には項目を作りません。</p><div class="analysis-controls">' +
    input('ruleViewBins', '再生数の区切り', a.ruleViewBins, 'type="text" inputmode="decimal"') +
    input(
      'ruleYearBins',
      '投稿年の区切り（2001〜2100）',
      a.ruleYearBins,
      'type="text" inputmode="numeric"',
    ) +
    input(
      'ruleDurationBins',
      '動画時間の区切り（秒）',
      a.ruleDurationBins,
      'type="text" inputmode="decimal"',
    ) +
    '</div><p>初期値の投稿時期には「2023〜2026年」、再生数には「1万再生未満」が含まれます。投稿時期は公開日時のUTC年を使います。</p></details>';
  return html;
}
