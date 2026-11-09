import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {webcrypto} from 'node:crypto';
const ROOT=new URL('../',import.meta.url).pathname;
const userScript=fs.readFileSync(ROOT+'bridge/nico-shelf-direct.user.js','utf8');
const bridgeScript=fs.readFileSync(ROOT+'src/bridge.js','utf8').replace('export class NicoTabBridge','globalThis.NicoTabBridge = class NicoTabBridge');
const delay=(ms)=>new Promise(r=>setTimeout(r,ms));

function element(tag){return {tag,style:{},children:[],listeners:new Map(),append(...els){this.children.push(...els)},appendChild(el){this.children.push(el)},replaceChildren(...els){this.children=els},remove(){this.removed=true},addEventListener(t,fn){this.listeners.set(t,fn)},click(){this.listeners.get('click')?.()}}}
async function runCase(notify=true){
 const store=new Map(),instances=[],timers=[];
 function create(origin,href){
   const listeners=new Map(),attrs=new Map(),buttons=[];const win={};
   const doc={documentElement:{getAttribute:(n)=>attrs.get(n),setAttribute:(n,v)=>attrs.set(n,v)},body:element('body'),createElement:(tag)=>{const o=element(tag);if(tag==='button')buttons.push(o);return o;}};
   const context={window:win,document:doc,location:{origin,href},URL,URLSearchParams,Date,Math,Number,Promise,Set,Map,String,RegExp,Object,Array,crypto:webcrypto,console,setTimeout,clearTimeout,setInterval:(fn,ms)=>{const t=setInterval(fn,ms);timers.push(t);return t;},clearInterval};
   win.addEventListener=(type,fn)=>{const l=listeners.get(type)||[];l.push(fn);listeners.set(type,l)};
   win.postMessage=(data,targetOrigin)=>{if(targetOrigin!==origin)throw Error('wrong origin');queueMicrotask(()=>{for(const f of listeners.get('message')||[])f({source:win,origin,data})})};
   let seq=0;const gmListeners=new Map();
   context.GM_addValueChangeListener=(key,fn)=>{const list=gmListeners.get(key)||new Map();const id=++seq;list.set(id,fn);gmListeners.set(key,list);return id};
   context.GM_removeValueChangeListener=id=>{for(const list of gmListeners.values())list.delete(id)};
   context.GM_getValue=(key,d)=>store.has(key)?store.get(key):d;
   context.GM_setValue=(key,val)=>{
      const old=store.get(key);store.set(key,val);
      for(const ins of instances){
         if(ins===obj||notify){for(const cb of ins.gmListeners.get(key)?.values()||[])queueMicrotask(()=>cb(key,old,val,ins!==obj));}
      }
   };
   context.globalThis=context;
   const obj={context,buttons,gmListeners};instances.push(obj);
   return obj;
 }
 const shelf=create('https://nico-shelf.shiokara-lab.workers.dev','https://nico-shelf.shiokara-lab.workers.dev/');
 let nico;
 shelf.context.window.open=url=>{
    nico=create('https://www.nicovideo.jp',url);
    vm.runInNewContext(userScript,nico.context);
    setTimeout(()=>nico.buttons.find(x=>x.textContent==='接続を許可')?.click(),40);
    return {};
 };
 vm.runInNewContext(userScript,shelf.context);
 vm.runInNewContext(bridgeScript,shelf.context);
 const bridge=vm.runInNewContext('new NicoTabBridge()',shelf.context);
 const result=Promise.race([bridge.connect().then(()=> 'connected'),delay(4000).then(()=> 'timeout')]);
 assert.equal(await result,'connected');
 assert.equal(bridge.connected,true);
 bridge.disconnect();for(const id of timers)clearInterval(id);
 return notify?'listener':'poll-fallback';
}
test('NICO SHELF接続: 通常のタブ間通知が届く', async()=>{assert.equal(await runCase(true),'listener')});
test('NICO SHELF接続: 通知が届かない場合も保存領域から復旧', async()=>{assert.equal(await runCase(false),'poll-fallback')});
