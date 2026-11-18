import { createClient } from '@supabase/supabase-js';
import { randomUUID, randomInt } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const manifestPath = new URL('../.nico-verify-manifest.json', import.meta.url);
const tables = ['playlists', 'videos', 'entries', 'user_meta', 'saved_searches'];
function fail(message) {
  throw new Error(message);
}
function requireOk(result, label) {
  if (result.error) fail(`${label}: request failed (${result.error.code || 'network'})`);
  return result.data;
}
function assert(condition, label) {
  if (!condition) fail(label);
}
function markerCheck(plan) {
  assert(/^ns-test-[0-9a-f-]{36}$/.test(plan.marker), 'Invalid cleanup marker');
  assert(
    plan.playlist === plan.marker &&
      plan.videoIds?.length === 2 &&
      plan.videoIds.every((id) => /^sm[0-9]{12}$/.test(id)),
    'Invalid cleanup IDs',
  );
}
export async function verifyProduction(env = process.env, cleanupOnly = false) {
  if (env.NICO_VERIFY_TEST_ACCOUNTS !== '1')
    fail('Use two dedicated empty test accounts and set NICO_VERIFY_TEST_ACCOUNTS=1.');
  const url = new URL(env.VERIFY_SUPABASE_URL || '');
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/')
    fail('Use the HTTPS Supabase project origin.');
  const key = env.VERIFY_SUPABASE_PUBLIC_KEY || '';
  if (!key || key.startsWith('sb_secret_'))
    fail('A publishable/anon key is required; secret keys are forbidden.');
  if (key.split('.').length === 3) {
    let role;
    try {
      role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role;
    } catch {
      fail('Invalid public key.');
    }
    if (role !== 'anon') fail('Only an anon public JWT is allowed as the API key.');
  } else if (!key.startsWith('sb_publishable_')) fail('Use a Supabase publishable or anon key.');
  const clients = [env.VERIFY_ACCESS_TOKEN_A, env.VERIFY_ACCESS_TOKEN_B].map((token) => {
    if (!token) fail('Two test-account access tokens are required in the local environment.');
    const client = createClient(url.origin, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        headers: { Authorization: `Bearer ${token}` },
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: init?.signal
              ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
              : AbortSignal.timeout(15000),
          }),
      },
    });
    return { token, client };
  });
  for (const account of clients) {
    const result = await account.client.auth.getUser(account.token);
    if (result.error || !result.data.user)
      fail('Test-account authentication failed. Refresh tokens locally and retry.');
    account.owner = result.data.user.id;
    delete account.token;
  }
  assert(clients[0].owner !== clients[1].owner, 'Two distinct test accounts are required.');
  if (!cleanupOnly) {
    const anonymous = createClient(url.origin, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    for (const table of tables) {
      const result = await anonymous.from(table).select('owner_id').limit(1);
      assert(result.error?.code === '42501', `FAIL: anonymous ${table} access was not denied`);
    }
    const result = await anonymous.rpc('read_my_library_usage');
    assert(result.error?.code === '42501', 'FAIL: anonymous usage RPC was not denied');
  }
  let plans;
  if (cleanupOnly) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert(manifest.project === url.origin, 'Cleanup project mismatch.');
    plans = manifest.plans;
    assert(
      plans.length === 2 && plans.every((p) => clients.some((c) => c.owner === p.owner)),
      'Cleanup owners mismatch.',
    );
    plans.forEach(markerCheck);
  } else {
    try {
      await readFile(manifestPath);
      fail('A previous fixture manifest exists. Run verify:production:cleanup first.');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    for (const { client } of clients) {
      for (const table of tables) {
        const rows = requireOk(
          await client.from(table).select('owner_id').limit(1),
          'Empty-account precheck',
        );
        assert(rows.length === 0, 'Use empty test accounts; existing libraries are not modified.');
      }
      const usage = requireOk(await client.rpc('read_my_library_usage'), 'Usage RPC');
      assert(
        usage?.version === 1 && Number(usage.bytes) === 0,
        'Apply v0.19 SQL and use empty accounts.',
      );
    }
    plans = clients.map(({ owner }) => {
      const marker = `ns-test-${randomUUID()}`;
      return {
        owner,
        marker,
        playlist: marker,
        videoIds: [0, 1].map(() => `sm${randomInt(100000, 999999)}${randomInt(100000, 999999)}`),
      };
    });
    await writeFile(manifestPath, JSON.stringify({ project: url.origin, plans }, null, 2), {
      mode: 0o600,
    });
  }
  async function cleanup() {
    let ok = true;
    for (const plan of plans) {
      const { client } = clients.find((c) => c.owner === plan.owner);
      // Exact random marker prevents deletion of a pre-existing ID collision.
      const results = [
        await client
          .from('saved_searches')
          .delete()
          .eq('owner_id', plan.owner)
          .in('name', [plan.marker, `${plan.marker}-forged`]),
        await client.from('playlists').delete().eq('owner_id', plan.owner).eq('name', plan.marker),
        await client.from('videos').delete().eq('owner_id', plan.owner).eq('title', plan.marker),
      ];
      if (results.some((r) => r.error)) ok = false;
      for (const table of tables) {
        const result = await client.from(table).select('owner_id').limit(1);
        if (result.error || result.data?.length) ok = false;
      }
      const result = await client.rpc('read_my_library_usage');
      if (result.error || Number(result.data?.bytes) !== 0) ok = false;
    }
    if (ok) await unlink(manifestPath);
    else
      fail(
        'Cleanup incomplete. Keep the manifest, refresh local tokens and run verify:production:cleanup.',
      );
  }
  let primaryError;
  try {
    if (!cleanupOnly) {
      for (const plan of plans) {
        const { client } = clients.find((c) => c.owner === plan.owner);
        requireOk(
          await client
            .from('playlists')
            .insert({ owner_id: plan.owner, id: plan.playlist, name: plan.marker }),
          'Create playlist fixture',
        );
        requireOk(
          await client
            .from('videos')
            .insert(plan.videoIds.map((id) => ({ owner_id: plan.owner, id, title: plan.marker }))),
          'Create video fixtures',
        );
        requireOk(
          await client.from('entries').insert({
            owner_id: plan.owner,
            playlist_id: plan.playlist,
            video_id: plan.videoIds[0],
          }),
          'Create entry fixture',
        );
        requireOk(
          await client
            .from('user_meta')
            .insert({ owner_id: plan.owner, video_id: plan.videoIds[0], memo: plan.marker }),
          'Create metadata fixture',
        );
        requireOk(
          await client.from('saved_searches').insert({ owner_id: plan.owner, name: plan.marker }),
          'Create saved search fixture',
        );
      }
      for (let i = 0; i < 2; i++) {
        const { client } = clients[i];
        const other = plans[1 - i];
        for (const table of tables) {
          const read = requireOk(
            await client.from(table).select('*').eq('owner_id', other.owner),
            'Cross-account read',
          );
          assert(read.length === 0, `FAIL: cross-account ${table} read was allowed`);
          const patch = {
            playlists: { name: other.marker },
            videos: { title: other.marker },
            entries: { position: 0 },
            user_meta: { memo: other.marker },
            saved_searches: { name: other.marker },
          }[table];
          for (const result of [
            await client.from(table).update(patch).eq('owner_id', other.owner).select('owner_id'),
            await client.from(table).delete().eq('owner_id', other.owner).select('owner_id'),
          ]) {
            assert(
              result.error?.code === '42501' || (!result.error && result.data?.length === 0),
              `FAIL: cross-account ${table} mutation was allowed or not verified`,
            );
          }
        }
        const forged = {
          playlists: { owner_id: other.owner, id: `${other.playlist}-forged`, name: other.marker },
          videos: {
            owner_id: other.owner,
            id: `nm${randomInt(100000, 999999)}`,
            title: other.marker,
          },
          entries: {
            owner_id: other.owner,
            playlist_id: other.playlist,
            video_id: other.videoIds[1],
          },
          user_meta: { owner_id: other.owner, video_id: other.videoIds[1], memo: other.marker },
          saved_searches: { owner_id: other.owner, name: `${other.marker}-forged` },
        };
        for (const table of tables) {
          const result = await client.from(table).insert(forged[table]);
          assert(
            result.error?.code === '42501',
            `FAIL: forged ${table} INSERT was not rejected by RLS (42501)`,
          );
        }
        const ownUsage = requireOk(await client.rpc('read_my_library_usage'), 'Own usage');
        assert(
          ownUsage.resources.videos.count === 2 && ownUsage.resources.playlists.count === 1,
          'Own usage mismatch',
        );
        assert(
          !JSON.stringify(ownUsage).includes(other.owner),
          'FAIL: usage RPC leaked another owner',
        );
      }
      for (const { client } of clients) {
        for (const table of tables) {
          const rows = requireOk(
            await client.from(table).select('owner_id'),
            'Own fixture readback',
          );
          assert(
            rows.length === (table === 'videos' ? 2 : 1),
            `Fixture integrity failed: ${table}`,
          );
        }
      }
      console.log('PASS: two-account RLS isolation, forged-write rejection and owner-only usage.');
    }
  } catch (error) {
    primaryError = error;
  }
  try {
    await cleanup();
    console.log('PASS: synthetic fixtures removed; both test accounts are empty.');
  } catch (error) {
    if (primaryError) console.error(primaryError.message);
    throw error;
  }
  if (primaryError) throw primaryError;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  verifyProduction(process.env, process.argv.includes('--cleanup')).catch((error) => {
    // Never dump the Supabase response, request headers or tokens.
    console.error(`Verification stopped: ${error.message}`);
    process.exitCode = 1;
  });
}
