import { snapshotFromBridgeParts } from './sync.js';

const ID_RE = /^[1-9]\d{0,15}$/;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

/** Accept an ID or the conventional public mylist URL. No arbitrary URLs. */
export function parsePublicMylistId(value) {
  const input = String(value ?? '').trim();
  if (ID_RE.test(input)) return input;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || !['www.nicovideo.jp', 'nicovideo.jp'].includes(url.hostname)) return null;
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
    if (!hasNext || page?.id !== listId || page.page !== index + 1 || !Array.isArray(page.items) || page.items.length > PAGE_SIZE) {
      throw new Error('取得ページに欠落・順番違いがあります。同期を中止しました');
    }
    if (page.totalCount !== null && page.totalCount !== undefined) {
      if (!Number.isSafeInteger(page.totalCount) || page.totalCount < 0 || (total !== null && total !== page.totalCount)) {
        throw new Error('マイリスト件数が取得途中で変わりました。再度取得してください');
      }
      total = page.totalCount;
    }
    for (const item of page.items) {
      if (!/^(?:sm|nm|so)\d{1,12}$/i.test(item?.video_id || '') || ids.has(item.video_id.toLowerCase())) {
        throw new Error('取得した動画IDが不正・重複しています。同期を中止しました');
      }
      ids.add(item.video_id.toLowerCase());
      items.push({ video_id: item.video_id.toLowerCase(), title: String(item.title || '').slice(0, 220) });
    }
    hasNext = page.hasNext === true || (page.hasNext == null && page.items.length === PAGE_SIZE && (total === null || items.length < total));
  }
  if (hasNext || (total !== null && items.length !== total) || items.length > 1000) {
    throw new Error('すべての動画を取得できませんでした。削除候補の誤検出を防ぐため中止します');
  }
  return {
    id: listId,
    name: String(pages[0].name || listId).slice(0, 100),
    complete: true,
    items,
  };
}

export async function fetchPublicMylist(listId, { onProgress = () => {}, fetchPage = fetch } = {}) {
  if (!ID_RE.test(listId)) throw new Error('マイリストIDが不正です');
  const pages = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    onProgress(`${listId}: ${page}ページ目を取得中…`);
    const response = await fetchPage(`/api/public-mylists/${listId}?page=${page}`, {
      cache: 'no-store',
    });
    const pageResult = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${listId}: ${pageResult.error || `HTTP ${response.status}`}`);
    if (!Array.isArray(pageResult.items)) throw new Error(`${listId}: API応答が不完全です`);
    pages.push(pageResult);
    const total = pages.reduce((value, part) => value + part.items.length, 0);
    if (pageResult.hasNext === false || (pageResult.hasNext == null && (pageResult.items.length < PAGE_SIZE || (pageResult.totalCount !== null && total >= pageResult.totalCount)))) {
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
