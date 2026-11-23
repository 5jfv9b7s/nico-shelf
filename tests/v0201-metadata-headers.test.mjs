import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGatewayHandler } from '../gateway/server.mjs';
const token = 'synthetic-gateway-shared-token-24-characters';
async function call(path, fetchUpstream) {
  let status, body;
  await makeGatewayHandler({ token, fetchUpstream })(
    { method: 'GET', url: path, headers: { 'x-nico-shelf-gateway-key': token } },
    {
      writeHead(code) {
        status = code;
      },
      end(value) {
        body = JSON.parse(value);
      },
    },
  );
  return { status, body };
}
test('動画情報はAcceptを限定せず、NVAPI用ヘッダーを送らない', async () => {
  const response = await call('/v1/video-metadata/sm9', async (url, init) => {
    assert.equal(url.href, 'https://ext.nicovideo.jp/api/getthumbinfo/sm9');
    assert.deepEqual(init.headers, { Accept: '*/*' });
    assert.equal(init.redirect, 'manual');
    return new Response(
      '<nicovideo_thumb_response status="ok"><thumb><video_id>sm9</video_id><title>テスト曲</title><tags><tag>音街ウナ</tag></tags></thumb></nicovideo_thumb_response>',
      { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
    );
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.id, 'sm9');
  assert.deepEqual(response.body.tags, ['音街ウナ']);
});
test('公開マイリストは従来のNVAPI用ヘッダーを維持する', async () => {
  const response = await call('/v1/public-mylists/101?page=1', async (url, init) => {
    assert.equal(url.hostname, 'nvapi.nicovideo.jp');
    assert.deepEqual(init.headers, {
      'X-Frontend-Id': '6',
      'X-Frontend-Version': '0',
      'X-Niconico-Language': 'ja-jp',
      Accept: 'application/json',
    });
    return Response.json({
      data: { mylist: { name: 'リスト', items: [], totalItemCount: 0, hasNext: false } },
    });
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.name, 'リスト');
});
