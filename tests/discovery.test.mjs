import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalVoice,
  canonicalVoices,
  rawVoices,
  voiceStats,
  voiceVariants,
  genreLabels,
  moodLabels,
  filteredDiscovery,
  needsMetadata,
  mergeMetadata,
  inferredVoicesFromTags,
  composerNames,
} from '../src/discovery.js';
const row = (id, extra = {}) => ({
  id,
  title: id,
  voices: [],
  producers: [],
  composers: [],
  tags: [],
  vocadb_tags: [],
  memberships: [],
  userMeta: null,
  ...extra,
});

test('音街ウナの4表記を1キャラクターに名寄せする', () => {
  const variants = [
    '音街ウナ-SV',
    '音街ウナ Spicy',
    'Synthesizer V AI 音街ウナ',
    '音街ウナ (Unknown)',
  ];
  variants.forEach((v) => assert.equal(canonicalVoice(v), '音街ウナ'));
  assert.equal(canonicalVoice('重音テトSV'), '重音テト');
  assert.equal(canonicalVoice('初音ミク'), '初音ミク');
});
test('歌唱者の原表記は残し、キャラクター単位では1件に数える', () => {
  const rows = [
    row('sm1', { voices: ['音街ウナ-SV', '音街ウナ Spicy'] }),
    row('sm2', { voices: ['Synthesizer V AI 音街ウナ'] }),
    row('sm3', { voices: ['足立レイ'] }),
  ];
  assert.deepEqual(
    voiceStats(rows, 'canonical', 2).map(([n, c]) => [n, c]),
    [
      ['音街ウナ', 2],
      ['足立レイ', 1],
    ],
  );
  assert.equal(voiceStats(rows, 'raw', 10).length, 4);
  assert.deepEqual(voiceVariants(rows, '音街ウナ'), [
    'Synthesizer V AI 音街ウナ',
    '音街ウナ Spicy',
    '音街ウナ-SV',
  ]);
});
test('手動修正した歌唱者は集計・検索の優先入力', () => {
  const r = row('sm1', {
    voices: ['初音ミク'],
    userMeta: { verified_voice: '音街ウナ、足立レイ' },
  });
  assert.deepEqual(rawVoices(r), ['音街ウナ', '足立レイ']);
  assert.deepEqual(canonicalVoices(r), ['音街ウナ', '足立レイ']);
  assert.equal(filteredDiscovery([r], { voice: '初音ミク' }).length, 0);
  assert.equal(filteredDiscovery([r], { voice: '音街ウナ' }).length, 1);
});
test('タグを根拠とするジャンル・雰囲気を分類できる', () => {
  const r = row('sm1', { genre: '音楽・サウンド', tags: ['ボカロック', '切ない', 'かわいい'] });
  assert.deepEqual(genreLabels(r), ['ロック']);
  assert.deepEqual(moodLabels(r), ['かわいい・癒し', '切ない・感動']);
  assert.deepEqual(genreLabels(row('sm2', { genre: '音楽・サウンド' })), []);
  assert.deepEqual(moodLabels(row('sm2', { tags: ['音街ウナ'] })), []);
});
test('複数条件をANDで絞り込み・作者名で探せる', () => {
  const rows = [
    row('sm10', {
      title: '夜の歌',
      voices: ['音街ウナ Spicy'],
      tags: ['VOCAROCK', '切ない'],
      uploader: '作者A',
      published_at: '2026-10-01',
      memberships: [{ id: '1' }],
    }),
    row('sm11', {
      title: '昼の歌',
      voices: ['音街ウナ-SV'],
      tags: ['VOCAPOP', '楽しい'],
      uploader: '作者B',
      published_at: '2025-01-02',
      memberships: [{ id: '2' }],
    }),
  ];
  assert.equal(
    filteredDiscovery(rows, {
      voice: '音街ウナ',
      variant: '音街ウナ Spicy',
      genre: 'ロック',
      mood: '切ない・感動',
      year: '2026',
      creator: '作者A',
      playlist: '1',
    }).length,
    1,
  );
  assert.equal(filteredDiscovery(rows, { voice: '音街ウナ', genre: 'メタル' }).length, 0);
  assert.equal(filteredDiscovery(rows, { q: '音街ウナ' }).length, 2);
  assert.equal(filteredDiscovery(rows, { creator: '作者A', year: '2025' }).length, 0);
});
test('作者の手動修正は既存投稿者と両方検索可能', () => {
  const r = row('sm1', {
    uploader: '公式投稿',
    composers: ['作曲X'],
    userMeta: { verified_composer: 'サイゼP' },
  });
  assert.deepEqual(composerNames(r), ['サイゼP', '作曲X', '公式投稿']);
  assert.equal(filteredDiscovery([r], { creator: 'サイゼP' }).length, 1);
});
test('タグによる歌唱者推定ではバージョン情報を可能な範囲で保持', () => {
  assert.deepEqual(inferredVoicesFromTags(['音街ウナ Spicy', '重音テトSV']), [
    '音街ウナ Spicy',
    '重音テトSV',
  ]);
  assert.deepEqual(inferredVoicesFromTags(['音街ウナオリジナル曲']), ['音街ウナ']);
  assert.deepEqual(inferredVoicesFromTags(['VOCALOID']), []);
});
test('メタデータの取得は不足情報を優先し、既存の歌唱者は上書きしない', () => {
  const existing = {
    id: 'sm9',
    title: 'sm9',
    thumb: '',
    voices: ['音街ウナ-SV'],
    tags: ['個人で取ったタグ'],
    views: 123,
    description: '大切な説明',
  };
  const remote = {
    id: 'sm9',
    title: 'サンプル楽曲',
    thumb: 'https://nicovideo.cdn.nimg.jp/thumbnails/9/9',
    voices: ['初音ミク'],
    tags: ['公式タグ'],
    views: 999,
    description: '別の説明',
    published_at: '2026-11-01T00:00:00Z',
  };
  const patch = mergeMetadata(existing, remote);
  assert.equal(patch.title, 'サンプル楽曲');
  assert.equal(patch.views, undefined);
  assert.equal(patch.description, undefined);
  assert.equal(patch.voices, undefined);
  assert.equal(patch.tags, undefined);
  assert.equal(patch.thumb, remote.thumb);
  assert.equal(patch.published_at, remote.published_at);
  assert.equal(typeof patch.metadata_updated_at, 'string');
});
test('定期補完は最近の取得情報を除外し、古い欠損情報を対象にする', () => {
  assert.equal(needsMetadata({ id: 'sm9', title: 'sm9', thumb: '' }), true);
  assert.equal(
    needsMetadata({
      id: 'sm9',
      title: 'sm9',
      thumb: '',
      metadata_updated_at: new Date().toISOString(),
    }),
    false,
  );
  assert.equal(
    needsMetadata({
      id: 'sm9',
      title: '完備',
      thumb: 'https://example.test',
      published_at: '2026-01-01',
      tags: ['音街ウナ'],
    }),
    false,
  );
});
test('他の動画IDのメタデータはマージしない', () => {
  assert.throws(() => mergeMetadata({ id: 'sm1' }, { id: 'sm2' }), /動画ID/);
});
