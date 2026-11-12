import { publicMylistUpstreamUrl, parsePublicMylistPage } from './public-mylist.js';

/**
 * Read-only proxy for PUBLIC NicoNico mylists. Never forwards credentials.
 * Database updates are done separately by Supabase RLS, only after the user
 * previews and explicitly accepts a complete snapshot.
 *
 * Error codes intentionally distinguish upstream failures while withholding
 * response bodies, request headers, cookies and tokens from clients/logs.
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

function failure(code, stage, message, status = 502, log = {}) {
  // Avoid logging any upstream response bodies, user headers, or auth data.
  console.error('[nico-public-mylist]', JSON.stringify({ code, stage, ...log }));
  return json({ error: message, code, stage }, status);
}

async function checkRateLimit(request, env) {
  const limiter = env?.PUBLIC_MYLIST_RATE_LIMIT;
  if (!limiter || typeof limiter.limit !== 'function') {
    return failure('RATE_LIMIT_UNCONFIGURED', 'rate_limit',
      '公開マイリストAPIのレート制限設定がありません。wrangler.jsoncを含めて再デプロイしてください', 503);
  }
  // Cloudflare-provided client IP, not a user-supplied X-Forwarded-For value.
  const visitor = request.headers.get('CF-Connecting-IP') || 'unknown';
  try {
    const { success } = await limiter.limit({ key: `nico-public:${visitor}` });
    if (!success) return json({ error: '短時間に取得が集中しました。1分ほど空けてから再試行してください', code: 'RATE_LIMITED', stage: 'rate_limit' }, 429);
  } catch {
    return failure('RATE_LIMIT_FAILED', 'rate_limit',
      '公開マイリストAPIの制限処理に失敗しました。時間を空けて再試行してください', 503);
  }
  return null;
}

function classifyFetchFailure(error) {
  const name = error instanceof Error ? error.name : 'UnknownError';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return { code: 'NICO_TIMEOUT', message: 'ニコニコAPIへの接続が15秒以内に完了しませんでした' };
  }
  return { code: 'NICO_NETWORK', message: 'CloudflareからニコニコAPIに接続できませんでした' };
}

/**
 * The upstream API is unofficial/undocumented; fail closed on ANY unknown
 * response, especially an empty or partial page, to prevent mass removals.
 */
export async function handlePublicMylistRequest(request, env) {
  if (request.method !== 'GET') return json({ error: 'GETのみ対応しています' }, 405);
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/public-mylists\/([1-9]\d{0,15})$/);
  if (!match) return json({ error: '不正なマイリストIDです' }, 400);
  const pageText = url.searchParams.get('page') || '1';
  if (!/^(?:[1-9]|1\d|20)$/.test(pageText)) return json({ error: 'ページ番号は1〜20で指定してください' }, 400);

  const limited = await checkRateLimit(request, env);
  if (limited) return limited;

  const listId = match[1];
  const page = Number(pageText);
  const logContext = { listId, page }; // Public list identifiers only.
  let upstream;
  try {
    upstream = await fetch(publicMylistUpstreamUrl(listId, page).toString(), {
      headers: {
        'X-Frontend-Id': '6',
        'X-Frontend-Version': '0',
        'X-Niconico-Language': 'ja-jp',
        Accept: 'application/json',
      },
      // Surface redirects as HTTP responses, rather than indistinguishable
      // TypeError failures with redirect: 'error'. Never follow a redirect.
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    const { code, message } = classifyFetchFailure(error);
    const reason = error instanceof Error ? error.name : 'UnknownError';
    return failure(code, 'fetch', message, 502, { ...logContext, reason });
  }

  const status = upstream.status;
  if (status >= 300 && status < 400) {
    return failure('NICO_REDIRECT', 'http', 'ニコニコAPIが予期しないリダイレクトを返しました', 502,
      { ...logContext, upstreamStatus: status });
  }
  if (status === 401 || status === 403 || status === 404) {
    return json({
      error: '公開マイリストを取得できません。非公開・削除・アクセス制限の可能性があります',
      code: 'NICO_NOT_PUBLIC', stage: 'http', upstreamStatus: status,
    }, 403);
  }
  if (status === 429) {
    return failure('NICO_RATE_LIMITED', 'http', 'ニコニコ側のアクセス制限に達しました。時間を空けて再試行してください',
      502, { ...logContext, upstreamStatus: status });
  }
  if (!upstream.ok) {
    return failure('NICO_HTTP_ERROR', 'http', `ニコニコの取得APIがHTTP ${status}を返しました`,
      502, { ...logContext, upstreamStatus: status });
  }

  const contentType = upstream.headers.get('content-type') || '';
  if (!/(?:^|\b)(?:application\/json|[^\s;]+\+json)(?:\b|\s*;|$)/i.test(contentType)) {
    return failure('NICO_NON_JSON', 'response',
      'ニコニコAPIからJSON以外の応答が返されました（HTMLの制限・エラー画面などの可能性）',
      502, { ...logContext, upstreamStatus: status, contentType: contentType.slice(0, 80) });
  }

  let payload;
  try {
    payload = await upstream.json();
  } catch (error) {
    return failure('NICO_INVALID_JSON', 'response', 'ニコニコAPIのJSONを解析できませんでした',
      502, { ...logContext, reason: error instanceof Error ? error.name : 'UnknownError' });
  }

  try {
    return json(parsePublicMylistPage(payload, listId, page));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const expected = /公開マイリストのAPI応答|動画IDを取得|取得件数/.test(message);
    return failure('NICO_INVALID_DATA', 'parse',
      expected ? message : 'ニコニコAPIのデータ形式が想定と異なります', 502,
      { ...logContext, reason: error instanceof Error ? error.name : 'UnknownError' });
  }
}

export default {
  fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith('/api/')) return handlePublicMylistRequest(request, env);
    return env.ASSETS.fetch(request);
  },
};
