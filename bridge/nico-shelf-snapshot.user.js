// ==UserScript==
// @name         NICO SHELF Snapshot Export (v0.5)
// @namespace    nico-shelf.example
// @version      0.5.0
// @description  ログイン中のニコニコから、指定マイリストの一覧だけをJSONに保存（書き込みなし・外部送信なし）
// @match        https://www.nicovideo.jp/*
// @grant        none
// @run-at       document-end
// ==/UserScript==
(() => {
  'use strict';
  const params=new URL(location.href).searchParams;
  if(params.get('nico_shelf_export')!=='1')return;
  const ids=params.getAll('nico_shelf_list');
  const names=params.getAll('nico_shelf_name');
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const allowed=/^[0-9]{1,16}$/;
  const vidOk=/^(sm|nm|so)[0-9]{1,12}$/;
  if(!ids.length || ids.length>25 || new Set(ids).size!==ids.length || ids.some(id=>!allowed.test(id)))return;

  const box=document.createElement('section');
  box.style.cssText='position:fixed;z-index:2147483646;right:18px;bottom:18px;width:min(405px,calc(100vw - 36px));box-sizing:border-box;background:#0f2035;color:#f0f8fb;border:1px solid #6cd8ca;border-radius:18px;box-shadow:0 15px 45px #0009;padding:20px;font:14px/1.6 system-ui,sans-serif';
  const title=document.createElement('strong');title.textContent='♫ NICO SHELF · 差分同期';title.style.cssText='display:block;color:#91e9dd;font-size:17px';
  const info=document.createElement('p');info.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0';
  info.textContent=`指定された ${ids.length} リストの動画IDと表示順を取得し、JSONファイルに保存します。\n\nニコニコへの書き込みは一切行いません。Cookieやログイン情報もファイルに含みません。

※現在ログイン中のニコニコアカウントが、同期したいアカウントか確認してください。`;
  const actions=document.createElement('div');actions.style.cssText='display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end';
  const small=document.createElement('small');small.textContent='非公式APIのため、ニコニコ側の仕様変更で取得できなくなる場合があります。';small.style.cssText='display:block;color:#a7bfcc;margin-top:12px';
  box.append(title,info,actions,small);document.body.append(box);
  function button(txt,fn,primary=false){const b=document.createElement('button');b.type='button';b.textContent=txt;b.style.cssText=`border-radius:8px;padding:8px 14px;border:1px solid #5a8797;background:${primary?'#82e1d3':'#1b3249'};color:${primary?'#0c2636':'#fff'};cursor:pointer;font-weight:700`;b.addEventListener('click',fn);actions.append(b);return b;}
  button('閉じる',()=>box.remove());
  const start=button('一覧を取得する',downloadSnapshot,true);

  async function getList(id){
    const out=[];const seen=new Set();
    for(let page=1;page<=25;page++){
      const u=`https://nvapi.nicovideo.jp/v1/users/me/mylists/${id}?page=${page}&pageSize=100`;
      const res=await fetch(u,{credentials:'include',cache:'no-store',headers:{'X-Frontend-Id':'6','X-Frontend-Version':'0','X-Request-With':'https://www.nicovideo.jp'}});
      if(!res.ok)throw new Error(`${id}: APIがHTTP ${res.status}を返しました（ログイン状態やAPI変更を確認）`);
      const json=await res.json();
      const ml=json?.data?.mylist;
      if(!ml||!Array.isArray(ml.items))throw new Error(`${id}: 応答形式を認識できません（取得結果は破棄しました）`);
      const pageItems=ml.items;
      for(const item of pageItems){
        const raw=item.watchId||item.videoId||item.video?.id||item.essential?.id||item.id;
        const video_id=String(raw||'');
        if(!vidOk.test(video_id)||seen.has(video_id))throw new Error(`${id}: 不正・重複した動画IDを検出。安全のため中止しました (${video_id})`);
        seen.add(video_id);
        const title=String(item.video?.title||item.essential?.title||item.title||'').slice(0,220);
        out.push({video_id,title});
      }
      info.textContent=`取得中… ${id}: ${out.length}件（${page}ページ）`;
      if(ml.hasNext===false || (ml.hasNext==null && pageItems.length<100))return out;
      if(ml.hasNext!==true && pageItems.length===0)return out;
      if(ml.hasNext===true && pageItems.length===0)throw new Error(`${id}: ページング情報が矛盾しています`);
      await sleep(240);
    }
    throw new Error(`${id}: 最終ページを確認できませんでした（上限25ページ）`);
  }

  async function downloadSnapshot(){
    start.disabled=true;start.style.opacity='.5';
    const lists=[];
    try{
      for(let i=0;i<ids.length;i++){
        info.textContent=`マイリストを取得中… ${i+1}/${ids.length}\n${names[i]||ids[i]}`;
        const items=await getList(ids[i]);
        lists.push({id:ids[i],name:(names[i]||ids[i]).slice(0,100),complete:true,items});
        await sleep(240);
      }
      const result={format:'nico-shelf-nico-snapshot',version:1,captured_at:new Date().toISOString(),complete:true,lists};
      const blob=new Blob([JSON.stringify(result,null,2)],{type:'application/json'});
      const link=document.createElement('a');const href=URL.createObjectURL(blob);
      link.href=href;link.download=`nico-shelf-snapshot-${new Date().toISOString().slice(0,10)}.json`;
      document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(href),15000);
      info.textContent=`取得完了！ ${lists.reduce((n,l)=>n+l.items.length,0)}件 / ${lists.length}リスト\n\n保存したJSONをNICO SHELFの「ニコニコとの差分同期」画面で選んでください。勝手にはDBを書き換えません。`;
    }catch(err){
      info.textContent=`取得できませんでした：${err.message}\n\n途中までのデータは保存していません。ニコニコでログインしているか確認し、再試行してください。`;
    }finally{start.disabled=false;start.style.opacity='1';}
  }
})();
