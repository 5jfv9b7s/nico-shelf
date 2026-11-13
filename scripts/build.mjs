import { readFile, writeFile } from 'node:fs/promises';
import { build, loadEnv } from 'vite';

const environment = loadEnv('production', process.cwd(), 'VITE_');
const configuredUrl = process.env.VITE_SUPABASE_URL || environment.VITE_SUPABASE_URL;
await build();

// Match the project's actual Auth/Data API host, including custom Supabase domains.
if (configuredUrl) {
  const url = new URL(configuredUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('VITE_SUPABASE_URL must be an HTTP(S) project URL');
  }
  const websocket = new URL(url.origin);
  websocket.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const path = new URL('../dist/_headers', import.meta.url);
  const headers = await readFile(path, 'utf8');
  await writeFile(
    path,
    headers.replace(
      'https://*.supabase.co wss://*.supabase.co',
      `${url.origin} ${websocket.origin}`,
    ),
  );
}
