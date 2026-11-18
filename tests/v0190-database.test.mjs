import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

const db = new PGlite();
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const tables = ['playlists', 'videos', 'entries', 'user_meta', 'saved_searches'];
let originalLimits;
let migration;
async function admin(sql, params = []) {
  await db.exec('reset role');
  return db.query(sql, params);
}
async function as(owner = A, role = 'authenticated') {
  await db.exec(`reset role; set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
}
async function count(table) {
  return Number((await db.query(`select count(*) n from public.${table}`)).rows[0].n);
}
async function usage() {
  return (await db.query('select public.read_my_library_usage() u')).rows[0].u;
}
async function configure(patch) {
  const limits = { ...originalLimits, ...patch };
  await admin('update nico_private.library_configuration set limits=$1::jsonb', [
    JSON.stringify(limits),
  ]);
  await as();
}
async function video(id = 'sm1', title = '曲') {
  return db.query('insert into public.videos(owner_id,id,title) values($1,$2,$3)', [A, id, title]);
}
async function fixture(owner) {
  await as(owner);
  await db.query("insert into public.playlists(owner_id,id,name) values($1,'p','list')", [owner]);
  await db.query("insert into public.videos(owner_id,id,title) values($1,'sm1','song')", [owner]);
  await db.query("insert into public.entries(owner_id,playlist_id,video_id) values($1,'p','sm1')", [
    owner,
  ]);
  await db.query(
    "insert into public.user_meta(owner_id,video_id,memo) values($1,'sm1','private')",
    [owner],
  );
  await db.query("insert into public.saved_searches(owner_id,name) values($1,'private')", [owner]);
}
async function assertCounters() {
  await admin('select 1');
  const actual = [];
  for (const table of tables) {
    const rows = (
      await db.query(
        `select owner_id,count(*)::bigint row_count,sum(octet_length(to_jsonb(t)::text))::bigint bytes_used from public.${table} t group by owner_id`,
      )
    ).rows;
    for (const row of rows) actual.push({ ...row, resource: table });
  }
  const stored = (
    await db.query("select * from nico_private.library_usage where resource<>'__total__'")
  ).rows;
  const key = (r) => `${r.owner_id}/${r.resource}`;
  for (const row of actual) {
    const charge = stored.find((r) => key(r) === key(row));
    assert.ok(charge, key(row));
    assert.equal(Number(charge.row_count), Number(row.row_count));
    assert.equal(Number(charge.bytes_used), Number(row.bytes_used));
  }
  for (const row of stored) {
    if (!actual.find((r) => key(r) === key(row))) {
      assert.equal(Number(row.row_count), 0);
      assert.equal(Number(row.bytes_used), 0);
    }
  }
  const totals = (
    await db.query("select * from nico_private.library_usage where resource='__total__'")
  ).rows;
  for (const total of totals)
    assert.equal(
      Number(total.bytes_used),
      actual
        .filter((r) => r.owner_id === total.owner_id)
        .reduce((s, r) => s + Number(r.bytes_used), 0),
    );
  const global = (await db.query('select bytes_used from nico_private.global_usage')).rows[0];
  assert.equal(
    Number(global.bytes_used),
    actual.reduce((s, r) => s + Number(r.bytes_used), 0),
  );
}

before(async () => {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated;`);
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const file of (await readdir(dir)).sort()) {
    const sql = await readFile(new URL(file, dir), 'utf8');
    if (file.includes('public_readiness')) migration = sql;
    await db.exec(sql);
  }
  originalLimits = (await admin('select limits from nico_private.library_configuration')).rows[0]
    .limits;
});
after(async () => db.close());
beforeEach(async () => {
  await admin('delete from auth.users');
  await admin('update nico_private.library_configuration set limits=$1::jsonb', [
    JSON.stringify(originalLimits),
  ]);
  await admin('insert into auth.users(id) values($1),($2)', [A, B]);
  await as();
});

test('real SQL: all five RLS tables isolate owners for reads, writes and forged inserts', async () => {
  await fixture(A);
  await fixture(B);
  await as(A);
  for (const table of tables) {
    assert.equal(await count(table), 1, table);
    assert.equal(
      (await db.query(`select * from public.${table} where owner_id=$1`, [B])).rows.length,
      0,
    );
    const column = {
      playlists: 'name',
      videos: 'title',
      entries: 'position',
      user_meta: 'memo',
      saved_searches: 'name',
    }[table];
    assert.equal(
      (
        await db.query(
          `update public.${table} set ${column}=${column} where owner_id=$1 returning owner_id`,
          [B],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (await db.query(`delete from public.${table} where owner_id=$1 returning owner_id`, [B])).rows
        .length,
      0,
    );
    await assert.rejects(
      db.query(`update public.${table} set owner_id=$1 where owner_id=$2`, [B, A]),
      (e) => e.code === '42501',
    );
  }
  // New unique keys ensure forged INSERT fails because of RLS, not duplicates.
  const forged = [
    ["insert into public.playlists(owner_id,id,name) values($1,'forged','x')", [B]],
    ["insert into public.videos(owner_id,id) values($1,'sm9')", [B]],
    ["insert into public.entries(owner_id,playlist_id,video_id) values($1,'missing','sm9')", [B]],
    ["insert into public.user_meta(owner_id,video_id) values($1,'sm9')", [B]],
    ["insert into public.saved_searches(owner_id,name) values($1,'forged')", [B]],
  ];
  for (const [sql, params] of forged)
    await assert.rejects(db.query(sql, params), (e) => e.code === '42501');
  await as(B);
  for (const table of tables) assert.equal(await count(table), 1);
  await assertCounters();
});

test('real SQL: anonymous and private quota internals are inaccessible', async () => {
  await as('', 'anon');
  for (const table of tables)
    await assert.rejects(db.query(`select * from public.${table}`), (e) => e.code === '42501');
  await assert.rejects(usage(), (e) => e.code === '42501');
  await as();
  await assert.rejects(
    db.query('select * from nico_private.library_configuration'),
    (e) => e.code === '42501',
  );
  await assert.rejects(
    db.query("select nico_private.check_library_payload('videos','{}','{}','{}')"),
    (e) => e.code === '42501',
  );
  await as('');
  await assert.rejects(usage(), (e) => e.code === '42501');
});

test('real SQL: usage RPC returns only current account, counters track UTF-8 updates and cascades', async () => {
  await fixture(A);
  await fixture(B);
  await as(A);
  const first = await usage();
  assert.equal(first.resources.videos.count, 1);
  assert.ok(first.bytes > 0);
  assert.ok(!JSON.stringify(first).includes(B));
  assert.ok(!('global_usage' in first));
  await db.query("update public.videos set title='初音ミクの曲' where owner_id=$1", [A]);
  await db.query('update public.entries set present=false where owner_id=$1', [A]);
  assert.equal((await usage()).resources.entries.count, 1);
  await assertCounters();
  await as(A);
  await db.query('delete from public.videos where owner_id=$1', [A]);
  await assertCounters();
  await admin('delete from auth.users where id=$1', [B]);
  await assertCounters();
});

test('real SQL: row caps roll back bulk operations, upserts at cap do not double charge', async () => {
  await configure({ rows: { ...originalLimits.rows, videos: 2 } });
  await video();
  await assert.rejects(
    db.query("insert into public.videos(owner_id,id) values($1,'sm2'),($1,'sm3')", [A]),
    /NICO_QUOTA_ROWS/,
  );
  assert.equal(await count('videos'), 1);
  await video('sm2');
  const before = await usage();
  await db.query(
    "insert into public.videos(owner_id,id,title) values($1,'sm1','曲') on conflict(owner_id,id) do update set title=excluded.title",
    [A],
  );
  await db.query("insert into public.videos(owner_id,id) values($1,'sm2') on conflict do nothing", [
    A,
  ]);
  assert.equal((await usage()).bytes, before.bytes);
  await assert.rejects(video('sm3'), /NICO_QUOTA_ROWS/);
  await db.query("delete from public.videos where id='sm2'");
  await video('sm3');
  await assertCounters();
});

test('real SQL: account/global byte caps roll back, shrink and delete remain available', async () => {
  await video();
  const bytes = (await usage()).bytes;
  await configure({ account_bytes: bytes });
  await assert.rejects(video('sm2'), /NICO_QUOTA_BYTES/);
  await configure({ global_bytes: bytes });
  await assert.rejects(video('sm2'), /NICO_QUOTA_GLOBAL/);
  await db.query("update public.videos set title='' where id='sm1'");
  await db.query("delete from public.videos where id='sm1'");
  await assertCounters();
});

test('real SQL: payload limits reject growing fields, arrays, filters and rows', async () => {
  await assert.rejects(video('sm1', 'a'.repeat(1001)), /NICO_FIELD_LIMIT/);
  await video();
  await assert.rejects(
    db.query('update public.videos set tags=$1::jsonb', [JSON.stringify(Array(101).fill('tag'))]),
    /NICO_ARRAY_LIMIT/,
  );
  await assert.rejects(
    db.query('update public.videos set tags=$1::jsonb', [JSON.stringify(['a'.repeat(17000)])]),
    /NICO_ARRAY_LIMIT/,
  );
  await db.query('update public.videos set voices=$1::jsonb', [
    JSON.stringify([{ name: '初音ミク', id: 39 }]),
  ]);
  await assert.rejects(
    db.query('insert into public.saved_searches(owner_id,name,filters) values($1,$2,$3::jsonb)', [
      A,
      'large',
      JSON.stringify({ q: 'a'.repeat(8200) }),
    ]),
    /NICO_FIELD_LIMIT/,
  );
  await configure({ row_bytes: 100 });
  await assert.rejects(video('sm2'), /NICO_ROW_LIMIT/);
  await assertCounters();
});

test('real SQL: migration preserves oversized legacy data, reinstallation is idempotent', async () => {
  await configure({
    text: { ...originalLimits.text, videos: { ...originalLimits.text.videos, title: 3000 } },
  });
  await video('sm1', 'a'.repeat(2000));
  await configure({});
  await admin('select 1');
  await db.exec(migration);
  await as();
  const before = await usage();
  assert.equal(await count('videos'), 1);
  await db.query(
    "insert into public.videos(owner_id,id,title) values($1,'sm1',$2) on conflict(owner_id,id) do update set title=excluded.title",
    [A, 'a'.repeat(2000)],
  );
  assert.equal((await usage()).bytes, before.bytes);
  await assert.rejects(
    db.query('update public.videos set title=$1', ['a'.repeat(2001)]),
    /NICO_FIELD_LIMIT/,
  );
  await db.query('update public.videos set title=$1', ['a'.repeat(1500)]);
  await assertCounters();
});

test('real SQL: snapshot quota failure rolls back its entire multi-table write', async () => {
  await configure({ rows: { ...originalLimits.rows, videos: 1 } });
  await db.query("insert into public.playlists(owner_id,id,name) values($1,'123','list')", [A]);
  const valid = {
    lists: [
      {
        id: '123',
        items: [
          { video_id: 'sm1', title: 'one', position: 1 },
          { video_id: 'sm2', title: 'two', position: 2 },
        ],
      },
    ],
  };
  await assert.rejects(
    db.query('select public.apply_mylist_snapshot_v2($1::jsonb)', [JSON.stringify(valid)]),
    /NICO_QUOTA_ROWS/,
  );
  assert.equal(await count('playlists'), 1);
  assert.equal((await db.query('select last_sync from public.playlists')).rows[0].last_sync, null);
  assert.equal(await count('entries'), 0);
  assert.equal(await count('videos'), 0);
  await assertCounters();
});

test('real SQL: cross-owner foreign keys cannot link another account video', async () => {
  await as(B);
  await db.query("insert into public.videos(owner_id,id) values($1,'sm7')", [B]);
  await as(A);
  await db.query("insert into public.playlists(owner_id,id,name) values($1,'p','list')", [A]);
  await assert.rejects(
    db.query("insert into public.entries(owner_id,playlist_id,video_id) values($1,'p','sm7')", [A]),
    (e) => e.code === '23503',
  );
  await assert.rejects(
    db.query("insert into public.user_meta(owner_id,video_id) values($1,'sm7')", [A]),
    (e) => e.code === '23503',
  );
  await assertCounters();
});

test('real SQL: row caps apply to all resources, not only video imports', async () => {
  await fixture(A);
  await configure({ rows: Object.fromEntries(tables.map((name) => [name, 1])) });
  await assert.rejects(
    db.query("insert into public.playlists(owner_id,id,name) values($1,'p2','second')", [A]),
    /NICO_QUOTA_ROWS/,
  );
  await assert.rejects(
    db.query("insert into public.saved_searches(owner_id,name) values($1,'second')", [A]),
    /NICO_QUOTA_ROWS/,
  );
  // Create dependencies before lowering their resource limits.
  await configure({});
  await video('sm2');
  await db.query("insert into public.playlists(owner_id,id,name) values($1,'p2','second')", [A]);
  await configure({ rows: { ...originalLimits.rows, entries: 1, user_meta: 1 } });
  await assert.rejects(
    db.query("insert into public.entries(owner_id,playlist_id,video_id) values($1,'p2','sm2')", [
      A,
    ]),
    /NICO_QUOTA_ROWS/,
  );
  await assert.rejects(
    db.query("insert into public.user_meta(owner_id,video_id) values($1,'sm2')", [A]),
    /NICO_QUOTA_ROWS/,
  );
  await assertCounters();
});

test('real SQL: read-only production audit executes and detects no counter mismatch', async () => {
  await fixture(A);
  await admin('select 1');
  const result = await db.exec(
    await readFile(new URL('../supabase/audits/public_readiness.sql', import.meta.url), 'utf8'),
  );
  const mismatch = result.find((r) => r.fields.some((f) => f.name === 'actual_rows'));
  assert.ok(mismatch);
  assert.deepEqual(mismatch.rows, []);
});
