import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));

test('Render gateway source is fixed in deployment config', () => {
  assert.equal(config.vars.PUBLIC_MYLIST_SOURCE, 'gateway');
  const url = new URL(config.vars.PUBLIC_MYLIST_GATEWAY_URL);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'nico-shelf.onrender.com');
  assert.equal(url.pathname, '/');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
});

test('dashboard-provided runtime secrets are not embedded in repository config', () => {
  assert.equal(config.keep_vars, true);
  assert.equal(config.vars.PUBLIC_MYLIST_GATEWAY_TOKEN, undefined);
  assert.equal(config.vars.GATEWAY_TOKEN, undefined);
});
