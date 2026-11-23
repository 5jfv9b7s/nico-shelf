import {
  VIDEO_ID_RE,
  validateVideoMetadata,
  readTextLimited,
} from '../../shared/video-metadata.js';
function metadataError(message, status, code, retryAfterMs = 0) {
  return Object.assign(new Error(message), { status, code, retryAfterMs });
}
function retryAfter(value) {
  if (!value) return 60000;
  const seconds = /^\d+$/.test(value)
    ? Number(value)
    : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  return Math.max(1000, Math.min(Number.isFinite(seconds) ? seconds * 1000 : 60000, 3600000));
}
/** Session goes only to our fixed same-origin endpoint; cancellation affects reads. */
export function createMetadataFetch(auth, fetchPage = fetch) {
  return async (id, { signal } = {}) => {
    if (!VIDEO_ID_RE.test(id)) throw new Error('動画IDが不正です');
    signal?.throwIfAborted();
    const { data, error } = await auth.getSession();
    if (error || !data?.session?.access_token)
      throw metadataError('ログインしてから動画情報を取得してください', 401, 'AUTH_REQUIRED');
    signal?.throwIfAborted();
    const response = await fetchPage('/api/video-metadata/' + id, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(35000)])
        : AbortSignal.timeout(35000),
      headers: { Authorization: 'Bearer ' + data.session.access_token, Accept: 'application/json' },
    });
    let body = {};
    try {
      body = JSON.parse(await readTextLimited(response));
    } catch (error) {
      signal?.throwIfAborted();
      if (response.ok)
        throw metadataError(
          '動画情報の応答を確認できません。Cloudflare・Renderの更新状況を確認してください',
          response.status,
          'GATEWAY_INVALID_DATA',
        );
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};
    if (!response.ok) {
      const code =
        typeof body.code === 'string' && /^[A-Z_]{1,60}$/.test(body.code)
          ? body.code
          : response.status === 429
            ? 'RATE_LIMITED'
            : 'GATEWAY_ERROR';
      const upstream =
        Number.isInteger(body.upstreamStatus) &&
        body.upstreamStatus >= 100 &&
        body.upstreamStatus <= 599
          ? ` / 上流HTTP ${body.upstreamStatus}`
          : '';
      throw metadataError(
        (typeof body.error === 'string' ? body.error.slice(0, 300) : '動画情報を取得できません') +
          '（' +
          code +
          upstream +
          '）',
        response.status,
        code,
        retryAfter(response.headers.get('Retry-After')),
      );
    }
    return validateVideoMetadata(body, id);
  };
}
