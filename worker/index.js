import { publicMylistUpstreamUrl, parsePublicMylistPage } from './public-mylist.js';

/**
 * Public, read-only proxy for NicoNico's public mylist endpoint.
 *
 * The payload contains only public NicoNico video metadata, never a user's
 * private NICO SHELF data. The browser's Supabase session belongs to the
 * database client, not this endpoint; asking Supabase Auth to verify it here
 * created a fragile, unnecessary extra network dependency.
 *
 * Abuse protection is mandatory: deploy the PUBLIC_MYLIST_RATE_LIMIT binding
 * configured in wrangler.jsonc. No arbitrary URL, cookies or tokens are sent
 * to NicoNico. This route does not create, update or delete library data.
 */
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

async function checkRateLimit(request, env) {
  const limiter = env?.PUBLIC_MYLIST_RATE_LIMIT;
  if (!limiter || typeof limiter.limit !== 'function') {
    return json({ error: '公開マイリストAPIのレート制限設定がありません。wrangler.jsoncを含めて再デプロイしてください' }, 503);
  }

  // Cloudflare supplies CF-Connecting-IP from the actual visitor connection.
  // Never use an arbitrary client-supplied forwarded-for address as the key.
  const visitor = request.headers.get('CF-Connecting-IP') || 'unknown';
  try {
    const { success } = await limiter.limit({ key: `nico-public:${visitor}` });
    if (!success) return json({ error: '短時間に取得が集中しました。1分ほど空けてから再試行してください' }, 429);
  } catch {
    // Fail closed rather than serving unlimited requests on binding failure.
    return json({ error: '公開マイリストAPIの制限処理に失敗しました。時間を空けて再試行してください' }, 503);
  }
  return null;
}

/** Exported so tests can exercise the complete route without a Cloudflare account. */
export async function handlePublicMylistRequest(request, env) {
  if (request.method !== 'GET') return json({ error: 'GETのみ対応しています' }, 405);
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/public-mylists\/([1-9]\d{0,15})$/);
  if (!match) return json({ error: '不正なマイリストIDです' }, 400);
  const pageText = url.searchParams.get('page') || '1';
  if (!/^(?:[1-9]|1\d|20)$/.test(pageText)) return json({ error: 'ページ番号は1〜20で指定してください' }, 400);

  const limited = await checkRateLimit(request, env);
  if (limited) return limited;

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
    if (upstream.status === 429) {
      return json({ error: 'ニコニコ側のアクセス制限に達しました。時間を空けて再試行してください' }, 502);
    }
    if (!upstream.ok) return json({ error: `ニコニコの取得APIがHTTP ${upstream.status}を返しました` }, 502);
    const payload = await upstream.json();
    return json(parsePublicMylistPage(payload, match[1], Number(pageText)));
  } catch (error) {
    // An incomplete/invalid response must never be interpreted as an empty
    // snapshot: it could otherwise trigger mass deletion suggestions.
    const message = error instanceof Error ? error.message : '';
    const detail = /公開マイリストのAPI応答|動画IDを取得|取得件数/.test(message)
      ? message
      : 'ニコニコへの接続またはAPI応答の解析に失敗しました';
    return json({ error: detail }, 502);
  }
}

export default {
  fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith('/api/')) return handlePublicMylistRequest(request, env);
    return env.ASSETS.fetch(request);
  },
};
