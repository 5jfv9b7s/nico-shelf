/** UI guidance only. The database trigger remains the authoritative limit. */
export const IMPORT_FILE_BYTES = 25 * 1024 * 1024;
export const RESOURCE_LABELS = {
  playlists: 'マイリスト',
  videos: '動画',
  entries: 'リストへの所属（履歴を含む）',
  user_meta: 'メモ・評価',
  saved_searches: '保存した検索条件',
};
export function formatMiB(bytes) {
  return `${(Number(bytes || 0) / 1048576).toFixed(2)} MiB`;
}
export function storageErrorMessage(error) {
  const message = String(error?.message || '処理に失敗しました');
  if (message.includes('NICO_QUOTA_GLOBAL'))
    return 'サービス全体の保存上限に達しました。時間を置くか、ヘルプの窓口へお問い合わせください。';
  if (/NICO_QUOTA_(ROWS|BYTES)/.test(message))
    return 'このアカウントの保存上限に達しました。「データと設定」で使用量を確認してください。';
  if (/NICO_(FIELD|ARRAY|ROW)_LIMIT/.test(message))
    return '保存する文字数・タグ数・データ量が上限を超えています。内容を短くして再試行してください。';
  return message;
}
export function checkImportFile(file) {
  if (file.size > IMPORT_FILE_BYTES)
    throw new Error('インポートファイルは25 MiB以下にしてください。');
}
export function checkImportCounts(library, savedSearches, incoming, usage) {
  if (!usage?.limits?.rows) return;
  const resources = [
    ['playlists', library.playlists, incoming.playlists, (x) => x.id],
    ['videos', library.videos, incoming.videos, (x) => x.id],
    [
      'entries',
      library.entries,
      incoming.entries,
      (x) => JSON.stringify([x.playlist_id, x.video_id]),
    ],
    ['user_meta', library.meta, incoming.meta, (x) => x.video_id],
    ['saved_searches', savedSearches, incoming.savedSearches, (x) => x.name],
  ];
  for (const [resource, existing = [], added = [], key] of resources) {
    const before = new Set(existing.map(key));
    const after = new Set([...before, ...added.map(key)]);
    const limit = usage.limits.rows[resource];
    if (after.size > limit && after.size > before.size) {
      throw new Error(
        `${RESOURCE_LABELS[resource]}は最大${Number(limit).toLocaleString()}件です。この取り込みでは${after.size.toLocaleString()}件になります。`,
      );
    }
  }
}
