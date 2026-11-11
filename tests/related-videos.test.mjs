import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendRelatedVideos } from '../src/app/related-videos.js';
import { genreEvidence, moodEvidence, genreLabels, moodLabels } from '../src/discovery.js';
import { createInitialState } from '../src/app/state.js';
import { createDialogRenderer } from '../src/ui/dialogs.js';
import { createViewRenderer } from '../src/ui/views.js';

const video = (id, fields = {}) => ({
  id, title: id, tags: [], voices: [], producers: [], composers: [],
  vocadb_tags: [], memberships: [], userMeta: null, ...fields,
});

const fixture = () => {
  const state = createInitialState();
  state.user = { id: 'self', email: 'self@example.test', user_metadata: {} };
  state.library = {
    videos: [
      video('sm1', { title: '始まり', voices: ['音街ウナ-SV'], tags: ['ボカロック', '疾走感'], producers: ['作曲A'] }),
      video('sm2', { title: '近い曲', voices: ['音街ウナ Spicy'], tags: ['ボカロック', '疾走感'], producers: ['作曲A'] }),
      video('sm3', { title: 'ロック', voices: ['初音ミク'], tags: ['ボカロック'] }),
      video('sm4', { title: '無関係', voices: [], tags: ['ジャズ'] }),
    ],
    entries: [], playlists: [], meta: [],
  };
  return state;
};

test('関連曲は本人の候補のみ、元動画を除外し、共有信号で並べ替える', () => {
  const { library } = fixture();
  const results = recommendRelatedVideos(library.videos[0], library.videos);
  assert.equal(results[0].video.id, 'sm2');
  assert.equal(results[1].video.id, 'sm3');
  assert.equal(results.some((x) => x.video.id === 'sm1'), false);
  assert.equal(results.some((x) => x.video.id === 'sm4'), false);
  assert.match(results[0].reasons.join(' / '), /歌唱キャラ：音街ウナ/);
  assert.match(results[0].reasons.join(' / '), /共通タグ：/);
});

test('IDごとに安定して同順位をソートし、件数上限に従う', () => {
  const source = video('sm0', { voices: ['足立レイ'] });
  const candidates = [video('sm3', { voices: ['足立レイ'] }), video('sm2', { voices: ['足立レイ'] })];
  assert.deepEqual(recommendRelatedVideos(source, [source, ...candidates]).map((x) => x.video.id), ['sm2', 'sm3']);
  assert.deepEqual(recommendRelatedVideos(source, [source, ...candidates], { limit: 1 }).map((x) => x.video.id), ['sm2']);
  assert.deepEqual(recommendRelatedVideos(source, [source, ...candidates], { limit: 0 }), []);
  assert.deepEqual(recommendRelatedVideos(source, [], {}), []);
});

test('一般的なタグのみの一致は関連曲だと判定しない', () => {
  const songs = [video('sm1', { tags: ['VOCALOID'] }), video('sm2', { tags: ['vocaloid'] })];
  assert.deepEqual(recommendRelatedVideos(songs[0], songs), []);
});

test('歌唱者の元表記が違っても同一キャラとして一致', () => {
  const songs = [
    video('sm1', { voices: ['Synthesizer V AI 音街ウナ'] }),
    video('sm2', { voices: ['音街ウナ Spicy'] }),
  ];
  assert.deepEqual(recommendRelatedVideos(songs[0], songs)[0].reasons, ['歌唱キャラ：音街ウナ']);
});

test('分類根拠には実際に一致したタグだけを表示する', () => {
  const song = video('sm1', { tags: ['ボカロック', '切ない', 'かわいい'], genre: '音楽・サウンド' });
  assert.deepEqual(genreEvidence(song), [{ label: 'ロック', evidence: ['ボカロック'] }]);
  assert.deepEqual(moodEvidence(song), [
    { label: 'かわいい・癒し', evidence: ['かわいい'] },
    { label: '切ない・感動', evidence: ['切ない'] },
  ]);
  assert.deepEqual(genreLabels(song), ['ロック']);
  assert.deepEqual(moodLabels(song), ['かわいい・癒し', '切ない・感動']);
});

test('タグがない場合はジャンルも雰囲気も推定しない', () => {
  const song = video('sm1', { title: '切ないロック', uploader: 'かわいい作者', genre: '音楽・サウンド' });
  assert.deepEqual(genreEvidence(song), []);
  assert.deepEqual(moodEvidence(song), []);
});

test('UI: 詳細画面から関連動画へ移動でき、ランキングから絞り込める', () => {
  const state = fixture();
  const renderDialog = createDialogRenderer({ state, nicoBridge: { connected: false } });
  const renderer = createViewRenderer({ state, renderDialog });
  state.dialog = { kind: 'detail', id: 'sm1' };
  assert.match(renderDialog(), /id="find-related"/);
  assert.match(renderDialog(), /分類の根拠/);
  state.dialog = { kind: 'related', id: 'sm1' };
  assert.match(renderDialog(), /data-detail="sm2"/);
  assert.match(renderDialog(), /data-detail="sm1"/);
  state.dialog = null;
  assert.match(renderer.content(), /data-facet-kind="genre"/);
  assert.match(renderer.content(), /data-facet-kind="mood"/);
});

test('関連曲HTMLは動画由来の文言をエスケープする', () => {
  const state = fixture();
  state.library.videos[1].title = '<img src=x onerror=alert(1)>';
  state.dialog = { kind: 'related', id: 'sm1' };
  const renderer = createDialogRenderer({ state, nicoBridge: { connected: false } });
  const html = renderer();
  assert.doesNotMatch(html, /<img src=x onerror=/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('大量の動画でも候補は上限内で返り、順序が安定する', () => {
  const source = video('sm0', { tags: ['ボカロック'], voices: ['音街ウナ'] });
  const songs = Array.from({ length: 1100 }, (_, i) => video(`sm${i+1}`, {
    tags: ['ボカロック'], voices: ['音街ウナ Spicy'],
  }));
  const result = recommendRelatedVideos(source, [source, ...songs]);
  assert.equal(result.length, 8);
  assert.deepEqual(result.map((entry) => entry.video.id),
    recommendRelatedVideos(source, [source, ...songs]).map((entry) => entry.video.id));
});
