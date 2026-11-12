import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicMylistUpstreamUrl, parsePublicMylistPage } from '../worker/public-mylist.js';
import { handlePublicMylistRequest } from '../worker/index.js';
import { assemblePublicMylistPages, fetchPublicMylist, fetchPublicSnapshot, parsePublicMylistId } from '../src/public-sync.js';
import { diffSnapshot } from '../src/sync.js';

const video = (id, title = '') => ({ video: { id, title: title || id } });
const page = (id, number, items, { totalCount = null, hasNext = false } = {}) => ({
  id, name: 'ぼかうた3', page: number, pageSize: 100, totalCount, hasNext,
  items: items.map((id) => ({ video_id: id, title: id })),
});
const PUBLIC_ID = '76098340';
const env = { PUBLIC_MYLIST_RATE_LIMIT: { limit: async () => ({ success: true }) } };
const authHeader = { Authorization: 'Bearer test.token.value123456' }; // Never forwarded to NicoNico
const apiUrl = `https://nico-shelf.example/api/public-mylists/${PUBLIC_ID}?page=1`;

function withFetch(mock, run) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  return Promise.resolve().then(run).finally(() => { globalThis.fetch = previous; });
}

test('公開URLか数値IDだけを受け付け、任意URLや危険なURLを拒否する', () => {
  assert.equal(parsePublicMylistId(PUBLIC_ID), PUBLIC_ID);
  assert.equal(parsePublicMylistId(`https://www.nicovideo.jp/mylist/${PUBLIC_ID}`), PUBLIC_ID);
  assert.equal(parsePublicMylistId(`https://www.nicovideo.jp/user/100/mylist/${PUBLIC_ID}`), PUBLIC_ID);
  assert.equal(parsePublicMylistId(`https://evil.example/mylist/${PUBLIC_ID}`), null);
  assert.equal(parsePublicMylistId(`http://www.nicovideo.jp/mylist/${PUBLIC_ID}`), null);
  assert.throws(() => publicMylistUpstreamUrl('https://evil.test', 1));
  assert.equal(publicMylistUpstreamUrl(PUBLIC_ID, 1).hostname, 'nvapi.nicovideo.jp');
});

test('公開APIのメタデータを制限付きの安全な形式に変換する', () => {
  const response = parsePublicMylistPage({ data: { mylist: {
    name: 'ぼかうた3', totalItemCount: 2, hasNext: false, items: [video('sm10'), video('sm20')],
  } } }, PUBLIC_ID, 1);
  assert.deepEqual(response.items.map((entry) => entry.video_id), ['sm10', 'sm20']);
  assert.equal(response.totalCount, 2);
  assert.throws(() => parsePublicMylistPage({ data: { mylist: {
    items: [video('sm10'), { video: null }],
  } } }, PUBLIC_ID, 1), /取得できない/);
  assert.throws(() => parsePublicMylistPage({ data: { mylist: {
    items: [video('sm10'), video('sm10')],
  } } }, PUBLIC_ID, 1), /取得できない/);
});

test('途中で欠けたページや件数変化・ID重複は差分に反映できない', () => {
  assert.deepEqual(assemblePublicMylistPages([
    page(PUBLIC_ID, 1, ['sm10', 'sm20'], { totalCount: 2 }),
  ], PUBLIC_ID).items.map((row) => row.video_id), ['sm10', 'sm20']);
  assert.throws(() => assemblePublicMylistPages([
    page(PUBLIC_ID, 1, ['sm10'], { hasNext: true }),
  ], PUBLIC_ID), /すべての動画/);
  assert.throws(() => assemblePublicMylistPages([
    page(PUBLIC_ID, 1, ['sm10'], { totalCount: 3 }),
  ], PUBLIC_ID), /すべての動画/);
  assert.throws(() => assemblePublicMylistPages([
    page(PUBLIC_ID, 1, ['sm10'], { hasNext: true }),
    page(PUBLIC_ID, 2, ['sm10']),
  ], PUBLIC_ID), /重複/);
  assert.throws(() => assemblePublicMylistPages([
    page(PUBLIC_ID, 2, ['sm10']),
  ], PUBLIC_ID), /欠落/);
});

test('WorkerはID・HTTPメソッドを検証し、レート制限設定がない場合は取得しない', async () => {
  assert.equal((await handlePublicMylistRequest(new Request('https://nico-shelf.example/api/public-mylists/abc'), env)).status, 400);
  assert.equal((await handlePublicMylistRequest(new Request(apiUrl), {})).status, 503);
  assert.equal((await handlePublicMylistRequest(new Request(apiUrl, { method: 'POST' }), env)).status, 405);
  assert.equal((await handlePublicMylistRequest(new Request(apiUrl.replace('page=1', 'page=21')), env)).status, 400);
});

test('レート制限を超えると429を返し、ニコニコAPIを一切呼ばない', async () => {
  await withFetch(async () => { throw Error('上流APIに到達してはいけない'); }, async () => {
    const limited = { PUBLIC_MYLIST_RATE_LIMIT: { limit: async ({ key }) => {
      assert.equal(key, 'nico-public:203.0.113.12');
      return { success: false };
    } } };
    const response = await handlePublicMylistRequest(new Request(apiUrl, {
      headers: { 'CF-Connecting-IP': '203.0.113.12' },
    }), limited);
    assert.equal(response.status, 429);
    assert.match((await response.json()).error, /時間/);
  });
});

test('公開情報の取得時はSupabase認証への外部通信を行わず、ニコニコにもトークンを送らない', async () => {
  const urls = [];
  await withFetch(async (url, options) => {
    const target = String(url); urls.push(target);
    assert.equal(new URL(target).hostname, 'nvapi.nicovideo.jp');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.headers.apikey, undefined);
    return Response.json({ data: { mylist: {
      name: '公開リスト', totalItemCount: 2, hasNext: false, items: [video('sm10'), video('sm20')],
    } } });
  }, async () => {
    const response = await handlePublicMylistRequest(new Request(apiUrl, { headers: authHeader }), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).items.length, 2);
  });
  assert.equal(urls.length, 1);
});

test('公開APIはSupabaseセッションなしでも公開動画だけを読み取れる', async () => {
  await withFetch(async (url) => {
    assert.equal(new URL(url).hostname, 'nvapi.nicovideo.jp');
    return Response.json({ data: { mylist: {
      name: '公開リスト', items: [video('sm123')], totalItemCount: 1,
    } } });
  }, async () => {
    const response = await handlePublicMylistRequest(new Request(apiUrl), env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.items.map((item) => item.video_id), ['sm123']);
  });
});

test('ニコニコ上流APIに障害があると502になり、空リストに変換しない', async () => {
  await withFetch(async () => new Response('temporary failure', { status: 503 }), async () => {
    const response = await handlePublicMylistRequest(new Request(apiUrl), env);
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /HTTP 503/);
  });
});

test('レート制限バインディングの故障時は安全側に倒して503を返す', async () => {
  const broken = { PUBLIC_MYLIST_RATE_LIMIT: { limit: async () => { throw Error('failure'); } } };
  const response = await handlePublicMylistRequest(new Request(apiUrl), broken);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /制限処理/);
});

test('非公開・削除リストはエラーにし、空のスナップショットにしない', async () => {
  await withFetch(async (url) => {
    return new Response('Forbidden', { status: 403 });
  }, async () => {
    const response = await handlePublicMylistRequest(new Request(apiUrl, { headers: authHeader }), env);
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /公開マイリストを取得できません/);
  });
});

test('画面側でページを最後まで取得し、従来の差分同期と同じ形式になる', async () => {
  const page1 = page(PUBLIC_ID, 1, ['sm10', 'sm20'], { totalCount: 2 });
  const snapshot = await fetchPublicSnapshot([{ id: PUBLIC_ID, name: 'ぼかうた3' }], {
    fetchPage: async (_url, init) => {
      assert.equal(init.headers, undefined);
      return Response.json(page1);
    },
  });
  assert.equal(snapshot.complete, true);
  const diff = diffSnapshot(snapshot, {
    playlists: [{ id: PUBLIC_ID, name: 'ぼかうた3' }],
    videos: [{ id: 'sm10', title: '既存' }],
    entries: [{ playlist_id: PUBLIC_ID, video_id: 'sm10', position: 1, present: true }],
  });
  assert.equal(diff.added, 1);
  assert.equal(diff.removed, 0);
});

test('公開同期の1リスト取得失敗では部分的な差分を返さない', async () => {
  const ids = [{ id: '123', name: '公開A' }, { id: '456', name: '非公開B' }];
  await assert.rejects(() => fetchPublicSnapshot(ids, {
    fetchPage: async (url) => url.includes('/123?')
      ? Response.json(page('123', 1, ['sm10']))
      : Response.json({ error: '非公開です' }, { status: 403 }),
  }), /非公開/);
});

test('100件を超える公開マイリストを複数ページから正しく連結する', async () => {
  const videoIds = Array.from({ length: 101 }, (_, index) => `sm${index + 100}`);
  const first = page(PUBLIC_ID, 1, videoIds.slice(0, 100), { totalCount: 101, hasNext: true });
  const second = page(PUBLIC_ID, 2, videoIds.slice(100), { totalCount: 101, hasNext: false });
  const list = assemblePublicMylistPages([first, second], PUBLIC_ID);
  assert.equal(list.items.length, 101);
  assert.equal(list.items.at(-1).video_id, 'sm200');
  const requested = [];
  const fetched = await fetchPublicMylist(PUBLIC_ID, {
    fetchPage: async (url) => {
      requested.push(url);
      return Response.json(requested.length === 1 ? first : second);
    },
  });
  assert.equal(fetched.items.length, 101);
  assert.equal(requested.length, 2);
});

test('同期画面に拡張機能不要の導線と従来ブリッジの両方が残る', async () => {
  const { createDialogRenderer } = await import('../src/ui/dialogs.js');
  const { createInitialState } = await import('../src/app/state.js');
  const state = createInitialState();
  state.dialog = { kind: 'sync' };
  state.library = {
    playlists: [{ id: PUBLIC_ID, name: 'ぼかうた3' }],
    videos: [], entries: [], meta: [],
  };
  state.publicSyncSelected = [PUBLIC_ID];
  const render = createDialogRenderer({ state, nicoBridge: { connected: false } });
  const html = render();
  assert.match(html, /id="sync-public"/);
  assert.match(html, /data-public-sync-list/);
  assert.match(html, /id="public-sync-add"/);
  assert.match(html, /id="sync-live"/);
  assert.match(html, /id="file-sync"/);
});
