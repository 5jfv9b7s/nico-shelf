import './style.css';
import { client, configured, loadLibrary, importRows } from './supabase.js';
import { esc, videoId, normalizeImport, csvToImport } from './lib.js';
import {
  diffSnapshot,
  normalizeSnapshot,
  toRpcPayload,
  snapshotFromBridgeParts,
  diffSignature,
} from './sync.js';
import { NicoTabBridge } from './bridge.js';
import {
  fetchPublicSnapshot,
  fetchPublicMylist,
  parsePublicMylistId,
  findExistingPublicPlaylist,
} from './public-sync.js';
import { registrationLists, registrationDecision } from './registration.js';
import { needsMetadata, mergeMetadata, inferredVoicesFromTags } from './discovery.js';
import { createInitialState } from './app/state.js';
import { createSearchPreset, applySearchPreset, MAX_SAVED_SEARCHES } from './app/saved-searches.js';
import { selectLibraryResults, chooseRandomVideo } from './app/search.js';
import { makeLibraryCsv } from './app/csv-export.js';
import { registerEventHandlers } from './app/events.js';
import { createViewRenderer } from './ui/views.js';
import { buildLibraryRows } from './app/library.js';
import { mountScatter3D } from './ui/scatter3d.js';
import { createDialogRenderer } from './ui/dialogs.js';
import {
  captureSyncDialogUi,
  restoreSyncDialogUi,
  updateSyncStatus,
} from './app/sync-dialog-ui.js';
import { checkPublicSourceStatus } from './app/public-source-status.js';
import { createNavigationScrollHandler } from './app/scroll.js';
import { createAuthenticatedPublicFetch } from './app/public-fetch.js';

/**
 * Controller: connects UI events to Supabase and NicoNico bridge operations.
 * HTML creation lives in ui/; shared transformations live in app/ and lib.js.
 */
const root = document.querySelector('#app');
const state = createInitialState();
const nicoBridge = new NicoTabBridge();
const renderDialog = createDialogRenderer({ state, nicoBridge });
const { shell, content, loginScreen, missingConfig } = createViewRenderer({ state, renderDialog });
const scrollAfterNavigation = createNavigationScrollHandler();
const fetchAuthenticatedPublicPage = createAuthenticatedPublicFetch(client?.auth);

function toast(message, isError = false) {
  let el = document.querySelector('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.append(el);
  }
  el.textContent = message;
  el.className = `toast show ${isError ? 'danger' : ''}`;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.classList.remove('show'), 4200);
}
/** Attach Canvas behavior only when the 3D chart is visible. */
function mountInteractiveScatter() {
  mountScatter3D({
    root,
    state,
    rows:
      state.view === 'scatter' && state.scatter.mode === '3d'
        ? buildLibraryRows(state.library)
        : [],
    onOpenVideo: (id) => showDialog('detail', { id }),
  });
}
function render() {
  const modalState = state.dialog?.kind === 'sync' ? captureSyncDialogUi(root) : null;
  root.innerHTML = !configured ? missingConfig() : !state.user ? loginScreen() : shell();
  if (state.dialog?.kind === 'sync') restoreSyncDialogUi(root, modalState);
  mountInteractiveScatter();
  scrollAfterNavigation(state);
}
/** Keep the dialog and scroll position intact during long gateway requests. */
function setSyncProgress(message) {
  state.syncProgress = message;
  updateSyncStatus(root, message);
}

function rerenderContent() {
  const el = document.querySelector('#main-content');
  if (el) el.innerHTML = content();
  mountInteractiveScatter();
  scrollAfterNavigation(state);
}
function rerenderSidebar() {
  render();
}
async function loadPublicSourceStatus() {
  // A failed /status probe is NOT evidence that the read-only list API fails.
  // Keep the URL/refresh controls usable and let the actual request diagnose it.
  state.publicSourceStatus = 'checking';
  state.publicSourceReason = null;
  if (state.dialog?.kind === 'sync') render();
  const result = await checkPublicSourceStatus();
  if (state.dialog?.kind !== 'sync') return;
  state.publicSourceStatus = result.status;
  state.publicSourceReason = result.reason;
  render();
}
function showDialog(kind, extra = {}) {
  state.preview = null;
  if (kind === 'sync') {
    state.sync = null;
    state.pendingPublicImport = null;
    state.syncProgress = '';
    state.publicImportInput = '';
    state.publicSourceStatus = 'checking';
    state.publicSourceReason = null;
    state.publicSyncSelected = state.library.playlists
      .filter((p) => /^[1-9]\d{0,15}$/.test(String(p.id)))
      .map((p) => String(p.id));
  }
  if (kind === 'metadata') state.metadataProgress = '';
  state.dialog = { kind, ...extra };
  render();
  if (kind === 'sync') void loadPublicSourceStatus();
}
function closeDialog() {
  state.dialog = null;
  state.preview = null;
  state.pendingPublicImport = null;
  render();
}
function refreshMembership() {
  const el = document.querySelector('#membership-preview'),
    id = videoId(document.querySelector('#video-id')?.value);
  if (!el) return;
  const e = state.library.entries.filter((x) => x.video_id === id && x.present !== false);
  el.textContent = id
    ? e.length
      ? `所属済み：${e.map((x) => state.library.playlists.find((p) => p.id === x.playlist_id)?.name || x.playlist_id).join('・')}`
      : 'どのリストにも未登録'
    : '正しい動画IDを入力してください';
}
/** Load presets separately: a missing v0.9 SQL migration must not hide the library. */
async function reloadSavedSearches() {
  const { data, error } = await client
    .from('saved_searches')
    .select('id,name,view,filters,card_mode,created_at')
    .eq('owner_id', state.user.id)
    .order('created_at', { ascending: false })
    .limit(MAX_SAVED_SEARCHES + 1);

  if (error) throw error;
  state.savedSearches = data || [];
  state.savedSearchesError = '';
  state.savedSearchesLoaded = true;
}

async function refresh() {
  state.library = await loadLibrary(state.user.id);
  if (!state.savedSearchesLoaded) {
    try {
      await reloadSavedSearches();
    } catch (error) {
      console.warn('検索条件の読み込みに失敗:', error);
      state.savedSearchesError = '検索条件の保存にはv0.9のSQL適用が必要です';
      state.savedSearchesLoaded = true;
    }
  }
  render();
}

/** Save the current listing as one authenticated user's reusable search. */
async function saveSearchPreset() {
  if (state.busy) return;
  const preset = createSearchPreset({
    name: document.querySelector('#saved-search-name')?.value,
    view: state.view,
    filters: state.filters,
    cardMode: state.cardMode,
  });
  const sameName = state.savedSearches.find((item) => item.name === preset.name);
  if (sameName && !confirm(`「${preset.name}」を現在の条件で上書きしますか？`)) return;
  if (!sameName && state.savedSearches.length >= MAX_SAVED_SEARCHES) {
    throw new Error(`保存条件は最大${MAX_SAVED_SEARCHES}件です。古い条件を削除してください。`);
  }

  state.busy = true;
  try {
    const row = { ...preset, owner_id: state.user.id, updated_at: new Date().toISOString() };
    const query = sameName
      ? client
          .from('saved_searches')
          .update(row)
          .eq('id', sameName.id)
          .eq('owner_id', state.user.id)
      : client.from('saved_searches').insert(row);
    const { error } = await query;
    if (error) throw new Error(`検索条件を保存できません: ${error.message}`);
    await reloadSavedSearches();
    state.activeSavedSearchId =
      state.savedSearches.find((item) => item.name === preset.name)?.id || '';
    closeDialog();
    toast(`検索条件「${preset.name}」を保存しました`);
  } finally {
    state.busy = false;
  }
}

function useSearchPreset(id) {
  if (!id) {
    state.activeSavedSearchId = '';
    rerenderContent();
    return;
  }
  const preset = state.savedSearches.find((item) => item.id === id);
  if (!preset) return toast('保存条件が見つかりません。ページを再読み込みしてください', true);
  applySearchPreset(state, preset);
  render();
}

async function deleteSearchPreset() {
  const preset = state.savedSearches.find((item) => item.id === state.activeSavedSearchId);
  if (!preset) return;
  if (
    !confirm(`保存検索「${preset.name}」を削除しますか？\n現在の検索結果や動画データは消えません。`)
  )
    return;
  const { error } = await client
    .from('saved_searches')
    .delete()
    .eq('owner_id', state.user.id)
    .eq('id', preset.id);
  if (error) throw new Error(`保存条件を削除できません: ${error.message}`);
  state.activeSavedSearchId = '';
  await reloadSavedSearches();
  rerenderContent();
  toast('保存条件を削除しました');
}

function exportFilteredCsv() {
  const { rows } = selectLibraryResults(state);
  if (!rows.length) return toast('書き出す動画がありません', true);
  const csv = makeLibraryCsv(rows);
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `nico-shelf-search-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`絞り込み結果 ${rows.length}件をCSVに書き出しました`);
}

function surpriseMe() {
  const video = chooseRandomVideo(selectLibraryResults(state).rows);
  if (!video) return toast('条件に合う動画がありません', true);
  showDialog('detail', { id: video.id });
}

async function enrichOne(id, { refresh = false } = {}) {
  if (!nicoBridge.connected) throw new Error('ニコニコのタブへ接続してください');
  const local = state.library.videos.find((x) => x.id === id);
  if (!local) throw new Error(`${id} はDBにありません。先に同期または登録してください。`);
  const remote = await nicoBridge.request('metadata', { videoId: id }, 35000);
  if (!remote || remote.id !== id) throw new Error('取得動画IDが一致しません');
  const inferred = inferredVoicesFromTags(remote.tags);
  const patch = mergeMetadata(local, { ...remote, voices: inferred }, { refresh });
  const { error } = await client
    .from('videos')
    .update(patch)
    .eq('owner_id', state.user.id)
    .eq('id', id);
  if (error) throw new Error(`${id}：保存失敗 ${error.message}`);
  Object.assign(local, patch);
  return patch;
}
async function enrichBatch(ids, { limit = 15 } = {}) {
  const unique = [...new Set(ids)].slice(0, limit);
  const failures = [];
  let ok = 0;
  for (const [i, id] of unique.entries()) {
    state.metadataProgress = `${i + 1}/${unique.length}：${id} の動画情報を取得しています…`;
    if (state.dialog?.kind === 'metadata') render();
    try {
      await enrichOne(id);
      ok++;
    } catch (err) {
      failures.push(`${id}: ${err.message}`);
    }
  }
  return { ok, failures, remaining: ids.length - unique.length };
}
async function enrichMissing() {
  if (state.busy) return;
  if (!nicoBridge.connected) return connectNico();
  const ids = state.library.videos.filter((v) => needsMetadata(v)).map((v) => v.id);
  if (!ids.length) {
    toast('補完待ちの動画はありません');
    return;
  }
  state.busy = true;
  render();
  try {
    const result = await enrichBatch(ids, { limit: 15 });
    await refresh();
    state.metadataProgress = `補完成功 ${result.ok}件・取得失敗 ${result.failures.length}件。${result.remaining ? `ほか${result.remaining}件は次回取得できます。` : ''}`;
    if (result.failures.length) state.metadataProgress += ` 失敗例：${result.failures[0]}`;
    toast(
      result.ok
        ? `${result.ok}件のメタデータを補完しました`
        : '補完できませんでした。取得元の状態を確認してください',
      !result.ok,
    );
  } finally {
    state.busy = false;
    render();
  }
}
async function enrichSingle() {
  const id = state.dialog?.id;
  if (!id || state.busy) return;
  state.busy = true;
  render();
  try {
    await enrichOne(id);
    await refresh();
    state.dialog = { kind: 'detail', id };
    render();
    toast(`${id} の動画情報を補完しました`);
  } finally {
    state.busy = false;
    render();
  }
}
async function login() {
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname },
  });
  if (error) toast(`Googleログインに失敗: ${error.message}`, true);
}
async function toggleFavorite(id) {
  const original = state.library.meta.find((x) => x.video_id === id);
  const row = {
    owner_id: state.user.id,
    video_id: id,
    favorite: !original?.favorite,
    rating: original?.rating || 0,
    memo: original?.memo || '',
    personal_tags: original?.personal_tags || '',
    verified_voice: original?.verified_voice || '',
    verified_composer: original?.verified_composer || '',
    updated_at: new Date().toISOString(),
  };
  const { error } = await client.from('user_meta').upsert(row, { onConflict: 'owner_id,video_id' });
  if (error) throw error;
  const i = state.library.meta.findIndex((x) => x.video_id === id);
  i >= 0 ? state.library.meta.splice(i, 1, row) : state.library.meta.push(row);
  rerenderContent();
}
async function saveMeta() {
  const id = state.dialog.id,
    row = {
      owner_id: state.user.id,
      video_id: id,
      rating: Number(document.querySelector('#meta-rating').value),
      favorite: document.querySelector('#meta-fav').value === '1',
      memo: document.querySelector('#meta-memo').value.slice(0, 10000),
      personal_tags: document.querySelector('#meta-tags').value.slice(0, 500),
      verified_voice: document.querySelector('#meta-voice').value.slice(0, 500),
      verified_composer: document.querySelector('#meta-composer').value.slice(0, 500),
      updated_at: new Date().toISOString(),
    };

  const { error } = await client.from('user_meta').upsert(row, { onConflict: 'owner_id,video_id' });
  if (error) throw error;
  closeDialog();
  await refresh();
  toast('メモと評価を保存しました');
}
async function savePlaylist() {
  const name = document.querySelector('#playlist-name')?.value.trim();
  if (!name) throw new Error('名前を入力してください');
  const id = `local-${crypto.randomUUID()}`;
  const { error } = await client.from('playlists').insert({ owner_id: state.user.id, id, name });
  if (error) throw error;
  closeDialog();
  await refresh();
  toast('マイリストを作成しました（DBのみ）');
}
function captureAddForm() {
  if (state.dialog?.kind !== 'add') return;
  const d = state.dialog;
  d.vid = document.querySelector('#video-id')?.value || d.vid || '';
  d.title = document.querySelector('#video-title')?.value || '';
  d.target = document.querySelector('#target-playlist')?.value || 'auto';
  d.allowDuplicate = Boolean(document.querySelector('#allow-duplicate')?.checked);
}
async function connectNico() {
  if (state.busy) return;
  const fromSync = state.dialog?.kind === 'sync';
  const fromMetadata = state.dialog?.kind === 'metadata';
  captureAddForm();
  state.busy = true;
  state.connectingNico = true;
  if (fromSync) state.syncProgress = '接続待ち：ニコニコのタブで「接続を許可」してください';
  render();
  try {
    nicoBridge.disconnect();
    await nicoBridge.connect();
    toast('ニコニコのタブに接続できました');
  } finally {
    state.busy = false;
    state.connectingNico = false;
    render();
  }
  if (fromSync && state.dialog?.kind === 'sync') await syncFromNico();
  if (fromMetadata && state.dialog?.kind === 'metadata') await enrichMissing();
}
async function probeNico() {
  if (state.busy) return;
  captureAddForm();
  const id = videoId(state.dialog.vid);
  if (!id) throw new Error('正しい動画IDを入力してください');
  const lists = registrationLists(state.library.playlists);
  if (!lists.length) throw new Error('同期対象のニコニコマイリストがありません');
  state.busy = true;
  render();
  try {
    const result = await nicoBridge.request(
      'inspect',
      { videoId: id, lists: lists.map((p) => ({ id: p.id, name: p.name })) },
      85000,
    );
    if (!Array.isArray(result) || result.length !== lists.length)
      throw new Error('不完全な登録状況です。再取得してください');
    if (state.dialog?.kind === 'add') state.dialog.probe = { videoId: id, lists: result };
    toast('ニコニコの登録状況を確認しました');
  } finally {
    state.busy = false;
    render();
  }
}
async function writeConfirmedRegistration(vid, remote) {
  if (!remote?.confirmed || remote.videoId !== vid)
    throw new Error('ニコニコ登録結果を確認できません');
  const pl = state.library.playlists.find((p) => p.id === remote.listId);
  if (!pl) throw new Error('登録先がDBにありません。差分同期してください');
  if (!state.library.videos.some((v) => v.id === vid)) {
    const title = String(state.dialog?.title || remote.title || vid).slice(0, 220);
    const { error } = await client
      .from('videos')
      .insert({ owner_id: state.user.id, id: vid, title: title || vid });
    if (error && error.code !== '23505') throw error;
  }
  const numbers = state.library.entries
    .filter((e) => e.playlist_id === pl.id && e.present !== false)
    .map((e) => Number(e.position))
    .filter(Number.isFinite);
  const position = (numbers.length ? Math.min(...numbers) : 1) - 1;
  const { error } = await client
    .from('entries')
    .upsert(
      { owner_id: state.user.id, playlist_id: pl.id, video_id: vid, position, present: true },
      { onConflict: 'owner_id,playlist_id,video_id' },
    );
  if (error) throw error;
}
async function registerInNico() {
  if (state.busy) return;
  captureAddForm();
  const d = state.dialog,
    id = videoId(d?.vid);
  if (!id) throw new Error('正しい動画IDを入力してください');
  if (!d.probe || d.probe.videoId !== id) throw new Error('先に登録状況を確認してください');
  const decision = registrationDecision(d.probe.lists, id, d.target || 'auto', d.allowDuplicate);
  if (
    !confirm(
      `ニコニコ動画 ${id} を「${decision.target.name}」へ登録します。\n\nログイン中のニコニコアカウントと登録先が正しいことを確認してください。`,
    )
  )
    return;
  state.busy = true;
  render();
  try {
    let remote;
    try {
      remote = await nicoBridge.request(
        'register',
        {
          videoId: id,
          lists: registrationLists(state.library.playlists).map((p) => ({
            id: p.id,
            name: p.name,
          })),
          targetId: d.target || 'auto',
          allowDuplicate: d.allowDuplicate,
        },
        105000,
      );
    } catch (err) {
      throw new Error(`${err.message}。ニコニコ側の登録を確認するまで再操作しないでください`);
    }
    try {
      await writeConfirmedRegistration(id, remote);
      state.dialog = null;
      await refresh();
      try {
        await enrichOne(id);
        await refresh();
        toast(`「${remote.listName}」に登録し、動画情報も補完しました`);
      } catch (err) {
        toast(`登録とDB反映は成功。詳細取得のみ失敗：${err.message}`, true);
      }
    } catch (err) {
      throw new Error(
        `ニコニコには登録できましたが、Supabaseの更新に失敗しました：${err.message}。差分同期でDBを更新してください（再登録しないでください）`,
      );
    }
  } finally {
    state.busy = false;
    render();
  }
}
async function saveVideo() {
  const id = videoId(document.querySelector('#video-id')?.value);
  if (!id) throw new Error('正しい動画IDまたはURLを入力してください');
  const playlist_id = document.querySelector('#target-playlist')?.value;
  if (!playlist_id || playlist_id === 'auto')
    throw new Error('DBだけに登録する場合は登録先を手動で選んでください');
  const current = state.library.entries.filter((x) => x.video_id === id && x.present !== false);
  if (current.some((x) => x.playlist_id === playlist_id))
    throw new Error('このマイリストにはすでに登録されています');
  if (current.length && !document.querySelector('#allow-duplicate').checked)
    throw new Error(
      `別リストに登録済みです：${current.map((x) => state.library.playlists.find((p) => p.id === x.playlist_id)?.name || x.playlist_id).join('・')}（重複許可が必要）`,
    );
  const count = state.library.entries.filter(
    (x) => x.playlist_id === playlist_id && x.present !== false,
  ).length;
  if (count >= 500) throw new Error('選択したリストは500件に達しています');
  if (!state.library.videos.some((v) => v.id === id)) {
    const title = document.querySelector('#video-title').value.trim() || id;
    const { error } = await client.from('videos').insert({ owner_id: state.user.id, id, title });
    if (error) throw error;
  }
  const existingPositions = state.library.entries
    .filter((x) => x.playlist_id === playlist_id && x.present !== false)
    .map((e) => Number(e.position) || 0);
  // v0.3 initial data uses position 1 for the first (typically newest) displayed item.
  // New local registrations go before the current first item without rewriting the entire list.
  const nextPos = (existingPositions.length ? Math.min(...existingPositions) : 1) - 1;
  const { error } = await client
    .from('entries')
    .upsert(
      { owner_id: state.user.id, playlist_id, video_id: id, position: nextPos, present: true },
      { onConflict: 'owner_id,playlist_id,video_id' },
    );
  if (error) throw error;
  closeDialog();
  await refresh();
  toast('DBに登録しました。ニコニコ本体には反映されていません');
}
function exportJson() {
  const { playlists, videos, entries, meta } = state.library;
  const strip = (x) => {
    const { owner_id, ...data } = x;
    return data;
  };
  const payload = {
    format: 'nico-shelf-v0.9',
    exported_at: new Date().toISOString(),
    playlists: playlists.map(strip),
    videos: videos.map(strip),
    entries: entries.map(strip),
    user_meta: meta.map(strip),
    saved_searches: state.savedSearches.map(({ name, view, filters, card_mode }) => ({
      name,
      view,
      filters,
      card_mode,
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `nico-shelf-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function handleFile(file) {
  if (!file) return;
  const t = await file.text();
  state.preview = file.name.toLowerCase().endsWith('.csv')
    ? csvToImport(t)
    : normalizeImport(JSON.parse(t));
  state.dialog = { kind: 'import' };
  render();
  toast('ファイルを読み取りました。内容を確認してインポートしてください');
}
async function runImport() {
  if (!state.preview || state.busy) return;
  const rows = state.preview;
  const yes = confirm(
    `${rows.videos.length}動画・${rows.entries.length}件${rows.savedSearches?.length ? `・検索条件${rows.savedSearches.length}件` : ''}をSupabaseに保存します。\n同じ動画・リストは上書き更新されます。よろしいですか？`,
  );
  if (!yes) return;
  state.busy = true;
  document.querySelector('#run-import').disabled = true;
  const status = document.querySelector('#import-status');
  try {
    await importRows(state.user.id, rows, (table, n, total) => {
      if (status) status.textContent = `インポート中：${table} ${n}/${total}`;
    });
    let presetError = '';
    if (rows.savedSearches?.length) {
      const presets = rows.savedSearches.map((preset) => ({ ...preset, owner_id: state.user.id }));
      const { error } = await client
        .from('saved_searches')
        .upsert(presets, { onConflict: 'owner_id,name' });
      if (error) presetError = `検索条件の復元のみ失敗：${error.message}`;
    }
    state.preview = null;
    state.dialog = null;
    state.savedSearchesLoaded = false;
    await refresh();
    toast(
      presetError || `${rows.videos.length}動画のインポートが完了しました`,
      Boolean(presetError),
    );
  } finally {
    state.busy = false;
    if (document.querySelector('#run-import'))
      document.querySelector('#run-import').disabled = false;
  }
}
/**
 * No-extension sync for explicitly public playlists. The public read-only
 * Worker endpoint fetches published data; Supabase/RLS still protect DB writes.
 */
async function syncFromPublic(onlyLists = null) {
  if (state.busy || state.dialog?.kind !== 'sync') return;
  const ids = new Set(state.publicSyncSelected || []);
  const lists =
    onlyLists ??
    state.library.playlists.filter(
      (p) => ids.has(String(p.id)) && /^[1-9]\d{0,15}$/.test(String(p.id)),
    );
  if (!lists.length) throw new Error('公開マイリストを1つ以上選択してください');

  state.busy = true;
  state.sync = null;
  setSyncProgress('公開マイリストを取得しています…');
  render();
  try {
    const snapshot = await fetchPublicSnapshot(lists, {
      fetchPage: fetchAuthenticatedPublicPage,
      onProgress: (message) => {
        setSyncProgress(message);
      },
    });
    // Obtain current DB state *after* the network call: another device might
    // have synced or registered videos while we were fetching pages.
    const latest = await loadLibrary(state.user.id);
    state.library = latest;
    state.sync = diffSnapshot(snapshot, latest);
    state.syncProgress = `公開マイリスト ${lists.length}件を取得しました。内容を確認してください。`;
    toast(`公開同期：追加${state.sync.added}件・削除候補${state.sync.removed}件`);
  } catch (error) {
    state.sync = null;
    state.syncProgress = `取得失敗：${error.message}。DBは変更していません。非公開リストは下の従来連携で同期してください。`;
    throw error;
  } finally {
    state.busy = false;
    render();
  }
}

/** Preview a public list completely BEFORE creating anything in Supabase. */
async function importPublicPlaylist() {
  if (state.busy || state.dialog?.kind !== 'sync') return;
  const requested =
    state.publicImportInput || document.querySelector('#public-sync-new-list')?.value || '';
  const id = parsePublicMylistId(requested);
  if (!id) throw new Error('ニコニコの公開マイリストURLまたは数値IDを入力してください');
  // A URL should work the same whether this is the first import or a refresh.
  const existing = findExistingPublicPlaylist(state.library.playlists, id);
  if (existing) return syncFromPublic([existing]);
  state.busy = true;
  state.pendingPublicImport = null;
  setSyncProgress(`${id} の公開マイリストを読み取っています…`);
  render();
  try {
    const remote = await fetchPublicMylist(id, {
      fetchPage: fetchAuthenticatedPublicPage,
      onProgress: setSyncProgress,
    });
    state.pendingPublicImport = remote;
    state.publicImportInput = '';
    state.syncProgress = `取得成功。${remote.items.length}件を確認して、追加を確定してください。`;
  } catch (error) {
    state.syncProgress = `取得できませんでした：${error.message}。ライブラリは変更していません。`;
    throw error;
  } finally {
    state.busy = false;
    render();
  }
}

/** Explicit confirmation: insert list, then apply its validated snapshot. */
async function confirmPublicImport() {
  const remote = state.pendingPublicImport;
  if (state.busy || state.dialog?.kind !== 'sync' || !remote) return;
  // Existing lists must never be overwritten by new-list import.
  const latest = await loadLibrary(state.user.id);
  if (latest.playlists.some((p) => String(p.id) === remote.id)) {
    state.library = latest;
    state.pendingPublicImport = null;
    render();
    throw new Error('別の端末でこのリストが作成されました。再度同期画面を開いてください');
  }
  const snapshot = snapshotFromBridgeParts([{ id: remote.id, name: remote.name }], [remote]);
  state.busy = true;
  render();
  let listCreated = false;
  try {
    const { error: insertError } = await client.from('playlists').insert({
      owner_id: state.user.id,
      id: remote.id,
      name: remote.name,
    });
    if (insertError) throw new Error(`マイリストを作成できません: ${insertError.message}`);
    listCreated = true;
    const { data, error } = await client.rpc('apply_mylist_snapshot_v2', {
      p_snapshot: toRpcPayload(snapshot),
    });
    if (error || !data?.ok)
      throw new Error(`動画の登録に失敗しました: ${error?.message || '不明なエラー'}`);
    state.pendingPublicImport = null;
    state.dialog = null;
    await refresh();
    toast(`「${remote.name}」の${remote.items.length}件を取り込みました`);
  } catch (error) {
    if (listCreated) {
      // A partly completed two-step operation may leave an EMPTY playlist.
      // Do not silently delete it or mark any old entries absent.
      state.pendingPublicImport = null;
      state.syncProgress = `リストだけ作成された可能性があります。データと設定で確認してください：${error.message}`;
    }
    throw error;
  } finally {
    state.busy = false;
    render();
  }
}
function cancelPublicImport() {
  state.pendingPublicImport = null;
  state.syncProgress = '';
  render();
}

/** One-click read-only sync, reusing the proven v0.7.0 bridge. */
async function syncFromNico() {
  if (state.busy || state.dialog?.kind !== 'sync') return;
  if (!nicoBridge.connected) return connectNico();
  const lists = state.library.playlists.filter((p) => /^[0-9]{1,16}$/.test(String(p.id)));
  if (!lists.length)
    throw new Error('ニコニコのマイリストがありません。先にインポートしてください。');
  if (lists.length > 25) throw new Error('同期できるリストは25個までです');
  state.sync = null;
  state.syncProgress = '取得の準備中…';
  state.busy = true;
  render();
  const replies = [];
  try {
    for (let i = 0; i < lists.length; i++) {
      if (state.dialog?.kind !== 'sync')
        throw new Error('同期画面が閉じられたため処理を中止しました');
      const item = lists[i];
      state.syncProgress = `ニコニコから取得中：${i + 1}/${lists.length}「${item.name}」`;
      render();
      const result = await nicoBridge.request(
        'snapshot-list',
        { id: item.id, name: item.name },
        90000,
      );
      replies.push(result);
    }
    const snapshot = snapshotFromBridgeParts(lists, replies);
    // DB can have changed while the network was being read; refresh before diffing.
    state.syncProgress = '取得完了。Supabaseの最新データと照合しています…';
    render();
    const latest = await loadLibrary(state.user.id);
    state.library = latest;
    state.sync = diffSnapshot(snapshot, latest);
    state.syncProgress = `全${lists.length}リストの取得が完了しました。差分を確認してください。`;
    toast(`差分を確認しました：追加${state.sync.added}件・削除${state.sync.removed}件`);
  } catch (err) {
    state.sync = null;
    state.syncProgress = '取得失敗：一部の結果は破棄しました。DBは更新していません。';
    throw err;
  } finally {
    state.busy = false;
    render();
  }
}
async function handleSyncFile(file) {
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) throw new Error('同期ファイルが大きすぎます（4MB以下）');
  const snapshot = normalizeSnapshot(JSON.parse(await file.text()));
  state.sync = diffSnapshot(snapshot, state.library);
  state.dialog = { kind: 'sync' };
  render();
  toast(`差分を確認しました：追加${state.sync.added}件・削除${state.sync.removed}件`);
}
async function applySync() {
  if (state.busy || !state.sync) return;
  const snapshot = state.sync.snapshot;
  if (Date.now() - Date.parse(snapshot.captured_at) > 24 * 3600 * 1000)
    throw new Error('取得から24時間を超えています。新しい一覧を取得してください。');
  // Prevent confirming a stale diff against local data changed on another device.
  const current = await loadLibrary(state.user.id);
  const latest = diffSnapshot(snapshot, current);
  if (diffSignature(latest) !== diffSignature(state.sync)) {
    state.library = current;
    state.sync = latest;
    render();
    throw new Error('他の端末でDBが更新されました。差分を再確認してください。');
  }
  const highRemoval = latest.rows.filter(
    (r) => r.removed.length >= 10 && r.removed.length >= Math.max(1, r.localCount) * 0.2,
  );
  if (highRemoval.length) {
    const input = prompt(
      `大量の削除候補があります（${highRemoval.map((r) => `${r.name}: ${r.removed.length}件`).join(' / ')}）。\n取得元のニコニコアカウントとリストを再確認してください。\n続行する場合のみ「大量削除」と入力してください。`,
    );
    if (input !== '大量削除') return;
  }
  if (
    !confirm(
      `選択した${latest.rows.length}リストを同期します。\n追加${latest.added}件・削除扱い${latest.removed}件・並び順変更${latest.reordered}件\n\n削除扱いの動画・メモはDBから物理削除しません。続けますか？`,
    )
  )
    return;
  const newIds = [...new Set(latest.rows.flatMap((r) => r.added.map((x) => x.video_id)))].filter(
    (id) => !current.videos.some((v) => v.id === id),
  );
  state.busy = true;
  render();
  try {
    const { data, error } = await client.rpc('apply_mylist_snapshot_v2', {
      p_snapshot: toRpcPayload(snapshot),
    });
    if (error)
      throw new Error(
        `Supabaseの同期に失敗: ${error.message}。SQLマイグレーションの適用も確認してください。`,
      );
    if (!data?.ok) throw new Error('同期処理から正常な完了応答がありません');
    state.sync = null;
    state.dialog = null;
    await refresh();
    // Fill details for a small number of *new* videos only, never the entire archive.
    let note = '';
    if (nicoBridge.connected && newIds.length) {
      const enriched = await enrichBatch(newIds, { limit: 5 });
      note = ` / 新規動画情報 ${enriched.ok}件補完`;
      if (enriched.failures.length) note += `（${enriched.failures.length}件取得不可）`;
      if (enriched.remaining) note += `（残りは設定画面から補完）`;
      await refresh();
    }
    toast(`同期成功：${latest.added}件追加・${latest.removed}件を削除済み扱い${note}`);
  } finally {
    state.busy = false;
    render();
  }
}
async function eraseData() {
  if (!confirm('このアカウントのライブラリをすべて削除します。元に戻せません。よろしいですか？'))
    return;
  const answer = prompt('誤操作防止のため「削除」と入力してください');
  if (answer !== '削除') return;
  // Saved searches contain personal preferences and must be deleted too.
  // Pre-migration installations have no saved_searches table, so skip it there.
  if (!state.savedSearchesError) {
    const { error } = await client.from('saved_searches').delete().eq('owner_id', state.user.id);
    if (error) throw new Error(`saved_searches: ${error.message}`);
  }
  for (const table of ['user_meta', 'entries', 'videos', 'playlists']) {
    const { error } = await client.from(table).delete().eq('owner_id', state.user.id);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  state.savedSearches = [];
  state.savedSearchesLoaded = false;
  state.activeSavedSearchId = '';
  await refresh();
  toast('このアカウントのライブラリと保存検索を削除しました');
}
async function guard(fn) {
  try {
    await fn();
  } catch (e) {
    console.error(e);
    toast(e.message || '処理に失敗しました', true);
  }
}
registerEventHandlers({
  root,
  state,
  client,
  nicoBridge,
  render,
  rerenderContent,
  showDialog,
  closeDialog,
  refreshMembership,
  actions: {
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
    confirmPublicImport,
    cancelPublicImport,
    checkPublicSourceStatus: loadPublicSourceStatus,
    probeNico,
    registerInNico,
    runImport,
    applySync,
    exportJson,
    eraseData,
    captureAddForm,
    handleFile,
    handleSyncFile,
    saveSearchPreset,
    deleteSearchPreset,
    useSearchPreset,
    exportFilteredCsv,
    surpriseMe,
  },
});

async function start() {
  if (!configured) {
    render();
    return;
  }
  try {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    state.user = data.session?.user || null;
    render();
    if (state.user) await guard(refresh);
    client.auth.onAuthStateChange(async (event, session) => {
      // No awaited Supabase call here: avoids auth-lock deadlocks. Refresh later.
      const before = state.user?.id || null;
      state.user = session?.user || null;
      if (before !== state.user?.id) {
        state.library = { playlists: [], videos: [], entries: [], meta: [] };
        state.savedSearches = [];
        state.savedSearchesLoaded = false;
        state.savedSearchesError = '';
        state.activeSavedSearchId = '';
        state.view = 'dashboard';
        state.dialog = null;
        render();
        if (state.user) setTimeout(() => guard(refresh), 0);
      }
    });
  } catch (e) {
    root.innerHTML = `<div class="setup-state"><h1>接続できませんでした</h1><p>${esc(e.message)}</p><button class="btn primary" id="retry">再読み込み</button></div>`;
    document.querySelector('#retry')?.addEventListener('click', () => location.reload());
  }
}
start();
