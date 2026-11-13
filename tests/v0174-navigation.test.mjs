import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/app/state.js';
import { createViewRenderer } from '../src/ui/views.js';
import { registerEventHandlers } from '../src/app/events.js';
import { createNavigationScrollHandler, scrollPageToTop } from '../src/app/scroll.js';

function createFixture() {
  const state = createInitialState();
  state.user = { id: 'test-user', user_metadata: {} };
  state.view = 'library';
  state.library.videos = Array.from({ length: 80 }, (_, index) => ({
    id: `sm${index + 1}`,
    title: `テスト曲 ${index + 1}`,
    views: index + 1,
    voices: ['初音ミク'],
    tags: [],
  }));
  const events = new Map();
  const root = {
    addEventListener: (type, callback) => {
      events.set(type, [...(events.get(type) || []), callback]);
    },
  };
  const scrolls = [];
  const afterNavigation = createNavigationScrollHandler(() => scrolls.push('top'));
  const renderer = createViewRenderer({ state, renderDialog: () => '' });
  let html;
  const render = () => {
    html = renderer.content();
    afterNavigation(state);
  };
  registerEventHandlers({
    root,
    state,
    client: {},
    nicoBridge: {},
    render,
    rerenderContent: render,
    showDialog() {},
    closeDialog() {},
    refreshMembership() {},
    actions: {},
  });
  render();

  return {
    state,
    scrolls,
    render,
    html: () => html,
    dispatch(type, values) {
      const target = { id: '', dataset: {}, matches: () => false, ...values };
      target.closest = () => target;
      for (const callback of events.get(type) || []) callback({ target });
    },
  };
}

test('ページ送り・番号指定・メニュー切替の通常操作で描画後に上へ戻る', () => {
  const ui = createFixture();
  assert.equal(ui.scrolls.length, 0);
  ui.dispatch('click', { dataset: { page: '2' } });
  assert.equal(ui.state.page, 2);
  assert.match(ui.html(), /<option value="2" selected>2<\/option>/);
  assert.equal(ui.scrolls.length, 1);
  ui.dispatch('change', { id: 'page-jump', value: '3' });
  assert.equal(ui.state.page, 3);
  assert.equal(ui.scrolls.length, 2);
  ui.dispatch('click', { dataset: { page: '2' } });
  assert.equal(ui.state.page, 2);
  assert.equal(ui.scrolls.length, 3);
  ui.dispatch('click', { dataset: { view: 'trends' } });
  assert.equal(ui.state.view, 'trends');
  assert.equal(ui.state.page, 1);
  assert.equal(ui.scrolls.length, 4);
});

test('ダイアログ・集計項目の変更など同じページの再描画では位置を保つ', () => {
  const ui = createFixture();
  ui.state.dialog = { kind: 'sync' };
  ui.render();
  ui.state.dialog = null;
  ui.render();
  ui.state.trends.selected = { group: 'year:2012', category: '初音ミク' };
  ui.render();
  assert.equal(ui.scrolls.length, 0);
  ui.dispatch('change', { id: 'page-jump', value: '0' });
  assert.equal(ui.state.page, 1);
  assert.equal(ui.scrolls.length, 0);
});

test('描画時に範囲外ページが補正された場合も現在のページで位置を判定する', () => {
  const ui = createFixture();
  ui.dispatch('click', { dataset: { page: '999' } });
  assert.equal(ui.state.page, 3);
  assert.equal(ui.scrolls.length, 1);
  ui.render();
  assert.equal(ui.scrolls.length, 1);
  ui.state.library.videos = ui.state.library.videos.slice(0, 10);
  ui.render();
  assert.equal(ui.state.page, 1);
  assert.equal(ui.scrolls.length, 2);
});

test('上へ戻るボタンは通常は滑らかに移動し、モーション削減設定を尊重する', () => {
  const previousScroll = Object.getOwnPropertyDescriptor(globalThis, 'scrollTo');
  const previousMatch = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
  const calls = [];
  try {
    globalThis.scrollTo = (options) => calls.push(options);
    globalThis.matchMedia = () => ({ matches: false });
    const ui = createFixture();
    ui.dispatch('click', { id: 'back-to-top' });
    assert.deepEqual(calls.at(-1), { top: 0, left: 0, behavior: 'smooth' });
    globalThis.matchMedia = () => ({ matches: true });
    ui.dispatch('click', { id: 'back-to-top' });
    assert.deepEqual(calls.at(-1), { top: 0, left: 0, behavior: 'instant' });
    scrollPageToTop();
    assert.deepEqual(calls.at(-1), { top: 0, left: 0, behavior: 'instant' });
  } finally {
    if (previousScroll) Object.defineProperty(globalThis, 'scrollTo', previousScroll);
    else delete globalThis.scrollTo;
    if (previousMatch) Object.defineProperty(globalThis, 'matchMedia', previousMatch);
    else delete globalThis.matchMedia;
  }
});

test('上へ戻る操作はログイン中の画面に表示し、ダイアログ表示中は隠す', () => {
  const state = createInitialState();
  state.user = { id: 'test-user', user_metadata: {} };
  const view = createViewRenderer({ state, renderDialog: () => '<div role="dialog"></div>' });
  assert.match(view.shell(), /id="back-to-top" aria-label="ページ上部へ戻る"/);
  state.dialog = { kind: 'sync' };
  assert.doesNotMatch(view.shell(), /id="back-to-top"/);
});

test('長いタイトルと大きな件数を表示し、動画・お気に入り・関連曲の操作先を保持する', () => {
  const state = createInitialState();
  state.view = 'library';
  state.cardMode = 'grid';
  state.library.videos = [
    {
      id: 'sm123',
      title: '<img onerror="alert(1)">' + '長い曲名'.repeat(30),
      views: 1234567890,
      likes: 123456789,
      tags: [],
    },
  ];
  const html = createViewRenderer({ state, renderDialog: () => '' }).content();
  assert.match(html, /class="video-title-text"/);
  assert.match(html, /class="external-arrow" aria-hidden="true"/);
  assert.match(html, /1,234,567,890/);
  assert.match(html, /123,456,789/);
  for (const action of ['favorite', 'related', 'detail']) {
    assert.match(html, new RegExp(`data-${action}="sm123"`));
  }
  assert.doesNotMatch(html, /<img onerror=/);
  assert.match(html, /&lt;img onerror=&quot;alert\(1\)&quot;&gt;/);
});
