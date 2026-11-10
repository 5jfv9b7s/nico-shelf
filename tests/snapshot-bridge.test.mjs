import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {webcrypto} from 'node:crypto';
import {snapshotFromBridgeParts,diffSnapshot} from '../src/sync.js';

const script=fs.readFileSync(new URL('../bridge/nico-shelf-direct.user.js',import.meta.url),'utf8');
const bridgeSrc=fs.readFileSync(new URL('../src/bridge.js',import.meta.url),'utf8').replace('export class NicoTabBridge','globalThis.NicoTabBridge = class NicoTabBridge');
const sourceLists={
 '100':Array.from({length:500},(_,i)=>({watchId:`sm${1000+i}`,video:{title:`楽曲${i}`}})),
 '200':Array.from({length:125},(_,i)=>({watchId:`nm${2000+i}`,video:{title:`新作${i}`}}))
};
function el(){return {style:{},buttons:[],children:[],listeners:{},append(...xs){this.children.push(...xs)},appendChild(x){this.children.push(x)},replaceChildren(...xs){this.children=xs},remove(){},addEventListener(t,fn){this.listeners[t]=fn},click(){this.listeners.click?.()}}}
async function createSession(){
 const instances=[],timers=[],store=new Map();
 let nicoSession;
 function makeContext(origin,href){
   const listeners=new Map(),domListeners=new Map(),attrs=new Map(),buttons=[],gm=new Map();
   const window={};
   const document={body:el(),documentElement:{setAttribute:(k,v)=>attrs.set(k,v),getAttribute:k=>attrs.get(k)},createElement:()=>{const e=el();buttons.push(e);return e;}};
   document.addEventListener=(t,fn)=>{if(!domListeners.has(t))domListeners.set(t,[]);domListeners.get(t).push(fn)};
   document.dispatchEvent=e=>{for(const fn of domListeners.get(e.type)||[])fn(e)};
   class CustomEvent {constructor(type,opts){this.type=type;this.detail=opts.detail;}}
   const context={window,document,location:{origin,href},URL,URLSearchParams,Date,Math,Number,Promise,Set,Map,JSON,String,Array,Object,RegExp,crypto:webcrypto,console,CustomEvent,setTimeout,clearTimeout,clearInterval,setInterval:(fn,n)=>{const i=setInterval(fn,n);timers.push(i);return i;}};
   window.addEventListener=(t,fn)=>{if(!listeners.has(t))listeners.set(t,[]);listeners.get(t).push(fn)};
   window.postMessage=(data,target)=>{assert.equal(target,origin);queueMicrotask(()=>{for(const fn of listeners.get('message')||[])fn({source:window,origin,data})})};
   let nextId=0;
   context.GM_getValue=(key,fallback)=>store.has(key)?store.get(key):fallback;
   context.GM_addValueChangeListener=(key,fn)=>{const id=++nextId;const all=gm.get(key)||new Map();all.set(id,fn);gm.set(key,all);return id};
   context.GM_removeValueChangeListener=id=>{for(const all of gm.values())all.delete(id)};
   const item={context,buttons,gm};
   context.GM_setValue=(key,value)=>{const old=store.get(key);store.set(key,value);for(const dest of instances){for(const fn of dest.gm.get(key)?.values()||[])queueMicrotask(()=>fn(key,old,value,dest!==item));}};
   context.globalThis=context;
   instances.push(item);
   return item;
 }
 const app=makeContext('https://nico-shelf.shiokara-lab.workers.dev','https://nico-shelf.shiokara-lab.workers.dev/');
 app.context.window.open=url=>{
   const nico=makeContext('https://www.nicovideo.jp',url);
   nicoSession=nico;
   nico.context.fetch=async resource=>{
     const parsed=new URL(resource);
     const id=parsed.pathname.match(/mylists\/(\d+)/)?.[1];
     if(!sourceLists[id])return {ok:false,status:404};
     const page=Number(parsed.searchParams.get('page'));
     const source=sourceLists[id];const items=source.slice((page-1)*100,page*100);
     return {ok:true,json:async()=>({data:{mylist:{items,hasNext:page*100<source.length,totalItemCount:source.length}}})};
   };
   vm.runInNewContext(script,nico.context);
   setTimeout(()=>nico.buttons.find(x=>x.textContent==='接続を許可')?.click(),20);
   return {closed:false};
 };
 vm.runInNewContext(script,app.context);
 vm.runInNewContext(bridgeSrc,app.context);
 const bridge=vm.runInNewContext('new NicoTabBridge()',app.context);
 await bridge.connect();
 return {bridge,nico:nicoSession,store,stop:()=>{bridge.disconnect();for(const timer of timers)clearInterval(timer)}};
}

test('500件＋125件を既存の登録用タブから取得、全件差分プレビューを作れる',async()=>{
 const session=await createSession();
 try{
   const requested=[{id:'100',name:'ぼかうた1'},{id:'200',name:'ぼかうた3'}];
   const result=[];
   for(const x of requested)result.push(await session.bridge.request('snapshot-list',x,15000));
   const snapshot=snapshotFromBridgeParts(requested,result);
   assert.equal(snapshot.lists[0].items.length,500);
   assert.equal(snapshot.lists[1].items.length,125);
   assert.equal(snapshot.lists[0].items[0].video_id,'sm1000');
   assert.equal(snapshot.lists[0].items[499].position,500);
   assert.equal(snapshot.lists[1].items[124].video_id,'nm2124');
   const diff=diffSnapshot(snapshot,{playlists:requested,videos:[],entries:[]});
   assert.equal(diff.added,625);
   assert.equal(diff.removed,0);
   // Reading a snapshot does not touch the NicoNico POST endpoint.
 }finally{session.stop()}
});

test('リストAPIでエラーが返ったら成功扱いせずに処理を止める',async()=>{
 const session=await createSession();
 try{
   await assert.rejects(()=>session.bridge.request('snapshot-list',{id:'999',name:'存在しない'},5000),/HTTP 404/);
 }finally{session.stop()}
});

// XML fixture uses the same fields as the NicoNico getthumbinfo schema.
const xmlFixture=`<nicovideo_thumb_response status="ok"><thumb><video_id>sm9</video_id>
<title>テスト &amp; 楽曲</title><description>ニコニコの楽曲</description>
<thumbnail_url>https://nicovideo.cdn.nimg.jp/thumbnails/9/9</thumbnail_url>
<first_retrieve>2026-11-01T10:30:00+09:00</first_retrieve>
<length>2:35</length><view_counter>120</view_counter><comment_num>5</comment_num>
<mylist_counter>8</mylist_counter><genre>音楽・サウンド</genre>
<user_id>222</user_id><user_nickname>投稿者A</user_nickname>
<tags domain="jp"><tag>音街ウナ Spicy</tag><tag>ボカロック</tag></tags>
</thumb></nicovideo_thumb_response>`;
function lightweightDomParser(xml){
  const entity=s=>s.replace(/&amp;/g,'&');
  const element=content=>({textContent:entity(content),querySelector:tag=>{
    const m=content.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`));
    return m?element(m[1]):null;
  },querySelectorAll:selector=>selector==='tags tag'?[...content.matchAll(/<tag(?:\s[^>]*)?>([\s\S]*?)<\/tag>/g)].map(m=>element(m[1])):[],getAttribute:name=>name==='status'?'ok':null});
  return {querySelector:tag=>{
    const m=xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`));
    return m?element(m[1]):tag==='nicovideo_thumb_response'?element(xml):null;
  }};
}
test('ブリッジのmetadataアクションがタグ、サムネ、動画時間を取得し、秘密情報を送らない',async()=>{
  const session=await createSession();
  try{
    let requested;
    session.nico.context.DOMParser=class {parseFromString(xml){return lightweightDomParser(xml)}};
    session.nico.context.GM_xmlhttpRequest=opts=>{
      requested=opts;
      opts.onload({status:200,responseText:xmlFixture});
    };
    const result=await session.bridge.request('metadata',{videoId:'sm9'},4000);
    assert.equal(result.id,'sm9');
    assert.equal(result.title,'テスト & 楽曲');
    assert.equal(result.duration,155);
    assert.equal(result.views,120);
    assert.deepEqual(Array.from(result.tags),['音街ウナ Spicy','ボカロック']);
    assert.match(result.thumb,/nicovideo\.cdn\.nimg\.jp/);
    assert.equal(requested.anonymous,true);
    assert.equal(requested.url,'https://ext.nicovideo.jp/api/getthumbinfo/sm9');
  }finally{session.stop()}
});
test('動画情報APIが失敗した場合は登録や同期と混同せずエラーにする',async()=>{
  const session=await createSession();
  try{
    session.nico.context.GM_xmlhttpRequest=opts=>opts.onload({status:404,responseText:''});
    await assert.rejects(()=>session.bridge.request('metadata',{videoId:'sm9'},4000),/HTTP 404/);
  }finally{session.stop()}
});
