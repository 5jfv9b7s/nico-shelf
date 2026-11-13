/**
 * Video availability for scatter-plot calculations.
 *
 * Imported data includes Japanese fetch outcomes (取得成功 / 取得失敗) and
 * yt-dlp placeholders ("Deleted video" / "Private video").  A fetch failure
 * is NOT proof of deletion: report it separately as unconfirmed availability.
 * Never infer deletion from absent metadata, 0 views or old playlist entries.
 */

const DELETED_STATUS =
  /^(?:deleted|deleted_video|removed|video_deleted|not_found|404|削除|削除済み|動画削除|削除された動画)$/i;
const PRIVATE_STATUS =
  /^(?:private|private_video|nonpublic|non_public|非公開|非公開動画|限定非公開|閲覧不可|公開停止)$/i;
const UNKNOWN_STATUS =
  /^(?:取得失敗|fetch_failed|failed|unavailable|inaccessible|unknown|取得不可|動画取得失敗)$/i;
const DELETED_TITLE =
  /^(?:deleted video|this video (?:has been|was) deleted|削除された動画|この動画は削除されました)$/i;
const PRIVATE_TITLE = /^(?:private video|this video is private|非公開動画|この動画は非公開です)$/i;
const CONFIRMED_AVAILABLE = /^(?:取得成功|部分取得|available|ok|public|active|success)$/i;

/** @returns {'deleted' | 'private' | 'unconfirmed' | null} */
export function scatterExclusionReason(video) {
  const status = String(video?.status ?? '')
    .normalize('NFKC')
    .trim();
  const title = String(video?.title ?? '')
    .normalize('NFKC')
    .trim();
  if (DELETED_STATUS.test(status)) return 'deleted';
  if (PRIVATE_STATUS.test(status)) return 'private';
  // On the original import a failed fetch often also supplied the exact
  // "Deleted video" or "Private video" placeholder. Prefer that explicit
  // evidence; leave other fetch failures in the unconfirmed category.
  if (!CONFIRMED_AVAILABLE.test(status)) {
    if (DELETED_TITLE.test(title)) return 'deleted';
    if (PRIVATE_TITLE.test(title)) return 'private';
  }
  if (UNKNOWN_STATUS.test(status)) return 'unconfirmed';
  return null;
}

export function availableForScatter(video) {
  return scatterExclusionReason(video) === null;
}
