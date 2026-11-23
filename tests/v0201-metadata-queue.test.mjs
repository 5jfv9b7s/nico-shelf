import test from 'node:test';
import assert from 'node:assert/strict';
import { runMetadataQueue, abortError, metadataJobInitial } from '../src/app/metadata-queue.js';
import { createMetadataFetch } from '../src/app/metadata-fetch.js';
import { createMetadataEnricher } from '../src/app/metadata-enrichment.js';
import { renderMetadataProgress, updateMetadataProgress } from '../src/ui/metadata-progress.js';
import { registerEventHandlers } from '../src/app/events.js';
import { handleVideoMetadataRequest } from '../worker/index.js';
import { AUTH_ENV, authenticatedRequest } from './fixtures/session.mjs';

function clock() {
  let time = 0;
  return {
    now: () => time,
    sleep: async (ms, signal) => {
      if (signal?.aborted) throw abortError();
      time += ms;
    },
  };
}
const ids = (n) => Array.from({ length: n }, (_, i) => 'sm' + (i + 1));
const fail = (code, status = 502, retryAfterMs) =>
  Object.assign(new Error(code), { code, status, retryAfterMs });

test('40件を1回で順次補完し、重複IDを除去、15件ごとに休憩して自動継続する', async () => {
  const time = clock(),
    calls = [],
    updates = [];
  let active = 0,
    maximum = 0;
  const result = await runMetadataQueue([...ids(40), 'sm1'], {
    ...time,
    enrich: async (id) => {
      active++;
      maximum = Math.max(active, maximum);
      calls.push(id);
      await Promise.resolve();
      active--;
    },
    onProgress: (job) => updates.push(job),
  });
  assert.deepEqual(calls, ids(40));
  assert.equal(maximum, 1);
  assert.equal(result.phase, 'done');
  assert.equal(result.ok, 40);
  assert.equal(result.remaining, 0);
  assert.equal(time.now(), 24800);
  assert.deepEqual(
    [...new Set(updates.filter((job) => job.phase === 'resting').map((job) => job.processed))],
    [15, 30],
  );
});
test('待機中の中止は即座に効き、次の動画を取得しない', async () => {
  const c = new AbortController(),
    time = clock(),
    calls = [];
  const result = await runMetadataQueue(ids(20), {
    ...time,
    signal: c.signal,
    enrich: async (id) => calls.push(id),
    onProgress: (job) => {
      if (job.phase === 'resting') c.abort();
    },
  });
  assert.equal(calls.length, 15);
  assert.equal(result.phase, 'cancelled');
  assert.equal(result.ok, 15);
  assert.equal(result.remaining, 5);
});
test('アクセス制限時はRetry-Afterを待ち、同じ動画から再開して二重カウントしない', async () => {
  const time = clock(),
    calls = [],
    waiting = [];
  const result = await runMetadataQueue(ids(2), {
    ...time,
    enrich: async (id) => {
      calls.push(id);
      if (calls.length === 1) throw fail('UPSTREAM_RATE_LIMITED', 429, 120000);
    },
    onProgress: (job) => {
      if (job.phase === 'rate-wait') waiting.push(job);
    },
  });
  assert.deepEqual(calls, ['sm1', 'sm1', 'sm2']);
  assert.equal(result.ok, 2);
  assert.equal(result.failed, 0);
  assert.equal(waiting[0].waitSeconds, 120);
  assert.ok(waiting.every((j) => j.processed === 0));
});
test('アクセス制限が続けば2回待機した後に停止し、無限再送しない', async () => {
  const time = clock();
  let calls = 0;
  const result = await runMetadataQueue(ids(20), {
    ...time,
    enrich: async () => {
      calls++;
      throw fail('ACCOUNT_RATE_LIMITED', 429);
    },
  });
  assert.equal(calls, 3);
  assert.equal(time.now(), 120000);
  assert.equal(result.phase, 'stopped');
  assert.equal(result.processed, 0);
  assert.equal(result.remaining, 20);
});
test('HTTP 406等のエラーが3件続いたら停止し、全件にアクセスしない', async () => {
  let calls = 0;
  const result = await runMetadataQueue(ids(40), {
    ...clock(),
    enrich: async () => {
      calls++;
      throw fail('UPSTREAM_HTTP_ERROR');
    },
  });
  assert.equal(calls, 3);
  assert.equal(result.phase, 'stopped');
  assert.equal(result.failed, 3);
  assert.equal(result.remaining, 37);
  assert.equal(result.failures.length, 3);
});
test('個別の削除・非公開動画はスキップして続行し、失敗例の保持数を制限する', async () => {
  const result = await runMetadataQueue(ids(30), {
    ...clock(),
    enrich: async () => {
      throw fail('UPSTREAM_METADATA_UNAVAILABLE');
    },
  });
  assert.equal(result.phase, 'done');
  assert.equal(result.failed, 30);
  assert.equal(result.processed, 30);
  assert.equal(result.failures.length, 3);
});
test('認証・設定エラーやライブラリ切替では停止する', async () => {
  for (const code of ['AUTH_INVALID', 'METADATA_NOT_CONFIGURED', 'RATE_LIMIT_UNCONFIGURED']) {
    let calls = 0;
    const result = await runMetadataQueue(ids(10), {
      ...clock(),
      enrich: async () => {
        calls++;
        throw fail(code);
      },
    });
    assert.equal(result.phase, 'stopped');
    assert.equal(calls, 1);
    assert.equal(result.remaining, 10);
  }
  let current = true,
    calls = 0;
  const result = await runMetadataQueue(ids(10), {
    ...clock(),
    isCurrent: () => current,
    enrich: async () => {
      calls++;
      current = false;
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.phase, 'stopped');
});
test('アクセス制限の待機中にも中止でき、再送しない', async () => {
  const c = new AbortController();
  let calls = 0;
  const result = await runMetadataQueue(ids(10), {
    ...clock(),
    signal: c.signal,
    enrich: async () => {
      calls++;
      throw fail('UPSTREAM_RATE_LIMITED');
    },
    onProgress: (job) => {
      if (job.phase === 'rate-wait') c.abort();
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.phase, 'cancelled');
  assert.equal(result.remaining, 10);
});
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function enricherFixture() {
  const remote = deferred(),
    save = deferred(),
    writes = [],
    filters = [];
  const state = {
    user: { id: 'owner-a' },
    metadataSource: 'bridge',
    library: { videos: [{ id: 'sm1', title: 'sm1', voices: [] }] },
  };
  const builder = {
    eq: (k, v) => {
      filters.push([k, v]);
      return builder;
    },
    then: (ok, no) => save.promise.then(ok, no),
  };
  const client = {
    from: () => ({
      update: (patch) => {
        writes.push(patch);
        return builder;
      },
    }),
  };
  const enrich = createMetadataEnricher({
    state,
    client,
    nicoBridge: { request: () => remote.promise },
  });
  return { state, remote, save, writes, filters, enrich };
}
test('通信中にアカウント・ライブラリが変わった場合はDBへ書き込まない', async () => {
  for (const kind of ['owner', 'library']) {
    const f = enricherFixture(),
      run = f.enrich('sm1');
    if (kind === 'owner') f.state.user = { id: 'owner-b' };
    else f.state.library = { videos: [] };
    f.remote.resolve({ id: 'sm1', title: '取得した曲', tags: ['音街ウナ'] });
    await assert.rejects(run, { code: 'STALE_LIBRARY' });
    assert.equal(f.writes.length, 0);
  }
});
test('中止後のTampermonkey遅延応答は保存せず、未処理として残す', async () => {
  const f = enricherFixture(),
    c = new AbortController(),
    run = f.enrich('sm1', { signal: c.signal });
  c.abort();
  await assert.rejects(run, { name: 'AbortError' });
  f.remote.resolve({ id: 'sm1', title: '遅延した曲' });
  await Promise.resolve();
  assert.equal(f.writes.length, 0);
});
test('送信済みのDB保存は完了してから中止し、成功件数を保持する', async () => {
  const f = enricherFixture(),
    c = new AbortController();
  const run = runMetadataQueue(['sm1', 'sm2'], { ...clock(), signal: c.signal, enrich: f.enrich });
  f.remote.resolve({ id: 'sm1', title: '取得した曲', tags: ['音街ウナ'] });
  // Flush the remote read and thenable database save into its pending state.
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(f.writes.length, 1);
  c.abort();
  f.save.resolve({ error: null });
  const result = await run;
  assert.equal(result.phase, 'cancelled');
  assert.equal(result.ok, 1);
  assert.equal(result.remaining, 1);
  assert.deepEqual(f.filters, [
    ['owner_id', 'owner-a'],
    ['id', 'sm1'],
  ]);
  assert.equal(f.state.library.videos[0].title, '取得した曲');
});
test('進捗は既存ノードを更新してフォーカスを保ち、エラー文字列をエスケープする', () => {
  const job = {
    ...metadataJobInitial(20),
    processed: 3,
    ok: 2,
    failed: 1,
    remaining: 17,
    failures: ['<script>alert(1)</script>'],
  };
  const progress = {},
    message = {},
    failure = {},
    cancel = {};
  const root = {
    querySelectorAll: (selector) =>
      ({
        '[data-metadata-message]': [message],
        '[data-metadata-progress]': [progress],
        '[data-metadata-failure]': [failure],
        '[data-metadata-cancel]': [cancel],
      })[selector] || [],
  };
  updateMetadataProgress(root, job);
  assert.equal(progress.value, 3);
  assert.match(message.textContent, /3\/20件/);
  assert.equal(cancel.disabled, false);
  const html = renderMetadataProgress(job);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /補完を中止する/);
  updateMetadataProgress(root, { ...job, cancelRequested: true });
  assert.equal(cancel.disabled, true);
  assert.match(cancel.textContent, /中止しています/);
});
test('中止ボタンは処理中でもイベント委譲で受け付ける', () => {
  const listeners = {};
  let canceled = 0;
  registerEventHandlers({
    root: { addEventListener: (name, fn) => (listeners[name] ||= []).push(fn) },
    state: { user: { id: 'a' }, busy: true },
    actions: { cancelMetadata: () => canceled++ },
  });
  const button = { dataset: { metadataCancel: '' }, id: '' };
  for (const fn of listeners.click) fn({ target: { closest: () => button } });
  assert.equal(canceled, 1);
});
test('取得エラーは状態・Retry-After・上流HTTP番号を保持し、中止済みなら通信しない', async () => {
  const auth = {
    getSession: async () => ({ data: { session: { access_token: 'synthetic-session' } } }),
  };
  const fetch = createMetadataFetch(auth, async () =>
    Response.json(
      { code: 'UPSTREAM_RATE_LIMITED', error: '待機', upstreamStatus: 429 },
      { status: 429, headers: { 'Retry-After': '120' } },
    ),
  );
  await assert.rejects(
    fetch('sm1'),
    (error) =>
      error.status === 429 &&
      error.code === 'UPSTREAM_RATE_LIMITED' &&
      error.retryAfterMs === 120000 &&
      error.message.includes('上流HTTP 429'),
  );
  await assert.rejects(
    createMetadataFetch(auth, async () => new Response('busy', { status: 429 }))('sm1'),
    (e) => e.code === 'RATE_LIMITED',
  );
  const c = new AbortController();
  c.abort();
  let calls = 0;
  await assert.rejects(
    createMetadataFetch(auth, async () => calls++)('sm1', { signal: c.signal }),
    { name: 'AbortError' },
  );
  assert.equal(calls, 0);
});
test('Workerは上流429を待機可能な応答へ変換し、HTTP診断は数値だけを渡す', async () => {
  const old = globalThis.fetch;
  const env = {
    ...AUTH_ENV,
    PUBLIC_MYLIST_SOURCE: 'gateway',
    PUBLIC_MYLIST_GATEWAY_URL: 'https://gateway.example/',
    PUBLIC_MYLIST_GATEWAY_TOKEN: 'synthetic-gateway-token-24-chars',
    PUBLIC_MYLIST_RATE_LIMIT: { limit: async () => ({ success: true }) },
  };
  try {
    globalThis.fetch = async () =>
      Response.json(
        { code: 'UPSTREAM_RATE_LIMITED', error: 'private', upstreamStatus: 429, cookie: 'private' },
        { status: 503 },
      );
    const r = await handleVideoMetadataRequest(
      authenticatedRequest('https://app.example/api/video-metadata/sm1'),
      env,
    );
    assert.equal(r.status, 429);
    assert.equal(r.headers.get('Retry-After'), '60');
    const body = await r.json();
    assert.equal(body.upstreamStatus, 429);
    assert.equal(JSON.stringify(body).includes('private'), false);
    globalThis.fetch = async () =>
      Response.json({ code: 'UPSTREAM_HTTP_ERROR', upstreamStatus: 406 }, { status: 502 });
    assert.equal(
      (
        await (
          await handleVideoMetadataRequest(
            authenticatedRequest('https://app.example/api/video-metadata/sm1'),
            env,
          )
        ).json()
      ).upstreamStatus,
      406,
    );
  } finally {
    globalThis.fetch = old;
  }
});

import { createMetadataController } from '../src/app/metadata-controller.js';
import { createInitialState } from '../src/app/state.js';
function controllerFixture(enrich) {
  const state = createInitialState();
  state.user = { id: 'a' };
  state.library.videos = ids(40).map((id) => ({ id, title: id }));
  state.dialog = { kind: 'metadata' };
  const root = { querySelectorAll: () => [] };
  let refreshed = 0,
    renders = 0;
  const controller = createMetadataController({
    state,
    root,
    enrich,
    nicoBridge: { connected: false },
    connectNico: () => assert.fail('server mode must not connect'),
    render: () => renders++,
    refresh: async () => {
      refreshed++;
    },
    toast() {},
    runQueue: (list, opts) => runMetadataQueue(list, { ...opts, ...clock() }),
  });
  return { state, controller, refreshed: () => refreshed, renders: () => renders };
}
test('画面を閉じても40件を自動継続し、実行中の再クリックでは二重起動しない', async () => {
  const block = deferred();
  const calls = [];
  const f = controllerFixture(async (id) => {
    calls.push(id);
    if (calls.length === 1) await block.promise;
  });
  const run = f.controller.start();
  assert.equal(f.state.busy, true);
  await f.controller.start();
  f.state.dialog = null;
  block.resolve();
  const result = await run;
  assert.equal(calls.length, 40);
  assert.equal(result.ok, 40);
  assert.equal(f.state.metadataJob.phase, 'done');
  assert.equal(f.state.busy, false);
  assert.equal(f.refreshed(), 1);
  assert.equal(f.renders(), 2);
});
test('アカウント切替は処理を破棄し、古い処理の完了で次の画面状態を上書きしない', async () => {
  const block = deferred();
  const f = controllerFixture(async () => block.promise);
  const run = f.controller.start();
  f.controller.reset();
  f.state.user = { id: 'b' };
  f.state.metadataProgress = 'new account';
  block.resolve();
  await run;
  assert.equal(f.refreshed(), 0);
  assert.equal(f.state.metadataJob, null);
  assert.equal(f.state.metadataProgress, 'new account');
  assert.equal(f.state.busy, false);
});
