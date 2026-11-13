import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalVoice } from '../src/app/voice-detection.js';
import {
  colorForCharacter,
  colorForFacet,
  UNCLASSIFIED_COLOR,
} from '../src/app/character-colors.js';
import { createScatterData, metricValue, transformMetric } from '../src/app/scatter.js';
import { renderScatter } from '../src/ui/scatter.js';
import { renderTrendChart } from '../src/ui/trend-charts.js';
import { calculateTrend } from '../src/app/trends.js';
import { createInitialState } from '../src/app/state.js';
import { createViewRenderer } from '../src/ui/views.js';

const rows = [
  {
    id: 'sm1',
    title: 'ウナの曲',
    voices: ['音街ウナ Spicy'],
    views: 1000,
    comments: 35,
    likes: 5,
    duration: 160,
    published_at: '2023-05-01',
  },
  {
    id: 'sm2',
    title: 'ミクとテト',
    voices: ['初音ミク', '重音テトSV'],
    views: 10000,
    comments: 300,
    likes: 50,
    duration: 190,
    published_at: '2024-05-01',
  },
  {
    id: 'sm3',
    title: '未取得',
    voices: ['足立レイ'],
    views: null,
    comments: null,
    likes: null,
    duration: 140,
  },
  {
    id: 'sm4',
    title: 'ゼロ再生',
    voices: ['音街ウナ'],
    views: 0,
    comments: 0,
    likes: 0,
    duration: 90,
    published_at: '2025-01-01',
  },
];

function stateWithRows() {
  const state = createInitialState();
  state.user = { id: 'test-owner', email: 'test@example.com', user_metadata: {} };
  state.library = { videos: rows, playlists: [], entries: [], meta: [] };
  return state;
}

test('キャラクター色は版違いで共通・未知キャラにも安定した自動色', () => {
  assert.equal(canonicalVoice('Synthesizer V AI 音街ウナ'), '音街ウナ');
  assert.equal(colorForCharacter('音街ウナ-SV'), colorForCharacter('音街ウナ Spicy'));
  assert.equal(colorForCharacter('初音ミク'), '#39C5BB');
  assert.equal(colorForCharacter('音街ウナ'), '#8575D8');
  assert.equal(colorForCharacter('宮舞モカ'), '#5DABC5');
  assert.notEqual(colorForCharacter('宮舞モカ'), colorForCharacter('初音ミク'));
  assert.match(colorForCharacter('未登録キャラ'), /^#[0-9A-F]{6}$/);
  assert.equal(colorForCharacter('未登録キャラ'), colorForCharacter('未登録キャラ'));
  assert.equal(colorForCharacter(''), UNCLASSIFIED_COLOR);
  assert.notEqual(colorForCharacter('重音テト'), colorForCharacter('初音ミク'));
  assert.notEqual(colorForFacet('音街ウナ', 'genre', 0), colorForFacet('音街ウナ', 'voice', 0));
});

test('散布図は実在する0と欠損nullを区別して動画IDで重複排除する', () => {
  const result = createScatterData([...rows, rows[0]], { x: 'views', y: 'comments' });
  assert.equal(result.points.length, 3);
  assert.equal(result.eligible, 4);
  assert.ok(result.points.some((p) => p.id === 'sm4' && p.xValue === 0));
  assert.ok(!result.points.some((p) => p.id === 'sm3'));
  assert.equal(transformMetric(0, 'views'), 0);
  assert.equal(metricValue(rows[0], 'duration'), 160 / 60);
});

test('歌唱キャラ絞り込みは複数歌唱者を含め、色を選択キャラへ統一する', () => {
  const result = createScatterData(rows, { x: 'published', y: 'views', voice: '重音テト' });
  assert.deepEqual(
    result.points.map((p) => p.id),
    ['sm2'],
  );
  assert.equal(result.points[0].colorVoice, '重音テト');
  assert.equal(result.eligible, 1);
});

test('投稿年は2000〜2100の日時だけを採用・欠損日時は落とす', () => {
  assert.ok(metricValue(rows[0], 'published') > 2023);
  assert.equal(metricValue(rows[2], 'published'), null);
  assert.equal(metricValue({ published_at: 'nonsense' }, 'published'), null);
});

test('順位相関は増加傾向で正・定数では算出しない', () => {
  const pos = createScatterData(
    rows.slice(0, 2).concat({ id: 'sm5', views: 30000, comments: 900 }),
    { x: 'views', y: 'comments' },
  );
  assert.ok(pos.correlation > 0.98);
  const constant = createScatterData([
    { id: 'sm1', views: 0, comments: 1 },
    { id: 'sm2', views: 0, comments: 2 },
    { id: 'sm3', views: 0, comments: 3 },
  ]);
  assert.equal(constant.correlation, null);
});

test('散布図にSVG・軸選択・点の詳細ボタン・説明・配色を出す', () => {
  const state = stateWithRows();
  state.view = 'scatter';
  const html = renderScatter({ state, rows, hero: (a, b, c) => `<header>${a}${b}${c}</header>` });
  assert.match(html, /id="scatter-x"/);
  assert.match(html, /id="scatter-voice"/);
  assert.match(html, /data-scatter-video="sm1"/);
  assert.match(html, /fill="#8575D8"/);
  assert.match(html, /複数歌唱者の曲は白い輪郭/);
  assert.match(html, /対数目盛/);
  assert.match(html, /情報不足で非表示/);
});

test('ユーザー入力の動画タイトルがSVGタグとして実行されない', () => {
  const state = stateWithRows();
  const unsafe = [{ ...rows[0], title: '<img src=x onerror=alert(1)>' }];
  const html = renderScatter({ state, rows: unsafe, hero: () => '' });
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('既存グラフでも歌唱キャラが同じ色で描画される', () => {
  const library = {
    playlists: [{ id: 'a', name: 'ぼかうた1' }],
    entries: [{ playlist_id: 'a', video_id: 'sm1', present: true }],
  };
  const trend = calculateTrend(library, rows, { facet: 'voice' });
  const html = renderTrendChart(trend, { style: 'line' });
  assert.ok(html.includes(colorForCharacter('音街ウナ')));
  assert.match(renderTrendChart(trend, { style: 'spotlight' }), /background:#8575D8/);
});

test('散布図画面がナビから開け、イベント配線とCSSが含まれる', () => {
  const state = stateWithRows();
  state.view = 'scatter';
  const view = createViewRenderer({ state, renderDialog: () => '' });
  assert.match(view.shell(), /data-view="scatter"/);
  assert.match(view.content(), /data-scatter-video="sm1"/);
  const events = readFileSync(new URL('../src/app/events.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(events, /target\.dataset\.scatterVideo/);
  assert.match(events, /scatter-reset/);
  assert.match(css, /\.scatter-svg\s*\{/);
  assert.match(css, /\.scatter-chart-scroll\s*\{[^}]*overflow-x:\s*auto/s);
});
