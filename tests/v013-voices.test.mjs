import test from 'node:test';
import assert from 'node:assert/strict';
import { detectVoiceEvidence, voiceVariant } from '../src/app/voice-detection.js';
import { canonicalVoices, rawVoices, genreEvidence, genreLabels, moodLabels, filteredDiscovery } from '../src/discovery.js';

const song = (extra = {}) => ({ id: 'sm999', title: 'テスト曲', description: '', tags: [], voices: [], vocadb_tags: [], ...extra });

test('タイトルのfeat.表記から歌唱者を抽出できる', () => {
  const row = song({ title: '新曲 / feat. 音街ウナ' });
  assert.deepEqual(canonicalVoices(row), ['音街ウナ']);
  assert.equal(detectVoiceEvidence(row).accepted[0].source, 'タイトル');
});

test('タイトルのスラッシュ・括弧内の歌唱表記を扱う', () => {
  assert.deepEqual(canonicalVoices(song({ title: 'ぼくの歌 ／ 重音テトSV' })), ['重音テト']);
  assert.deepEqual(canonicalVoices(song({ title: '【初音ミク】夏の歌【オリジナル】' })), ['初音ミク']);
});

test('明示された概要欄の歌唱者を複数取得する', () => {
  const row = song({ description: 'Music：作者A\nVocal：音街ウナ、足立レイ\nイラスト：作者B' });
  assert.deepEqual(canonicalVoices(row), ['音街ウナ', '足立レイ']);
  assert.deepEqual(detectVoiceEvidence(row).accepted.map((x) => x.source), ['概要欄の歌唱クレジット', '概要欄の歌唱クレジット']);
});

test('動画説明に原曲や絵師として書かれた声ライブラリ名は集計しない', () => {
  const row = song({ description: '原曲：初音ミクの名曲\nイラスト：音街ウナのファン\n歌唱：足立レイ' });
  assert.deepEqual(canonicalVoices(row), ['足立レイ']);
});

test('単なる概要欄の言及は要確認候補として残し自動集計に含めない', () => {
  const row = song({ description: '音街ウナちゃんの曲もよく聴いています。' });
  assert.deepEqual(canonicalVoices(row), []);
  assert.deepEqual(detectVoiceEvidence(row).suggestions.map((x) => x.name), ['音街ウナ']);
});

test('明示的でないタイトルの名前は確認候補とする', () => {
  const row = song({ title: '初音ミクの誕生日を祝う曲' });
  assert.deepEqual(canonicalVoices(row), []);
  assert.deepEqual(detectVoiceEvidence(row).suggestions.map((x) => x.name), ['初音ミク']);
});

test('タグの誕生祭は歌唱者と断定しない', () => {
  const row = song({ tags: ['初音ミク誕生祭'] });
  assert.deepEqual(canonicalVoices(row), []);
  assert.equal(detectVoiceEvidence(row).suggestions[0].name, '初音ミク');
});

test('タグにある実際の歌唱者表記は採用する', () => {
  const row = song({ tags: ['音街ウナ Spicy', '重音テトオリジナル曲'] });
  assert.deepEqual(canonicalVoices(row), ['音街ウナ', '重音テト']);
  assert.deepEqual(rawVoices(row), ['音街ウナ Spicy', '重音テト']);
});

test('保存済み歌唱者表記の異なるエンジンを保持し、名寄せでは一人にする', () => {
  const row = song({ voices: ['音街ウナ-SV', '音街ウナ Spicy'] });
  assert.deepEqual(rawVoices(row), ['音街ウナ-SV', '音街ウナ Spicy']);
  assert.deepEqual(canonicalVoices(row), ['音街ウナ']);
});

test('手動確定は既存・推測値より優先する', () => {
  const row = song({ voices: ['初音ミク'], title: 'feat.音街ウナ', userMeta: { verified_voice: '足立レイ' } });
  assert.deepEqual(canonicalVoices(row), ['足立レイ']);
  assert.equal(detectVoiceEvidence(row).accepted[0].source, '手動確定');
  assert.equal(filteredDiscovery([row], { voice: '音街ウナ' }).length, 0);
});

test('ジャンルと雰囲気を概要欄の明示的フィールドから推定できる', () => {
  const row = song({ description: 'ジャンル：ボカロック\n雰囲気：切ない、ノスタルジック' });
  assert.deepEqual(genreLabels(row), ['ロック']);
  assert.deepEqual(moodLabels(row), ['切ない・感動']);
  assert.match(genreEvidence(row)[0].evidence[0], /概要欄の明示的な表記/);
});

test('歌詞の単なる言及からジャンルや雰囲気を誤推定しない', () => {
  const row = song({ title: 'ポップコーン', description: '明るい未来を願う。ロックマンも登場する。' });
  assert.deepEqual(genreLabels(row), []);
  assert.deepEqual(moodLabels(row), []);
});

test('候補文字列を含む悪意あるメタデータはHTMLに直接注入されない', async () => {
  const { createDialogRenderer } = await import('../src/ui/dialogs.js');
  const row = song({ title: '<img onerror=alert(1)> feat. 音街ウナ' });
  const state = { library: { videos: [row], meta: [] }, dialog: { kind: 'detail', id: row.id }, busy: false };
  const html = createDialogRenderer({ state, nicoBridge: { connected: false } })();
  assert.match(html, /&lt;img onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img onerror=alert\(1\)>/);
  assert.match(html, /歌唱者の判定根拠/);
});

test('判定候補だけを抽出する専用フィルタ', () => {
  const rows = [
    { ...song(), id: 'sm111', description: '動画内には音街ウナの話題も出ます' },
    { ...song(), id: 'sm222', title: 'feat.音街ウナ' },
  ];
  assert.deepEqual(filteredDiscovery(rows, { status: 'voice-review' }).map((v) => v.id), ['sm111']);
});

test('歌唱者候補のキャッシュは取得情報更新後に無効化される', () => {
  const row = song({ title: 'タイトルのみ' });
  assert.deepEqual(canonicalVoices(row), []);
  row.description = '歌唱：音街ウナ';
  assert.deepEqual(canonicalVoices(row), ['音街ウナ']);
});

test('概要欄に明記された作曲者も検索・作り手分析に利用できる', async () => {
  const { composerNames } = await import('../src/discovery.js');
  const row = song({ description: '作曲：作者X\n歌唱：音街ウナ', uploader: '公式アカウント' });
  assert.deepEqual(composerNames(row), ['作者X', '公式アカウント']);
  assert.equal(filteredDiscovery([row], { creator: '作者X' }).length, 1);
});

test('原曲の紹介だけでは作曲者を追加しない', async () => {
  const { composerNames } = await import('../src/discovery.js');
  const row = song({ description: '原曲：原曲作者さんの曲\nイラスト：別の作者' });
  assert.deepEqual(composerNames(row), []);
});

test('タイトルの歌唱者クレジットに続くデュエット表記を両方採用する', () => {
  const row = song({ title: 'ずっとミュージック！ / 音街ウナと星界' });
  assert.deepEqual(canonicalVoices(row), ['音街ウナ', '星界']);
});

test('ジャンル名を含む無関係な作品名からは分類しない', () => {
  assert.deepEqual(genreLabels(song({ tags: ['ロックマン', 'ポップコーン'] })), []);
});


test('「桜乃そら、彩澄りりせ」のタイトルとタグから2人を歌唱者として判定する', () => {
  const row = song({
    id: 'sm46636822',
    title: 'secret base ～君がくれたもの～ (ZONE) ／ 桜乃そら、彩澄りりせ (SynthesizerV2) カバー',
    tags: ['桜乃そら', '彩澄りりせ', 'SynthesizerV'],
  });
  assert.deepEqual(canonicalVoices(row), ['桜乃そら', '彩澄りりせ']);
  assert.equal(detectVoiceEvidence(row).suggestions.length, 0);
});

test('ZONEの文字列から歌唱者「OИE」を誤検出しない', () => {
  assert.deepEqual(canonicalVoices(song({ title: 'ZONEのカバー曲' })), []);
  assert.deepEqual(canonicalVoices(song({ title: 'ONE feat. 桜乃そら' })), ['桜乃そら']);
  assert.deepEqual(canonicalVoices(song({ title: 'テスト曲 / OИE' })), ['OИE']);
});

test('歌唱者の原表記が空でも、タイトルの明示的な歌唱表記を認識する', () => {
  const row = song({ title: 'cover ／ 桜乃そら、彩澄りりせ', voices: [] });
  assert.deepEqual(canonicalVoices(row), ['桜乃そら', '彩澄りりせ']);
});
