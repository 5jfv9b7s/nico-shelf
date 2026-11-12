import test from 'node:test';
import assert from 'node:assert/strict';

import { detectVoiceEvidence } from '../src/app/voice-detection.js';
import { canonicalVoices, filteredDiscovery, mergeMetadata } from '../src/discovery.js';
import { scatterExclusionReason } from '../src/app/scatter-availability.js';
import { createScatterData } from '../src/app/scatter.js';
import { renderScatter } from '../src/ui/scatter.js';
import { createDialogRenderer } from '../src/ui/dialogs.js';
import { createInitialState } from '../src/app/state.js';

const video = (id, overrides = {}) => ({
  id, title: '普通の楽曲', status: '取得成功', published_at: '2025-01-02',
  views: 200, comments: 30, duration: 180, tags: [], voices: [],
  ...overrides,
});

const examples = [
  video('sm1', { voices: ['音街ウナ'], views: 100, comments: 10 }),
  video('sm2', { status: '取得失敗', title: 'Deleted video', views: 1000000, comments: 500000 }),
  video('sm3', { status: '取得失敗', title: 'Private video', views: 1000000, comments: 500000 }),
  video('sm4', { status: '取得失敗', title: '不明な動画', views: 1000000, comments: 500000 }),
  video('sm5', { title: 'ゼロ回', views: 0, comments: 0 }),
  video('sm6', { title: 'データ欠損', views: null, comments: null }),
  video('sm7', { status: 'deleted', views: 555, comments: 44 }),
];

test('削除・非公開・取得失敗を区別する。取得失敗だけでは削除済みと決めつけない', () => {
  assert.equal(scatterExclusionReason(examples[1]), 'deleted');
  assert.equal(scatterExclusionReason(examples[2]), 'private');
  assert.equal(scatterExclusionReason(examples[3]), 'unconfirmed');
  assert.equal(scatterExclusionReason(examples[6]), 'deleted');
  assert.equal(scatterExclusionReason(video('sm8', { status: '非公開' })), 'private');
  assert.equal(scatterExclusionReason(video('sm9', { status: '削除済み' })), 'deleted');
  assert.equal(scatterExclusionReason(video('sm10', { status: '取得失敗', title: '普通の曲' })), 'unconfirmed');
  assert.equal(scatterExclusionReason(video('sm11', { status: '部分取得' })), null);
  assert.equal(scatterExclusionReason(video('sm12', { title: '削除について歌う曲' })), null);
  assert.equal(scatterExclusionReason(video('sm13', { title: 'Private video' })), null); // verified as public
  assert.equal(scatterExclusionReason({ id: 'sm14', title: 'Private video' }), 'private');
});

test('散布図から利用不能動画を除き、描画点・相関係数・欠損数の分母からも外す', () => {
  const result = createScatterData([...examples, examples[1]], { x: 'views', y: 'comments' });
  assert.deepEqual(result.points.map((point) => point.id), ['sm1', 'sm5']);
  assert.equal(result.eligible, 3); // 2 points and 1 missing metrics
  assert.deepEqual(result.excluded, { deleted: 2, private: 1, unconfirmed: 1 });
  assert.equal(result.total, 7); // all source records remain intact
  assert.equal(result.correlation, null); // two valid points: no Spearman
});

test('公開状態の除外は歌唱者による絞り込み後も適用する', () => {
  const filtered = [
    video('sm20', { voices: ['音街ウナ'], views: 100 }),
    video('sm21', { voices: ['音街ウナ'], status: 'private', views: 10000 }),
    video('sm22', { voices: ['初音ミク'], status: 'deleted', views: 10000 }),
  ];
  const result = createScatterData(filtered, { voice: '音街ウナ' });
  assert.deepEqual(result.points.map((point) => point.id), ['sm20']);
  assert.deepEqual(result.excluded, { deleted: 0, private: 1, unconfirmed: 0 });
});

test('SVGにも除外動画が出ず、除外数と理由を明示する', () => {
  const state = createInitialState();
  state.scatter = { x: 'views', y: 'comments', voice: '', legendLimit: 30 };
  const html = renderScatter({ state, rows: examples, hero: () => '' });
  assert.match(html, /data-scatter-video="sm1"/);
  assert.doesNotMatch(html, /data-scatter-video="sm2"/);
  assert.doesNotMatch(html, /data-scatter-video="sm3"/);
  assert.match(html, /削除・非公開で除外/);
  assert.match(html, /公開状態未確認で除外/);
  assert.match(html, /取得失敗は削除確定ではありません/);
});

test('成功したメタデータ補完は古い取得失敗とプレースホルダー名を上書きする', () => {
  const old = video('sm30', { status: '取得失敗', title: 'Deleted video', views: null });
  const patch = mergeMetadata(old, { id: 'sm30', title: '復活した曲', views: 1000 });
  assert.equal(patch.title, '復活した曲');
  assert.equal(patch.status, '取得成功');
  assert.equal(scatterExclusionReason({ ...old, ...patch }), null);
});

test('辞書にない仮想歌唱者を、明示的なVocalクレジットから要確認候補にする', () => {
  const row = video('sm40', { description: 'Vocal: 重音テト & 未登録シンガー' });
  const evidence = detectVoiceEvidence(row);
  assert.deepEqual(evidence.accepted.map((e) => e.name), ['重音テト']);
  assert.deepEqual(evidence.suggestions.map((e) => e.name), ['未登録シンガー']);
  assert.deepEqual(canonicalVoices(row), ['重音テト']);
  assert.equal(evidence.suggestions[0].confidence, 'suggestion');
});

test('辞書未登録のfeat表記・歌唱行・歌唱タグを候補にするが自動集計しない', () => {
  for (const row of [
    video('sm41', { title: '新曲 feat. 未登録シンガー' }),
    video('sm42', { description: '歌：未登録シンガー' }),
    video('sm43', { tags: ['歌唱：未登録シンガー'] }),
    video('sm44', { title: '曲名 / 未登録シンガー (SynthesizerV) カバー' }),
  ]) {
    assert.deepEqual(detectVoiceEvidence(row).suggestions.map((e) => e.name), ['未登録シンガー']);
    assert.deepEqual(canonicalVoices(row), []);
    assert.equal(filteredDiscovery([row], { status: 'voice-review' }).length, 1);
  }
});

test('辞書登録済みの2名は既知歌唱者として採用し、候補には残さない', () => {
  const row = video('sm46636822', {
    title: 'secret base (ZONE) ／ 桜乃そら、彩澄りりせ (SynthesizerV2) カバー',
    tags: ['桜乃そら', '彩澄りりせ'],
  });
  assert.deepEqual(canonicalVoices(row), ['桜乃そら', '彩澄りりせ']);
  assert.deepEqual(detectVoiceEvidence(row).suggestions, []);
});

test('原曲とイラストなど、歌唱者以外のクレジットは未知候補にしない', () => {
  const row = video('sm45', {
    title: '本家の曲',
    description: '原曲：新しい人物\nイラスト：別の人\n作曲：作者の名前\n普通の文章：名前が出てきた',
    tags: ['イラストレーター名', 'ボカコレ参加曲'],
  });
  assert.deepEqual(detectVoiceEvidence(row).suggestions, []);
});

test('HTMLでは未知歌唱者の候補をエスケープし、利用者の手動確認まで保留する', () => {
  const row = video('sm46', { description: 'Vocal: <img onerror=alert(1)>' });
  const state = createInitialState();
  state.library = { videos: [row], playlists: [], entries: [], meta: [] };
  state.dialog = { kind: 'detail', id: row.id };
  const html = createDialogRenderer({ state, nicoBridge: { connected: false } })();
  assert.doesNotMatch(html, /<img onerror=alert\(1\)>/);
  assert.match(html, /歌唱者の判定根拠/);
});

// A missed major VoiSona singer must be accepted, not left as an unverified suggestion.
test('知声・Chis-Aを既知歌唱者として認識し、英語別名も統一する', () => {
  for (const row of [
    video('sm60', { title: '新曲 feat. 知声' }),
    video('sm61', { description: 'Vocal: 重音テト & 知声' }),
    video('sm62', { tags: ['知声'] }),
    video('sm63', { title: '新曲 feat. Chis-A' }),
    video('sm64', { description: 'Vocal: Chis-A' }),
  ]) {
    const evidence = detectVoiceEvidence(row);
    assert.ok(evidence.accepted.some((entry) => entry.name === '知声'), row.id);
    assert.ok(canonicalVoices(row).includes('知声'), row.id);
    assert.ok(!evidence.suggestions.some((entry) => entry.name === '知声'), row.id);
  }
});

test('キャラクターカラー辞書にあった東北ずん子とLilyも歌唱者として認識する', () => {
  assert.deepEqual(canonicalVoices(video('sm70', { tags: ['東北ずん子'] })), ['東北ずん子']);
  assert.deepEqual(canonicalVoices(video('sm71', { title: '新曲 feat. Lily' })), ['Lily']);
});

test('知声の単なる言及や原曲クレジットは歌唱者として確定しない', () => {
  const row = video('sm72', { title: '知声の声質について語る動画', description: '原曲：知声\nイラスト：知声' });
  assert.deepEqual(canonicalVoices(row), []);
});
