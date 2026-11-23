/** Missing names in legacy replies must never replace the stored name with an ID. */
export function sourcePlaylistName(value) {
  if (value === undefined) return {};
  if (typeof value !== 'string' || !value.trim() || [...value].length > 200)
    throw new Error('マイリスト名が不正です');
  return { name: value };
}
