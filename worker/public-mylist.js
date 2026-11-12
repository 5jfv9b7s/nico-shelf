/**
 * Read-only adapter for NicoNico's public mylist endpoint.
 * Never accepts an arbitrary upstream URL, cookie, or NicoNico credential.
 * This is an undocumented endpoint; reject ambiguous responses rather than
 * treating a partial list as a deletion from the user's own library.
 */
export const PUBLIC_MYLIST_ID = /^[1-9]\d{0,15}$/;
export const PAGE_SIZE = 100;
export const MAX_PAGES = 20;
const VIDEO_ID = /^(?:sm|nm|so)\d{1,12}$/i;

export function parsePublicMylistPage(payload, listId, page) {
  const list = payload?.data?.mylist;
  if (!list || !Array.isArray(list.items)) {
    throw new Error('公開マイリストのAPI応答を認識できません');
  }
  const seen = new Set();
  const items = list.items.map((item, index) => {
    const video = item?.video;
    const videoId = String(video?.id ?? '');
    if (!VIDEO_ID.test(videoId) || seen.has(videoId.toLowerCase())) {
      throw new Error(`動画IDを取得できない項目があります（${index + 1}件目）。誤削除を防ぐため同期を中止しました`);
    }
    seen.add(videoId.toLowerCase());
    return { video_id: videoId.toLowerCase(), title: String(video.title ?? '').slice(0, 220) };
  });
  const rawCount = list.totalItemCount ?? list.totalCount ?? null;
  const totalCount = Number.isSafeInteger(Number(rawCount)) && rawCount !== null
    ? Number(rawCount) : null;
  if (items.length > PAGE_SIZE || (totalCount !== null && (totalCount < 0 || totalCount > PAGE_SIZE * MAX_PAGES))) {
    throw new Error('取得件数が許容範囲を超えています');
  }
  // Some API variants omit hasNext; the client then checks the item count.
  if (items.length === 0 && totalCount === null) {
    throw new Error('0件の応答について実際の総件数を確認できません');
  }
  const hasNext = typeof list.hasNext === 'boolean' ? list.hasNext : null;
  return {
    id: listId,
    name: String(list.name || listId).slice(0, 100),
    page,
    pageSize: PAGE_SIZE,
    totalCount,
    hasNext,
    items,
  };
}

export function publicMylistUpstreamUrl(id, page) {
  if (!PUBLIC_MYLIST_ID.test(id) || !Number.isInteger(page) || page < 1 || page > MAX_PAGES) {
    throw new Error('マイリストIDまたはページ番号が不正です');
  }
  const url = new URL(`https://nvapi.nicovideo.jp/v2/mylists/${id}`);
  url.searchParams.set('page', String(page));
  url.searchParams.set('pageSize', String(PAGE_SIZE));
  return url;
}

/** Untrusted normalized page from optional Node gateway: validate before UI. */
export function validatePublicMylistPage(pageData, listId, page) {
  if (!PUBLIC_MYLIST_ID.test(listId) || pageData?.id !== listId || pageData?.page !== page ||
      !Array.isArray(pageData?.items) || pageData.items.length > PAGE_SIZE) {
    throw new Error('公開マイリストの取得結果が不完全です');
  }
  const seen = new Set();
  const items = pageData.items.map((item) => {
    const id = String(item?.video_id || '').toLowerCase();
    if (!VIDEO_ID.test(id) || seen.has(id) || typeof item.title !== 'string' || item.title.length > 220) {
      throw new Error('公開マイリストの動画ID・タイトルが不正です');
    }
    seen.add(id);
    return { video_id: id, title: item.title };
  });
  const total = pageData.totalCount;
  if (total !== null && total !== undefined && (!Number.isSafeInteger(total) || total < 0 || total > 2000)) {
    throw new Error('公開マイリストの件数が不正です');
  }
  if (items.length === 0 && (total === null || total === undefined)) {
    throw new Error('0件の応答について実際の総件数を確認できません');
  }
  if (pageData.hasNext !== null && pageData.hasNext !== undefined && typeof pageData.hasNext !== 'boolean') {
    throw new Error('公開マイリストの継続状態が不正です');
  }
  return {
    id: listId,
    page,
    pageSize: PAGE_SIZE,
    name: String(pageData.name || listId).slice(0, 100),
    totalCount: total ?? null,
    hasNext: pageData.hasNext ?? null,
    items,
  };
}
