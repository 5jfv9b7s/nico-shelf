import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateTrend } from '../src/app/trends.js';
import { renderTrendChart } from '../src/ui/trend-charts.js';

const rows = [
  { id: 'sm1', voices: ['音街ウナ'], tags: ['ボカロック'] },
  { id: 'sm2', voices: [], title: 'feat.初音ミク', tags: [] },
  { id: 'sm3', voices: ['音街ウナ'], tags: ['かわいい'] },
];
const library = {
  playlists: [{ id: 'a', name: 'ぼかうた1' }, { id: 'b', name: 'ぼかうた2' }],
  entries: [
    { playlist_id: 'a', video_id: 'sm1', present: true },
    { playlist_id: 'a', video_id: 'sm2', present: true },
    { playlist_id: 'b', video_id: 'sm3', present: true },
  ],
};

test('折れ線SVGに割合・凡例・分類率が含まれ、XSSがエスケープされる', () => {
  const sample = rows.map((v) => ({ ...v }));
  sample[0].voices = ['<svg onload=alert(1)>'];
  const result = calculateTrend(library, sample, { facet: 'voice' });
  const html = renderTrendChart(result, { style: 'line' });
  assert.match(html, /class="trend-line-svg"/);
  assert.match(html, /aria-label=/);
  assert.match(html, /分類情報がある動画の割合/);
  assert.ok(!html.includes('<svg onload=alert(1)>'));
  assert.match(html, /&lt;svg onload=alert\(1\)&gt;/);
});

test('注目項目の横棒グラフと件数が表示される', () => {
  const result = calculateTrend(library, rows, { facet: 'voice' });
  const html = renderTrendChart(result, { style: 'spotlight', focus: '音街ウナ' });
  assert.match(html, /class="trend-spotlight-list"/);
  assert.match(html, /50\.0%/);
  assert.match(html, /100\.0%/);
  assert.match(html, /trend-focus-reset/);
});

test('適切なデータがない場合はチャートを描かない', () => {
  assert.equal(renderTrendChart({ categories: [], cells: [] }), '');
});

test('グラフの色付き棒はブロックとしてレイアウトする', async () => {
  const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.trend-spotlight-fill,\s*\.trend-coverage-track > span\s*\{[^}]*display:\s*block/s);
  assert.match(css, /\.trend-chart-scroll\s*\{[^}]*overflow-x:\s*auto/);
});
