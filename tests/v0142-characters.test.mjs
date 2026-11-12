import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHARACTER_COLORS, colorForCharacter, hasCharacterColor } from '../src/app/character-colors.js';
import { canonicalVoice, detectVoiceEvidence, namesInText } from '../src/app/voice-detection.js';
import { calculateTrend } from '../src/app/trends.js';
import { renderTrendChart } from '../src/ui/trend-charts.js';
import { renderTrends } from '../src/ui/trends.js';
import { renderScatter } from '../src/ui/scatter.js';
import { createInitialState } from '../src/app/state.js';
import { createViewRenderer } from '../src/ui/views.js';

const HERO = () => '';
const video = (index, name) => ({
  id: `sm${index}`, title: `曲${index}`, voices: [name], views: 1000 + index * 2,
  comments: 100 + index, likes: index + 1, duration: 100 + index,
  published_at: `202${index % 6}-03-02`, tags: [],
});
const SAMPLE_SINGERS = [
  '音街ウナ', '初音ミク', '重音テト', '足立レイ', '宮舞モカ', '東北きりたん',
  '結月ゆかり', '鏡音リン', '鏡音レン', '巡音ルカ', '波音リツ',
  '鳴花ヒメ', '鳴花ミコト', '神威がくぽ', '四国めたん', '裏命',
  '歌愛ユキ', '弦巻マキ', '雪歌ユフ', 'v flower',
  '東北イタコ', 'OИE', '夢ノ結唱 POPY', '創作の未知キャラ', '別の未知キャラ',
];
function libraryWithSingers() {
  const videos = SAMPLE_SINGERS.map((name, i) => video(i + 1, name));
  const playlists = [
    { id: 'first', name: 'ぼかうた1' }, { id: 'second', name: 'ぼかうた2' },
  ];
  const entries = videos.flatMap((item, i) => [{
    playlist_id: i % 2 ? 'second' : 'first', video_id: item.id, present: true, position: i,
  }]);
  return { videos, playlists, entries, meta: [] };
}

test('代表的な歌唱キャラクターが追加され、既存の色は維持される', () => {
  assert.ok(Object.keys(CHARACTER_COLORS).length >= 45);
  assert.equal(colorForCharacter('音街ウナ Spicy'), '#8575D8');
  assert.equal(colorForCharacter('宮舞モカ'), '#5DABC5');
  assert.equal(colorForCharacter('重音テトSV'), '#D95669');
  assert.ok(hasCharacterColor('東北イタコ'));
  assert.ok(hasCharacterColor('鳴花ヒメ'));
  assert.ok(hasCharacterColor('夢ノ結唱 POPY'));
});

test('新しい歌唱者の名寄せはタイトルの明示クレジットを認識する', () => {
  assert.equal(canonicalVoice('デフォ子'), '唄音ウタ');
  assert.equal(canonicalVoice('flower'), 'v flower');
  assert.equal(canonicalVoice('神威がくぽ'), '神威がくぽ');
  assert.deepEqual(namesInText('歌唱：鳴花ヒメと鳴花ミコト').map(({ name }) => name), ['鳴花ヒメ', '鳴花ミコト']);
  assert.deepEqual(detectVoiceEvidence({ title: '青い曲 feat. 東北イタコ', tags: [] }).accepted.map(({name}) => name), ['東北イタコ']);
  // Loose description mentions must not automatically increase vocal counts.
  const evidence = detectVoiceEvidence({title:'曲',description:'イラスト：東北イタコ\n素敵な歌愛ユキさん',tags:[]});
  assert.deepEqual(evidence.accepted, []);
});

test('未知の歌唱者も名前ごとに安定した色を持つ。未分類だけ灰色', () => {
  const a = colorForCharacter('創作の未知キャラ');
  assert.match(a, /^#[0-9A-F]{6}$/);
  assert.equal(a, colorForCharacter('創作の未知キャラ'));
  assert.notEqual(a, colorForCharacter('別の未知キャラ'));
  assert.notEqual(a, colorForCharacter(''));
  assert.equal(hasCharacterColor('創作の未知キャラ'), false);
});

test('変遷の集計は12項目上限を超え、20・30・全件に対応する', () => {
  const library = libraryWithSingers();
  const top20 = calculateTrend(library, library.videos, { limit: 20, facet: 'voice' });
  const all = calculateTrend(library, library.videos, { limit: 'all', facet: 'voice' });
  assert.equal(top20.categories.length, 20);
  assert.equal(all.categories.length, SAMPLE_SINGERS.length);
  assert.equal(all.cells.length, 2);
  const chart = renderTrendChart(top20, { style: 'line' });
  assert.equal((chart.match(/class="trend-legend-item/g) || []).length, 20);
  assert.match(chart, /id="trend-focus-select"/);
  assert.match(chart, /20項目/);
});

test('変遷画面に表示数と強調キャラ選択欄があり、入力がHTMLに反映される', () => {
  const state = createInitialState();
  state.library = libraryWithSingers();
  state.trends.visibleCount = 30;
  state.trends.focus = '東北イタコ';
  const html = renderTrends({ state, rows: state.library.videos, hero: HERO, cards:()=>'' });
  assert.match(html, /id="trend-visible-count"/);
  assert.match(html, /上位30/);
  assert.match(html, /option value="30" selected/);
  assert.match(html, /option value="東北イタコ" selected/);
});

test('ダッシュボードは表示人数を選べ、マイリスト別比較も連動する', () => {
  const state = createInitialState();
  state.user = { id: 'u1', email: 'sample@example.com', user_metadata: {} };
  state.library = libraryWithSingers();
  state.voiceVisibleCount = 'all';
  const renderer = createViewRenderer({ state, renderDialog:()=>'' });
  const html = renderer.content();
  assert.match(html, /id="voice-count"/);
  assert.match(html, /全員/);
  assert.match(html, /ランキングの表示人数に連動/);
  assert.match(html, /創作の未知キャラ/);
});

test('散布図の凡例は30件／全員対応。凡例の歌唱者クリックで絞り込む配線がある', () => {
  const state = createInitialState();
  state.library = libraryWithSingers();
  const html = renderScatter({ state, rows: state.library.videos, hero: HERO });
  assert.match(html, /id="scatter-legend-limit"/);
  assert.match(html, /data-scatter-voice="音街ウナ"/);
  assert.match(html, /data-scatter-voice="創作の未知キャラ"/);
  assert.equal((html.match(/data-scatter-voice=/g) || []).length, SAMPLE_SINGERS.length);
  const events = readFileSync(new URL('../src/app/events.js', import.meta.url), 'utf8');
  assert.match(events, /target\.dataset\.scatterVoice/);
  assert.match(events, /trend-visible-count/);
  assert.match(events, /voice-count/);
});


test('散布図の凡例にはデュエットの2人目も登場し、クリックで絞り込める', () => {
  const state = createInitialState();
  const duet = [{ ...video(99, '初音ミク'), voices: ['初音ミク', '足立レイ'] }];
  const html = renderScatter({ state, rows: duet, hero: HERO });
  assert.match(html, /data-scatter-voice="初音ミク"/);
  assert.match(html, /data-scatter-voice="足立レイ"/);
});
