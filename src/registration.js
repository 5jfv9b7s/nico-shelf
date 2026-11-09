/** Pure registration rules. Only numbered 'ぼかうた' lists are auto-selected. */
export const NICO_LIST_ID = /^[0-9]{1,16}$/;
export const NICO_VIDEO_ID = /^(?:sm|nm|so)[0-9]{1,12}$/;
export const DEFAULT_CAPACITY = 500;

export function registrationLists(playlists) {
  const list = (playlists || []).filter(p => NICO_LIST_ID.test(String(p.id)));
  return [...list].sort((a,b) => {
    const am = /^ぼかうた([1-9][0-9]*)$/.exec(String(a.name).trim());
    const bm = /^ぼかうた([1-9][0-9]*)$/.exec(String(b.name).trim());
    if (am && bm) return Number(am[1]) - Number(bm[1]);
    if (am) return -1;
    if (bm) return 1;
    return String(a.name).localeCompare(String(b.name), 'ja');
  });
}

export function autoRegistrationTarget(remoteLists, videoId, capacity=DEFAULT_CAPACITY) {
  const candidates = registrationLists(remoteLists).filter(p => /^ぼかうた([1-9][0-9]*)$/.test(String(p.name).trim()));
  return candidates.find(p => p.count < capacity && !(p.hasVideoIds || []).includes(videoId)) || null;
}

export function registrationDecision(remoteLists, videoId, targetId, allowDuplicates=false, capacity=DEFAULT_CAPACITY) {
  if(!NICO_VIDEO_ID.test(videoId)) throw new Error('動画IDが正しくありません');
  const options = registrationLists(remoteLists);
  const existing = options.filter(p => (p.hasVideoIds || []).includes(videoId));
  const target = targetId === 'auto'
    ? autoRegistrationTarget(options,videoId,capacity)
    : options.find(p => String(p.id) === String(targetId));
  if(!target) throw new Error(targetId === 'auto'
    ? 'ぼかうた1から順に探しましたが、空いている登録先がありません。最近のお気に入りには自動登録しません。'
    : '指定のマイリストが見つかりません');
  if(existing.some(p => p.id === target.id)) throw new Error(`「${target.name}」にはすでに登録されています`);
  if(target.count >= capacity) throw new Error(`「${target.name}」は${capacity}件に達しています`);
  const other = existing.filter(p=>p.id!==target.id);
  if(other.length && !allowDuplicates) throw new Error(`すでに「${other.map(p=>p.name).join('・')}」に登録されています。重複を許可する必要があります`);
  return {target, existing};
}
