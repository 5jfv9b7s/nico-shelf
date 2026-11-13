import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createSessionVerifier } from '../worker/session-auth.js';
import { handlePublicMylistRequest } from '../worker/index.js';
import { createAuthenticatedPublicFetch } from '../src/app/public-fetch.js';
import { registerEventHandlers } from '../src/app/events.js';
import { createInitialState } from '../src/app/state.js';
import { createViewRenderer } from '../src/ui/views.js';
import { AUTH_ENV, USER_ID, authenticatedRequest } from './fixtures/session.mjs';

const endpoint = 'https://app.example/api/public-mylists/101?page=1';
const hmacKey = new TextEncoder().encode(AUTH_ENV.SUPABASE_JWT_SECRET);
const issuer = `${AUTH_ENV.SUPABASE_URL}/auth/v1`;
const read = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

async function tokenFor(key = hmacKey, { alg = 'HS256', kid, ...claims } = {}) {
  return new SignJWT({
    role: 'authenticated',
    sub: USER_ID,
    iss: issuer,
    aud: 'authenticated',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  })
    .setProtectedHeader({ alg, typ: 'JWT', ...(kid ? { kid } : {}) })
    .sign(key);
}
const requestFor = (token) =>
  new Request(endpoint, { headers: { Authorization: `Bearer ${token}` } });

test('Workerは未ログイン・偽造署名を取得サーバーへ渡す前に拒否する', async () => {
  const savedFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error('must not reach upstream');
  };
  try {
    const env = {
      ...AUTH_ENV,
      PUBLIC_MYLIST_SOURCE: 'direct',
      PUBLIC_MYLIST_RATE_LIMIT: { limit: async () => ({ success: true }) },
    };
    assert.equal((await handlePublicMylistRequest(new Request(endpoint), env)).status, 401);
    const forged = await tokenFor(
      new TextEncoder().encode('different-test-key-with-more-than-32-characters'),
    );
    const response = await handlePublicMylistRequest(requestFor(forged), env);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, 'AUTH_INVALID');
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test('署名が正しくても期限・発行元・対象・権限・ユーザーIDが不正なら拒否する', async () => {
  const verify = createSessionVerifier();
  for (const claims of [
    { exp: Math.floor(Date.now() / 1000) - 60 },
    { nbf: Math.floor(Date.now() / 1000) + 60 },
    { iss: 'https://untrusted.example/auth/v1' },
    { aud: 'another-service' },
    { role: 'anon' },
    { role: 'service_role' },
    { sub: 'not-a-user-id' },
    { sub: [USER_ID] },
  ]) {
    assert.equal((await verify(requestFor(await tokenFor(hmacKey, claims)), AUTH_ENV)).status, 401);
  }
  const valid = await verify(authenticatedRequest(endpoint), AUTH_ENV);
  assert.equal(valid.subject, USER_ID);
});

test('HS256の既存セッションも外部Authへの問い合わせなしで検証する', async () => {
  const verify = createSessionVerifier({
    fetchKeys: async () => {
      throw new Error('network forbidden');
    },
  });
  assert.equal((await verify(authenticatedRequest(endpoint), AUTH_ENV)).subject, USER_ID);
  assert.equal(
    (await verify(authenticatedRequest(endpoint), { SUPABASE_URL: AUTH_ENV.SUPABASE_URL })).code,
    'AUTH_LEGACY_KEY_REQUIRED',
  );
  assert.equal((await verify(authenticatedRequest(endpoint), {})).code, 'AUTH_NOT_CONFIGURED');
  assert.equal(
    (
      await verify(authenticatedRequest(endpoint), {
        ...AUTH_ENV,
        SUPABASE_URL: 'http://auth.example',
      })
    ).status,
    503,
  );
});

test('ES256・RS256は固定JWKSから取得した公開鍵を再利用し、セッションをローカル検証する', async () => {
  for (const alg of ['ES256', 'RS256']) {
    const { publicKey, privateKey } = await generateKeyPair(alg);
    const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg, use: 'sig' };
    let fetches = 0;
    const verify = createSessionVerifier({
      fetchKeys: async (url, init) => {
        fetches++;
        assert.equal(String(url), `${issuer}/.well-known/jwks.json`);
        assert.equal(init.redirect, 'manual');
        return Response.json({ keys: [jwk] });
      },
    });
    const signed = await tokenFor(privateKey, { alg, kid: 'test-key' });
    for (let index = 0; index < 3; index++) {
      assert.equal(
        (await verify(requestFor(signed), { SUPABASE_URL: AUTH_ENV.SUPABASE_URL })).subject,
        USER_ID,
      );
    }
    assert.equal(fetches, 1);
  }
});

test('鍵の取得障害と未知のキーでも認証を通さず、トークンをエラー本文へ含めない', async () => {
  const { privateKey } = await generateKeyPair('ES256');
  const signed = await tokenFor(privateKey, { alg: 'ES256', kid: 'unknown-key' });
  const offline = createSessionVerifier({
    fetchKeys: async () => {
      throw new TypeError('offline');
    },
  });
  const failure = await offline(requestFor(signed), { SUPABASE_URL: AUTH_ENV.SUPABASE_URL });
  assert.equal(failure.status, 503);
  assert.ok(!JSON.stringify(failure).includes(signed));
  const empty = createSessionVerifier({ fetchKeys: async () => Response.json({ keys: [] }) });
  assert.equal(
    (await empty(requestFor(signed), { SUPABASE_URL: AUTH_ENV.SUPABASE_URL })).status,
    401,
  );
});

test('ブラウザはページごとに現在のセッションを付け、外部URLへの送信を拒否する', async () => {
  const calls = [];
  let sessions = 0;
  const fetchPage = createAuthenticatedPublicFetch(
    { getSession: async () => ({ data: { session: { access_token: `session-${++sessions}` } } }) },
    async (url, init) => {
      calls.push({ url, token: init.headers.get('Authorization'), cache: init.cache });
      return Response.json({ ok: true });
    },
  );
  await fetchPage('/api/public-mylists/101?page=1', { cache: 'no-store' });
  await fetchPage('/api/public-mylists/101?page=2');
  assert.deepEqual(
    calls.map((call) => call.token),
    ['Bearer session-1', 'Bearer session-2'],
  );
  assert.equal(calls[0].cache, 'no-store');
  await assert.rejects(
    () => fetchPage('https://evil.example/api/public-mylists/101?page=1'),
    /取得先/,
  );
  assert.equal(sessions, 2);
  const loggedOut = createAuthenticatedPublicFetch(
    { getSession: async () => ({ data: { session: null } }) },
    async () => {
      throw new Error('no request allowed');
    },
  );
  await assert.rejects(() => loggedOut('/api/public-mylists/101?page=1'), /ログイン/);
});

test('サムネイル失敗はキャプチャ段階の委譲で処理し、HTMLにイベント属性を含めない', () => {
  const listeners = [];
  const state = createInitialState();
  state.view = 'library';
  state.library.videos = [{ id: 'sm1', title: 'test', thumb: 'https://nicovideo.jp/thumb.jpg' }];
  const root = { addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }) };
  registerEventHandlers({ root, state, actions: {} });
  const html = createViewRenderer({ state, renderDialog: () => '' }).content();
  assert.match(html, /data-thumbnail/);
  assert.doesNotMatch(html, /\son(?:error|load|click)=/i);
  const handler = listeners.find((listener) => listener.type === 'error');
  assert.equal(handler.capture, true);
  let removed = 0;
  handler.fn({
    target: {
      matches: (selector) => selector === '.cover img[data-thumbnail]',
      remove: () => removed++,
    },
  });
  handler.fn({ target: { matches: () => false, remove: () => removed++ } });
  assert.equal(removed, 1);
});

test('CSPは外部スクリプト・イベント属性を制限し、ビルドで必要な画像と接続先を許可する', async () => {
  const headers = await read('public/_headers');
  const policy = headers.split('\n').find((line) => line.includes('Content-Security-Policy:'));
  assert.match(policy, /script-src 'self';/);
  assert.match(policy, /script-src-attr 'none'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /connect-src 'self' https:\/\/\*\.supabase\.co/);
  assert.doesNotMatch(policy.split('style-src')[0], /unsafe-inline|unsafe-eval/);
  assert.match(await read('src/supabase.js'), /flowType:\s*['"]pkce['"]/);
});

test('JWKSの移動応答は追跡せず、取得できない鍵で認証を通さない', async () => {
  const { privateKey } = await generateKeyPair('ES256');
  const token = await tokenFor(privateKey, { alg: 'ES256', kid: 'redirected-key' });
  let calls = 0;
  const verify = createSessionVerifier({
    fetchKeys: async (_url, init) => {
      calls++;
      assert.equal(init.redirect, 'manual');
      return new Response('', {
        status: 302,
        headers: { Location: 'https://untrusted.example/jwks' },
      });
    },
  });
  assert.equal(
    (await verify(requestFor(token), { SUPABASE_URL: AUTH_ENV.SUPABASE_URL })).status,
    503,
  );
  assert.equal(calls, 1);
});

test('パス接頭辞があるSupabaseのプロジェクトURLでも同じ発行元を検証する', async () => {
  const environment = { ...AUTH_ENV, SUPABASE_URL: 'https://auth.example/supabase/' };
  const token = await tokenFor(hmacKey, { iss: 'https://auth.example/supabase/auth/v1' });
  assert.equal((await createSessionVerifier()(requestFor(token), environment)).subject, USER_ID);
});
