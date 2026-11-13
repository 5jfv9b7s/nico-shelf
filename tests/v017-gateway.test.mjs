import { AUTH_ENV, authenticatedRequest } from './fixtures/session.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { makeGatewayHandler } from '../gateway/server.mjs';
import { handlePublicMylistRequest } from '../worker/index.js';
import { validatePublicMylistPage } from '../worker/public-mylist.js';
import { createInitialState } from '../src/app/state.js';
import { createDialogRenderer } from '../src/ui/dialogs.js';

const ID = '75327830';
const endpoint = `https://nico-shelf.example/api/public-mylists/${ID}?page=1`;
const token = 'a-long-private-test-gateway-token-of-32-characters';
const validPage = {
  id: ID,
  page: 1,
  pageSize: 100,
  name: '公開マイリスト',
  totalCount: 2,
  hasNext: false,
  items: [
    { video_id: 'sm123', title: '初めの曲' },
    { video_id: 'sm456', title: '次の曲' },
  ],
};
const env = {
  ...AUTH_ENV,
  PUBLIC_MYLIST_SOURCE: 'gateway',
  PUBLIC_MYLIST_GATEWAY_URL: 'https://gateway.example/',
  PUBLIC_MYLIST_GATEWAY_TOKEN: token,
  PUBLIC_MYLIST_RATE_LIMIT: { limit: async () => ({ success: true }) },
};

async function mockedWorkerFetch(fakeFetch, work, activeEnv = env) {
  const saved = globalThis.fetch;
  const log = console.error;
  globalThis.fetch = fakeFetch;
  console.error = () => {};
  try {
    return await work(activeEnv);
  } finally {
    globalThis.fetch = saved;
    console.error = log;
  }
}

test('外部取得サービスを設定していない場合はURL取り込みを無効化して既存のDBを守る', async () => {
  const response = await handlePublicMylistRequest(authenticatedRequest(endpoint), {
    ...AUTH_ENV,
    PUBLIC_MYLIST_RATE_LIMIT: { limit: async () => ({ success: true }) },
  });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, 'PUBLIC_SYNC_NOT_READY');
  assert.equal(body.items, undefined);
  const status = await handlePublicMylistRequest(
    authenticatedRequest('https://nico-shelf.example/api/public-mylists/status'),
    {},
  );
  assert.deepEqual((await status.json()).available, false);
});

test('Node連携を設定した場合に限り、固定されたHTTPSの取得先へアクセスする', async () => {
  await mockedWorkerFetch(
    async (url, options) => {
      assert.equal(url, `https://gateway.example/v1/public-mylists/${ID}?page=1`);
      assert.equal(options.redirect, 'manual');
      assert.equal(options.headers['X-Nico-Shelf-Gateway-Key'], token);
      assert.equal(options.headers.Cookie, undefined);
      assert.equal(options.headers.Authorization, undefined);
      return Response.json(validPage);
    },
    async () => {
      const response = await handlePublicMylistRequest(
        authenticatedRequest(endpoint, {
          headers: { Cookie: 'user_session=never-forward-this', Authorization: 'Bearer secret' },
        }),
        env,
      );
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).items, validPage.items);
      const status = await handlePublicMylistRequest(
        authenticatedRequest('https://nico-shelf.example/api/public-mylists/status'),
        env,
      );
      assert.equal((await status.json()).available, true);
    },
  );
});

test('Node連携先の通信障害、403、形式不一致、リダイレクトは空のリストとして返さない', async () => {
  for (const [fake, expected] of [
    [
      async () => {
        throw new TypeError('network failed');
      },
      'GATEWAY_NETWORK',
    ],
    [
      async () => Response.json({ code: 'UPSTREAM_ACCESS_DENIED' }, { status: 502 }),
      'UPSTREAM_ACCESS_DENIED',
    ],
    [
      async () => Response.json({ ...validPage, items: [{ video_id: 'bad', title: 'x' }] }),
      'GATEWAY_INVALID_DATA',
    ],
    [
      async () => new Response('', { status: 302, headers: { Location: 'https://evil.example' } }),
      'GATEWAY_REDIRECT',
    ],
  ]) {
    await mockedWorkerFetch(fake, async () => {
      const response = await handlePublicMylistRequest(authenticatedRequest(endpoint), env);
      assert.equal(response.status, 502);
      const body = await response.json();
      assert.equal(body.code, expected);
      assert.equal(body.items, undefined);
    });
  }
});

test('利用者が送った URL で取得先を変更できず、HTTP URLの設定は拒否', async () => {
  const noHttpEnv = { ...env, PUBLIC_MYLIST_GATEWAY_URL: 'http://gateway.example/' };
  await mockedWorkerFetch(
    async () => {
      throw new Error('gateway must not be called');
    },
    async () => {
      const response = await handlePublicMylistRequest(
        authenticatedRequest(endpoint + '&url=https://evil.example'),
        noHttpEnv,
      );
      assert.equal(response.status, 503);
    },
  );
});

test('ゲートウェイは24文字以上の共有鍵を必須とし、権限なしのアクセスを拒否', async () => {
  assert.throws(() => makeGatewayHandler({ token: 'short' }), /GATEWAY_TOKEN/);
  let upstreamCalls = 0;
  const handler = makeGatewayHandler({
    token,
    fetchUpstream: async () => {
      upstreamCalls++;
      return Response.json({});
    },
  });
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const health = await fetch(base + '/health');
    assert.equal((await health.json()).upstreamVerified, false);
    assert.equal((await fetch(base + `/v1/public-mylists/${ID}`)).status, 401);
    for (const supplied of ['', token.slice(0, -1), token + 'x', 'x'.repeat(token.length)]) {
      assert.equal(
        (
          await fetch(base + `/v1/public-mylists/${ID}`, {
            headers: { 'X-Nico-Shelf-Gateway-Key': supplied },
          })
        ).status,
        401,
      );
    }
    assert.equal(
      (
        await fetch(base + '/v1/public-mylists/../../evil', {
          headers: { 'X-Nico-Shelf-Gateway-Key': token },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(base + `/v1/public-mylists/${ID}?url=https://evil.example`, {
          headers: { 'X-Nico-Shelf-Gateway-Key': token },
        })
      ).status,
      400,
    );
    assert.equal(upstreamCalls, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('ゲートウェイは公開情報だけを変換し、ニコニコCookieを送信しない', async () => {
  let called = 0;
  const handler = makeGatewayHandler({
    token,
    fetchUpstream: async (url, options) => {
      called++;
      assert.equal(url.hostname, 'nvapi.nicovideo.jp');
      assert.equal(url.searchParams.get('page'), '1');
      assert.equal(options.headers.Cookie, undefined);
      assert.equal(options.headers.Authorization, undefined);
      return Response.json({
        data: {
          mylist: {
            name: '公開リスト',
            totalItemCount: 1,
            items: [{ video: { id: 'sm321', title: '曲' } }],
          },
        },
      });
    },
  });
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/v1/public-mylists/${ID}`,
      {
        headers: { 'X-Nico-Shelf-Gateway-Key': token, Cookie: 'never-to-niconico' },
      },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.items, [{ video_id: 'sm321', title: '曲' }]);
    assert.equal(called, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('APIの悪意あるレスポンスは安全な検証段階で失敗する', () => {
  assert.throws(
    () =>
      validatePublicMylistPage(
        {
          ...validPage,
          items: [
            { video_id: 'sm10', title: '<img>' },
            { video_id: 'sm10', title: 'dup' },
          ],
        },
        ID,
        1,
      ),
    /不正/,
  );
  assert.throws(() => validatePublicMylistPage(validPage, ID, 2), /不完全/);
  assert.throws(() => validatePublicMylistPage({ ...validPage, hasNext: 'false' }, ID, 1), /不正/);
});

test('公開リストは保存前のプレビューを表示し、状態確認失敗だけでは操作を無効化しない', () => {
  const state = createInitialState();
  state.dialog = { kind: 'sync' };
  state.library = { playlists: [], videos: [], entries: [], meta: [] };
  state.publicSourceStatus = 'configured';
  state.pendingPublicImport = {
    id: ID,
    name: '安全な曲集',
    complete: true,
    items: [{ video_id: 'sm1', title: '<危険な文字列>' }],
  };
  const renderDialog = createDialogRenderer({ state, nicoBridge: { connected: false } });
  const html = renderDialog();
  assert.match(html, /このリストを追加する/);
  assert.match(html, /&lt;危険な文字列&gt;/);
  assert.doesNotMatch(html, /<危険な文字列>/);
  assert.match(html, /public-import-confirm/);
  state.pendingPublicImport = null;
  state.publicSourceStatus = 'not-configured';
  state.publicSourceReason = 'GATEWAY_TOKEN_INVALID';
  const unavailable = renderDialog();
  assert.match(unavailable, /GATEWAY_TOKEN_INVALID/);
  assert.match(unavailable, /接続状態を再確認/);
  assert.match(unavailable, /id="public-sync-add"(?=\s|>)/);
  assert.doesNotMatch(unavailable, /id="public-sync-add" disabled/);
});

test('総件数不明の空ページは完了と見なさず、削除候補を作らない', async () => {
  const { assemblePublicMylistPages } = await import('../src/public-sync.js');
  assert.throws(
    () =>
      assemblePublicMylistPages(
        [
          {
            id: ID,
            page: 1,
            items: [],
            totalCount: null,
            hasNext: false,
          },
        ],
        ID,
      ),
    /0件/,
  );
  assert.throws(
    () => validatePublicMylistPage({ ...validPage, items: [], totalCount: null }, ID, 1),
    /0件/,
  );
});
