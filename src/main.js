import './style.css';
import {client,configured,loadLibrary,importRows} from './supabase.js';
import {esc,videoId,array,formatCount,formatDate,formatDuration,membershipMap,sortRows,singerStats,autoPlaylist,normalizeImport,csvToImport} from './lib.js';
import {diffSnapshot,normalizeSnapshot,toRpcPayload,snapshotUrl} from './sync.js';
import {NicoTabBridge} from './bridge.js';
import {registrationLists,registrationDecision} from './registration.js';

const root=document.querySelector('#app');
const nicoBridge=new NicoTabBridge();
const state={user:null,library:{playlists:[],videos:[],entries:[],meta:[]},view:'dashboard',filters:{q:'',playlist:'',sort:'views',order:'desc'},page:1,dialog:null,preview:null,sync:null,busy:false,error:'',toastTimer:null};
const VIEWS={dashboard:'ダッシュボード',library:'ライブラリ',duplicates:'重複した動画',favorites:'お気に入り',settings:'データと設定'};
const SORTS={views:'再生数',published_at:'投稿日',duration:'動画時間',comments:'コメント数',mylists:'マイリスト数',title:'タイトル',registration:'リスト内順番'};
const icon={dashboard:'▦',library:'≡',duplicates:'◈',favorites:'♡',settings:'⚙'};

function toast(message,isError=false){
  let el=document.querySelector('#toast');if(!el){el=document.createElement('div');el.id='toast';document.body.append(el);}
  el.textContent=message;el.className=`toast show ${isError?'danger':''}`;
  clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>el.classList.remove('show'),4200);
}
function makeRows(){
  const m=membershipMap(state.library.entries,state.library.playlists);
  const meta=new Map(state.library.meta.map(x=>[x.video_id,x]));
  return state.library.videos.map(v=>({...v,memberships:m.get(v.id)||[],userMeta:meta.get(v.id)||null}));
}
function navItem(id,label,ico,active){return `<button class="nav-item ${active?'is-active':''}" data-view="${esc(id)}"><span class="nav-icon">${ico}</span><span>${esc(label)}</span></button>`;}
function counts(){const e=state.library.entries.filter(x=>x.present!==false),unique=e.length?new Set(e.map(x=>x.video_id)).size:0;return {videos:state.library.videos.length,entries:e.length,duplicates:[...new Set(e.map(x=>x.video_id))].filter(id=>e.filter(x=>x.video_id===id).length>1).length,tracked:unique};}
function shell(){
  const p=state.library.playlists,all=state.library.entries.filter(e=>e.present!==false);
  return `<div class="shell">
    <aside class="sidebar">
      <button class="brand" data-view="dashboard" aria-label="トップへ"><span class="brand-mark">♫</span><span><b>NICO SHELF</b><small>YOUR MUSIC ARCHIVE</small></span></button>
      <div class="menu-label">DISCOVER</div>
      <nav>${['dashboard','library','duplicates','favorites'].map(x=>navItem(x,VIEWS[x],icon[x],state.view===x)).join('')}</nav>
      <div class="menu-label playlist-head">MY LISTS <span>${p.length}</span></div>
      <nav class="playlist-menu">${p.map(x=>`<button class="nav-item ${state.view===`playlist:${x.id}`?'is-active':''}" data-view="playlist:${esc(x.id)}"><span class="playlist-dot"></span><span class="text-ellipsis">${esc(x.name)}</span><small>${all.filter(e=>e.playlist_id===x.id).length}</small></button>`).join('')||'<p class="nav-help">インポートすると表示されます</p>'}</nav>
      <div class="sidebar-foot"><button class="nav-item ${state.view==='settings'?'is-active':''}" data-view="settings"><span class="nav-icon">⚙</span>データと設定</button><div class="small-note">NICO SHELF <b>v0.6 β</b><br>クラウド管理・非公式アプリ</div></div>
    </aside>
    <div class="workspace">
      <header class="topbar"><div class="mobile-logo">♫ <b>NICO SHELF</b></div><div class="top-center"><span class="online-indicator"></span>プライベートライブラリ</div>
        <div class="top-actions"><span class="account-avatar">${esc((state.user.user_metadata?.name||state.user.email||'U').charAt(0).toUpperCase())}</span><span class="account-name">${esc(state.user.user_metadata?.name||state.user.email||'ユーザー')}</span><button class="btn-ghost small" id="logout">ログアウト</button></div></header>
      <main id="main-content" class="main-content">${content()}</main>
      <footer class="footer"><span>NICO SHELF · MY MUSIC ARCHIVE</span><span>ニコニコ動画の公式サービスではありません</span></footer>
    </div>
    ${state.dialog?modal():''}
  </div>`;
}
function hero(kicker,title,desc,action=''){return `<div class="heading"><div><div class="eyebrow">${esc(kicker)}</div><h1>${esc(title)}</h1><p>${esc(desc)}</p></div>${action}</div>`;}
function statsCards(){const c=counts();return `<div class="stat-grid">
  ${[[c.videos,'VIDEO LIBRARY','保存済み動画'],[c.entries,'PLAYLIST ENTRIES','登録件数'],[c.duplicates,'DUPLICATED','複数リストに所属'],[state.library.playlists.length,'MYLISTS','管理中のリスト']].map(([n,label,sub],i)=>`<div class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-symbol">${['◈','≡','◎','♫'][i]}</span></div><strong>${formatCount(n)}</strong><small>${sub}</small></div>`).join('')}
  </div>`;}
function barList(data,noun='曲'){
  const max=Math.max(1,...data.map(x=>x[1]));
  return data.length?data.map(([name,num],i)=>`<div class="bar-row"><span class="bar-index">${String(i+1).padStart(2,'0')}</span><span class="bar-name" title="${esc(name)}">${esc(name)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.min(100,100*num/max)}%"></div></div><span class="bar-num">${num}${noun}</span></div>`).join(''):'<div class="empty-sm">まだ集計できる情報がありません</div>';
}
function playlistVoiceMatrix(rows,playlists){
  if(!playlists.length||!rows.length)return '';
  const ordered=[...playlists].sort((a,b)=>{
    const am=a.name.match(/(\d+)$/),bm=b.name.match(/(\d+)$/);
    if(am&&bm)return Number(am[1])-Number(bm[1]);
    if(am)return -1;if(bm)return 1;
    return a.name.localeCompare(b.name,'ja');
  });
  const voices=singerStats(rows,6).map(([name])=>name);
  const totals=ordered.map(p=>rows.filter(v=>v.memberships.some(m=>m.id===p.id)).length);
  return `<section class="panel"><div class="panel-title"><div><span class="section-eyebrow">VOICE BY PLAYLIST</span><h2>マイリスト別・歌唱者の傾向</h2></div><span class="panel-note">収録割合（重複歌唱あり）</span></div>
    <div class="matrix-wrap"><table class="voice-matrix"><thead><tr><th>歌唱者</th>${ordered.map((p,i)=>`<th>${esc(p.name)}<small>${totals[i]}件</small></th>`).join('')}</tr></thead>
    <tbody>${voices.map(name=>`<tr><th>${esc(name)}</th>${ordered.map((p,i)=>{
      const n=rows.filter(v=>v.memberships.some(m=>m.id===p.id)&&array(v.voices).includes(name)).length;
      const pct=totals[i]?Math.round(1000*n/totals[i])/10:0;
      return `<td><span class="matrix-bar" style="width:${Math.min(100,pct)}%"></span><span class="matrix-value">${pct}% <small>(${n})</small></span></td>`;
    }).join('')}</tr>`).join('')}</tbody></table></div>
    <div class="panel-footnote">歌唱者はインポートデータの表記に基づく分類です。同じキャラクターでも別表記の場合があります。</div>
  </section>`;
}
function dashboard(rows){
  const creators=new Map();for(const r of rows)for(const x of new Set(array(r.producers).filter(Boolean)))creators.set(x,(creators.get(x)||0)+1);
  const topCreators=[...creators].sort((a,b)=>b[1]-a[1]).slice(0,7);
  const c=counts();const p=state.library.playlists;
  return `${hero('OVERVIEW','あなたの音楽の棚','好きな曲を、探して、整理して、もっと知る。',`<div class="inline-actions"><button class="btn primary" data-action="add">＋ 動画を登録</button><button class="btn subtle" data-action="sync">↻ ニコニコとの差分同期</button><button class="btn subtle" data-action="import">⇩ インポート</button></div>`)}
    ${statsCards()}
    ${c.videos===0?`<div class="welcome-banner"><div class="welcome-icon">♫</div><div><h2>最初のライブラリを作りましょう</h2><p>v0.3のJSONバックアップ、またはCSVから取り込めます。あなたのデータはGoogleアカウントごとに分離して保存されます。</p><div class="inline-actions"><button class="btn primary" data-action="import">インポートする</button><button class="btn subtle" data-action="playlist">空のリストを作る</button></div></div></div>`:''}
    <div class="two-cols">
      <section class="panel"><div class="panel-title"><div><span class="section-eyebrow">VOICE RANKING</span><h2>歌唱者ランキング</h2></div><span class="panel-note">収録動画数</span></div>${barList(singerStats(rows,8))}</section>
      <section class="panel"><div class="panel-title"><div><span class="section-eyebrow">MY PLAYLISTS</span><h2>マイリスト別の登録件数</h2></div><span class="panel-note">${p.length} lists</span></div>${barList(p.map(x=>[x.name,state.library.entries.filter(e=>e.playlist_id===x.id&&e.present!==false).length]),'件')}<div class="panel-bottom"><button class="text-btn" data-action="playlist">＋ マイリストを作成</button></div></section>
    </div>
    ${playlistVoiceMatrix(rows,p)}
    <section class="panel"><div class="panel-title"><div><span class="section-eyebrow">RECENTLY PUBLISHED</span><h2>ライブラリ内の新着投稿</h2></div><button class="text-btn" data-view="library">すべて見る →</button></div>${cards(sortRows(rows,'published_at','desc').slice(0,5))}</section>`;
}
function safeThumb(v){
  try {const u=new URL(v||'');return u.protocol==='https:'&&(u.hostname==='nicovideo.jp'||u.hostname.endsWith('.nicovideo.jp')||u.hostname==='nimg.jp'||u.hostname.endsWith('.nimg.jp'))?u.href:'';} catch{return '';}
}
function cards(rows){
  return `<div class="video-list">${rows.map(v=>{
    const thumb=safeThumb(v.thumb);const dup=v.memberships.length>1;
    return `<article class="video-card"><div class="cover">${thumb?`<img src="${esc(thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'" />`:'<span class="cover-fallback">♫</span>'}<span class="duration">${formatDuration(v.duration)}</span></div>
      <div class="video-info"><div class="video-title-row"><a class="video-title" href="https://www.nicovideo.jp/watch/${encodeURIComponent(v.id)}" target="_blank" rel="noopener noreferrer" title="ニコニコで動画を開く">${esc(v.title||v.id)} <span class="external-arrow">↗</span></a>${dup?'<span class="dup-badge">重複</span>':''}</div>
      <div class="video-sub"><span>${esc(v.uploader||'投稿者不明')}</span><span class="sub-divider">·</span><span>${esc(v.id)}</span><span class="sub-divider">·</span><span>${formatDate(v.published_at)}</span></div>
      <div class="video-tags">${v.memberships.map(m=>`<span class="list-chip" title="取得時のリスト内順番: ${Number.isFinite(Number(m.position))?m.position:'不明'}">${esc(m.name)}</span>`).join('')||'<span class="empty-chip">未分類</span>'}<span class="voice-clip">${esc(array(v.voices).slice(0,2).join(' / '))}</span></div></div>
      <div class="video-stat"><span>▶ ${formatCount(v.views)}</span><span>♡ ${formatCount(v.likes)}</span></div>
      <div class="video-buttons"><button class="heart-btn ${v.userMeta?.favorite?'hearted':''}" title="お気に入り" data-favorite="${esc(v.id)}">${v.userMeta?.favorite?'♥':'♡'}</button><button class="more-btn" title="メモと評価" data-detail="${esc(v.id)}">···</button></div></article>`;
  }).join('')}</div>`;
}
function listing(rows){
  const inPlaylist=state.view.startsWith('playlist:');const forced=inPlaylist?state.view.slice(9):'';
  const playlist=forced||state.filters.playlist;
  const duplicate=state.view==='duplicates',favorite=state.view==='favorites';const query=state.filters.q.toLocaleLowerCase().trim();
  const show=rows.filter(v=>{
    if(playlist&&!v.memberships.some(m=>m.id===playlist))return false;
    if(duplicate&&v.memberships.length<2)return false;
    if(favorite&&!v.userMeta?.favorite)return false;
    if(!query)return true;
    return [v.title,v.id,v.description,v.uploader,...array(v.voices),...array(v.producers),...array(v.tags),v.userMeta?.memo,v.userMeta?.personal_tags].join(' ').toLocaleLowerCase().includes(query);
  });
  const sorted=sortRows(show,state.filters.sort,state.filters.order,playlist);
  const totalPages=Math.max(1,Math.ceil(sorted.length/35));state.page=Math.min(state.page,totalPages);
  const pageRows=sorted.slice((state.page-1)*35,state.page*35);
  const heading=inPlaylist?(state.library.playlists.find(x=>x.id===forced)?.name||'マイリスト'):duplicate?'重複した動画':favorite?'お気に入り':'すべての動画';
  const help=inPlaylist?'このマイリストに登録されている動画':duplicate?'2つ以上のマイリストに所属している動画':favorite?'自分でお気に入りにした動画':'あなたのライブラリ全体を検索・並び替え';
  return `${hero('LIBRARY',heading,help,`<button class="btn primary" data-action="add">＋ 動画を登録</button>`)}
  <div class="toolbar"><label class="search-field"><span>⌕</span><input id="search" type="search" placeholder="曲名・動画ID・歌唱者・タグ・メモを検索" value="${esc(state.filters.q)}" autocomplete="off" /></label>
    ${!inPlaylist?`<label class="control-label">マイリスト<select id="list-filter"><option value="">すべて</option>${state.library.playlists.map(p=>`<option value="${esc(p.id)}" ${playlist===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>`:''}
    <label class="control-label">並び替え<select id="sort-field">${Object.entries(SORTS).map(([key,val])=>`<option value="${key}" ${state.filters.sort===key?'selected':''}>${esc(val)}</option>`).join('')}</select></label>
    <button class="btn btn-sort" id="sort-dir" title="昇順/降順を切替">${state.filters.order==='desc'?'↓':'↑'}</button>
    <button class="btn subtle" id="sort-reset" title="ソートだけ初期化、絞り込みは維持">↺ リセット</button>
  </div>
  ${state.filters.sort==='registration'?`<div class="inline-hint">登録順はインポート時の一覧表示順です。正確な登録日時とは限りません。${!playlist?'マイリストを選ぶと順番を比較できます。':''}</div>`:''}
  <div class="result-heading"><span><b>${formatCount(sorted.length)}</b> 件の動画</span><span>ソート：${esc(SORTS[state.filters.sort])} ${state.filters.order==='desc'?'降順':'昇順'}</span></div>
  ${pageRows.length?cards(pageRows):`<div class="empty-panel"><span>♫</span><h2>動画が見つかりません</h2><p>絞り込み条件を変えるか、データをインポートしてください。</p></div>`}
  ${totalPages>1?`<nav class="pagination"><button class="btn subtle" data-page="${state.page-1}" ${state.page===1?'disabled':''}>← 前へ</button><span>${state.page} / ${totalPages}</span><button class="btn subtle" data-page="${state.page+1}" ${state.page===totalPages?'disabled':''}>次へ →</button></nav>`:''}`;
}
function settings(){return `${hero('SETTINGS','データと設定','マイリストの取り込み・バックアップ・アカウント管理')}
  <section class="settings-grid"><div class="panel setting-panel"><div class="setting-icon">⇩</div><h2>データをインポート</h2><p>v0.3のJSONバックアップ、またはCSVをSupabaseへ取り込みます。同じIDは上書き更新されます。</p><button class="btn primary" data-action="import">インポート</button></div>
  <div class="panel setting-panel"><div class="setting-icon">⇧</div><h2>バックアップ</h2><p>動画・マイリスト・メモ・評価などを、自分のPCにJSON形式で保存します。</p><button class="btn subtle" id="export">JSONバックアップを保存</button></div>
  <div class="panel setting-panel"><div class="setting-icon">≡</div><h2>マイリストを作成</h2><p>アプリ内の管理用リストを追加します。ニコニコ本体には作成されません。</p><button class="btn subtle" data-action="playlist">新しいリスト</button></div>
  <div class="panel setting-panel"><div class="setting-icon">↻</div><h2>ニコニコとの差分同期</h2><p>ログイン済みニコニコの一覧を取得して、登録漏れや削除済み動画を確認できます。差分を確認してからDBへ反映します。</p><button class="btn primary" data-action="sync">差分を確認する</button></div>
  </section><div class="danger-zone"><div><h2>ライブラリを削除</h2><p>このアカウントの動画・マイリスト・メモを削除します。Googleアカウント自体は削除しません。</p></div><button class="btn danger" id="erase">全データを削除</button></div>`;}
function content(){const rows=makeRows();return state.view==='dashboard'?dashboard(rows):state.view==='settings'?settings():listing(rows);}
function loginScreen(){return `<div class="login-bg"><div class="login-orbit orbit-one"></div><div class="login-orbit orbit-two"></div><header class="login-top"><span class="login-mark">♫</span><span>NICO SHELF</span><span class="version">BETA / 0.6</span></header><div class="login-card"><div class="eyebrow">PERSONAL MUSIC ARCHIVE</div><div class="login-art">♫</div><h1>好きな音楽を、<br><em>自分だけの棚に。</em></h1><p>ニコニコのマイリストを検索・整理・分析。<br>タグも、歌唱者も、あなたの思い出も。</p><button id="login" class="google-btn"><span class="google-g">G</span> Googleアカウントで続ける <span>↗</span></button><small>ライブラリはアカウントごとに非公開で管理されます。<br>ニコニコ公式のサービスではありません。</small></div><footer class="login-footer">NICO SHELF <span>YOUR MUSIC ARCHIVE</span></footer></div>`;}
function missingConfig(){return `<div class="setup-state"><span class="big-note">♫</span><h1>NICO SHELF v0.6</h1><p>Supabaseの接続先が設定されていません。</p><div class="code-hint">.env.local に VITE_SUPABASE_URL と<br>VITE_SUPABASE_PUBLISHABLE_KEY を設定</div><p class="muted">設定後に npm run dev を再起動してください。<br>詳しくは README.md を参照してください。</p></div>`;}
function modal(){
  const d=state.dialog,lib=state.library;
  let contents='';
  if(d.kind==='import')contents=`<div class="modal-head"><div class="eyebrow">IMPORT / BACKUP</div><h2>ライブラリを取り込む</h2><p>v0.3のJSONバックアップ、またはCSVファイルを選択してください。</p></div>
   <label class="file-drop">⇩<strong>ここを押してファイルを選択</strong><small>.json / .csv（自動同期ではありません）</small><input type="file" id="file-import" accept=".json,.csv,application/json,text/csv" /></label>
   <p class="modal-note">個人データはログイン中のアカウントに保存され、他のユーザーからはアクセスできません。</p>
   <a class="link-text" href="/import-example.csv" download>CSVテンプレートをダウンロード ↗</a>
   ${state.preview?`<div class="preview-data"><b>読み込み内容</b><span>${formatCount(state.preview.playlists.length)} リスト · ${formatCount(state.preview.videos.length)} 動画 · ${formatCount(state.preview.entries.length)} 件の登録</span><small>同じIDの情報は上書きされます。途中で失敗した場合、一部だけ反映されることがあります。</small></div><button class="btn primary full" id="run-import" ${state.busy?'disabled':''}>${state.busy?'インポート中…':'Supabaseにインポート'}</button>`:''}<div id="import-status" class="modal-note" role="status"></div>`;
  else if(d.kind==='sync') {
    let url='';try{url=snapshotUrl(lib);}catch{}
    const diff=state.sync;
    const age=diff?Math.round((Date.now()-Date.parse(diff.snapshot.captured_at))/60000):0;
    const changes=diff?diff.added+diff.removed+diff.reordered:0;
    contents=`<div class="modal-head"><div class="eyebrow">SYNC / REVIEW FIRST</div><h2>ニコニコとの差分同期</h2><p>同期前に差分を確認できます。削除候補の動画・個人メモは物理削除しません。</p></div>
      <ol class="sync-steps"><li>先にニコニコ側に <b>v0.5の取得用Tampermonkeyスクリプト</b>を登録</li><li>下のボタンからニコニコを開き、一覧を取得してJSONを保存</li><li>保存したJSONをここで読み込み、差分を確認して反映</li></ol>
      ${url?`<a class="btn primary full sync-export" href="${esc(url)}" target="_blank" rel="noopener noreferrer">↗ ニコニコで一覧を取得する</a>`:'<p class="inline-hint">数値のマイリストIDがありません。先にニコニコのリストをインポートしてください。</p>'}
      <label class="file-drop">⇩<strong>ニコニコから取得したJSONを選択</strong><small>nico-shelf-snapshot-*.json</small><input type="file" id="file-sync" accept=".json,application/json" /></label>
      ${diff?`<div class="sync-summary"><b>取得日時：${esc(new Date(diff.snapshot.captured_at).toLocaleString('ja-JP'))}</b>${age>60?'<p class="sync-warning">取得から1時間以上経過しています。最新の一覧を再取得することを推奨します。</p>':''}
        <div class="sync-totals"><span>追加候補 <b>${diff.added}</b></span><span>削除候補 <b>${diff.removed}</b></span><span>順番変更 <b>${diff.reordered}</b></span></div>
        ${diff.rows.map(row=>`<div class="sync-list"><h3>${esc(row.name)} <small>ニコニコ ${row.remoteCount} / DB ${row.localCount}</small></h3>
          <p class="sync-list-count">追加 ${row.added.length}・削除 ${row.removed.length}・並び順の差 ${row.reordered.length}</p>
          ${row.added.length?`<div class="sync-detail"><b class="sync-add">＋ ニコニコにあってDBにないもの</b>${row.added.slice(0,40).map(x=>`<div><a href="https://www.nicovideo.jp/watch/${encodeURIComponent(x.video_id)}" target="_blank" rel="noopener noreferrer">${esc(x.title||x.video_id)}</a> <small>(${esc(x.video_id)})</small></div>`).join('')}${row.added.length>40?`<small>ほか ${row.added.length-40} 件</small>`:''}</div>`:''}
          ${row.removed.length?`<div class="sync-detail"><b class="sync-remove">− DBにあってニコニコにないもの</b>${row.removed.slice(0,40).map(x=>`<div><a href="https://www.nicovideo.jp/watch/${encodeURIComponent(x.video_id)}" target="_blank" rel="noopener noreferrer">${esc(x.title||x.video_id)}</a> <small>(${esc(x.video_id)})</small></div>`).join('')}${row.removed.length>40?`<small>ほか ${row.removed.length-40} 件</small>`:''}</div>`:''}
        </div>`).join('')}
        <p class="modal-note">反映は選択したリストの所属と表示順のみ更新。個人的な評価・メモ・お気に入り、他の未選択リストは変更しません。</p>
        <div class="inline-actions"><button class="btn subtle" id="export">事前にバックアップ</button><button class="btn primary" id="apply-sync" ${state.busy?'disabled':''}>${state.busy?'反映中…':changes?'確認して差分を反映':'同期日時・登録順を更新'}</button></div>
       </div>`:''}`;
  }
  else if(d.kind==='playlist') contents=`<div class="modal-head"><div class="eyebrow">CREATE LIST</div><h2>マイリストを作成</h2><p>NICO SHELF内の管理用リストを作ります。</p></div><label class="field-label">名前<input id="playlist-name" placeholder="例：好きな曲" maxlength="90" /></label><button class="btn primary full" id="save-playlist">リストを作成（DBのみ）</button>`;
  else if(d.kind==='add'){
    const id=videoId(d.vid),matches=id?lib.entries.filter(x=>x.video_id===id&&x.present!==false):[];
    const p=registrationLists(lib.playlists);
    const probe=d.probe?.videoId===id?d.probe:null;
    const isConnected=nicoBridge.connected;
    let decision=null,warning='';
    if(probe){try{decision=registrationDecision(probe.lists,id,d.target||'auto',Boolean(d.allowDuplicate));}catch(e){warning=e.message;}}
    const remoteMemberships=probe?probe.lists.filter(x=>x.hasVideoIds.includes(id)):[];
    contents=`<div class="modal-head"><div class="eyebrow">ADD TO NICONICO / BETA</div><h2>動画をマイリストへ登録</h2><p>ニコニコで所属を確認してから本体に追加。成功確認後にSupabaseにも保存します。</p></div>
      <label class="field-label">動画ID / URL<input id="video-id" placeholder="sm12345678" value="${esc(d.vid||'')}" autocomplete="off" /></label>
      <div id="membership-preview" class="inline-hint">${id?(matches.length?`DBでの所属：${esc(matches.map(e=>lib.playlists.find(x=>x.id===e.playlist_id)?.name||e.playlist_id).join('・'))}`:'DB内では未登録'):'入力するとDB内の重複を確認できます'}</div>
      <label class="field-label">動画タイトル（任意・DB保存時に利用）<input id="video-title" placeholder="未入力ならニコニコから取得" value="${esc(d.title||'')}" maxlength="220" /></label>
      <label class="field-label">登録先<select id="target-playlist"><option value="auto" ${!d.target||d.target==='auto'?'selected':''}>自動：ぼかうた1 → 2 → 3（空き優先）</option>${p.map(x=>`<option value="${esc(x.id)}" ${d.target===x.id?'selected':''}>手動：${esc(x.name)}（DB上 ${lib.entries.filter(e=>e.playlist_id===x.id&&e.present!==false).length}/500）</option>`).join('')}</select></label>
      ${p.length?'':'<div class="inline-hint">先に数値IDのニコニコマイリストをインポートしてください。</div>'}
      <label class="check-field"><input type="checkbox" id="allow-duplicate" ${d.allowDuplicate?'checked':''} /> ほかのマイリストと重複しても登録を許可する</label>
      <div class="nico-connect-panel"><b>ニコニコ連携：${isConnected?'接続中':'未接続'}</b><p>初回だけニコニコのタブで「接続を許可」。タブは閉じずにおいてください。Cookie・パスワードは送信しません。</p>
        <div class="inline-actions"><button class="btn subtle" id="nico-connect" ${state.busy?'disabled':''}>${isConnected?'再接続':'① ニコニコと接続'}</button><button class="btn subtle" id="nico-inspect" ${!isConnected||!id||!p.length||state.busy?'disabled':''}>② 登録状況を確認</button></div>
        ${probe?`<div class="nico-check-results"><b>ニコニコ側の登録状況</b>${probe.lists.map(x=>`<div class="nico-check-line"><span>${esc(x.name)}</span><span>${x.count}/500 ${x.hasVideoIds.includes(id)?'・登録済み':''}</span></div>`).join('')}
           <div class="inline-hint">${remoteMemberships.length?'所属：'+esc(remoteMemberships.map(x=>x.name).join('・')):'ニコニコ側では未登録'}</div>
           ${decision?`<p>追加先：<b>${esc(decision.target.name)}</b></p>`:`<p class="sync-warning">${esc(warning)}</p>`}</div>`:''}
      </div>
      <button class="btn primary full" id="nico-register" ${!decision||!isConnected||state.busy?'disabled':''}>③ ニコニコ本体に登録する</button>
      <div class="inline-hint">非公式APIのため登録できない場合があります。処理中に通信が切れた場合はニコニコで結果を確認し、再送信せず差分同期してください。</div>
      <button class="btn subtle full" id="save-video" ${!p.length||state.busy||d.target==='auto'||!d.target?'disabled':''}>DBのみへ仮登録（本体には登録しない）</button>`;
  }
  else if(d.kind==='detail'){
    const v=lib.videos.find(x=>x.id===d.id),m=lib.meta.find(x=>x.video_id===d.id);
    if(!v)return '';
    contents=`<div class="modal-head"><div class="eyebrow">VIDEO NOTES / ${esc(v.id)}</div><h2>${esc(v.title||v.id)}</h2><p>${esc(v.uploader||'')} · ${formatDate(v.published_at)}</p></div>
    <a class="link-text" href="https://www.nicovideo.jp/watch/${encodeURIComponent(v.id)}" target="_blank" rel="noopener noreferrer">ニコニコで開く ↗</a>
    <label class="field-label">お気に入り<select id="meta-fav"><option value="0" ${!m?.favorite?'selected':''}>通常</option><option value="1" ${m?.favorite?'selected':''}>♥ お気に入り</option></select></label>
    <label class="field-label">評価<select id="meta-rating">${[0,1,2,3,4,5].map(x=>`<option value="${x}" ${Number(m?.rating||0)===x?'selected':''}>${x===0?'未評価':`★ ${x} / 5`}</option>`).join('')}</select></label>
    <label class="field-label">自分用タグ<input id="meta-tags" value="${esc(m?.personal_tags||'')}" placeholder="例：お気に入り、夜、発掘" maxlength="500" /></label>
    <label class="field-label">メモ<textarea id="meta-memo" rows="5" placeholder="この曲の好きなところなど">${esc(m?.memo||'')}</textarea></label>
    <button class="btn primary full" id="save-meta">保存する</button>`;
  }
  return `<div class="modal-backdrop" data-close="1"><section class="modal" role="dialog" aria-modal="true" aria-label="NICO SHELFの操作"><button class="close-btn" data-close="1" aria-label="閉じる">×</button>${contents}</section></div>`;
}
function render(){
  root.innerHTML=!configured?missingConfig():!state.user?loginScreen():shell();
}
function rerenderContent(){const el=document.querySelector('#main-content');if(el)el.innerHTML=content();}
function rerenderSidebar(){render();}
function showDialog(kind,extra={}){state.preview=null;if(kind==='sync')state.sync=null;state.dialog={kind,...extra};render();}
function closeDialog(){state.dialog=null;state.preview=null;render();}
function refreshMembership(){
  const el=document.querySelector('#membership-preview'),id=videoId(document.querySelector('#video-id')?.value);
  if(!el)return;
  const e=state.library.entries.filter(x=>x.video_id===id&&x.present!==false);
  el.textContent=id?(e.length?`所属済み：${e.map(x=>state.library.playlists.find(p=>p.id===x.playlist_id)?.name||x.playlist_id).join('・')}`:'どのリストにも未登録'):'正しい動画IDを入力してください';
}
async function refresh(){state.library=await loadLibrary(state.user.id);render();}
async function login(){
  const {error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+location.pathname}});
  if(error)toast(`Googleログインに失敗: ${error.message}`,true);
}
async function toggleFavorite(id){
  const original=state.library.meta.find(x=>x.video_id===id);
  const row={owner_id:state.user.id,video_id:id,favorite:!original?.favorite,rating:original?.rating||0,memo:original?.memo||'',personal_tags:original?.personal_tags||'',verified_voice:original?.verified_voice||'',verified_composer:original?.verified_composer||'',updated_at:new Date().toISOString()};
  const {error}=await client.from('user_meta').upsert(row,{onConflict:'owner_id,video_id'});if(error)throw error;
  const i=state.library.meta.findIndex(x=>x.video_id===id);i>=0?state.library.meta.splice(i,1,row):state.library.meta.push(row);rerenderContent();
}
async function saveMeta(){
  const id=state.dialog.id,row={owner_id:state.user.id,video_id:id,rating:Number(document.querySelector('#meta-rating').value),favorite:document.querySelector('#meta-fav').value==='1',memo:document.querySelector('#meta-memo').value.slice(0,10000),personal_tags:document.querySelector('#meta-tags').value.slice(0,500),updated_at:new Date().toISOString()};
  const old=state.library.meta.find(x=>x.video_id===id);if(old){row.verified_voice=old.verified_voice;row.verified_composer=old.verified_composer;}
  const {error}=await client.from('user_meta').upsert(row,{onConflict:'owner_id,video_id'});if(error)throw error;
  closeDialog();await refresh();toast('メモと評価を保存しました');
}
async function savePlaylist(){
  const name=document.querySelector('#playlist-name')?.value.trim();if(!name)throw new Error('名前を入力してください');
  const id=`local-${crypto.randomUUID()}`;
  const {error}=await client.from('playlists').insert({owner_id:state.user.id,id,name});if(error)throw error;
  closeDialog();await refresh();toast('マイリストを作成しました（DBのみ）');
}
function captureAddForm(){
  if(state.dialog?.kind!=='add')return;
  const d=state.dialog;
  d.vid=document.querySelector('#video-id')?.value||d.vid||'';
  d.title=document.querySelector('#video-title')?.value||'';
  d.target=document.querySelector('#target-playlist')?.value||'auto';
  d.allowDuplicate=Boolean(document.querySelector('#allow-duplicate')?.checked);
}
async function connectNico(){
  if(state.busy)return;
  captureAddForm();state.busy=true;render();
  try{nicoBridge.disconnect();await nicoBridge.connect();toast('ニコニコのタブに接続できました');}
  finally{state.busy=false;render();}
}
async function probeNico(){
  if(state.busy)return;
  captureAddForm();
  const id=videoId(state.dialog.vid);if(!id)throw new Error('正しい動画IDを入力してください');
  const lists=registrationLists(state.library.playlists);
  if(!lists.length)throw new Error('同期対象のニコニコマイリストがありません');
  state.busy=true;render();
  try{
    const result=await nicoBridge.request('inspect',{videoId:id,lists:lists.map(p=>({id:p.id,name:p.name}))},85000);
    if(!Array.isArray(result)||result.length!==lists.length)throw new Error('不完全な登録状況です。再取得してください');
    if(state.dialog?.kind==='add')state.dialog.probe={videoId:id,lists:result};
    toast('ニコニコの登録状況を確認しました');
  }finally{state.busy=false;render();}
}
async function writeConfirmedRegistration(vid,remote){
  if(!remote?.confirmed || remote.videoId!==vid)throw new Error('ニコニコ登録結果を確認できません');
  const pl=state.library.playlists.find(p=>p.id===remote.listId);
  if(!pl)throw new Error('登録先がDBにありません。差分同期してください');
  if(!state.library.videos.some(v=>v.id===vid)){
    const title=String(state.dialog?.title||remote.title||vid).slice(0,220);
    const {error}=await client.from('videos').insert({owner_id:state.user.id,id:vid,title:title||vid});
    if(error && error.code!=='23505')throw error;
  }
  const numbers=state.library.entries.filter(e=>e.playlist_id===pl.id&&e.present!==false).map(e=>Number(e.position)).filter(Number.isFinite);
  const position=(numbers.length?Math.min(...numbers):1)-1;
  const {error}=await client.from('entries').upsert({owner_id:state.user.id,playlist_id:pl.id,video_id:vid,position,present:true},{onConflict:'owner_id,playlist_id,video_id'});
  if(error)throw error;
}
async function registerInNico(){
  if(state.busy)return;
  captureAddForm();
  const d=state.dialog,id=videoId(d?.vid);
  if(!id)throw new Error('正しい動画IDを入力してください');
  if(!d.probe||d.probe.videoId!==id)throw new Error('先に登録状況を確認してください');
  const decision=registrationDecision(d.probe.lists,id,d.target||'auto',d.allowDuplicate);
  if(!confirm(`ニコニコ動画 ${id} を「${decision.target.name}」へ登録します。\n\nログイン中のニコニコアカウントと登録先が正しいことを確認してください。`))return;
  state.busy=true;render();
  try{
    let remote;
    try{
      remote=await nicoBridge.request('register',{
        videoId:id,lists:registrationLists(state.library.playlists).map(p=>({id:p.id,name:p.name})),
        targetId:d.target||'auto',allowDuplicate:d.allowDuplicate
      },105000);
    }catch(err){throw new Error(`${err.message}。ニコニコ側の登録を確認するまで再操作しないでください`);}
    try{
      await writeConfirmedRegistration(id,remote);
      state.dialog=null;await refresh();
      toast(`「${remote.listName}」に登録し、DBにも反映しました`);
    }catch(err){
      throw new Error(`ニコニコには登録できましたが、Supabaseの更新に失敗しました：${err.message}。差分同期でDBを更新してください（再登録しないでください）`);
    }
  }finally{state.busy=false;render();}
}
async function saveVideo(){
  const id=videoId(document.querySelector('#video-id')?.value);if(!id)throw new Error('正しい動画IDまたはURLを入力してください');
  const playlist_id=document.querySelector('#target-playlist')?.value;if(!playlist_id||playlist_id==='auto')throw new Error('DBだけに登録する場合は登録先を手動で選んでください');
  const current=state.library.entries.filter(x=>x.video_id===id&&x.present!==false);
  if(current.some(x=>x.playlist_id===playlist_id))throw new Error('このマイリストにはすでに登録されています');
  if(current.length&&!document.querySelector('#allow-duplicate').checked)throw new Error(`別リストに登録済みです：${current.map(x=>state.library.playlists.find(p=>p.id===x.playlist_id)?.name||x.playlist_id).join('・')}（重複許可が必要）`);
  const count=state.library.entries.filter(x=>x.playlist_id===playlist_id&&x.present!==false).length;
  if(count>=500)throw new Error('選択したリストは500件に達しています');
  if(!state.library.videos.some(v=>v.id===id)){
    const title=document.querySelector('#video-title').value.trim()||id;
    const {error}=await client.from('videos').insert({owner_id:state.user.id,id,title});if(error)throw error;
  }
  const existingPositions=state.library.entries.filter(x=>x.playlist_id===playlist_id&&x.present!==false).map(e=>Number(e.position)||0);
  // v0.3 initial data uses position 1 for the first (typically newest) displayed item.
  // New local registrations go before the current first item without rewriting the entire list.
  const nextPos=(existingPositions.length?Math.min(...existingPositions):1)-1;
  const {error}=await client.from('entries').upsert({owner_id:state.user.id,playlist_id,video_id:id,position:nextPos,present:true},{onConflict:'owner_id,playlist_id,video_id'});
  if(error)throw error;
  closeDialog();await refresh();toast('DBに登録しました。ニコニコ本体には反映されていません');
}
function exportJson(){
  const {playlists,videos,entries,meta}=state.library;
  const strip=x=>{const {owner_id,...data}=x;return data;};
  const payload={format:'nico-shelf-v0.4',exported_at:new Date().toISOString(),playlists:playlists.map(strip),videos:videos.map(strip),entries:entries.map(strip),user_meta:meta.map(strip)};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`nico-shelf-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
async function handleFile(file){
  if(!file)return;
  const t=await file.text();state.preview=file.name.toLowerCase().endsWith('.csv')?csvToImport(t):normalizeImport(JSON.parse(t));
  state.dialog={kind:'import'};render();toast('ファイルを読み取りました。内容を確認してインポートしてください');
}
async function runImport(){
  if(!state.preview||state.busy)return;
  const rows=state.preview;
  const yes=confirm(`${rows.videos.length}動画・${rows.entries.length}件をSupabaseに保存します。\n同じ動画・リストは上書き更新されます。よろしいですか？`);if(!yes)return;
  state.busy=true;document.querySelector('#run-import').disabled=true;
  const status=document.querySelector('#import-status');
  try{
    await importRows(state.user.id,rows,(table,n,total)=>{if(status)status.textContent=`インポート中：${table} ${n}/${total}`;});
    state.preview=null;state.dialog=null;await refresh();toast(`${rows.videos.length}動画のインポートが完了しました`);
  }finally{state.busy=false;if(document.querySelector('#run-import'))document.querySelector('#run-import').disabled=false;}
}
async function handleSyncFile(file){
  if(!file)return;
  if(file.size>4*1024*1024)throw new Error('同期ファイルが大きすぎます（4MB以下）');
  const snapshot=normalizeSnapshot(JSON.parse(await file.text()));
  state.sync=diffSnapshot(snapshot,state.library);
  state.dialog={kind:'sync'};render();
  toast(`差分を確認しました：追加${state.sync.added}件・削除${state.sync.removed}件`);
}
async function applySync(){
  if(state.busy||!state.sync)return;
  const snapshot=state.sync.snapshot;
  if(Date.now()-Date.parse(snapshot.captured_at)>24*3600*1000)throw new Error('取得から24時間を超えています。新しい一覧を取得してください。');
  // Prevent confirming a stale diff against local data changed on another device.
  const current=await loadLibrary(state.user.id);
  const latest=diffSnapshot(snapshot,current);
  if(latest.added!==state.sync.added||latest.removed!==state.sync.removed||latest.reordered!==state.sync.reordered){
    state.library=current;state.sync=latest;render();
    throw new Error('他の端末でDBが更新されました。差分を再確認してください。');
  }
  const highRemoval=latest.rows.filter(r=>r.removed.length>=10&&r.removed.length>=Math.max(1,r.localCount)*0.2);
  if(highRemoval.length){
    const input=prompt(`大量の削除候補があります（${highRemoval.map(r=>`${r.name}: ${r.removed.length}件`).join(' / ')}）。\n取得元のニコニコアカウントとリストを再確認してください。\n続行する場合のみ「大量削除」と入力してください。`);
    if(input!=='大量削除')return;
  }
  if(!confirm(`選択した${latest.rows.length}リストを同期します。\n追加${latest.added}件・削除扱い${latest.removed}件・並び順変更${latest.reordered}件\n\n削除扱いの動画・メモはDBから物理削除しません。続けますか？`))return;
  state.busy=true;render();
  try{
    const {data,error}=await client.rpc('apply_mylist_snapshot',{p_snapshot:toRpcPayload(snapshot)});
    if(error)throw new Error(`Supabaseの同期に失敗: ${error.message}。SQLマイグレーションの適用も確認してください。`);
    if(!data?.ok)throw new Error('同期処理から正常な完了応答がありません');
    state.sync=null;state.dialog=null;await refresh();
    toast(`同期成功：${latest.added}件追加・${latest.removed}件を削除済み扱い`);
  }finally{state.busy=false;render();}
}
async function eraseData(){
  if(!confirm('このアカウントのライブラリをすべて削除します。元に戻せません。よろしいですか？'))return;
  const answer=prompt('誤操作防止のため「削除」と入力してください');if(answer!=='削除')return;
  for(const table of ['user_meta','entries','videos','playlists']){
    const {error}=await client.from(table).delete().eq('owner_id',state.user.id);if(error)throw new Error(`${table}: ${error.message}`);
  }
  await refresh();toast('このアカウントのライブラリを削除しました');
}
async function guard(fn){
  try{await fn();}catch(e){console.error(e);toast(e.message||'処理に失敗しました',true);}
}
root.addEventListener('click',e=>{
  const target=e.target.closest('button,[data-view],[data-page],[data-close]');if(!target)return;
  if(target.id==='login')return guard(login);
  if(target.id==='logout')return guard(async()=>{const {error}=await client.auth.signOut();if(error)throw error;});
  if(!state.user)return;
  if(target.dataset.close){if(e.target.closest('.modal')&&!target.classList.contains('close-btn'))return;return closeDialog();}
  if(target.dataset.view){state.view=target.dataset.view;state.page=1;state.filters.q='';state.filters.playlist='';state.filters.sort='views';state.filters.order='desc';return render();}
  if(target.dataset.page){state.page=Math.max(1,Number(target.dataset.page));return rerenderContent();}
  if(target.dataset.action){return showDialog(target.dataset.action);}
  if(target.dataset.favorite)return guard(()=>toggleFavorite(target.dataset.favorite));
  if(target.dataset.detail)return showDialog('detail',{id:target.dataset.detail});
  if(target.id==='sort-dir'){state.filters.order=state.filters.order==='desc'?'asc':'desc';state.page=1;return rerenderContent();}
  if(target.id==='sort-reset'){state.filters.sort='views';state.filters.order='desc';state.page=1;return rerenderContent();}
  if(target.id==='save-meta')return guard(saveMeta);
  if(target.id==='save-playlist')return guard(savePlaylist);
  if(target.id==='save-video')return guard(saveVideo);
  if(target.id==='nico-connect')return guard(connectNico);
  if(target.id==='nico-inspect')return guard(probeNico);
  if(target.id==='nico-register')return guard(registerInNico);
  if(target.id==='run-import')return guard(runImport);
  if(target.id==='apply-sync')return guard(applySync);
  if(target.id==='export')return exportJson();
  if(target.id==='erase')return guard(eraseData);
});
root.addEventListener('change',e=>{
  if((e.target.id==='target-playlist'||e.target.id==='allow-duplicate')&&state.dialog?.kind==='add'){captureAddForm();render();return;}
  if(e.target.id==='file-import')return guard(()=>handleFile(e.target.files[0]));
  if(e.target.id==='file-sync')return guard(()=>handleSyncFile(e.target.files[0]));
  if(e.target.id==='list-filter'){state.filters.playlist=e.target.value;state.page=1;rerenderContent();}
  if(e.target.id==='sort-field'){
    state.filters.sort=e.target.value;
    const currentList=state.view.startsWith('playlist:')?state.view.slice(9):state.filters.playlist;
    if(state.filters.sort==='registration'&&!currentList)state.filters.playlist=state.library.playlists[0]?.id||'';
    // Position 1 means the first item in the imported list; ascending is "first in list".
    state.filters.order=state.filters.sort==='registration'?'asc':'desc';state.page=1;rerenderContent();
  }
});
let composing=false;
root.addEventListener('compositionstart',e=>{if(e.target.id==='search')composing=true;});
root.addEventListener('compositionend',e=>{if(e.target.id==='search'){composing=false;state.filters.q=e.target.value;state.page=1;rerenderContent();document.querySelector('#search')?.focus();}});
root.addEventListener('input',e=>{
  if(e.target.id==='video-id'){if(state.dialog?.kind==='add'){state.dialog.vid=e.target.value;state.dialog.probe=null;refreshMembership();const b=document.querySelector('#nico-register');if(b)b.disabled=true;const p=document.querySelector('#nico-inspect');if(p)p.disabled=!videoId(e.target.value)||!nicoBridge.connected;}return;}
  if(e.target.id==='search'){
    if(composing||e.isComposing)return;
    state.filters.q=e.target.value;state.page=1;
    const start=e.target.selectionStart,end=e.target.selectionEnd;
    rerenderContent();const field=document.querySelector('#search');field?.focus();try{field?.setSelectionRange(start,end);}catch{}
  }
});
root.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.dialog)closeDialog();});

async function start(){
  if(!configured){render();return;}
  try{
    const {data,error}=await client.auth.getSession();if(error)throw error;
    state.user=data.session?.user||null;render();
    if(state.user)await guard(refresh);
    client.auth.onAuthStateChange(async(event,session)=>{
      // No awaited Supabase call here: avoids auth-lock deadlocks. Refresh later.
      const before=state.user?.id||null;state.user=session?.user||null;
      if(before!==state.user?.id){state.library={playlists:[],videos:[],entries:[],meta:[]};state.view='dashboard';state.dialog=null;render();if(state.user)setTimeout(()=>guard(refresh),0);}
    });
  }catch(e){root.innerHTML=`<div class="setup-state"><h1>接続できませんでした</h1><p>${esc(e.message)}</p><button class="btn primary" id="retry">再読み込み</button></div>`;document.querySelector('#retry')?.addEventListener('click',()=>location.reload());}
}
start();
