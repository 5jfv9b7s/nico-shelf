import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SignJWT } from 'jose';
import { handlePublicMylistRequest } from '../worker/index.js';
import { AUTH_ENV, SESSION_TOKEN, USER_ID } from './fixtures/session.mjs';

const endpoint = 'https://app.example/api/public-mylists/101?page=1';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const otherToken = await new SignJWT({ role: 'authenticated' })
  .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
  .setSubject(OTHER_ID)
  .setIssuer(AUTH_ENV.SUPABASE_URL + '/auth/v1')
  .setAudience('authenticated')
  .setIssuedAt()
  .setExpirationTime('1h')
  .sign(new TextEncoder().encode(AUTH_ENV.SUPABASE_JWT_SECRET));
const request = (token = SESSION_TOKEN, ip = '203.0.113.12') =>
  new Request(endpoint, {
    headers: { Authorization: 'Bearer ' + token, 'CF-Connecting-IP': ip, 'X-User-Id': OTHER_ID },
  });
const env = () => ({
  ...AUTH_ENV,
  PUBLIC_MYLIST_SOURCE: 'gateway',
  PUBLIC_MYLIST_GATEWAY_URL: 'https://gateway.example/',
  PUBLIC_MYLIST_GATEWAY_TOKEN: 'synthetic-gateway-key-at-least-24-characters',
  PUBLIC_MYLIST_RATE_LIMIT: { limit: async () => ({ success: true }) },
});
async function withUpstream(work) {
  const fetch = globalThis.fetch,
    log = console.error,
    logs = [];
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({
      id: '101',
      page: 1,
      pageSize: 100,
      name: '公開リスト',
      totalCount: 1,
      hasNext: false,
      items: [{ video_id: 'sm1', title: '曲' }],
    });
  };
  console.error = (...args) => logs.push(args.join(' '));
  try {
    await work(() => calls);
  } finally {
    globalThis.fetch = fetch;
    console.error = log;
  }
  const captured = logs.join('\n');
  for (const secret of [SESSION_TOKEN, otherToken, USER_ID, OTHER_ID, 'sensitive-internal-detail'])
    assert.ok(!captured.includes(secret));
}
test('共有IPでもアカウント枠を分離し、IP変更や偽装IDヘッダーで枠を変更できない', async () => {
  await withUpstream(async (calls) => {
    const quotas = new Map(),
      accountKeys = [],
      ipKeys = [];
    const active = {
      ...env(),
      PUBLIC_MYLIST_RATE_LIMIT: {
        limit: async ({ key }) => {
          ipKeys.push(key);
          return { success: true };
        },
      },
      PUBLIC_MYLIST_USER_RATE_LIMIT: {
        limit: async ({ key }) => {
          accountKeys.push(key);
          const count = (quotas.get(key) || 0) + 1;
          quotas.set(key, count);
          return { success: count <= 1 };
        },
      },
    };
    assert.equal((await handlePublicMylistRequest(request(), active)).status, 200);
    const blocked = await handlePublicMylistRequest(request(), active);
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).code, 'ACCOUNT_RATE_LIMITED');
    assert.equal(blocked.headers.get('Retry-After'), '60');
    assert.equal((await handlePublicMylistRequest(request(otherToken), active)).status, 200);
    assert.equal(
      (await handlePublicMylistRequest(request(otherToken, '203.0.113.55'), active)).status,
      429,
    );
    assert.deepEqual(accountKeys, [
      'nico-user:' + USER_ID,
      'nico-user:' + USER_ID,
      'nico-user:' + OTHER_ID,
      'nico-user:' + OTHER_ID,
    ]);
    assert.equal(new Set(ipKeys.slice(0, 3)).size, 1);
    assert.equal(calls(), 2);
  });
});
test('IP制限は認証前に適用し、無効な認証はアカウント枠を消費しない', async () => {
  await withUpstream(async (calls) => {
    let accounts = 0;
    const active = {
      ...env(),
      PUBLIC_MYLIST_USER_RATE_LIMIT: {
        limit: async () => {
          accounts++;
          return { success: true };
        },
      },
    };
    const denied = await handlePublicMylistRequest(request('invalid'), {
      ...active,
      PUBLIC_MYLIST_RATE_LIMIT: { limit: async () => ({ success: false }) },
    });
    assert.equal(denied.status, 429);
    assert.equal((await denied.json()).code, 'RATE_LIMITED');
    const unauthenticated = await handlePublicMylistRequest(request('invalid'), active);
    assert.equal(unauthenticated.status, 401);
    assert.equal(accounts, 0);
    assert.equal(calls(), 0);
  });
});
test('アカウント制限の未設定・障害は上流へ接続せず503を返す', async () => {
  await withUpstream(async (calls) => {
    for (const [limiter, code] of [
      [undefined, 'ACCOUNT_RATE_LIMIT_UNCONFIGURED'],
      [
        {
          limit: async () => {
            throw new Error('sensitive-internal-detail');
          },
        },
        'ACCOUNT_RATE_LIMIT_FAILED',
      ],
    ]) {
      const response = await handlePublicMylistRequest(request(), {
        ...env(),
        PUBLIC_MYLIST_USER_RATE_LIMIT: limiter,
      });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, code);
    }
    assert.equal(calls(), 0);
  });
});
test('IPは粗い防御枠、アカウントは独立した名前空間の通常枠として設定する', async () => {
  const configuration = JSON.parse(
    await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
  );
  const ip = configuration.ratelimits.find((r) => r.name === 'PUBLIC_MYLIST_RATE_LIMIT');
  const account = configuration.ratelimits.find((r) => r.name === 'PUBLIC_MYLIST_USER_RATE_LIMIT');
  assert.equal(ip.simple.period, 60);
  assert.equal(account.simple.period, 60);
  assert.ok(ip.simple.limit >= account.simple.limit * 4);
  assert.notEqual(ip.namespace_id, account.namespace_id);
});
test('CSPはstyle要素のインラインを禁止し、属性の例外だけを明示する', async () => {
  const headers = await readFile(new URL('../public/_headers', import.meta.url), 'utf8');
  assert.match(headers, /style-src 'self';/);
  assert.match(headers, /style-src-elem 'self';/);
  assert.match(headers, /style-src-attr 'unsafe-inline';/);
  assert.match(headers, /script-src-attr 'none';/);
  assert.match(headers, /worker-src 'self';/);
});
