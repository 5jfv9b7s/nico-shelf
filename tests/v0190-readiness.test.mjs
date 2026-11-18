import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicSettings, renderPublicPage } from '../scripts/public-pages.mjs';
import {
  checkImportFile,
  checkImportCounts,
  storageErrorMessage,
  IMPORT_FILE_BYTES,
} from '../src/app/storage-limits.js';
import { createInitialState } from '../src/app/state.js';
import { createViewRenderer } from '../src/ui/views.js';
import { verifyProduction } from '../scripts/verify-production.mjs';

test('public launch guard requires contact, operator and public project settings', () => {
  assert.throws(() => publicSettings({ NICO_PUBLIC_LAUNCH: '1' }), /Public launch requires/);
  assert.equal(publicSettings({}).launch, false);
  assert.throws(() => publicSettings({ VITE_SUPPORT_URL: 'javascript:alert(1)' }));
  assert.throws(() => publicSettings({ VITE_SUPPORT_URL: 'https://name:password@example.org' }));
  assert.throws(() => publicSettings({ VITE_SUPPORT_URL: 'mailto:test@example.org?body=secret' }));
  for (const contact of ['https://example.org/contact', 'mailto:help@example.org']) {
    const settings = publicSettings({
      NICO_PUBLIC_LAUNCH: '1',
      VITE_SUPPORT_URL: contact,
      VITE_OPERATOR_NAME: '運営者',
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
    });
    assert.equal(settings.contact, contact);
  }
});
test('public pages escape operator/contact and show an honest unset state', () => {
  const template =
    '<p><!-- operator -->NICO SHELF 運営者</p><!-- contact:start -->old<!-- contact:end -->';
  const html = renderPublicPage(template, {
    operator: '<script>',
    contact: 'https://example.org/?a=1&b="x"',
  });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&amp;'));
  assert.ok(renderPublicPage(template, {}).includes('公開準備中'));
});
test('import checks reject large files before reading and use unique projected row counts', () => {
  assert.doesNotThrow(() => checkImportFile({ size: IMPORT_FILE_BYTES }));
  assert.throws(() => checkImportFile({ size: IMPORT_FILE_BYTES + 1 }), /25 MiB/);
  const library = { playlists: [], videos: [{ id: 'sm1' }], entries: [], meta: [] };
  const usage = {
    limits: {
      rows: { videos: 1, playlists: 50, entries: 30000, user_meta: 10000, saved_searches: 20 },
    },
  };
  assert.doesNotThrow(() =>
    checkImportCounts(library, [], { videos: [{ id: 'sm1' }, { id: 'sm1' }] }, usage),
  );
  assert.throws(
    () => checkImportCounts(library, [], { videos: [{ id: 'sm2' }] }, usage),
    /最大1件/,
  );
  assert.doesNotThrow(() => checkImportCounts(library, [], { videos: [{ id: 'sm2' }] }, null));
});
test('storage errors explain account/global limits without exposing SQL details', () => {
  assert.match(
    storageErrorMessage({ message: 'videos: NICO_QUOTA_ROWS', details: 'videos:10000' }),
    /このアカウント/,
  );
  assert.match(storageErrorMessage({ message: 'NICO_QUOTA_GLOBAL' }), /サービス全体/);
  assert.match(storageErrorMessage({ message: 'NICO_FIELD_LIMIT' }), /文字数/);
});
test('public information is available before login, usage and accurate deletion help appear in settings', () => {
  const state = createInitialState();
  const views = createViewRenderer({ state, renderDialog: () => '' });
  const login = views.loginScreen();
  for (const page of ['privacy', 'terms', 'help']) assert.ok(login.includes(`/${page}.html`));
  state.user = { id: 'test' };
  state.view = 'settings';
  state.storageUsage = {
    bytes: 1048576,
    limits: { account_bytes: 52428800, rows: { videos: 10000 } },
    resources: { videos: { count: 123 } },
  };
  const html = views.content();
  assert.ok(html.includes('1.00 MiB'));
  assert.ok(html.includes('123 / 10,000'));
  assert.ok(html.includes('ログイン登録情報の削除'));
});
test('production verifier refuses to run without explicit dedicated test account configuration', async () => {
  await assert.rejects(verifyProduction({}), /dedicated empty test accounts/);
  await assert.rejects(
    verifyProduction({ NICO_VERIFY_TEST_ACCOUNTS: '1', VERIFY_SUPABASE_URL: 'http://localhost' }),
    /HTTPS/,
  );
});
