import { canonicalVoices, composerNames, genreLabels, moodLabels } from '../../discovery.js';
import { array } from '../../lib.js';

function itemsFor(video, extras) {
  const prefixed = (prefix, values) =>
    values.map((value) => prefix + '：' + String(value).normalize('NFKC').trim());
  return [
    ...new Set([
      ...prefixed('歌唱者', canonicalVoices(video)),
      ...prefixed('ジャンル', genreLabels(video)),
      ...prefixed('雰囲気', moodLabels(video)),
      ...(extras
        ? [
            ...prefixed('作り手・投稿者', composerNames(video)),
            ...prefixed(
              'タグ',
              array(video.tags).filter((t) => typeof t === 'string' && t.trim() && t.length <= 80),
            ),
          ]
        : []),
    ]),
  ];
}

/** Frequent pairs and directional one-item => one-item association rules. */
export function mineRules(rows, options) {
  const support = Number(options.support ?? 0.02),
    confidence = Number(options.confidence ?? 0.5);
  if (!(support > 0 && support <= 1 && confidence >= 0 && confidence <= 1))
    throw new Error('支持度は0より大きく100%以下、確信度は0〜100%にしてください');
  if (rows.length < 3) throw new Error('相関ルールの分析には3曲以上必要です');
  const transactions = rows.map((row) => itemsFor(row, options.ruleExtras));
  const frequency = new Map();
  transactions.forEach((items) =>
    items.forEach((item) => frequency.set(item, (frequency.get(item) || 0) + 1)),
  );
  const minCount = Math.max(3, Math.ceil(support * rows.length));
  const frequent = [...frequency]
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'));
  const items = frequent.slice(0, 80).map(([item]) => item);
  const indices = new Map(items.map((item, i) => [item, i]));
  const pairs = new Map();
  transactions.forEach((transaction, rowIndex) => {
    const selected = transaction
      .filter((item) => indices.has(item))
      .map((item) => indices.get(item))
      .sort((a, b) => a - b);
    for (let a = 0; a < selected.length; a++)
      for (let b = a + 1; b < selected.length; b++) {
        const key = selected[a] * 80 + selected[b];
        if (!pairs.has(key)) pairs.set(key, []);
        pairs.get(key).push(rowIndex);
      }
  });
  const rules = [];
  for (const [key, matching] of pairs) {
    if (matching.length < minCount) continue;
    const a = items[Math.floor(key / 80)],
      b = items[key % 80];
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      const conf = matching.length / frequency.get(from);
      const lift = conf / (frequency.get(to) / rows.length);
      if (conf >= confidence && lift > 1 + 1e-12)
        rules.push({
          from,
          to,
          count: matching.length,
          support: matching.length / rows.length,
          confidence: conf,
          lift,
          fromCount: frequency.get(from),
          toCount: frequency.get(to),
          ids: matching.map((index) => rows[index].id),
        });
    }
  }
  rules.sort((a, b) => b.lift - a.lift || b.count - a.count || a.from.localeCompare(b.from, 'ja'));
  return {
    method: 'rules',
    n: rows.length,
    classified: transactions.filter((t) => t.length).length,
    minCount,
    items: items.length,
    omittedItems: Math.max(0, frequent.length - 80),
    totalRules: rules.length,
    rules: rules.slice(0, 50),
  };
}
