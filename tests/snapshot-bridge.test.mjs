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
 return {bridge,stop:()=>{bridge.disconnect();for(const timer of timers)clearInterval(timer)}};
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
