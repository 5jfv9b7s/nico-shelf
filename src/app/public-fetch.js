/** Send the current session only to this app's public-mylist read endpoint. */
export function createAuthenticatedPublicFetch(auth, fetchPage = fetch) {
  return async (url, init = {}) => {
    if (!/^\/api\/public-mylists\/[1-9]\d{0,15}\?page=(?:[1-9]|1\d|20)$/.test(url)) {
      throw new Error('公開マイリストの取得先が不正です');
    }
    const session = await auth?.getSession();
    if (session?.error || !session?.data?.session?.access_token) {
      throw new Error('ログインしてから公開マイリストを取得してください');
    }
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${session.data.session.access_token}`);
    return fetchPage(url, { ...init, headers });
  };
}
