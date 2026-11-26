import { esc } from '../lib.js';
import { eligibleRows } from '../app/analytics/data.js';
import { buildRuleDataset, parseRuleBins, RULE_FIELDS } from '../app/analytics/rule-data.js';

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

const section = (title, body) =>
  '<fieldset class="analysis-rule-section"><legend>' +
  title +
  '</legend><div class="analysis-controls">' +
  body +
  '</div></fieldset>';

function binPreview(kind, value) {
  try {
    const limits = parseRuleBins(
      value,
      '',
      kind === 'year' ? { min: 2000, max: 2101, integer: true } : {},
    );
    const format = (n) =>
      kind === 'duration' ? (n % 60 === 0 ? n / 60 + '分' : n + '秒') : n.toLocaleString('ja-JP');
    const labels =
      kind === 'year'
        ? [2000, ...limits].map((lo, i) => lo + '〜' + ((limits[i] ?? 2101) - 1) + '年')
        : [
            format(limits[0]) + '未満',
            ...limits.slice(1).map((hi, i) => format(limits[i]) + '〜' + format(hi) + '未満'),
            format(limits.at(-1)) + '以上',
          ];
    return (
      '<div class="analysis-bin-preview" aria-label="分類範囲のプレビュー">' +
      labels.map((label) => '<span>' + esc(label) + '</span>').join('') +
      '</div>'
    );
  } catch {
    return '<p class="analysis-bin-error">小さい順の数値をカンマで指定してください。重複せず、最大12個までです。</p>';
  }
}

function binSettings(a) {
  const fields = [
    ['ruleViewBins', '再生数の区切り', 'view', a.ruleViewBins],
    ['ruleYearBins', '投稿年の区切り', 'year', a.ruleYearBins],
    ['ruleDurationBins', '動画時間の区切り（秒）', 'duration', a.ruleDurationBins],
  ];
  return (
    '<details id="analysis-rule-bins" class="analysis-help analysis-bin-settings analysis-rule-wide"' +
    (a.ruleBinsOpen ? ' open' : '') +
    '>' +
    '<summary><span class="analysis-disclosure-icon" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M4 17h16M8 4v6M16 14v6"/></svg></span>' +
    '<span class="analysis-disclosure-copy"><strong>数値の区切りを設定</strong><small>再生数・投稿年・動画時間の分類範囲を変更</small></span>' +
    '<span class="analysis-disclosure-action" aria-hidden="true"><span class="analysis-disclosure-open">開く</span><span class="analysis-disclosure-close">閉じる</span></span></summary>' +
    '<div class="analysis-bin-content"><p class="analysis-description">小さい順にカンマで区切って入力します。下に、実際に使う分類範囲が表示されます。</p><div class="analysis-bin-grid">' +
    fields
      .map(
        ([field, label, kind, value]) =>
          '<div class="analysis-bin-field">' +
          input(field, label, value, 'type="text" spellcheck="false" autocomplete="off"') +
          binPreview(kind, value) +
          '</div>',
      )
      .join('') +
    '</div><p class="analysis-description analysis-bin-note">境界値は上側の区間に含みます。区切りは最大12個。投稿年は2001〜2100の整数で指定し、UTC年で分類します。欠損値は分類しません。</p></div></details>'
  );
}

export function ruleControls(state, rows, select) {
  const a = state.analysis,
    advanced = a.ruleMode === 'apriori';
  let html = select(
    'ruleMode',
    '分析方式',
    [
      ['simple', '簡易分析（1項目 → 1項目）'],
      ['apriori', 'Apriori（複数項目）'],
    ],
    a.ruleMode,
  );
  const thresholds =
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
    );
  const sort = select(
    'ruleSort',
    'ルールの並べ順',
    [
      ['count', '共起曲数が多い順'],
      ['lift', 'リフトが高い順'],
      ['confidence', '確信度が高い順'],
    ],
    a.ruleSort,
  );
  if (!advanced) return html + thresholds + sort;
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
    '<p class="analysis-description">対象マイリストは曲の絞り込みです。「所属マイリスト」は各曲の現在の所属先を項目にします。選択範囲外の所属先も含みます。</p></fieldset>';
  html += section(
    'ルールを表示する条件',
    thresholds +
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
      select(
        'ruleMaxSize',
        '最大項目集合サイズ（左右の合計）',
        [2, 3, 4, 5].map((n) => [n, n + '項目']),
        a.ruleMaxSize,
      ) +
      input('ruleLimit', '最大表示件数', a.ruleLimit, 'type="number" min="1" max="500" step="1"') +
      sort +
      '<p class="analysis-description analysis-rule-wide">支持度と共起曲数の両方を満たす規則を表示します。最大4項目なら A・B → C・D も探索します。</p>',
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
    section(
      '結論部の絞り込み（任意）',
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
      ) +
        select(
          'ruleConsequentItem',
          '結論部に含む項目（頻出上位80から）',
          [['', '指定なし'], ...items.map((item) => [item.key, item.label])],
          a.ruleConsequentItem,
        ) +
        '<p class="analysis-description analysis-rule-wide">「指定なし」ならすべての結論部を探索します。指定すると、その属性・項目を少なくとも1つ含む結論部に絞ります。</p>',
    ) + binSettings(a);
  return html;
}
