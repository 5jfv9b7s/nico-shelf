import { publicMylistUpstreamUrl, parsePublicMylistPage } from './public-mylist.js';

/** Same-origin, authenticated, strictly read-only API route. */
function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

async function authenticate(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    return { error: 'Cloudflare側に認証用のWorker環境変数が設定されていません', status: 503 };
  }
  const origin = new URL(env.SUPABASE_URL);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/') {
    return { error: 'SUPABASE_URLの設定が不正です', status: 503 };
  }
  const authorization = request.headers.get('Authorization') || '';
  if (!/^Bearer [\w.-]{10,4096}$/.test(authorization)) {
    return { error: 'NICO SHELFへログインしてください', status: 401 };
  }
  try {
    const response = await fetch(`${origin.origin}/auth/v1/user`, {
      headers: {
        Authorization: authorization,
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return { error: 'ログイン状態を確認できませんでした。再ログインしてください', status: 401 };
    const user = await response.json();
    if (!user || typeof user.id !== 'string' || !user.id) return { error: '認証情報が不正です', status: 401 };
    return { id: user.id };
  } catch {
    return { error: '認証サービスに接続できませんでした', status: 503 };
  }
}

/** Exported to allow mocked request tests without a Cloudflare account. */
export async function handlePublicMylistRequest(request, env) {
  if (request.method !== 'GET') return json({ error: 'GETのみ対応しています' }, 405);
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/public-mylists\/([1-9]\d{0,15})$/);
  if (!match) return json({ error: '不正なマイリストIDです' }, 400);
  const pageText = url.searchParams.get('page') || '1';
  if (!/^(?:[1-9]|1\d|20)$/.test(pageText)) return json({ error: 'ページ番号は1〜20で指定してください' }, 400);
  const auth = await authenticate(request, env);
  if (auth.error) return json({ error: auth.error }, auth.status);

  try {
    const upstream = await fetch(publicMylistUpstreamUrl(match[1], Number(pageText)), {
      headers: {
        'X-Frontend-Id': '6',
        'X-Frontend-Version': '0',
        Accept: 'application/json',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (upstream.status === 401 || upstream.status === 403 || upstream.status === 404) {
      return json({ error: '公開マイリストを取得できません。非公開・削除・アクセス制限の可能性があります' }, 403);
    }
    if (!upstream.ok) return json({ error: `ニコニコの取得APIがHTTP ${upstream.status}を返しました` }, 502);
    const payload = await upstream.json();
    return json(parsePublicMylistPage(payload, match[1], Number(pageText)));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'マイリスト取得に失敗しました' }, 502);
  }
}

export default {
  fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith('/api/')) return handlePublicMylistRequest(request, env);
    return env.ASSETS.fetch(request);
  },
};
