/**
 * One-way NicoNico snapshot comparison. No secrets, cookies or tokens in snapshots.
 * The snapshot is downloaded from the user's logged-in nicovideo tab.
 * Data is only written after explicit preview and confirmation.
 */
import {videoId} from './lib.js';

const ID_RE=/^[0-9]{1,16}$/;
const FORMAT='nico-shelf-nico-snapshot';

export function normalizeSnapshot(payload) {
  if (!payload || payload.format !== FORMAT || payload.version !== 1 || payload.complete !== true || !Array.isArray(payload.lists)) {
    throw new Error('同期用の完全なスナップショットではありません。ニコニコ側から改めて取得してください。');
  }
  if (payload.lists.length < 1 || payload.lists.length > 25) throw new Error('マイリスト数が不正です');
  const time=Date.parse(payload.captured_at);
  if (!Number.isFinite(time) || time>Date.now()+10*60*1000) throw new Error('取得時刻が不正です');
  const ids=new Set();
  const lists=payload.lists.map(list=>{
    const id=String(list?.id||'');
    if(!ID_RE.test(id)||ids.has(id)||list.complete!==true||!Array.isArray(list.items)||list.items.length>1000) throw new Error(`マイリスト ${id} の取得データが不完全です`);
    ids.add(id);
    const seen=new Set();
    const items=list.items.map((item,index)=>{
      const vid=videoId(item?.video_id);
      if(!vid||vid!==item.video_id||seen.has(vid))throw new Error(`${id}: 動画IDが不正または重複しています（${index+1}件目）`);
      seen.add(vid);
      return {video_id:vid,position:index+1,title:typeof item.title==='string'?item.title.slice(0,220):''};
    });
    return {id,name:String(list.name||id).slice(0,100),complete:true,items};
  });
  return {format:FORMAT,version:1,captured_at:new Date(time).toISOString(),complete:true,lists};
}

export function diffSnapshot(snapshot, library) {
  const normalized=normalizeSnapshot(snapshot);
  const localLists=new Map(library.playlists.map(l=>[l.id,l]));
  const videos=new Map(library.videos.map(v=>[v.id,v]));
  const rows=[];
  for(const remote of normalized.lists){
    const localList=localLists.get(remote.id);
    if(!localList)throw new Error(`「${remote.name}」（${remote.id}）がNICO SHELFに存在しません。先に同じマイリストをインポートしてください。`);
    const current=library.entries.filter(e=>e.playlist_id===remote.id&&e.present!==false);
    const currentById=new Map(current.map(e=>[e.video_id,e]));
    const oldAllById=new Map(library.entries.filter(e=>e.playlist_id===remote.id).map(e=>[e.video_id,e]));
    const remoteById=new Map(remote.items.map(e=>[e.video_id,e]));
    const added=remote.items.filter(e=>!currentById.has(e.video_id)).map(e=>({
      ...e,kind:oldAllById.has(e.video_id)?'restored':'added',title:videos.get(e.video_id)?.title||e.title||e.video_id
    }));
    const removed=current.filter(e=>!remoteById.has(e.video_id)).map(e=>({...e,title:videos.get(e.video_id)?.title||e.video_id}));
    const reordered=remote.items.filter(e=>currentById.has(e.video_id)&&Number(currentById.get(e.video_id).position)!==e.position);
    rows.push({id:remote.id,name:localList.name,remoteName:remote.name,localCount:current.length,remoteCount:remote.items.length,added,removed,reordered});
  }
  return {snapshot:normalized,rows,added:rows.reduce((n,r)=>n+r.added.length,0),removed:rows.reduce((n,r)=>n+r.removed.length,0),reordered:rows.reduce((n,r)=>n+r.reordered.length,0)};
}

export function toRpcPayload(snapshot) {
  const value=normalizeSnapshot(snapshot);
  return {lists:value.lists.map(({id,items})=>({id,items:items.map(({video_id,position,title})=>({video_id,position,title}))}))};
}

export function snapshotUrl(library) {
  const lists=library.playlists.filter(p=>ID_RE.test(String(p.id)));
  if(!lists.length)throw new Error('ニコニコ側のマイリストIDがありません。');
  const url=new URL('https://www.nicovideo.jp/');
  url.searchParams.set('nico_shelf_export','1');
  for(const p of lists){url.searchParams.append('nico_shelf_list',p.id);url.searchParams.append('nico_shelf_name',p.name);}
  return url.toString();
}

/** Build one complete snapshot from the per-playlist replies sent by the connected Nico tab.
 * Throws unless every requested list returned once and all items are well formed.
 */
export function snapshotFromBridgeParts(requestedLists, replies, capturedAt=new Date().toISOString()) {
  if(!Array.isArray(requestedLists)||!requestedLists.length||requestedLists.length>25||!Array.isArray(replies)||replies.length!==requestedLists.length){
    throw new Error('すべてのマイリストを取得できませんでした。DBは変更していません。');
  }
  const expected=new Set();
  const lists=[];
  for(let i=0;i<requestedLists.length;i++){
    const id=String(requestedLists[i]?.id||'');
    const item=replies[i];
    if(!ID_RE.test(id)||expected.has(id)||String(item?.id)!==id||item?.complete!==true||!Array.isArray(item?.items)){
      throw new Error('取得したリストが一致しません。差分は反映できません。');
    }
    expected.add(id);
    lists.push({id,name:String(requestedLists[i].name||id).slice(0,100),complete:true,items:item.items});
  }
  return normalizeSnapshot({format:FORMAT,version:1,captured_at:capturedAt,complete:true,lists});
}

/** Stable, content-based identity of the preview; totals alone can conceal changes. */
export function diffSignature(diff) {
  return JSON.stringify(diff.rows.map(row=>({
    id:row.id,
    added:row.added.map(item=>`${item.video_id}:${item.position}`).sort(),
    removed:row.removed.map(item=>item.video_id).sort(),
    reordered:row.reordered.map(item=>`${item.video_id}:${item.position}`).sort(),
    remoteCount:row.remoteCount
  })));
}
