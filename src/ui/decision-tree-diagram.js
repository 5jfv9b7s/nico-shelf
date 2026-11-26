import { esc } from '../lib.js';
import { number, percent } from './analysis-charts.js';

export function decisionNodeOpen(node, expansion) {
  return Object.hasOwn(expansion, node.id) ? expansion[node.id] : node.depth < 2;
}

/** Native HTML node buttons and nested lists retain keyboard access inside the connected diagram. */
export function decisionTreeDiagram(result, expansion = {}, selection = null) {
  function nodeMarkup(node, edge = null) {
    const branch = Boolean(node.left);
    const condition = branch
      ? node.featureType === 'category'
        ? node.label + ' を観測？'
        : node.label +
          ' は ' +
          number(node.threshold, 6) +
          (node.unit ? ' ' + node.unit : '') +
          ' 以下？'
      : '予測：' + (node.prediction ? '対象' : '対象外');
    const selected = selection?.type === 'node' && selection.index === node.id;
    const open = branch && decisionNodeOpen(node, expansion);
    const kind = branch ? 'condition' : node.prediction ? 'positive' : 'negative';
    const label = branch ? (node.depth === 0 ? '最初の条件' : '分岐条件') : '分類結果';
    const edgeHtml = edge
      ? '<span class="decision-edge-label ' +
        (edge.yes ? 'is-yes' : 'is-no') +
        '">' +
        esc(edge.label) +
        '</span>'
      : '';
    const share = Math.max(0, Math.min(100, node.score * 100));
    const card =
      '<article id="decision-node-' +
      node.id +
      '" class="decision-node decision-node--' +
      kind +
      (selected ? ' is-selected' : '') +
      '" aria-label="' +
      esc(condition + '。' + node.n + '曲') +
      '">' +
      '<div class="decision-node-heading"><span>' +
      label +
      '</span><strong>' +
      node.n +
      '曲</strong></div>' +
      '<h3>' +
      esc(condition) +
      '</h3>' +
      '<div class="decision-node-counts"><span><i class="decision-dot positive" aria-hidden="true"></i>対象 <strong>' +
      node.positive +
      '</strong></span><span><i class="decision-dot negative" aria-hidden="true"></i>対象外 <strong>' +
      node.negative +
      '</strong></span></div>' +
      '<div class="decision-node-ratio" aria-hidden="true"><span style="width:' +
      share +
      '%"></span></div>' +
      (!branch
        ? '<p class="decision-leaf-share">葉内の対象割合 ' + percent(node.score) + '</p>'
        : '') +
      '<div class="decision-node-actions"><button type="button" class="decision-node-select" data-analysis-node="' +
      node.id +
      '" aria-pressed="' +
      Boolean(selected) +
      '" aria-label="' +
      esc(condition + '：該当する' + node.n + '曲を見る') +
      '">' +
      (selected ? '選択中の' : 'この') +
      node.n +
      '曲を見る</button>' +
      (branch
        ? '<button type="button" class="decision-branch-toggle" data-analysis-tree-toggle="' +
          node.id +
          '" aria-expanded="' +
          Boolean(open) +
          '" aria-controls="decision-children-' +
          node.id +
          '">' +
          (open ? '− 枝をたたむ' : '＋ 枝を開く') +
          '</button>'
        : '') +
      '</div></article>';
    let children = '';
    if (branch) {
      const categorical = node.featureType === 'category';
      children =
        '<ol id="decision-children-' +
        node.id +
        '" class="decision-children"' +
        (open ? '' : ' hidden') +
        '>' +
        (open
          ? nodeMarkup(node.left, {
              yes: !categorical,
              label: categorical ? 'いいえ・未観測' : 'はい・以下',
            }) +
            nodeMarkup(node.right, {
              yes: categorical,
              label: categorical ? 'はい・観測あり' : 'いいえ・超える',
            })
          : '') +
        '</ol>';
    }
    return '<li>' + edgeHtml + card + children + '</li>';
  }
  return (
    '<div class="decision-tree-toolbar"><div class="decision-tree-legend"><span><i class="decision-dot condition" aria-hidden="true"></i>分岐条件</span><span><i class="decision-dot positive" aria-hidden="true"></i>予測：対象</span><span><i class="decision-dot negative" aria-hidden="true"></i>予測：対象外</span></div><div class="decision-tree-tools"><button type="button" class="btn subtle" data-analysis-tree-expand="all"' +
    (!result.tree.left ? ' disabled' : '') +
    '>すべての枝を開く</button><button type="button" class="btn subtle" data-analysis-tree-expand="reset"' +
    (!result.tree.left ? ' disabled' : '') +
    '>上から3段に戻す</button></div></div>' +
    '<p id="decision-tree-reading" class="analysis-description">上から下へ、分岐線の「はい／いいえ」をたどります。横に広い場合はスクロールできます。各カードのボタンから該当曲を表示します。</p>' +
    '<div class="analysis-tree-scroll" tabindex="0" role="region" aria-label="決定木の分岐図。縦横にスクロールできます" aria-describedby="decision-tree-reading"><ol class="analysis-decision-tree">' +
    nodeMarkup(result.tree) +
    '</ol></div>'
  );
}
