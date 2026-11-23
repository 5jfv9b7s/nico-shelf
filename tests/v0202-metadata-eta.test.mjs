import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateMetadataTiming } from '../src/app/metadata-estimate.js';
import { runMetadataQueue, metadataJobInitial } from '../src/app/metadata-queue.js';
import {
  metadataTimingText,
  renderMetadataProgress,
  updateMetadataProgress,
} from '../src/ui/metadata-progress.js';
const base = {
  total: 31,
  processed: 3,
  running: true,
  samples: [1000, 1000, 1000],
  startedAt: 0,
  now: 3800,
};

test('最初の2件は計算中、3件目から残り件数と今後の休憩を見積もる', () => {
  assert.equal(
    estimateMetadataTiming({ ...base, samples: [1000, 1000], processed: 2 }).etaMs,
    null,
  );
  assert.deepEqual(estimateMetadataTiming(base), { elapsedMs: 3800, etaMs: 48400 });
  assert.equal(estimateMetadataTiming({ ...base, total: 15 }).etaMs, 16800); // no pause after the last item
});
test('休憩中は残りの休憩秒数を加え、同じ休憩を二重計上しない', () => {
  const options = { ...base, processed: 15, now: 20000, waitUntil: 24500, gapPending: false };
  assert.equal(estimateMetadataTiming(options).etaMs, 31100);
  assert.equal(estimateMetadataTiming({ ...options, now: 21000 }).etaMs, 30100);
});
test('アクセス制限の既知の待機時間を加算し、経過時間とは分離する', () => {
  const current = { ...base, gapPending: false, now: 100000, waitUntil: 160000 };
  const timed = estimateMetadataTiming(current);
  assert.equal(timed.elapsedMs, 100000);
  assert.equal(timed.etaMs, 108000);
  assert.equal(estimateMetadataTiming({ ...current, now: 101000 }).etaMs, 107000);
});
test('進行中の1件の経過分を差し引き、長い通信でも負の残り時間にしない', () => {
  assert.equal(
    estimateMetadataTiming({ ...base, gapPending: false, now: 4400, requestStartedAt: 4200 }).etaMs,
    47800,
  );
  assert.equal(
    estimateMetadataTiming({
      ...base,
      total: 4,
      processed: 3,
      gapPending: false,
      requestStartedAt: 4000,
      now: 50000,
    }).etaMs,
    0,
  );
  assert.equal(estimateMetadataTiming({ ...base, running: false }).etaMs, null);
});

test('直近12件に追従し、古い遅延やアクセス制限待ちで平均速度を水増ししない', async () => {
  let time = 0,
    calls = 0;
  const updates = [];
  const result = await runMetadataQueue(
    Array.from({ length: 20 }, (_, i) => 'sm' + i),
    {
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
      enrich: async () => {
        calls++;
        time += calls === 1 ? 20000 : 1000;
      },
      onProgress: (job) => updates.push(job),
    },
  );
  const after13 = updates.find((j) => j.processed === 13);
  // 7 remaining reads (7s), six 400ms gaps and one 5s pause.
  assert.equal(after13.etaMs, 14400);
  assert.equal(result.elapsedMs, 51200);
  assert.equal(result.etaMs, null);
  assert.equal(result.phase, 'done');
});

test('経過・概算時間を読みやすく丸め、中止・完了後は残り時間を表示しない', () => {
  const job = metadataJobInitial(40);
  assert.equal(metadataTimingText(job), '経過 0秒 ／ 残り時間を計算中…');
  assert.equal(
    metadataTimingText({ ...job, elapsedMs: 125000, etaMs: 125000 }),
    '経過 2分5秒 ／ 残り約3分',
  );
  assert.match(metadataTimingText({ ...job, etaMs: 3760000 }), /残り約1時間5分/);
  assert.match(metadataTimingText({ ...job, etaMs: 0 }), /残り約5秒/);
  assert.equal(
    metadataTimingText({ ...job, running: false, elapsedMs: 125000, etaMs: 99999 }),
    '経過 2分5秒',
  );
  assert.doesNotMatch(metadataTimingText({ ...job, cancelRequested: true, etaMs: 99999 }), /残り/);
  assert.match(renderMetadataProgress(job), /時間は目安/);
});

test('残り時間だけを既存ノードへ更新し、停止後は時間の注記を隠す', () => {
  const timing = {},
    note = {},
    button = {};
  const root = {
    querySelectorAll: (selector) =>
      ({
        '[data-metadata-time]': [timing],
        '[data-metadata-time-note]': [note],
        '[data-metadata-cancel]': [button],
      })[selector] || [],
  };
  const job = { ...metadataJobInitial(20), elapsedMs: 65000, etaMs: 93000 };
  updateMetadataProgress(root, job);
  assert.equal(timing.textContent, '経過 1分5秒 ／ 残り約2分');
  assert.equal(note.hidden, false);
  updateMetadataProgress(root, { ...job, running: false });
  assert.equal(timing.textContent, '経過 1分5秒');
  assert.equal(note.hidden, true);
  assert.equal(button.hidden, true);
});

test('通信中にも残り時間を更新し、中止完了後は更新タイマーを解除する', async () => {
  const oldSet = globalThis.setInterval,
    oldClear = globalThis.clearInterval;
  let tick,
    cleared,
    time = 0,
    calls = 0,
    resolveRead;
  const timer = Symbol('eta-timer'),
    updates = [],
    c = new AbortController();
  globalThis.setInterval = (fn, ms) => {
    assert.equal(ms, 1000);
    tick = fn;
    return timer;
  };
  globalThis.clearInterval = (id) => (cleared = id);
  try {
    const work = runMetadataQueue(['sm1', 'sm2', 'sm3', 'sm4', 'sm5'], {
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
      signal: c.signal,
      enrich: async () => {
        calls++;
        if (calls === 4) await new Promise((resolve) => (resolveRead = resolve));
        else time += 1000;
      },
      onProgress: (job) => updates.push(job),
    });
    for (let i = 0; i < 30 && calls < 4; i++) await Promise.resolve();
    assert.equal(calls, 4);
    const before = updates.at(-1);
    time += 500;
    tick();
    const after = updates.at(-1);
    assert.equal(after.elapsedMs, before.elapsedMs + 500);
    assert.equal(after.etaMs, before.etaMs - 500);
    c.abort();
    resolveRead();
    const result = await work;
    assert.equal(result.phase, 'cancelled');
    assert.equal(cleared, timer);
    const count = updates.length;
    tick();
    assert.equal(updates.length, count);
  } finally {
    globalThis.setInterval = oldSet;
    globalThis.clearInterval = oldClear;
  }
});
