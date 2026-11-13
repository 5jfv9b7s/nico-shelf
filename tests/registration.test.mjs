import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registrationLists,
  autoRegistrationTarget,
  registrationDecision,
} from '../src/registration.js';
const lists = [
  { id: '9', name: '最近のお気に入り', count: 78, hasVideoIds: [] },
  { id: '3', name: 'ぼかうた3', count: 125, hasVideoIds: [] },
  { id: '1', name: 'ぼかうた1', count: 500, hasVideoIds: [] },
  { id: '2', name: 'ぼかうた2', count: 500, hasVideoIds: [] },
];
test('auto picks first non-full numbered list, never favorite', () => {
  const d = registrationDecision(lists, 'sm1234567', 'auto');
  assert.equal(d.target.id, '3');
  assert.equal(autoRegistrationTarget(lists, 'sm1234567').id, '3');
});
test('auto skips favorites even if numbered lists all full', () => {
  assert.throws(
    () =>
      registrationDecision(
        lists.map((p) => ({ ...p, count: p.id === '3' ? 500 : p.count })),
        'sm1234567',
        'auto',
      ),
    /空いている登録先/,
  );
});
test('numeric suffix ordering', () => {
  assert.deepEqual(
    registrationLists([
      { id: '13', name: 'ぼかうた10' },
      { id: '12', name: 'ぼかうた2' },
      { id: '11', name: 'ぼかうた1' },
    ]).map((x) => x.id),
    ['11', '12', '13'],
  );
});
test('duplicate needs explicit permission', () => {
  const data = lists.map((p) => ({ ...p, hasVideoIds: p.id === '9' ? ['sm1234567'] : [] }));
  assert.throws(() => registrationDecision(data, 'sm1234567', 'auto'), /重複/);
  assert.equal(registrationDecision(data, 'sm1234567', 'auto', true).target.id, '3');
});
test('already in target is blocked', () => {
  const data = lists.map((p) => ({ ...p, hasVideoIds: p.id === '3' ? ['sm1234567'] : [] }));
  assert.throws(() => registrationDecision(data, 'sm1234567', '3', true), /すでに登録/);
});
test('manual favorite registration allowed when selected', () => {
  assert.equal(registrationDecision(lists, 'sm1234567', '9').target.name, '最近のお気に入り');
});
test('local-only list id and invalid video ids rejected', () => {
  assert.equal(registrationLists([...lists, { id: 'local-abc', name: 'ぼかうた4' }]).length, 4);
  assert.throws(() => registrationDecision(lists, 'https://bad.invalid', 'auto'), /動画ID/);
});
