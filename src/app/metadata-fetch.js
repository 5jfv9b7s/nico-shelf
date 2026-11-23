import {
  VIDEO_ID_RE,
  validateVideoMetadata,
  readTextLimited,
} from '../../shared/video-metadata.js';

/** The session is sent only to our fixed same-origin endpoint, never to Nico/Render. */
export function createMetadataFetch(auth, fetchPage = fetch) {
  return async (id) => {
    if (!VIDEO_ID_RE.test(id)) throw new Error('動画IDが不正です');
    const { data, error } = await auth.getSession();
    if (error || !data?.session?.access_token)
      throw new Error('ログインしてから動画情報を取得してください');
    const response = await fetchPage('/api/video-metadata/' + id, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(35000),
      headers: { Authorization: 'Bearer ' + data.session.access_token, Accept: 'application/json' },
    });
    let body;
    try {
      body = JSON.parse(await readTextLimited(response));
    } catch {
      throw new Error(
        '動画情報の応答を確認できません。Cloudflare・Renderの更新状況を確認してください',
      );
    }
    if (!response.ok)
      throw new Error(
        (typeof body.error === 'string' ? body.error.slice(0, 300) : '動画情報を取得できません') +
          (typeof body.code === 'string' && /^[A-Z_]{1,60}$/.test(body.code)
            ? '（' + body.code + '）'
            : ''),
      );
    return validateVideoMetadata(body, id);
  };
}
