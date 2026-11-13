import { snapshotFromBridgeParts } from './sync.js';

const ID_RE = /^[1-9]\d{0,15}$/;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const TRANSIENT_GATEWAY_ERRORS = new Set(['GATEWAY_NETWORK', 'GATEWAY_ERROR']);
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Retry a read-only page once on temporary gateway outages (e.g. cold starts).
 * Never retry access denials, rate limits, incomplete data or deleted lists.
 */
export async function requestPublicPage(
  url,
  { fetchPage = fetch, onProgress = () => {}, sleep = pause } = {},
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let response;
    try {
      response = await fetchPage(url, { cache: 'no-store' });
    } catch (error) {
      const retryableNetworkError = error instanceof TypeError || error?.name === 'TimeoutError';
      if (attempt > 0 || !retryableNetworkError) throw error;
      onProgress('取得サーバーへの接続を再確認しています…');
      await sleep(1500);
      continue;
    }
    const body = await response.json().catch(() => ({}));
    if (attempt === 0 && response.status === 502 && TRANSIENT_GATEWAY_ERRORS.has(body.code)) {
      onProgress('取得サーバーが応答するまで再接続しています…');
      await sleep(1500);
      continue;
    }
    return { response, body };
  }
  throw new Error('公開マイリストの取得サービスに接続できません');
}

/** Use the same URL flow to import a new list or resync an existing one. */
export function findExistingPublicPlaylist(playlists, id) {
  return playlists.find((playlist) => String(playlist.id) === id) || null;
}

/** Accept an ID or the conventional public mylist URL. No arbitrary URLs. */
export function parsePublicMylistId(value) {
  const input = String(value ?? '').trim();
  if (ID_RE.test(input)) return input;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || !['www.nicovideo.jp', 'nicovideo.jp'].includes(url.hostname))
      return null;
    const match = url.pathname.match(/^\/(?:user\/\d+\/)?mylist\/([1-9]\d{0,15})\/?$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function assemblePublicMylistPages(pages, listId) {
  if (!ID_RE.test(listId) || !Array.isArray(pages) || !pages.length || pages.length > MAX_PAGES) {
    throw new Error('公開マイリストを完全に取得できませんでした');
  }
  let total = null;
  let hasNext = true;
  const ids = new Set();
  const items = [];
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    if (
      !hasNext ||
      page?.id !== listId ||
      page.page !== index + 1 ||
      !Array.isArray(page.items) ||
      page.items.length > PAGE_SIZE
    ) {
      throw new Error('取得ページに欠落・順番違いがあります。同期を中止しました');
    }
    if (page.hasNext != null && typeof page.hasNext !== 'boolean') {
      throw new Error('公開マイリストの継続状態が不正です');
    }
    if (page.totalCount !== null && page.totalCount !== undefined) {
      if (
        !Number.isSafeInteger(page.totalCount) ||
        page.totalCount < 0 ||
        page.totalCount > PAGE_SIZE * MAX_PAGES ||
        (total !== null && total !== page.totalCount)
      ) {
        throw new Error('マイリスト件数が取得途中で変わりました。再度取得してください');
      }
      total = page.totalCount;
    }
    if (page.items.length === 0 && total === null) {
      throw new Error('0件という応答だけでは取得完了を確認できません。同期を中止しました');
    }
    for (const item of page.items) {
      if (
        !/^(?:sm|nm|so)\d{1,12}$/i.test(item?.video_id || '') ||
        ids.has(item.video_id.toLowerCase())
      ) {
        throw new Error('取得した動画IDが不正・重複しています。同期を中止しました');
      }
      ids.add(item.video_id.toLowerCase());
      items.push({
        video_id: item.video_id.toLowerCase(),
        title: String(item.title || '').slice(0, 220),
      });
    }
    hasNext =
      page.hasNext === true ||
      (page.hasNext == null &&
        page.items.length === PAGE_SIZE &&
        (total === null || items.length < total));
  }
  const countMismatch = total !== null && items.length !== total;
  // Only an explicit final-page marker permits a short public response. Keep
  // its count discrepancy through preview and the database write operation.
  if (
    hasNext ||
    items.length > 1000 ||
    (countMismatch &&
      (items.length === 0 || items.length > total || pages.at(-1).hasNext !== false))
  ) {
    throw new Error('すべての動画を取得できませんでした。削除候補の誤検出を防ぐため中止します');
  }
  return {
    id: listId,
    name: String(pages[0].name || listId).slice(0, 100),
    complete: true,
    ...(total !== null ? { reported_total: total } : {}),
    ...(countMismatch ? { allow_removals: false } : {}),
    items,
  };
}

export async function fetchPublicMylist(
  listId,
  { onProgress = () => {}, fetchPage = fetch, sleep = pause } = {},
) {
  if (!ID_RE.test(listId)) throw new Error('マイリストIDが不正です');
  const pages = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    onProgress(`${listId}: ${page}ページ目を取得中…`);
    const { response, body: pageResult } = await requestPublicPage(
      `/api/public-mylists/${listId}?page=${page}`,
      { fetchPage, onProgress, sleep },
    );
    if (!response.ok) {
      const detail = pageResult.error || `HTTP ${response.status}`;
      const diagnostic = pageResult.code ? ` [${pageResult.code}]` : '';
      throw new Error(`${listId}: ${detail}${diagnostic}`);
    }
    if (!Array.isArray(pageResult.items)) throw new Error(`${listId}: API応答が不完全です`);
    pages.push(pageResult);
    const total = pages.reduce((value, part) => value + part.items.length, 0);
    if (
      pageResult.hasNext === false ||
      (pageResult.hasNext == null &&
        (pageResult.items.length < PAGE_SIZE ||
          (pageResult.totalCount !== null && total >= pageResult.totalCount)))
    ) {
      return assemblePublicMylistPages(pages, listId);
    }
  }
  throw new Error('20ページ以内に取得が完了しませんでした');
}

/** Produces the same fully validated snapshot format as the Tampermonkey flow. */
export async function fetchPublicSnapshot(lists, options) {
  if (!lists.length || lists.length > 25) throw new Error('公開リストを1〜25個選択してください');
  const parts = [];
  for (const list of lists) {
    parts.push(await fetchPublicMylist(String(list.id), options));
  }
  return snapshotFromBridgeParts(lists, parts);
}
