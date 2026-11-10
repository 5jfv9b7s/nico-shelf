import { esc, videoId, array, formatCount, formatDate } from '../lib.js';
import { snapshotUrl } from '../sync.js';
import { registrationLists, registrationDecision } from '../registration.js';
import { canonicalVoices, needsMetadata } from '../discovery.js';
import { safeThumb } from './media.js';

/**
 * View-only dialogs. Registration/synchronization operations are performed by
 * the controller after the user explicitly confirms each action.
 */
export function createDialogRenderer({ state, nicoBridge }) {
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
    const liveConnected=nicoBridge.connected;
    const syncing=state.busy && state.dialog?.kind==='sync';
    contents=`<div class="modal-head"><div class="eyebrow">SYNC / REVIEW FIRST</div><h2>ニコニコとの差分同期</h2><p>登録状況を取得して差分を確認できます。メモや評価は物理削除しません。</p></div>
      <div class="sync-live-panel">
        <div class="sync-connection"><b>${liveConnected?'● ニコニコと接続中':'○ ニコニコに未接続'}</b><small>ブラウザのログイン済みニコニコタブを使います。Cookieはクラウドに保存しません。</small></div>
        <button class="btn primary full" id="sync-live" ${state.busy?'disabled':''}>${syncing?'ニコニコから取得中…':liveConnected?'↻ ニコニコと照合する':'↗ 接続してニコニコと照合する'}</button>
        ${state.syncProgress?`<p class="sync-progress" role="status">${esc(state.syncProgress)}</p>`:''}
        <small class="sync-note">${liveConnected?'接続済み。ボタン1回で全リストを読み取り、差分を表示します。':'初回のみ、開いたニコニコのタブで「接続を許可」してください。'}</small>
      </div>
      <details class="sync-fallback"><summary>JSONファイルで同期する（予備の方法）</summary>
        <p class="modal-note">通信できない場合は、v0.5の一覧取得スクリプトでJSONを作り、ここから読み込めます。</p>
        ${url?`<a class="btn subtle full sync-export" href="${esc(url)}" target="_blank" rel="noopener noreferrer">↗ ニコニコでJSONを作成</a>`:'<p class="inline-hint">数値のマイリストIDがありません。</p>'}
        <label class="file-drop">⇩<strong>取得したJSONを選択</strong><input type="file" id="file-sync" accept=".json,application/json" /></label>
      </details>
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
  else if(d.kind==='metadata'){
    const pending=lib.videos.filter(v=>needsMetadata(v));
    contents=`<div class="modal-head"><div class="eyebrow">ENRICH / VIDEO METADATA</div><h2>ニコニコから情報を補完</h2><p>欠損した動画データだけを取得します。全件を毎回再取得しません。</p></div>
      <div class="preview-data"><b>補完候補：${formatCount(pending.length)}動画</b><span>今回の実行では最大15件まで。連携は${nicoBridge.connected?'接続中':'未接続'}です。</span><small>タイトル・サムネイル・投稿日・タグ・カウンターなどを補完。取得できない動画はスキップします。</small></div>
      ${state.metadataProgress?`<p class="sync-progress" role="status">${esc(state.metadataProgress)}</p>`:''}
      <button class="btn primary full" id="enrich-batch" ${state.busy||!pending.length?'disabled':''}>${state.busy?'取得中…':nicoBridge.connected?'不足情報を15件まで取得':'ニコニコに接続して補完'}</button>
      <p class="modal-note">非公開・削除済み動画やAPI制限により取得できない場合があります。作者・雰囲気の推定はタグに依存します。</p>`;
  }
  else if(d.kind==='playlist') contents=`<div class="modal-head"><div class="eyebrow">CREATE LIST</div><h2>マイリストを作成</h2><p>NICO SHELF内の管理用リストを作ります。</p></div><label class="field-label">名前<input id="playlist-name" placeholder="例：好きな曲" maxlength="90" /></label><button class="btn primary full" id="save-playlist">リストを作成（DBのみ）</button>`;
  else if(d.kind==='add'){
    const id=videoId(d.vid),matches=id?lib.entries.filter(x=>x.video_id===id&&x.present!==false):[];
    const p=registrationLists(lib.playlists);
    const probe=d.probe?.videoId===id?d.probe:null;
    const isConnected=nicoBridge.connected;
    const isConnecting=Boolean(state.connectingNico);
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
      <div class="nico-connect-panel"><b>ニコニコ連携：${isConnected?'接続中':isConnecting?'接続待ち（ニコニコのタブで接続許可を押してください）':'未接続'}</b><p>初回だけニコニコのタブで「接続を許可」。タブは閉じずにおいてください。Cookie・パスワードは送信しません。</p>
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
    ${safeThumb(v.thumb)?`<a class="detail-hero-thumb" href="https://www.nicovideo.jp/watch/${encodeURIComponent(v.id)}" target="_blank" rel="noopener noreferrer"><img src="${esc(safeThumb(v.thumb))}" alt="${esc(v.title)}のサムネイル" loading="lazy" /></a>`:''}
    <a class="link-text" href="https://www.nicovideo.jp/watch/${encodeURIComponent(v.id)}" target="_blank" rel="noopener noreferrer">ニコニコで動画を見る ↗</a>
    <p class="modal-note">歌唱キャラ：${esc(canonicalVoices({...v,userMeta:m}).join(' / ')||'未判定')} ／ 元の表記：${esc(array(v.voices).join(' / ')||'なし')}<br>タグ：${esc(array(v.tags).slice(0,20).join(' / ')||'なし')}</p>
    <div class="inline-actions"><button class="btn subtle" id="enrich-single" ${!nicoBridge.connected||state.busy?'disabled':''}>↻ ニコニコから詳細情報を補完</button>${!nicoBridge.connected?'<small class="muted">補完するには先に「データと設定」からニコニコへ接続してください。</small>':''}</div>
    <label class="field-label">お気に入り<select id="meta-fav"><option value="0" ${!m?.favorite?'selected':''}>通常</option><option value="1" ${m?.favorite?'selected':''}>♥ お気に入り</option></select></label>
    <label class="field-label">評価<select id="meta-rating">${[0,1,2,3,4,5].map(x=>`<option value="${x}" ${Number(m?.rating||0)===x?'selected':''}>${x===0?'未評価':`★ ${x} / 5`}</option>`).join('')}</select></label>
    <label class="field-label">歌唱者を自分で修正（空欄なら元データを使用）<input id="meta-voice" value="${esc(m?.verified_voice||'')}" placeholder="例：音街ウナ、足立レイ" maxlength="500" /></label>
    <label class="field-label">作者を自分で修正（空欄なら元データを使用）<input id="meta-composer" value="${esc(m?.verified_composer||'')}" placeholder="" maxlength="500" /></label>
    <label class="field-label">自分用タグ<input id="meta-tags" value="${esc(m?.personal_tags||'')}" placeholder="例：お気に入り、夜、発掘" maxlength="500" /></label>
    <label class="field-label">メモ<textarea id="meta-memo" rows="5" placeholder="この曲の好きなところなど">${esc(m?.memo||'')}</textarea></label>
    <button class="btn primary full" id="save-meta">保存する</button>`;
  }
  return `<div class="modal-backdrop" data-close="1"><section class="modal" role="dialog" aria-modal="true" aria-label="NICO SHELFの操作"><button class="close-btn" data-close="1" aria-label="閉じる">×</button>${contents}</section></div>`;
}

  return modal;
}
