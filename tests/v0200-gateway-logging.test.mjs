import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGatewayHandler } from '../gateway/server.mjs';

for (const [path, status, kind, id, page] of [
  ['/v1/video-metadata/sm9', 302, 'metadata', 'sm9', 1],
  ['/v1/video-metadata/nm123', 503, 'metadata', 'nm123', 1],
  ['/v1/public-mylists/101?page=2', 500, 'mylist', '101', 2],
]) {
  test(`HTTP ${status}: ${kind}は実際のHTTP番号を安全なログに残し、応答形式を維持`, async () => {
    const logs = [];
    const warn = console.warn;
    const token = 'synthetic-private-gateway-token-for-logging-test';
    console.warn = (...args) => logs.push(args);
    try {
      const handler = makeGatewayHandler({
        token,
        fetchUpstream: async (url, init) => {
          assert.equal(init.redirect, 'manual');
          return new Response('sensitive-upstream-response', {
            status,
            headers: { Location: 'https://private.example/internal-redirect' },
          });
        },
      });
      let resultStatus, resultBody;
      await handler(
        {
          method: 'GET',
          url: path,
          headers: {
            'x-nico-shelf-gateway-key': token,
            authorization: 'private-session',
            cookie: 'private-cookie',
          },
        },
        {
          writeHead(code) {
            resultStatus = code;
          },
          end(body) {
            resultBody = JSON.parse(body);
          },
        },
      );
      assert.equal(resultStatus, 502);
      assert.deepEqual(resultBody, { code: 'UPSTREAM_HTTP_ERROR', upstreamStatus: status });
      assert.deepEqual(logs, [['[gateway] upstream HTTP error', { id, page, kind, status }]]);
      const text = JSON.stringify(logs);
      for (const secret of [
        token,
        'private-session',
        'private-cookie',
        'sensitive-upstream-response',
        'private.example',
      ])
        assert.equal(text.includes(secret), false);
    } finally {
      console.warn = warn;
    }
  });
}
