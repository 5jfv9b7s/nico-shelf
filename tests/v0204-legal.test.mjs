import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderPublicPage } from '../scripts/public-pages.mjs';
import { createInitialState } from '../src/app/state.js';
import { createViewRenderer } from '../src/ui/views.js';

const page = (name) => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');

test('configured operator and contact values stay literal in replacement patterns', () => {
  const template =
    '<p><!-- operator -->NICO SHELF 運営者</p><!-- contact:start --><!-- contact:end -->';
  const html = renderPublicPage(template, {
    operator: 'Cheese$&Lab $1',
    contact: 'https://example.org/form?a=1$&b=2',
  });
  assert.ok(html.includes('Cheese$&amp;Lab $1'));
  assert.ok(html.includes('?a=1$&amp;b=2'));
  assert.ok(!html.includes('<!--'));
});

test('login screen states that logging in means agreeing to the terms and the privacy policy', () => {
  const state = createInitialState();
  const login = createViewRenderer({ state, renderDialog: () => '' }).loginScreen();
  const consent = login.match(/<p class="login-consent">(.*?)<\/p>/)?.[1] ?? '';
  assert.match(consent, /同意したものとみなされます/);
  assert.ok(consent.includes('href="/terms.html"') && consent.includes('href="/privacy.html"'));
  assert.ok(login.indexOf('id="login"') < login.indexOf('login-consent'));
});

test('privacy policy covers the notices required for retained personal data', () => {
  const html = page('privacy.html');
  for (const heading of [
    '取得する情報と用途',
    'データの保存場所と外国にある事業者',
    '第三者への提供',
    '安全管理措置',
    '保存と削除',
    '開示・訂正・利用停止などの請求',
    '連絡先・苦情の申出先',
  ])
    assert.ok(html.includes(`<h2>${heading}</h2>`), heading);
  assert.ok(html.includes('氏名・住所は、下記の窓口へ請求があれば遅滞なく回答'));
  assert.ok(html.includes('<!-- contact:start -->') && html.includes('<!-- operator -->'));
});

test('terms cover agreement, disclaimer, suspension, changes and governing law', () => {
  const html = page('terms.html');
  for (const heading of ['同意', '免責', '利用の制限・停止', '利用条件の変更', '準拠法・管轄'])
    assert.ok(html.includes(`<h2>${heading}</h2>`), heading);
  assert.ok(html.includes('故意または重大な過失'));
  assert.ok(html.includes('<!-- contact:start -->'));
});
