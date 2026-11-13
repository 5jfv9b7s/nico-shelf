import { AUTH_ENV } from './fixtures/session.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPublicSourceStatus } from '../src/app/public-source-status.js';
import { createInitialState } from '../src/app/state.js';
import { createDialogRenderer } from '../src/ui/dialogs.js';
import { registerEventHandlers } from '../src/app/events.js';
import { handlePublicMylistRequest } from '../worker/index.js';

function dialog(status, reason) {
  const state = createInitialState();
  state.library = {
    videos: [],
    playlists: [{ id: '75327830', name: '公開済み' }],
    entries: [],
    meta: [],
  };
  state.dialog = { kind: 'sync' };
  state.publicSourceStatus = status;
  state.publicSourceReason = reason;
  return createDialogRenderer({ state, nicoBridge: { connected: false } })();
}

test('statusエンドポイントの200は設定状態のみを報告し、upstreamへの成功を推測しない', async () => {
  const result = await checkPublicSourceStatus(async () =>
    Response.json({ available: true, upstreamVerified: false }),
  );
  assert.deepEqual(result, { status: 'configured', reason: null });
});

test('設定不足の場合は診断理由を保つが、読み取りの操作を無効化しない', async () => {
  const result = await checkPublicSourceStatus(async () =>
    Response.json({ available: false, reason: 'GATEWAY_TOKEN_INVALID' }),
  );
  assert.equal(result.status, 'not-configured');
  assert.equal(result.reason, 'GATEWAY_TOKEN_INVALID');
  const html = dialog(result.status, result.reason);
  assert.match(html, /GATEWAY_TOKEN_INVALID/);
  assert.match(html, /id="public-sync-check-connection"/);
  assert.doesNotMatch(html, /id="public-sync-add" disabled/);
  assert.doesNotMatch(html, /id="sync-public" disabled/);
  assert.doesNotMatch(html, /id="public-sync-new-list"[^>]*disabled/);
});

test('statusが403・HTML・例外でもマイリストURL入力は使える', async () => {
  const probes = [
    async () => new Response('no', { status: 403 }),
    async () => new Response('<html>broken', { status: 200 }),
    async () => {
      throw new TypeError('connection failed');
    },
  ];
  for (const fetchProbe of probes) {
    const status = await checkPublicSourceStatus(fetchProbe);
    assert.equal(status.status, 'unverified');
    const html = dialog(status.status, status.reason);
    assert.match(html, /自動確認ができません/);
    assert.doesNotMatch(html, /id="public-sync-add" disabled/);
    assert.doesNotMatch(html, /id="sync-public" disabled/);
  }
});

test('接続設定を確認中でもURLを入力して実取得を試せる', () => {
  const html = dialog('checking');
  assert.match(html, /接続設定を確認しています/);
  assert.doesNotMatch(html, /id="public-sync-add" disabled/);
  assert.doesNotMatch(html, /id="public-sync-new-list"[^>]*disabled/);
});

test('Enterキーで状態確認失敗時も読み取りを開始するが、busyなら開始しない', async () => {
  const events = new Map();
  const root = {
    addEventListener: (type, fn) => events.set(type, [...(events.get(type) || []), fn]),
  };
  const state = createInitialState();
  state.user = { id: 'user' };
  let submits = 0;
  let prevented = 0;
  registerEventHandlers({
    root,
    state,
    client: {},
    nicoBridge: {},
    render() {},
    rerenderContent() {},
    showDialog() {},
    closeDialog() {},
    refreshMembership() {},
    actions: {
      guard: async (fn) => await fn(),
      importPublicPlaylist: async () => {
        submits++;
      },
    },
  });
  const event = {
    key: 'Enter',
    target: { id: 'public-sync-new-list' },
    preventDefault() {
      prevented++;
    },
  };
  state.publicSourceStatus = 'unverified';
  await events.get('keydown')[0](event);
  assert.equal(submits, 1);
  state.busy = true;
  await events.get('keydown')[0](event);
  assert.equal(submits, 1);
  assert.equal(prevented, 2);
});

test('Workerは未設定理由を安全なコードで返し、秘密値を漏らさない', async () => {
  const url = 'https://nico-shelf.example/api/public-mylists/status';
  const good = {
    ...AUTH_ENV,
    PUBLIC_MYLIST_SOURCE: 'gateway',
    PUBLIC_MYLIST_GATEWAY_URL: 'https://gateway.example/',
    PUBLIC_MYLIST_GATEWAY_TOKEN: 'long-enough-example-secret-token-32',
  };
  for (const [env, reason] of [
    [{}, 'SOURCE_NOT_GATEWAY'],
    [{ ...good, PUBLIC_MYLIST_GATEWAY_URL: 'http://gateway.example/' }, 'GATEWAY_URL_INVALID'],
    [{ ...good, PUBLIC_MYLIST_GATEWAY_TOKEN: 'short' }, 'GATEWAY_TOKEN_INVALID'],
  ]) {
    const response = await handlePublicMylistRequest(new Request(url), env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.available, false);
    assert.equal(body.reason, reason);
    assert.doesNotMatch(JSON.stringify(body), /example-secret/);
  }
  const response = await handlePublicMylistRequest(new Request(url), good);
  assert.deepEqual((await response.json()).available, true);
});
