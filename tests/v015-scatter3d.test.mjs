import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createScatter3DData, axisBounds, normalizedPoint, projectPoint, DEFAULT_3D_CAMERA } from '../src/app/scatter3d.js';
import { createInitialState } from '../src/app/state.js';
import { renderScatter } from '../src/ui/scatter.js';
import { mountScatter3D } from '../src/ui/scatter3d.js';

const videos = [
  { id: 'sm101', title: '音街ウナの曲', views: 1200, comments: 35, mylists: 120, likes: 13, voices: ['音街ウナ'] },
  { id: 'sm102', title: '初音ミクの曲', views: 25000, comments: 800, mylists: 870, likes: 210, voices: ['初音ミク'] },
  { id: 'sm103', title: 'データ不足', views: 540, comments: 13, mylists: null, voices: [] },
  { id: 'sm104', title: '削除された動画', status: 'deleted', views: 1200, comments: 25, mylists: 40, voices: ['音街ウナ'] },
  { id: 'sm105', title: '非公開動画', status: 'private', views: 5000, comments: 500, mylists: 800 },
  { id: 'sm106', title: '確認失敗', status: '取得失敗', views: 10000, comments: 300, mylists: 700 },
];

test('3軸とも情報のある公開動画だけ描画して、同じ動画IDを重複排除する', () => {
  const result = createScatter3DData([...videos, videos[0]], { x: 'views', y: 'comments', z: 'mylists' });
  assert.deepEqual(result.points.map((point) => point.id), ['sm101', 'sm102']);
  assert.equal(result.eligible, 3);
  assert.equal(result.excluded.deleted, 1);
  assert.equal(result.excluded.private, 1);
  assert.equal(result.excluded.unconfirmed, 1);
  assert.equal(result.total, 6);
  assert.ok(result.points[0].zPlot >= 0);
});

test('既存のX・Yと同じ指標をZでも使える', () => {
  const result = createScatter3DData(videos, { x: 'views', y: 'mylistRate', z: 'likes', voice: '音街ウナ' });
  assert.deepEqual(result.points.map((point) => point.id), ['sm101']);
  assert.equal(result.points[0].zValue, 13);
  assert.throws(() => createScatter3DData(videos, { z: 'not-a-metric' }), /Unknown Z-axis metric/);
});

test('3D投影は回転によって座標が変わり、手動カメラ初期値が壊れない', () => {
  const p = [0.25, -0.5, 0.8];
  const start = projectPoint(p);
  const rotated = projectPoint(p, { yaw: 1.2, pitch: 0.4 });
  assert.ok(Number.isFinite(start.x) && Number.isFinite(start.y) && Number.isFinite(start.depth));
  assert.notEqual(start.x, rotated.x);
  assert.equal(DEFAULT_3D_CAMERA.zoom, 1);
});

test('欠損のない座標は可視化範囲に正規化され、定数軸も正しく処理', () => {
  const a = createScatter3DData(videos.slice(0, 2));
  const bounds = Object.fromEntries(['x', 'y', 'z'].map((name) => [name, axisBounds(a.points, `${name}Plot`)]));
  for (const point of a.points) {
    const scaled = normalizedPoint(point, bounds);
    assert.equal(scaled.length, 3);
    assert.ok(scaled.every((value) => value >= -1 && value <= 1));
  }
  assert.deepEqual(axisBounds([{ zPlot: 3 }, { zPlot: 3 }], 'zPlot'), [2.5, 3.5]);
});

test('2Dを壊さず3D切替とZ軸11項目、カメラ操作UIを表示する', () => {
  const state = createInitialState();
  state.scatter.mode = '3d';
  state.scatter.z = 'mylists';
  const html = renderScatter({ state, rows: videos, hero: () => '' });
  assert.match(html, /id="scatter-mode-3d"/);
  assert.match(html, /id="scatter-z"/);
  assert.match(html, /<option value="mylists" selected>/);
  assert.match(html, /id="scatter-3d-canvas"/);
  assert.match(html, /id="scatter-3d-reset-view"/);
  assert.match(html, /非公開で除外/);
  assert.doesNotMatch(html, /data-scatter-video="sm104"/);
  state.scatter.mode = '2d';
  assert.match(renderScatter({ state, rows: videos, hero: () => '' }), /class="scatter-svg"/);
});

test('レンダラーはキャンバスを操作し、クリックで動画IDだけをハンドラへ渡す', () => {
  const handlers = new Map();
  const drawn = [];
  const ctx = new Proxy({ setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {}, arc() {}, fill() {} }, {
    set(target, key, value) { target[key] = value; return true; },
  });
  const canvas = {
    width: 0, height: 0, clientWidth: 780, clientHeight: 500,
    style: {}, getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 780, height: 500 }),
    addEventListener(type, fn) { handlers.set(type, fn); },
    removeEventListener(type) { handlers.delete(type); },
    setPointerCapture() {}, hasPointerCapture: () => false,
  };
  const tooltip = { style: {}, hidden: true, textContent: '' };
  const root = { querySelector(selector) { return selector.includes('canvas') ? canvas : tooltip; } };
  const state = createInitialState();
  state.scatter.mode = '3d';
  const originalWindow = globalThis.window;
  const originalRO = globalThis.ResizeObserver;
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.ResizeObserver = undefined;
  try {
    mountScatter3D({ root, state, rows: videos, onOpenVideo: (id) => drawn.push(id) });
    assert.equal(canvas.width, 780);
    assert.equal(typeof handlers.get('pointermove'), 'function');
    assert.equal(typeof handlers.get('wheel'), 'function');
    handlers.get('pointerdown')({ button: 0, pointerId: 1, clientX: 200, clientY: 200 });
    handlers.get('pointermove')({ pointerId: 1, clientX: 230, clientY: 190 });
    handlers.get('pointerup')({ pointerId: 1, clientX: 230, clientY: 190 });
    assert.notEqual(state.scatter.camera.yaw, DEFAULT_3D_CAMERA.yaw);
    assert.deepEqual(drawn, [], 'ドラッグを動画クリックと誤認しない');
    const zoom = state.scatter.camera.zoom;
    handlers.get('wheel')({ deltaY: -100, preventDefault() {} });
    assert.ok(state.scatter.camera.zoom > zoom);

    // A real click on a visible projected dot opens that video's details.
    const data = createScatter3DData(videos, state.scatter);
    const bounds = Object.fromEntries(['x', 'y', 'z'].map((name) =>
      [name, axisBounds(data.points, `${name}Plot`)]));
    const projected = projectPoint(normalizedPoint(data.points[0], bounds), state.scatter.camera);
    const chartHeight = Math.round(780 * 0.65);
    const scale = Math.min(780 * 0.315, chartHeight * 0.32) * state.scatter.camera.zoom;
    const px = 780 * 0.5 + projected.x * scale;
    const py = chartHeight * 0.52 - projected.y * scale;
    handlers.get('pointerdown')({ button: 0, pointerId: 2, clientX: px, clientY: py });
    handlers.get('pointerup')({ pointerId: 2, clientX: px, clientY: py });
    assert.deepEqual(drawn, ['sm101']);

    // Navigating off the scatter page cleans old handlers up.
    mountScatter3D({ root: { querySelector: () => null }, state, rows: videos, onOpenVideo() {} });
    assert.equal(handlers.size, 0);
  } finally {
    globalThis.window = originalWindow;
    globalThis.ResizeObserver = originalRO;
  }
});

test('メイン画面再描画後のCanvasマウントと操作をコードに組み込んでいる', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const events = readFileSync(new URL('../src/app/events.js', import.meta.url), 'utf8');
  assert.match(main, /mountScatter3D\(/);
  assert.match(main, /onOpenVideo: \(id\) => showDialog\('detail'/);
  assert.match(events, /scatter-mode-3d/);
  assert.match(events, /scatter-z/);
  assert.match(events, /scatter-3d-zoom-in/);
});
