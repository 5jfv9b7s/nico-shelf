import { AUTH_ENV, authenticatedRequest } from './fixtures/session.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlePublicMylistRequest } from '../worker/index.js';
import { fetchPublicMylist } from '../src/public-sync.js';

const endpoint = 'https://nico-shelf.example/api/public-mylists/75327830?page=1';
const rateLimit = {
  ...AUTH_ENV,
  PUBLIC_MYLIST_SOURCE: 'direct',
  PUBLIC_MYLIST_RATE_LIMIT: { limit: async () => ({ success: true }) },
};

async function requestWith(mock) {
  const old = globalThis.fetch;
  const oldError = console.error;
  // No sensitive data in logs. Suppress diagnostic logs in unit tests.
  console.error = () => {};
  globalThis.fetch = mock;
  try {
    const response = await handlePublicMylistRequest(authenticatedRequest(endpoint), rateLimit);
    return { status: response.status, body: await response.json() };
  } finally {
    globalThis.fetch = old;
    console.error = oldError;
  }
}

test('ネットワークエラーは通信段階のコードを返し、空リストとして処理しない', async () => {
  const { status, body } = await requestWith(async () => {
    throw new TypeError('fetch failed');
  });
  assert.equal(status, 502);
  assert.equal(body.code, 'NICO_NETWORK');
  assert.equal(body.stage, 'fetch');
  assert.equal(body.items, undefined);
});

test('タイムアウトは通信失敗と区別される', async () => {
  const { body } = await requestWith(async () => {
    throw new DOMException('timeout', 'TimeoutError');
  });
  assert.equal(body.code, 'NICO_TIMEOUT');
});

test('予期しないリダイレクトでは転送先へアクセスしない', async () => {
  const { status, body } = await requestWith(async (_url, options) => {
    assert.equal(options.redirect, 'manual');
    return new Response(null, {
      status: 302,
      headers: { Location: 'https://external.example/login' },
    });
  });
  assert.equal(status, 502);
  assert.equal(body.code, 'NICO_REDIRECT');
});

test('HTMLチャレンジページとJSONを区別してエラーコードを返す', async () => {
  const { status, body } = await requestWith(
    async () =>
      new Response('<html>access denied</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
  );
  assert.equal(status, 502);
  assert.equal(body.code, 'NICO_NON_JSON');
  assert.equal(body.stage, 'response');
  assert.equal(JSON.stringify(body).includes('access denied'), false);
});

test('JSON破損は解析失敗、データ構造変更は形式不一致として区別', async () => {
  const malformed = await requestWith(
    async () =>
      new Response('not-json', {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      }),
  );
  assert.equal(malformed.body.code, 'NICO_INVALID_JSON');
  const schema = await requestWith(async () => Response.json({ data: { unexpected: [] } }));
  assert.equal(schema.body.code, 'NICO_INVALID_DATA');
  assert.equal(schema.body.stage, 'parse');
});

test('上流HTTPエラーは本来のステータスを保存して区別', async () => {
  const blocked = await requestWith(async () => new Response('denied', { status: 403 }));
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'NICO_ACCESS_DENIED');
  const failed = await requestWith(async () => new Response('upstream error', { status: 503 }));
  assert.equal(failed.status, 502);
  assert.equal(failed.body.code, 'NICO_HTTP_ERROR');
});

test('画面のエラーメッセージに診断コードを表示し、同期を中止する', async () => {
  await assert.rejects(
    () =>
      fetchPublicMylist('75327830', {
        fetchPage: async () =>
          Response.json({ error: 'ネットワークエラー', code: 'NICO_NETWORK' }, { status: 502 }),
      }),
    /75327830: ネットワークエラー \[NICO_NETWORK\]/,
  );
});

test('認証情報を転送せず、正常な公開APIなら公開動画だけを返す', async () => {
  const { status, body } = await requestWith(async (url, options) => {
    assert.equal(typeof url, 'string'); // Cloudflare's fetch accepts URL strings.
    assert.equal(new URL(url).hostname, 'nvapi.nicovideo.jp');
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.headers['X-Niconico-Language'], 'ja-jp');
    return Response.json({
      data: {
        mylist: {
          name: '公開マイリスト',
          items: [{ video: { id: 'sm123', title: '曲' } }],
          totalItemCount: 1,
        },
      },
    });
  });
  assert.equal(status, 200);
  assert.deepEqual(body.items, [{ video_id: 'sm123', title: '曲' }]);
});
