import { videoId } from '../lib.js';

/**
 * DOM event delegation belongs here, away from the data-fetching controller.
 * Elements are recreated after each render, so listeners attach to the stable root.
 *
 * Callers supply the same controller actions as before the refactor.
 */
export function registerEventHandlers({
  root,
  state,
  client,
  nicoBridge,
  render,
  rerenderContent,
  showDialog,
  closeDialog,
  refreshMembership,
  actions,
}) {
  const {
    guard,
    login,
    toggleFavorite,
    enrichMissing,
    enrichSingle,
    saveMeta,
    savePlaylist,
    saveVideo,
    connectNico,
    syncFromNico,
    probeNico,
    registerInNico,
    runImport,
    applySync,
    exportJson,
    eraseData,
    captureAddForm,
    handleFile,
    handleSyncFile,
    saveSearchPreset, deleteSearchPreset, useSearchPreset, exportFilteredCsv, surpriseMe,
  } = actions;

root.addEventListener('click',e=>{
  const target=e.target.closest('button,[data-view],[data-page],[data-close]');if(!target)return;
  if(target.id==='login')return guard(login);
  if(target.id==='logout')return guard(async()=>{const {error}=await client.auth.signOut();if(error)throw error;});
  if(!state.user)return;
  if(target.dataset.close){if(e.target.closest('.modal')&&!target.classList.contains('close-btn'))return;return closeDialog();}
  if(target.dataset.view){state.view=target.dataset.view;state.page=1;state.activeSavedSearchId='';Object.assign(state.filters,{q:'',playlist:'',sort:'views',order:'desc',voice:'',variant:'',genre:'',mood:'',year:'',creator:'',status:''});return render();}
  if(target.dataset.page){state.page=Math.max(1,Number(target.dataset.page));return rerenderContent();}
  if(target.dataset.action){return showDialog(target.dataset.action);}
  if (target.dataset.related) return showDialog('related', { id: target.dataset.related });
  if (target.id === 'find-related' && state.dialog?.id) {
    return showDialog('related', { id: state.dialog.id });
  }
  if (target.dataset.facetKind && target.dataset.facetValue) {
    const key = target.dataset.facetKind;
    if (key !== 'genre' && key !== 'mood') return;
    state.view = 'library';
    state.activeSavedSearchId = '';
    state.filters = { ...state.filters, q: '', playlist: '', voice: '', variant: '',
      genre: '', mood: '', year: '', creator: '', status: '' };
    state.filters[key] = target.dataset.facetValue;
    state.page = 1;
    return render();
  }
  if(target.dataset.favorite)return guard(()=>toggleFavorite(target.dataset.favorite));
  if(target.dataset.detail)return showDialog('detail',{id:target.dataset.detail});
  if(target.id==='sort-dir'){state.activeSavedSearchId='';state.filters.order=state.filters.order==='desc'?'asc':'desc';state.page=1;return rerenderContent();}
  if(target.id==='sort-reset'){state.activeSavedSearchId='';state.filters.sort='views';state.filters.order='desc';state.page=1;return rerenderContent();}
  if(target.id==='toggle-card-mode'){state.activeSavedSearchId='';state.cardMode=state.cardMode==='grid'?'list':'grid';return rerenderContent();}
  if(target.id==='facets-reset'){state.activeSavedSearchId='';Object.assign(state.filters,{q:'',voice:'',variant:'',genre:'',mood:'',year:'',creator:'',status:''});state.page=1;return rerenderContent();}
  if(target.id==='save-search')return showDialog('save-search');
  if(target.id==='save-search-confirm')return guard(saveSearchPreset);
  if(target.id==='delete-search')return guard(deleteSearchPreset);
  if(target.id==='export-filtered')return guard(exportFilteredCsv);
  if(target.id==='surprise-me')return surpriseMe();
  if(target.id==='enrich-batch')return guard(enrichMissing);
  if(target.id==='enrich-single')return guard(enrichSingle);
  if(target.id==='save-meta')return guard(saveMeta);
  if(target.id==='save-playlist')return guard(savePlaylist);
  if(target.id==='save-video')return guard(saveVideo);
  if(target.id==='nico-connect')return guard(connectNico);
  if(target.id==='sync-live')return guard(syncFromNico);
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
  if(e.target.id==='saved-search-select')return useSearchPreset(e.target.value);
  if(e.target.id==='list-filter'){state.activeSavedSearchId='';state.filters.playlist=e.target.value;state.page=1;rerenderContent();}
  const facetMap={'voice-filter':'voice','variant-filter':'variant','genre-filter':'genre','mood-filter':'mood','year-filter':'year','status-filter':'status'};
  if(facetMap[e.target.id]){
    state.activeSavedSearchId='';state.filters[facetMap[e.target.id]]=e.target.value;
    if(e.target.id==='voice-filter')state.filters.variant='';
    state.page=1;rerenderContent();
  }
  if(e.target.id==='voice-mode'){state.voiceMode=e.target.value==='raw'?'raw':'canonical';rerenderContent();}
  if(e.target.id==='sort-field'){
    state.activeSavedSearchId='';
    state.filters.sort=e.target.value;
    const currentList=state.view.startsWith('playlist:')?state.view.slice(9):state.filters.playlist;
    if(state.filters.sort==='registration'&&!currentList)state.filters.playlist=state.library.playlists[0]?.id||'';
    // Position 1 means the first item in the imported list; ascending is "first in list".
    state.filters.order=state.filters.sort==='registration'?'asc':'desc';state.page=1;rerenderContent();
  }
});
let composing = false;
root.addEventListener('compositionstart',e=>{if(e.target.id==='search'||e.target.id==='creator-filter')composing=true;});
root.addEventListener('compositionend',e=>{if(e.target.id==='search'||e.target.id==='creator-filter'){const name=e.target.id;composing=false;state.activeSavedSearchId='';state.filters[name==='search'?'q':'creator']=e.target.value;state.page=1;rerenderContent();document.querySelector(`#${name}`)?.focus();}});
root.addEventListener('input',e=>{
  if(e.target.id==='video-id'){if(state.dialog?.kind==='add'){state.dialog.vid=e.target.value;state.dialog.probe=null;refreshMembership();const b=document.querySelector('#nico-register');if(b)b.disabled=true;const p=document.querySelector('#nico-inspect');if(p)p.disabled=!videoId(e.target.value)||!nicoBridge.connected;}return;}
  if(e.target.id==='search'||e.target.id==='creator-filter'){
    if(composing||e.isComposing)return;
    const name=e.target.id;state.activeSavedSearchId='';state.filters[name==='search'?'q':'creator']=e.target.value;state.page=1;
    const start=e.target.selectionStart,end=e.target.selectionEnd;
    rerenderContent();const field=document.querySelector(`#${name}`);field?.focus();try{field?.setSelectionRange(start,end);}catch{}
  }
});
root.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.dialog)closeDialog();});


}
