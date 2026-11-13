import { createRemoteJWKSet, customFetch, decodeProtectedHeader, jwtVerify } from 'jose';

function authError(code, status, error) {
  return { code, status, error, stage: 'authentication' };
}

export function sessionConfiguration(env) {
  try {
    const url = new URL(env?.SUPABASE_URL || env?.VITE_SUPABASE_URL || '');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      return null;
    const issuer = `${url.origin}${url.pathname.replace(/\/+$/, '')}/auth/v1`;
    return { issuer, jwks: new URL(`${issuer}/.well-known/jwks.json`) };
  } catch {
    return null;
  }
}

/** Cache trusted project keys, then verify each session locally before any Nico request. */
export function createSessionVerifier({ fetchKeys = (...args) => fetch(...args) } = {}) {
  const resolvers = new Map();
  return async (request, env) => {
    const authorization = request.headers.get('Authorization') || '';
    if (
      authorization.length > 16384 ||
      !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(authorization)
    ) {
      return authError('AUTH_REQUIRED', 401, 'ログインしてから公開マイリストを取得してください');
    }
    const configuration = sessionConfiguration(env);
    if (!configuration)
      return authError(
        'AUTH_NOT_CONFIGURED',
        503,
        '取得APIの認証設定がありません。CloudflareのSUPABASE_URLを確認してください',
      );

    try {
      const token = authorization.slice(7);
      const { alg } = decodeProtectedHeader(token);
      let key;
      if (alg === 'HS256') {
        if (typeof env.SUPABASE_JWT_SECRET !== 'string' || env.SUPABASE_JWT_SECRET.length < 32) {
          return authError(
            'AUTH_LEGACY_KEY_REQUIRED',
            503,
            '旧署名方式の検証設定がありません。運営者がCloudflareのSUPABASE_JWT_SECRETを確認してください',
          );
        }
        key = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
      } else if (alg === 'ES256' || alg === 'RS256') {
        if (!resolvers.has(configuration.issuer)) {
          resolvers.set(
            configuration.issuer,
            createRemoteJWKSet(configuration.jwks, {
              timeoutDuration: 5000,
              cacheMaxAge: 10 * 60 * 1000,
              cooldownDuration: 30000,
              [customFetch]: (url, init) => fetchKeys(url, { ...init, redirect: 'manual' }),
            }),
          );
        }
        key = resolvers.get(configuration.issuer);
      } else {
        return authError(
          'AUTH_INVALID',
          401,
          'ログイン情報を確認できません。再ログインしてください',
        );
      }
      const { payload } = await jwtVerify(token, key, {
        algorithms: [alg],
        issuer: configuration.issuer,
        audience: 'authenticated',
        requiredClaims: ['exp', 'iat', 'sub', 'iss', 'aud'],
        typ: 'JWT',
      });
      if (
        payload.role !== 'authenticated' ||
        typeof payload.sub !== 'string' ||
        !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(payload.sub)
      ) {
        return authError('AUTH_INVALID', 401, 'ログイン済みユーザーの権限を確認できません');
      }
      return { subject: payload.sub };
    } catch (error) {
      if (
        error instanceof TypeError ||
        ['ERR_JWKS_TIMEOUT', 'ERR_JWKS_INVALID', 'ERR_JOSE_GENERIC'].includes(error?.code)
      ) {
        return authError(
          'AUTH_KEYS_UNAVAILABLE',
          503,
          'ログイン署名の確認用キーを取得できません。時間を空けて再試行してください',
        );
      }
      return authError(
        'AUTH_INVALID',
        401,
        'ログイン情報の有効期限または署名を確認できません。再ログインしてください',
      );
    }
  };
}

export const verifyPublicSession = createSessionVerifier();
