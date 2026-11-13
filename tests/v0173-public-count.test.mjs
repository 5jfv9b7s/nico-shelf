import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assemblePublicMylistPages,
  fetchPublicMylist,
  fetchPublicSnapshot,
} from '../src/public-sync.js';
import { diffSnapshot, normalizeSnapshot, toRpcPayload, diffSignature } from '../src/sync.js';
import { createInitialState } from '../src/app/state.js';
import { createDialogRenderer } from '../src/ui/dialogs.js';

const id = '101';
function shortPages() {
  let next = 1;
  return [100, 100, 99, 100, 100].map((count, index) => ({
    id,
    name: '公開リスト',
    page: index + 1,
    totalCount: 500,
    hasNext: index < 4,
    items: Array.from({ length: count }, () => ({ video_id: `sm${next++}`, title: '曲' })),
  }));
}

const library = {
  playlists: [
    { id, name: '公開リスト' },
    { id: '102', name: '全件取得できるリスト' },
  ],
  videos: [{ id: 'sm900', title: '返らなかった動画' }],
  entries: [
    { playlist_id: id, video_id: 'sm900', position: 1, present: true },
    { playlist_id: id, video_id: 'sm1', position: 2, present: true },
    { playlist_id: id, video_id: 'sm2', position: 3, present: false },
    { playlist_id: '102', video_id: 'sm800', position: 1, present: true },
  ],
  meta: [],
};

test('途中99件でも5ページを読み、公称500件・取得499件をプレビューからRPCまで保持する', async () => {
  const pages = shortPages();
  const requests = [];
  const snapshot = await fetchPublicSnapshot([{ id, name: '公開リスト' }], {
    fetchPage: async (url) => {
      requests.push(url);
      return Response.json(
        pages[Number(new URL(url, 'https://example.test').searchParams.get('page')) - 1],
      );
    },
  });
  assert.equal(requests.length, 5);
  assert.equal(snapshot.lists[0].items.length, 499);
  assert.equal(snapshot.lists[0].reported_total, 500);
  assert.equal(snapshot.lists[0].allow_removals, false);
  const diff = diffSnapshot(snapshot, library);
  assert.equal(diff.added, 498);
  assert.equal(diff.removed, 0);
  assert.equal(diff.reordered, 0);
  assert.deepEqual(
    diff.rows[0].retained.map((item) => item.video_id),
    ['sm900'],
  );
  assert.equal(diff.rows[0].added.find((item) => item.video_id === 'sm2').kind, 'restored');
  assert.equal(toRpcPayload(diff.snapshot).lists[0].allow_removals, false);
  assert.equal(
    normalizeSnapshot(JSON.parse(JSON.stringify(diff.snapshot))).lists[0].allow_removals,
    false,
  );
});

test('途中の通信失敗・件数変化・重複・空応答・曖昧な最終ページは反映データにしない', async () => {
  const pages = shortPages();
  await assert.rejects(
    () =>
      fetchPublicMylist(id, {
        fetchPage: async (url) => {
          const index = Number(new URL(url, 'https://example.test').searchParams.get('page')) - 1;
          return index === 3
            ? Response.json({ error: '取得エラー' }, { status: 503 })
            : Response.json(pages[index]);
        },
      }),
    /取得エラー/,
  );
  assert.throws(() => assemblePublicMylistPages(pages.slice(0, 4), id), /すべての動画/);
  const changed = structuredClone(pages);
  changed[4].totalCount = 501;
  assert.throws(() => assemblePublicMylistPages(changed, id), /途中で変わり/);
  const duplicate = structuredClone(pages);
  duplicate[4].items[0] = duplicate[0].items[0];
  assert.throws(() => assemblePublicMylistPages(duplicate, id), /重複/);
  for (const last of [
    { ...pages[0], items: [], hasNext: false },
    { ...pages[0], hasNext: null },
    { ...pages[0], hasNext: 'false' },
    { ...pages[0], totalCount: 1, hasNext: false },
  ])
    assert.throws(() => assemblePublicMylistPages([last], id));
});

test('全件取得できた別リストは通常の削除・並び順差分を表示する', async () => {
  const snapshot = await fetchPublicSnapshot(library.playlists, {
    fetchPage: async (url) => {
      if (url.includes('/102?'))
        return Response.json({
          id: '102',
          page: 1,
          totalCount: 1,
          hasNext: false,
          items: [{ video_id: 'sm700', title: '新規' }],
        });
      return Response.json(
        shortPages()[Number(new URL(url, 'https://example.test').searchParams.get('page')) - 1],
      );
    },
  });
  const diff = diffSnapshot(snapshot, library);
  assert.equal(diff.rows[0].removed.length, 0);
  assert.deepEqual(
    diff.rows[1].removed.map((item) => item.video_id),
    ['sm800'],
  );
  assert.equal(toRpcPayload(snapshot).lists[1].allow_removals, undefined);
  const full = structuredClone(snapshot);
  full.lists[0].reported_total = 499;
  delete full.lists[0].allow_removals;
  assert.notEqual(diffSignature(diffSnapshot(full, library)), diffSignature(diff));
});

test('件数差の警告を新規取り込みと登録済みリストの両方に表示する', async () => {
  const pages = shortPages();
  const state = createInitialState();
  state.dialog = { kind: 'sync' };
  state.library = library;
  state.pendingPublicImport = assemblePublicMylistPages(pages, id);
  const snapshot = await fetchPublicSnapshot([{ id, name: '公開リスト' }], {
    fetchPage: async (url) =>
      Response.json(
        pages[Number(new URL(url, 'https://example.test').searchParams.get('page')) - 1],
      ),
  });
  state.sync = diffSnapshot(snapshot, library);
  const html = createDialogRenderer({ state, nicoBridge: { connected: false } })();
  assert.match(html, /公称500件・取得499件/);
  assert.match(html, /既存の所属と順番を保持/);
  assert.match(html, /返らなかった動画/);
  assert.match(html, /id="public-import-confirm"/);
  assert.match(html, /id="apply-sync"/);
  assert.doesNotMatch(html, /sync-remove/);
});
