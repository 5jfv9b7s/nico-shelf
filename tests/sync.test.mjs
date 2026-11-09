import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSnapshot,diffSnapshot,toRpcPayload,snapshotUrl} from '../src/sync.js';
const snapshot=(lists)=>({format:'nico-shelf-nico-snapshot',version:1,captured_at:new Date().toISOString(),complete:true,lists:lists.map(l=>({...l,complete:true}))});
const library={playlists:[{id:'101',name:'ぼかうた3'},{id:'102',name:'最近のお気に入り'}],videos:[{id:'sm10',title:'A'},{id:'sm20',title:'B'}],entries:[{playlist_id:'101',video_id:'sm10',position:1,present:true},{playlist_id:'101',video_id:'sm20',position:2,present:true},{playlist_id:'102',video_id:'sm10',position:1,present:true}]};
test('1件ズレがあるリストの余分な登録を特定し、未選択リストは触らない',()=>{
 const data=snapshot([{id:'101',name:'ぼかうた3',items:[{video_id:'sm10'}]}]);
 const result=diffSnapshot(data,library);
 assert.equal(result.removed,1);assert.equal(result.added,0);
 assert.equal(result.rows[0].removed[0].video_id,'sm20');
 assert.equal(toRpcPayload(data).lists.length,1);
});
test('削除済みからの復活も追加候補にする',()=>{
 const copy={...library,entries:[...library.entries,{playlist_id:'101',video_id:'sm30',position:3,present:false}]};
 const result=diffSnapshot(snapshot([{id:'101',items:[{video_id:'sm10'},{video_id:'sm20'},{video_id:'sm30'}]}]),copy);
 assert.equal(result.added,1);assert.equal(result.rows[0].added[0].kind,'restored');
});
test('同件数でも入れ替わりを見つける',()=>{
 const result=diffSnapshot(snapshot([{id:'101',items:[{video_id:'sm10'},{video_id:'sm30'}]}]),library);
 assert.equal(result.added,1);assert.equal(result.removed,1);
});
test('不完全な取得結果や重複IDは同期させない',()=>{
 assert.throws(()=>normalizeSnapshot({format:'nico-shelf-nico-snapshot',version:1,complete:false,lists:[]}));
 assert.throws(()=>normalizeSnapshot(snapshot([{id:'101',items:[{video_id:'sm10'},{video_id:'sm10'}]}])));
 assert.throws(()=>diffSnapshot(snapshot([{id:'999',items:[]}]),library));
});
test('取得用リンクには数値マイリストのみ入り、既存アプリのリストは除外',()=>{
 const url=new URL(snapshotUrl({...library,playlists:[...library.playlists,{id:'local-xyz',name:'ローカル'}]}));
 assert.equal(url.hostname,'www.nicovideo.jp');
 assert.deepEqual(url.searchParams.getAll('nico_shelf_list'),['101','102']);
});
