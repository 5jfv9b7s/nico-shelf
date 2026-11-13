import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requestPublicPage,
  fetchPublicMylist,
  findExistingPublicPlaylist,
} from '../src/public-sync.js';
import {
  captureSyncDialogUi,
  restoreSyncDialogUi,
  updateSyncStatus,
} from '../src/app/sync-dialog-ui.js';
import { createDialogRenderer } from '../src/ui/dialogs.js';
import { createInitialState } from '../src/app/state.js';

const id = '75327830';
const validPage = {
  id,
  page: 1,
  name: 'ぼかうた2',
  totalCount: 1,
  hasNext: false,
  items: [{ video_id: 'sm123', title: '楽曲' }],
};

function ui() {
  const state = createInitialState();
  state.library = { playlists: [], videos: [], entries: [], meta: [] };
  state.dialog = { kind: 'sync' };
  state.publicSourceStatus = 'configured';
  return { state, render: createDialogRenderer({ state, nicoBridge: { connected: false } }) };
}

test('Render起動中の一時的502だけを1回再試行し、取得完了時に安全なデータを返す', async () => {
  let count = 0;
  let slept = 0;
  const updates = [];
  const data = await fetchPublicMylist(id, {
    onProgress: (value) => updates.push(value),
    sleep: async (ms) => {
      slept += ms;
    },
    fetchPage: async () => {
      count++;
      return count === 1
        ? Response.json(
            { error: '一時的に接続できません', code: 'GATEWAY_NETWORK' },
            { status: 502 },
          )
        : Response.json(validPage);
    },
  });
  assert.equal(count, 2);
  assert.equal(slept, 1500);
  assert.deepEqual(data.items, [{ video_id: 'sm123', title: '楽曲' }]);
  assert.ok(updates.some((text) => text.includes('再接続')));
});

test('一時的なブラウザ通信エラーも1回だけ再試行する', async () => {
  let count = 0;
  const result = await requestPublicPage('/api/public-mylists/75327830?page=1', {
    sleep: async () => {},
    fetchPage: async () => {
      if (++count === 1) throw new TypeError('offline');
      return Response.json(validPage);
    },
  });
  assert.equal(count, 2);
  assert.equal(result.body.name, 'ぼかうた2');
});

test('403の認証拒否と429の制限、APIデータ不備では絶対に再試行しない', async () => {
  for (const [status, code] of [
    [403, 'UPSTREAM_ACCESS_DENIED'],
    [429, 'RATE_LIMITED'],
    [502, 'GATEWAY_INVALID_DATA'],
  ]) {
    let count = 0;
    await assert.rejects(
      () =>
        fetchPublicMylist(id, {
          sleep: async () => {
            throw Error('retry forbidden');
          },
          fetchPage: async () => {
            count++;
            return Response.json({ error: 'denied', code }, { status });
          },
        }),
      /denied/,
    );
    assert.equal(count, 1);
  }
});

test('再試行後も接続できなければ空リストにせずエラーで中止する', async () => {
  let count = 0;
  await assert.rejects(
    () =>
      fetchPublicMylist(id, {
        sleep: async () => {},
        fetchPage: async () => {
          count++;
          return Response.json({ error: '接続に失敗', code: 'GATEWAY_NETWORK' }, { status: 502 });
        },
      }),
    /接続に失敗/,
  );
  assert.equal(count, 2);
});

test('URL入力中の画面再描画で値が保持され、HTMLはエスケープされる', () => {
  const { state, render } = ui();
  state.publicImportInput = 'https://www.nicovideo.jp/mylist/12345678" onfocus="evil';
  const html = render();
  assert.match(html, /public-sync-new-list/);
  assert.match(
    html,
    /value="https:\/\/www\.nicovideo\.jp\/mylist\/12345678&quot; onfocus=&quot;evil"/,
  );
  assert.doesNotMatch(html, /value="https:\/\/www\.nicovideo\.jp\/mylist\/12345678" onfocus=/);
  assert.match(html, /id="sync-public-progress"/);
  assert.match(html, /hidden/);
  assert.doesNotMatch(html, /設定・実通信確認が必要/);
});

test('同期メニューの開閉状態とスクロール位置を再描画後も復元する', () => {
  const makeModal = (opens, scrollTop) => ({
    scrollTop,
    querySelectorAll: () => opens.map((open) => ({ open })),
  });
  const before = makeModal([true, false, true], 240);
  const root = { querySelector: () => before };
  const saved = captureSyncDialogUi(root);
  assert.deepEqual(saved, { expanded: [true, false, true], scrollTop: 240 });
  const after = makeModal([false, false, false], 0);
  root.querySelector = () => after;
  const refs = after.querySelectorAll();
  after.querySelectorAll = () => refs;
  restoreSyncDialogUi(root, saved);
  assert.deepEqual(
    refs.map((x) => x.open),
    [true, false, true],
  );
  assert.equal(after.scrollTop, 240);
});

test('進捗はテキストノードだけを変更し、不要時は非表示にできる', () => {
  const status = { hidden: true, textContent: '' };
  const root = {
    querySelector: (selector) => (selector === '#sync-public-progress' ? status : null),
  };
  updateSyncStatus(root, '3ページ目を取得中');
  assert.equal(status.hidden, false);
  assert.equal(status.textContent, '3ページ目を取得中');
  updateSyncStatus(root, '');
  assert.equal(status.hidden, true);
});

test('予期しないプログラム例外は接続エラー扱いで再試行しない', async () => {
  let attempts = 0;
  await assert.rejects(
    () =>
      requestPublicPage('/api/public-mylists/75327830?page=1', {
        sleep: async () => {
          throw Error('retry should not happen');
        },
        fetchPage: async () => {
          attempts++;
          throw new Error('unexpected logic error');
        },
      }),
    /unexpected logic error/,
  );
  assert.equal(attempts, 1);
});

test('登録済みマイリストのURLも同じ導線から再同期できる', () => {
  const lists = [{ id: '75327830', name: '最近のお気に入り' }];
  assert.equal(findExistingPublicPlaylist(lists, '75327830'), lists[0]);
  assert.equal(findExistingPublicPlaylist(lists, '75327831'), null);
  assert.equal(findExistingPublicPlaylist([], '75327830'), null);
});
