import {
  publicMylistUpstreamUrl,
  parsePublicMylistPage,
  validatePublicMylistPage,
} from './public-mylist.js';
import { sessionConfiguration, verifyPublicSession } from './session-auth.js';

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
    return failure(
      'RATE_LIMIT_UNCONFIGURED',
      'rate_limit',
      '公開マイリストAPIのレート制限設定がありません。wrangler.jsoncを含めて再デプロイしてください',
      503,
    );
  }
  // Cloudflare-provided client IP, not a user-supplied X-Forwarded-For value.
  const visitor = request.headers.get('CF-Connecting-IP') || 'unknown';
  try {
    const { success } = await limiter.limit({ key: `nico-public:${visitor}` });
    if (!success)
      return json(
        {
          error: '短時間に取得が集中しました。1分ほど空けてから再試行してください',
          code: 'RATE_LIMITED',
          stage: 'rate_limit',
        },
        429,
      );
  } catch {
    return failure(
      'RATE_LIMIT_FAILED',
      'rate_limit',
      '公開マイリストAPIの制限処理に失敗しました。時間を空けて再試行してください',
      503,
    );
  }
  return null;
}

/** Account quota uses only the verified JWT subject, never a request-supplied ID. */
async function checkAccountRateLimit(subject, env) {
  const limiter = env?.PUBLIC_MYLIST_USER_RATE_LIMIT;
  if (!limiter || typeof limiter.limit !== 'function')
    return failure(
      'ACCOUNT_RATE_LIMIT_UNCONFIGURED',
      'rate_limit',
      'アカウント単位の取得制限設定がありません。wrangler.jsoncを含めて再デプロイしてください',
      503,
    );
  try {
    const { success } = await limiter.limit({ key: 'nico-user:' + subject });
    if (!success) {
      const response = json(
        {
          error: 'このアカウントの取得が短時間に集中しました。1分ほど空けてから再試行してください',
          code: 'ACCOUNT_RATE_LIMITED',
          stage: 'rate_limit',
        },
        429,
      );
      response.headers.set('Retry-After', '60');
      return response;
    }
  } catch {
    return failure(
      'ACCOUNT_RATE_LIMIT_FAILED',
      'rate_limit',
      'アカウント単位の取得制限を確認できません。時間を空けて再試行してください',
      503,
    );
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
 * Gateway mode is enabled only after real network testing on the target host.
 * It must be a fixed HTTPS destination configured by the operator, not user input.
 */
function gatewayConfiguration(env) {
  if (env?.PUBLIC_MYLIST_SOURCE !== 'gateway') return { reason: 'SOURCE_NOT_GATEWAY' };
  let base;
  try {
    base = new URL(String(env.PUBLIC_MYLIST_GATEWAY_URL || ''));
  } catch {
    return { reason: 'GATEWAY_URL_INVALID' };
  }
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== '/' ||
    !base.hostname
  )
    return { reason: 'GATEWAY_URL_INVALID' };
  const token = String(env.PUBLIC_MYLIST_GATEWAY_TOKEN || '');
  if (token.length < 24) return { reason: 'GATEWAY_TOKEN_INVALID' };
  return { config: { base, token }, reason: null };
}
function gatewayConfig(env) {
  return gatewayConfiguration(env).config ?? null;
}

async function requestGatewayPage(env, listId, page) {
  const config = gatewayConfig(env);
  if (!config)
    return json(
      {
        error:
          '公開マイリスト取得サービスの設定が確認できません。運営者がCloudflareの接続設定を確認してください。データは変更していません',
        code: 'PUBLIC_SYNC_NOT_READY',
        stage: 'configuration',
        reason: gatewayConfiguration(env).reason,
      },
      503,
    );
  const url = new URL(`/v1/public-mylists/${listId}?page=${page}`, config.base);
  let response;
  try {
    response = await fetch(url.toString(), {
      headers: { 'X-Nico-Shelf-Gateway-Key': config.token, Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(28000),
    });
  } catch (error) {
    return failure(
      'GATEWAY_NETWORK',
      'gateway',
      '公開マイリストの取得サービスに接続できません',
      502,
      { listId, page, reason: error instanceof Error ? error.name : 'UnknownError' },
    );
  }
  if (response.status >= 300 && response.status < 400) {
    return failure(
      'GATEWAY_REDIRECT',
      'gateway',
      '取得サービスから予期しない移動応答がありました',
      502,
      { listId, page },
    );
  }
  // Do not leak gateway details, credentials, or raw responses to browsers.
  const code = response.status === 502 ? 'GATEWAY_UPSTREAM_FAILED' : 'GATEWAY_ERROR';
  if (!response.ok) {
    let diagnostic = null;
    try {
      diagnostic = (await response.json())?.code;
    } catch {}
    const allowed = [
      'UPSTREAM_ACCESS_DENIED',
      'UPSTREAM_NOT_FOUND',
      'UPSTREAM_RATE_LIMITED',
      'UPSTREAM_HTTP_ERROR',
      'UPSTREAM_TIMEOUT',
      'UPSTREAM_NOT_JSON',
      'UPSTREAM_TOO_LARGE',
      'UPSTREAM_INVALID_RESPONSE',
    ];
    if (allowed.includes(diagnostic)) {
      const message =
        diagnostic === 'UPSTREAM_ACCESS_DENIED'
          ? '取得サーバーからニコニコAPIへの接続が拒否されました。別環境での動作確認が必要です'
          : 'ニコニコの公開マイリストを取得できませんでした。時間を空けて再試行してください';
      return json({ error: message, code: diagnostic, stage: 'gateway' }, 502);
    }
    return failure(code, 'gateway', '公開マイリストの取得サービスが利用できません', 502, {
      listId,
      page,
      gatewayStatus: response.status,
    });
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    return failure('GATEWAY_INVALID_JSON', 'gateway', '取得サービスの応答形式が不正です', 502, {
      listId,
      page,
    });
  }
  try {
    return json(validatePublicMylistPage(payload, listId, page));
  } catch {
    return failure(
      'GATEWAY_INVALID_DATA',
      'gateway',
      '取得データが不完全なため同期を中止しました',
      502,
      { listId, page },
    );
  }
}

/**
 * Reject malformed or ambiguous upstream data. The UI handles a validated,
 * explicitly final short list by preserving all existing memberships.
 */
export async function handlePublicMylistRequest(request, env) {
  if (request.method !== 'GET') return json({ error: 'GETのみ対応しています' }, 405);
  const url = new URL(request.url);
  if (url.pathname === '/api/public-mylists/status') {
    const result = gatewayConfiguration(env);
    return json({
      available: Boolean(result.config && sessionConfiguration(env)),
      method: 'gateway',
      upstreamVerified: false,
      authentication: 'required',
      rateLimitScopes: ['ip', 'account'],
      reason: result.reason || (sessionConfiguration(env) ? null : 'AUTH_NOT_CONFIGURED'),
    });
  }
  const match = url.pathname.match(/^\/api\/public-mylists\/([1-9]\d{0,15})$/);
  if (!match) return json({ error: '不正なマイリストIDです' }, 400);
  const pageText = url.searchParams.get('page') || '1';
  if (!/^(?:[1-9]|1\d|20)$/.test(pageText))
    return json({ error: 'ページ番号は1〜20で指定してください' }, 400);

  const limited = await checkRateLimit(request, env);
  if (limited) return limited;
  const session = await verifyPublicSession(request, env);
  if (session.error)
    return json({ error: session.error, code: session.code, stage: session.stage }, session.status);
  const accountLimited = await checkAccountRateLimit(session.subject, env);
  if (accountLimited) return accountLimited;

  const listId = match[1];
  const page = Number(pageText);
  if (env?.PUBLIC_MYLIST_SOURCE !== 'direct') return requestGatewayPage(env, listId, page);
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
    return failure(
      'NICO_REDIRECT',
      'http',
      'ニコニコAPIが予期しないリダイレクトを返しました',
      502,
      { ...logContext, upstreamStatus: status },
    );
  }
  if (status === 401 || status === 403 || status === 404) {
    return json(
      {
        error:
          status === 403
            ? 'ニコニコAPIがCloudflareからの通信を拒否しました（HTTP 403）'
            : 'ニコニコAPIから取得できませんでした',
        code: status === 403 ? 'NICO_ACCESS_DENIED' : 'NICO_NOT_PUBLIC',
        stage: 'http',
        upstreamStatus: status,
      },
      403,
    );
  }
  if (status === 429) {
    return failure(
      'NICO_RATE_LIMITED',
      'http',
      'ニコニコ側のアクセス制限に達しました。時間を空けて再試行してください',
      502,
      { ...logContext, upstreamStatus: status },
    );
  }
  if (!upstream.ok) {
    return failure(
      'NICO_HTTP_ERROR',
      'http',
      `ニコニコの取得APIがHTTP ${status}を返しました`,
      502,
      { ...logContext, upstreamStatus: status },
    );
  }

  const contentType = upstream.headers.get('content-type') || '';
  if (!/(?:^|\b)(?:application\/json|[^\s;]+\+json)(?:\b|\s*;|$)/i.test(contentType)) {
    return failure(
      'NICO_NON_JSON',
      'response',
      'ニコニコAPIからJSON以外の応答が返されました（HTMLの制限・エラー画面などの可能性）',
      502,
      { ...logContext, upstreamStatus: status, contentType: contentType.slice(0, 80) },
    );
  }

  let payload;
  try {
    payload = await upstream.json();
  } catch (error) {
    return failure(
      'NICO_INVALID_JSON',
      'response',
      'ニコニコAPIのJSONを解析できませんでした',
      502,
      { ...logContext, reason: error instanceof Error ? error.name : 'UnknownError' },
    );
  }

  try {
    return json(parsePublicMylistPage(payload, listId, page));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const expected = /公開マイリストのAPI応答|動画IDを取得|取得件数/.test(message);
    return failure(
      'NICO_INVALID_DATA',
      'parse',
      expected ? message : 'ニコニコAPIのデータ形式が想定と異なります',
      502,
      { ...logContext, reason: error instanceof Error ? error.name : 'UnknownError' },
    );
  }
}

export default {
  fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith('/api/')) return handlePublicMylistRequest(request, env);
    return env.ASSETS.fetch(request);
  },
};
