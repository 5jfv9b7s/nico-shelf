import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { parseVideoMetadataXml, videoMetadataUpstreamUrl } from '../gateway/video-metadata.js';
import { validateVideoMetadata, readTextLimited } from '../shared/video-metadata.js';
import { makeGatewayHandler } from '../gateway/server.mjs';
import worker, { handleVideoMetadataRequest } from '../worker/index.js';
import { createMetadataFetch } from '../src/app/metadata-fetch.js';
import { mergeMetadata } from '../src/discovery.js';
import { AUTH_ENV, authenticatedRequest, SESSION_TOKEN, USER_ID } from './fixtures/session.mjs';
const token = 'synthetic-gateway-secret-at-least-24-chars';
const xml = `<?xml version="1.0" encoding="UTF-8"?><nicovideo_thumb_response status="ok"><thumb><video_id>sm9</video_id><title>曲 &amp; 音街ウナ</title><description><![CDATA[説明 <a href="x">音楽</a>]]></description><thumbnail_url>https://nicovideo.cdn.nimg.jp/thumbnails/9/9.L</thumbnail_url><first_retrieve>2020-01-02T12:34:56+09:00</first_retrieve><length>3:12</length><view_counter>12345</view_counter><comment_num>0</comment_num><mylist_counter>123</mylist_counter><user_nickname>作者</user_nickname><user_id>42</user_id><tags domain="jp"><tag>音街ウナ</tag><tag lock="1">VOCALOID</tag></tags></thumb></nicovideo_thumb_response>`;
const dto = parseVideoMetadataXml(xml, 'sm9');
const endpoint = 'https://app.example/api/video-metadata/sm9';
const env = () => ({
  ...AUTH_ENV,
  PUBLIC_MYLIST_SOURCE: 'gateway',
  PUBLIC_MYLIST_GATEWAY_URL: 'https://gateway.example/',
  PUBLIC_MYLIST_GATEWAY_TOKEN: token,
  PUBLIC_MYLIST_RATE_LIMIT: { limit: async () => ({ success: true }) },
});

test('XMLから日本語・CDATA・タグ・0件・日時・動画時間を正しく取得し、いいねを捏造しない', () => {
  assert.equal(dto.title, '曲 & 音街ウナ');
  assert.equal(dto.description, '説明 <a href="x">音楽</a>');
  assert.equal(dto.duration, 192);
  assert.equal(dto.comments, 0);
  assert.equal(dto.views, 12345);
  assert.deepEqual(dto.tags, ['音街ウナ', 'VOCALOID']);
  assert.equal(dto.published_at, '2020-01-02T03:34:56.000Z');
  assert.equal(Object.hasOwn(dto, 'likes'), false);
  assert.equal(
    videoMetadataUpstreamUrl('nm123').href,
    'https://ext.nicovideo.jp/api/getthumbinfo/nm123',
  );
  for (const id of ['https://evil.invalid', 'SM9', 'sm9?a=1', 'sm1234567890123'])
    assert.throws(() => videoMetadataUpstreamUrl(id));
});
test('エンティティ宣言・壊れたXML・HTML・別動画・非公開エラーは保存用データに変換しない', () => {
  for (const bad of [
    xml.replace('sm9', 'sm8'),
    '<html>blocked</html>',
    xml.slice(0, -10),
    '<!DOCTYPE x [<!ENTITY a "xx">]>' + xml,
    xml.replace('<view_counter>12345', '<view_counter>-1'),
    xml.replace('3:12', '3:72'),
  ])
    assert.throws(() => parseVideoMetadataXml(bad, 'sm9'));
  assert.throws(
    () =>
      parseVideoMetadataXml(
        '<nicovideo_thumb_response status="fail"><error><code>DELETED</code></error></nicovideo_thumb_response>',
        'sm9',
      ),
    /METADATA_UNAVAILABLE/,
  );
});
test('DTO検証は資格情報等を捨て、悪意あるサムネイル・巨大配列・不正カウンターを拒否する', () => {
  assert.deepEqual(
    validateVideoMetadata({ ...dto, cookie: 'secret', jwt: 'secret', status: '削除済み' }, 'sm9'),
    dto,
  );
  for (const patch of [
    { id: 'sm8' },
    { thumb: 'https://evil.invalid/pixel' },
    { thumb: 'https://nimg.jp@evil.invalid/' },
    { thumb: 'javascript:alert(1)' },
    { tags: ['a'.repeat(201)] },
    { tags: Array(101).fill('a') },
    { views: -1 },
    { views: NaN },
    { title: 55 },
  ])
    assert.throws(() => validateVideoMetadata({ ...dto, ...patch }, 'sm9'));
});
test('長さヘッダーがない巨大応答も途中で打ち切り、streamを閉じる', async () => {
  let canceled = false;
  const response = new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(10));
        c.enqueue(new Uint8Array(10));
      },
      cancel() {
        canceled = true;
      },
    }),
  );
  await assert.rejects(readTextLimited(response, 15), /TOO_LARGE/);
  assert.equal(canceled, true);
});
async function gateway(fetchUpstream, work) {
  const server = createServer(makeGatewayHandler({ token, fetchUpstream }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await work('http://127.0.0.1:' + server.address().port);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}
test('実HTTP gatewayは鍵と固定パスを検証し、Cookieを外へ送らずXMLを返す', async () => {
  let calls = 0;
  await gateway(
    async (url, init) => {
      calls++;
      assert.equal(url.href, videoMetadataUpstreamUrl('sm9').href);
      assert.equal(init.redirect, 'manual');
      assert.equal(new Headers(init.headers).has('Cookie'), false);
      return new Response(xml, { headers: { 'content-type': 'text/xml; charset=UTF-8' } });
    },
    async (base) => {
      assert.equal((await fetch(base + '/v1/video-metadata/sm9')).status, 401);
      const headers = { 'X-Nico-Shelf-Gateway-Key': token };
      assert.equal(
        (await fetch(base + '/v1/video-metadata/sm9?url=https://evil.invalid', { headers })).status,
        400,
      );
      assert.equal(
        (await fetch(base + '/v1/video-metadata/sm9', { method: 'POST', headers })).status,
        405,
      );
      const response = await fetch(base + '/v1/video-metadata/sm9', {
        headers: { ...headers, Cookie: 'never-forward' },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), dto);
      assert.equal(calls, 1);
    },
  );
});
test('gatewayは非公開エラー・redirect・巨大XMLを安全なコードへ変換する', async () => {
  for (const [response, code] of [
    [
      new Response('<nicovideo_thumb_response status="fail"/>', {
        headers: { 'content-type': 'text/xml' },
      }),
      'UPSTREAM_METADATA_UNAVAILABLE',
    ],
    [new Response('private details', { status: 302 }), 'UPSTREAM_HTTP_ERROR'],
    [
      new Response('x'.repeat(350001), { headers: { 'content-type': 'text/xml' } }),
      'UPSTREAM_TOO_LARGE',
    ],
  ])
    await gateway(
      async () => response,
      async (base) => {
        const r = await fetch(base + '/v1/video-metadata/sm9', {
          headers: { 'X-Nico-Shelf-Gateway-Key': token },
        });
        assert.equal(r.status, 502);
        const body = await r.json();
        assert.equal(body.code, code);
        assert.equal(JSON.stringify(body).includes('private details'), false);
      },
    );
});
async function mockedFetch(fn, work) {
  const old = globalThis.fetch;
  globalThis.fetch = fn;
  try {
    await work();
  } finally {
    globalThis.fetch = old;
  }
}
test('Workerは認証→アカウント制限を通し、セッションをRenderに渡さない', async () => {
  let calls = 0;
  const keys = [];
  const active = env();
  active.PUBLIC_MYLIST_USER_RATE_LIMIT = {
    limit: async ({ key }) => {
      keys.push(key);
      return { success: true };
    },
  };
  await mockedFetch(
    async (url, init) => {
      calls++;
      assert.equal(url, 'https://gateway.example/v1/video-metadata/sm9');
      const h = new Headers(init.headers);
      assert.equal(h.get('X-Nico-Shelf-Gateway-Key'), token);
      assert.equal(h.has('Authorization'), false);
      assert.equal(h.has('Cookie'), false);
      assert.equal(init.redirect, 'manual');
      return Response.json({ ...dto, cookie: 'secret' });
    },
    async () => {
      assert.equal((await handleVideoMetadataRequest(new Request(endpoint), active)).status, 401);
      assert.equal(calls, 0);
      const response = await worker.fetch(
        authenticatedRequest(endpoint, { headers: { Cookie: 'private' } }),
        active,
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), dto);
      assert.deepEqual(keys, ['nico-user:' + USER_ID]);
      assert.equal(calls, 1);
      active.PUBLIC_MYLIST_USER_RATE_LIMIT = { limit: async () => ({ success: false }) };
      assert.equal(
        (await handleVideoMetadataRequest(authenticatedRequest(endpoint), active)).status,
        429,
      );
      assert.equal(calls, 1);
    },
  );
});
test('Workerは未設定・不正パスを停止し、gatewayの生レスポンスや秘密を返さない', async () => {
  await mockedFetch(
    async () => Response.json({ code: 'UNEXPECTED', error: 'sensitive-internal-detail', token }),
    async () => {
      for (const suffix of ['/sm9?url=x', '/sm9/extra', '/https://evil.invalid'])
        assert.equal(
          (
            await handleVideoMetadataRequest(
              authenticatedRequest('https://app.example/api/video-metadata' + suffix),
              env(),
            )
          ).status,
          400,
        );
      const body = await (
        await handleVideoMetadataRequest(authenticatedRequest(endpoint), env())
      ).json();
      assert.equal(body.code, 'GATEWAY_INVALID_DATA');
      assert.equal(JSON.stringify(body).includes(token), false);
      const active = env();
      delete active.PUBLIC_MYLIST_GATEWAY_TOKEN;
      assert.equal(
        (await handleVideoMetadataRequest(authenticatedRequest(endpoint), active)).status,
        503,
      );
    },
  );
  await mockedFetch(
    async () =>
      Response.json({ code: 'UPSTREAM_METADATA_UNAVAILABLE', error: token }, { status: 502 }),
    async () => {
      const body = await (
        await handleVideoMetadataRequest(authenticatedRequest(endpoint), env())
      ).json();
      assert.equal(body.code, 'UPSTREAM_METADATA_UNAVAILABLE');
      assert.equal(JSON.stringify(body).includes(token), false);
    },
  );
});
test('ブラウザは同一originの固定パスだけにログイン情報を送り、手動修正を保持する', async () => {
  const auth = { getSession: async () => ({ data: { session: { access_token: SESSION_TOKEN } } }) };
  const request = createMetadataFetch(auth, async (url, init) => {
    assert.equal(url, '/api/video-metadata/sm9');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, 'Bearer ' + SESSION_TOKEN);
    return Response.json(dto);
  });
  for (const id of ['https://evil.invalid', 'sm9?x=1']) await assert.rejects(request(id));
  const remote = await request('sm9');
  const patch = mergeMetadata(
    { id: 'sm9', title: '自分のタイトル', voices: ['手動歌唱者'], likes: 7 },
    remote,
  );
  assert.equal(patch.title, undefined);
  assert.equal(patch.voices, undefined);
  assert.equal(patch.likes, undefined);
  assert.equal(patch.thumb, dto.thumb);
  await assert.rejects(
    createMetadataFetch(auth, async () =>
      Response.json({ error: '取得不可', code: 'UPSTREAM_METADATA_UNAVAILABLE' }, { status: 502 }),
    )('sm9'),
    /取得不可/,
  );
});
