import { videoId } from '../lib.js';
import { DEFAULT_3D_CAMERA } from './scatter3d.js';
import { scrollPageToTop } from './scroll.js';

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
    syncFromPublic,
    importPublicPlaylist,
    confirmPublicImport, cancelPublicImport, checkPublicSourceStatus,
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
  const target=e.target.closest('button,[data-view],[data-page],[data-close],[data-scatter-video]');if(!target)return;
  if(target.id==='login')return guard(login);
  if(target.id==='logout')return guard(async()=>{const {error}=await client.auth.signOut();if(error)throw error;});
  if(!state.user)return;
  if (target.id === 'back-to-top') return scrollPageToTop(true);
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
  if (target.dataset.scatterVideo) return showDialog('detail', { id: target.dataset.scatterVideo });
  if (target.dataset.scatterVoice) {
    state.scatter.voice = state.scatter.voice === target.dataset.scatterVoice ? '' : target.dataset.scatterVoice;
    return rerenderContent();
  }
  if (target.id === 'scatter-mode-2d' || target.id === 'scatter-mode-3d') {
    state.scatter.mode = target.id === 'scatter-mode-3d' ? '3d' : '2d';
    return rerenderContent();
  }
  if (target.id === 'scatter-3d-reset-view') {
    state.scatter.camera = { ...DEFAULT_3D_CAMERA };
    return rerenderContent();
  }
  if (target.id === 'scatter-3d-zoom-in' || target.id === 'scatter-3d-zoom-out') {
    const camera = state.scatter.camera || { ...DEFAULT_3D_CAMERA };
    camera.zoom = Math.max(0.6, Math.min(2.2, camera.zoom * (target.id.endsWith('in') ? 1.2 : 1 / 1.2)));
    state.scatter.camera = camera;
    return rerenderContent();
  }
  if (target.id === 'scatter-reset') {
    state.scatter = { mode: '2d', x: 'views', y: 'comments', z: 'mylists', voice: '', legendLimit: 30 };
    return rerenderContent();
  }
  if(target.dataset.favorite)return guard(()=>toggleFavorite(target.dataset.favorite));
  if(target.dataset.detail)return showDialog('detail',{id:target.dataset.detail});
  if (target.dataset.trendGroup && target.dataset.trendCategory) {
    const next = { group: target.dataset.trendGroup, category: target.dataset.trendCategory };
    const current = state.trends.selected;
    state.trends.selected = current?.group === next.group && current?.category === next.category ? null : next;
    return rerenderContent();
  }
  if (target.dataset.trendFocus) {
    state.trends.focus = state.trends.focus === target.dataset.trendFocus ? '' : target.dataset.trendFocus;
    return rerenderContent();
  }
  if (target.id === 'trend-focus-reset') { state.trends.focus = ''; return rerenderContent(); }
  if (target.id === 'trend-clear') { state.trends.selected = null; return rerenderContent(); }
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
  if(target.id==='sync-public')return guard(syncFromPublic);
  if(target.id==='public-sync-add')return guard(importPublicPlaylist);
  if(target.id==='public-sync-check-connection')return void checkPublicSourceStatus();
  if(target.id==='public-import-confirm')return guard(confirmPublicImport);
  if(target.id==='public-import-cancel')return cancelPublicImport();
  if(target.id==='nico-inspect')return guard(probeNico);
  if(target.id==='nico-register')return guard(registerInNico);
  if(target.id==='run-import')return guard(runImport);
  if(target.id==='apply-sync')return guard(applySync);
  if(target.id==='export')return exportJson();
  if(target.id==='erase')return guard(eraseData);
});
// List selection is explicit: excluding a private list must never be mistaken
// for the list becoming empty, which would mark all its entries as removed.
root.addEventListener('change', (event) => {
  if (event.target.matches('[data-public-sync-list]')) {
    const selected = new Set(state.publicSyncSelected || []);
    if (event.target.checked) selected.add(event.target.value);
    else selected.delete(event.target.value);
    state.publicSyncSelected = [...selected];
  }
});

root.addEventListener('keydown', (event) => {
  // URL + Enter remains available even if the optional status probe fails.
  if (event.key === 'Enter' && event.target.id === 'public-sync-new-list') {
    event.preventDefault();
    if (!state.busy && !state.pendingPublicImport) {
      return guard(importPublicPlaylist);
    }
    return;
  }
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const point = event.target.closest('[data-scatter-video]');
  if (point) {
    event.preventDefault();
    showDialog('detail', { id: point.dataset.scatterVideo });
  }
});
root.addEventListener('toggle', (event) => {
  if (event.target.matches?.('.library-extra-filters')) {
    state.filterPanelsOpen = event.target.open;
  }
}, true);

root.addEventListener('change',e=>{
  if (e.target.id === 'page-jump') {
    const page = Number(e.target.value);
    if (Number.isInteger(page) && page > 0) {
      state.page = page;
      rerenderContent();
    }
    return;
  }
  if (state.dialog?.kind === 'related') {
    if (e.target.id === 'related-mode') {
      state.dialog.mode = ['balanced', 'musical', 'explore'].includes(e.target.value)
        ? e.target.value : 'balanced';
      return render();
    }
    if (e.target.id === 'related-unrated') {
      state.dialog.unratedOnly = e.target.checked;
      return render();
    }
  }
  if((e.target.id==='target-playlist'||e.target.id==='allow-duplicate')&&state.dialog?.kind==='add'){captureAddForm();render();return;}
  if(e.target.id==='file-import')return guard(()=>handleFile(e.target.files[0]));
  if(e.target.id==='file-sync')return guard(()=>handleSyncFile(e.target.files[0]));
  if (['trend-axis', 'trend-facet', 'trend-playlist', 'trend-include-other', 'trend-chart-style', 'trend-visible-count', 'trend-focus-select'].includes(e.target.id)) {
    if (e.target.id === 'trend-axis') state.trends.axis = e.target.value;
    if (e.target.id === 'trend-facet') state.trends.facet = e.target.value;
    if (e.target.id === 'trend-playlist') state.trends.playlistId = e.target.value;
    if (e.target.id === 'trend-include-other') state.trends.includeOther = e.target.checked;
    if (e.target.id === 'trend-chart-style') state.trends.chartStyle = ['spotlight', 'line', 'matrix'].includes(e.target.value) ? e.target.value : 'matrix';
    if (e.target.id === 'trend-visible-count') state.trends.visibleCount = e.target.value === 'all' ? 'all' : Number(e.target.value);
    if (e.target.id === 'trend-focus-select') state.trends.focus = e.target.value;
    if (e.target.id === 'trend-facet' || e.target.id === 'trend-axis') state.trends.focus = '';
    state.trends.selected = null;
    return rerenderContent();
  }
  if (['scatter-x', 'scatter-y', 'scatter-z', 'scatter-voice', 'scatter-legend-limit'].includes(e.target.id)) {
    if (e.target.id === 'scatter-legend-limit') state.scatter.legendLimit = e.target.value === 'all' ? 'all' : Number(e.target.value);
    else state.scatter[{ 'scatter-x': 'x', 'scatter-y': 'y', 'scatter-z': 'z', 'scatter-voice': 'voice' }[e.target.id]] = e.target.value;
    return rerenderContent();
  }
  if(e.target.id==='saved-search-select')return useSearchPreset(e.target.value);
  if(e.target.id==='list-filter'){state.activeSavedSearchId='';state.filters.playlist=e.target.value;state.page=1;rerenderContent();}
  const facetMap={'voice-filter':'voice','variant-filter':'variant','genre-filter':'genre','mood-filter':'mood','year-filter':'year','status-filter':'status'};
  if(facetMap[e.target.id]){
    state.activeSavedSearchId='';state.filters[facetMap[e.target.id]]=e.target.value;
    if(e.target.id==='voice-filter')state.filters.variant='';
    state.page=1;rerenderContent();
  }
  if(e.target.id==='voice-mode'){state.voiceMode=e.target.value==='raw'?'raw':'canonical';rerenderContent();}
  if (e.target.id === 'voice-count') {
    state.voiceVisibleCount = e.target.value === 'all' ? 'all' : Number(e.target.value);
    return rerenderContent();
  }
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
  if(e.target.id==='public-sync-new-list'){state.publicImportInput=e.target.value;return;}
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
