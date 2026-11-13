import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createInitialState } from '../src/app/state.js';
import { createViewRenderer } from '../src/ui/views.js';

/**
 * The dashboard uses a span for each bar fill. Without display:block,
 * its inline width has no effect and the track looks empty.
 */
test('棒グラフの塗り要素は幅が反映される表示モードである', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  const declaration = css.match(/\.bar-fill\s*\{([^}]*)\}/)?.[1];

  assert.ok(declaration, 'CSSの.bar-fill定義が存在する');
  assert.match(declaration, /display\s*:\s*block\s*;/);
  assert.match(declaration, /height\s*:\s*100%\s*;/);
});

test('ダッシュボードの歌唱者とマイリスト件数に対応した棒幅を出力する', () => {
  const state = createInitialState();
  state.user = { email: 'example@example.com', user_metadata: {} };
  state.library = {
    playlists: [
      { id: '1', name: 'ぼかうた1' },
      { id: '2', name: 'ぼかうた2' },
    ],
    videos: [
      { id: 'sm100', title: '1', voices: ['音街ウナ'] },
      { id: 'sm101', title: '2', voices: ['音街ウナ'] },
      { id: 'sm102', title: '3', voices: ['初音ミク'] },
    ],
    entries: [
      { playlist_id: '1', video_id: 'sm100', present: true },
      { playlist_id: '1', video_id: 'sm101', present: true },
      { playlist_id: '2', video_id: 'sm102', present: true },
    ],
    meta: [],
  };

  const view = createViewRenderer({ state, renderDialog: () => '' });
  const html = view.content();
  assert.match(html, /歌唱者ランキング/);
  assert.match(html, /マイリスト別の登録件数/);
  assert.match(html, /class="bar-fill" style="width:100%(?:;background:#[0-9a-fA-F]{6};)?"/);
  assert.match(html, /class="bar-fill" style="width:50%(?:;background:#[0-9a-fA-F]{6};)?"/);
});
