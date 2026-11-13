import { esc, array, formatCount, formatDate, formatDuration, sortRows } from '../lib.js';
import {
  canonicalVoices,
  rawVoices,
  voiceStats,
  voiceVariants,
  GENRE_LABELS,
  MOOD_LABELS,
  genreLabels,
  moodLabels,
} from '../discovery.js';
import { buildLibraryRows, countLibrary } from '../app/library.js';
import { APP_VERSION, VIEWS, SORTS, NAV_ICONS } from '../app/state.js';
import { safeThumb } from './media.js';
import { selectLibraryResults } from '../app/search.js';
import { renderTrends } from './trends.js';
import { renderScatter } from './scatter.js';
import { colorForCharacter } from '../app/character-colors.js';

/**
 * Pure-ish HTML templates: read the injected UI state, but never write to the DB.
 * Button IDs and data-* attributes remain compatible with the controller.
 */
export function createViewRenderer({ state, renderDialog }) {
  function makeRows() {
    return buildLibraryRows(state.library);
  }
  function navItem(id, label, ico, active) {
    return `<button class="nav-item ${active ? 'is-active' : ''}" data-view="${esc(id)}" ${active ? 'aria-current="page"' : ''}><span class="nav-icon">${ico}</span><span>${esc(label)}</span></button>`;
  }
  function counts() {
    return countLibrary(state.library);
  }
  function shell() {
    const p = state.library.playlists,
      all = state.library.entries.filter((e) => e.present !== false);
    return `<div class="shell">
    <aside class="sidebar">
      <button class="brand" data-view="dashboard" aria-label="トップへ"><span class="brand-mark">♫</span><span><b>NICO SHELF</b><small>YOUR MUSIC ARCHIVE</small></span></button>
      <div class="menu-label">DISCOVER</div>
      <nav>${['dashboard', 'library', 'trends', 'scatter', 'duplicates', 'favorites'].map((x) => navItem(x, VIEWS[x], NAV_ICONS[x], state.view === x)).join('')}</nav>
      <div class="menu-label playlist-head">MY LISTS <span>${p.length}</span></div>
      <nav class="playlist-menu">${p.map((x) => `<button class="nav-item ${state.view === `playlist:${x.id}` ? 'is-active' : ''}" data-view="playlist:${esc(x.id)}"><span class="playlist-dot"></span><span class="text-ellipsis">${esc(x.name)}</span><small>${all.filter((e) => e.playlist_id === x.id).length}</small></button>`).join('') || '<p class="nav-help">インポートすると表示されます</p>'}</nav>
      <div class="sidebar-foot"><button class="nav-item ${state.view === 'settings' ? 'is-active' : ''}" data-view="settings"><span class="nav-icon">⚙</span>データと設定</button><div class="small-note">NICO SHELF <b>v${APP_VERSION} β</b><br>クラウド管理・非公式アプリ</div></div>
    </aside>
    <div class="workspace">
      <header class="topbar"><div class="mobile-logo">♫ <b>NICO SHELF</b></div><div class="top-center"><span class="online-indicator"></span>プライベートライブラリ</div>
        <div class="top-actions"><span class="account-avatar">${esc((state.user.user_metadata?.name || state.user.email || 'U').charAt(0).toUpperCase())}</span><span class="account-name">${esc(state.user.user_metadata?.name || state.user.email || 'ユーザー')}</span><button class="btn-ghost small" id="logout">ログアウト</button></div></header>
      <main id="main-content" class="main-content">${content()}</main>
      <footer class="footer"><span>NICO SHELF · MY MUSIC ARCHIVE</span><span>ニコニコ動画の公式サービスではありません</span></footer>
    </div>
    <nav class="mobile-bottom-nav" aria-label="モバイル用ナビゲーション">
      ${['dashboard', 'library', 'trends', 'scatter', 'favorites', 'settings']
        .map(
          (id) => `
        <button type="button" class="mobile-tab ${state.view === id || (id === 'library' && (state.view.startsWith('playlist:') || state.view === 'duplicates')) ? 'is-active' : ''}"
          data-view="${esc(id)}" aria-current="${state.view === id ? 'page' : 'false'}">
          <span class="mobile-tab-icon" aria-hidden="true">${NAV_ICONS[id]}</span>
          <span>${esc(VIEWS[id] === 'データと設定' ? '設定' : VIEWS[id] === 'ダッシュボード' ? 'ホーム' : VIEWS[id] === '音楽の変遷' ? '変遷' : VIEWS[id] === 'お気に入り' ? 'お気に入り' : VIEWS[id])}</span>
        </button>`,
        )
        .join('')}
    </nav>
    ${!state.dialog ? '<button type="button" class="back-to-top" id="back-to-top" aria-label="ページ上部へ戻る"><span aria-hidden="true">↑</span>上へ</button>' : ''}
    ${state.dialog ? renderDialog() : ''}
  </div>`;
  }
  function hero(kicker, title, desc, action = '') {
    return `<div class="heading"><div><div class="eyebrow">${esc(kicker)}</div><h1>${esc(title)}</h1><p>${esc(desc)}</p></div>${action}</div>`;
  }
  function statsCards() {
    const c = counts();
    return `<div class="stat-grid">
  ${[
    [c.videos, 'VIDEO LIBRARY', '保存済み動画'],
    [c.entries, 'PLAYLIST ENTRIES', '登録件数'],
    [c.duplicates, 'DUPLICATED', '複数リストに所属'],
    [state.library.playlists.length, 'MYLISTS', '管理中のリスト'],
  ]
    .map(
      ([n, label, sub], i) =>
        `<div class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-symbol">${['◈', '≡', '◎', '♫'][i]}</span></div><strong>${formatCount(n)}</strong><small>${sub}</small></div>`,
    )
    .join('')}
  </div>`;
  }
  function barList(data, noun = '曲', facetKind = '', useCharacterColors = false) {
    const max = Math.max(1, ...data.map((entry) => entry[1]));
    if (!data.length) return '<div class="empty-sm">まだ集計できる情報がありません</div>';

    return data
      .map(([name, count], index) => {
        const isFilter = facetKind === 'genre' || facetKind === 'mood';
        const opening = isFilter
          ? `<button class="bar-row facet-row" data-facet-kind="${facetKind}" data-facet-value="${esc(name)}" title="${esc(name)}の曲へ絞り込む">`
          : '<div class="bar-row">';
        return `${opening}<span class="bar-index">${String(index + 1).padStart(2, '0')}</span>
      <span class="bar-name" title="${esc(name)}">${esc(name)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${Math.min(100, (100 * count) / max)}%;${useCharacterColors ? `background:${colorForCharacter(name)};` : ''}"></span></span>
      <span class="bar-num">${count}${noun}${isFilter ? ' ・絞り込む' : ''}</span>${isFilter ? '</button>' : '</div>'}`;
      })
      .join('');
  }
  function playlistVoiceMatrix(rows, playlists) {
    if (!playlists.length || !rows.length) return '';
    const ordered = [...playlists].sort((a, b) => {
      const am = a.name.match(/(\d+)$/),
        bm = b.name.match(/(\d+)$/);
      if (am && bm) return Number(am[1]) - Number(bm[1]);
      if (am) return -1;
      if (bm) return 1;
      return a.name.localeCompare(b.name, 'ja');
    });
    const count = state.voiceVisibleCount === 'all' ? Infinity : (state.voiceVisibleCount ?? 15);
    const voices = voiceStats(rows, state.voiceMode, count).map(([name]) => name);
    const totals = ordered.map(
      (p) => rows.filter((v) => v.memberships.some((m) => m.id === p.id)).length,
    );
    return `<section class="panel"><div class="panel-title"><div><span class="section-eyebrow">VOICE BY PLAYLIST</span><h2>マイリスト別・歌唱者の傾向</h2></div><span class="panel-note">収録割合（重複歌唱あり）・ランキングの表示人数に連動</span></div>
    <div class="matrix-wrap"><table class="voice-matrix"><thead><tr><th>歌唱者</th>${ordered.map((p, i) => `<th>${esc(p.name)}<small>${totals[i]}件</small></th>`).join('')}</tr></thead>
    <tbody>${voices
      .map(
        (name) =>
          `<tr><th>${esc(name)}</th>${ordered
            .map((p, i) => {
              const n = rows.filter(
                (v) =>
                  v.memberships.some((m) => m.id === p.id) &&
                  (state.voiceMode === 'raw' ? rawVoices(v) : canonicalVoices(v)).includes(name),
              ).length;
              const pct = totals[i] ? Math.round((1000 * n) / totals[i]) / 10 : 0;
              return `<td><span class="matrix-bar" style="width:${Math.min(100, pct)}%;background:${colorForCharacter(name)}44;border-left:3px solid ${colorForCharacter(name)}"></span><span class="matrix-value">${pct}% <small>(${n})</small></span></td>`;
            })
            .join('')}</tr>`,
      )
      .join('')}</tbody></table></div>
    <div class="panel-footnote">歌唱者名は名寄せルールに基づく表示です。原表記と手動修正は保持しています。</div>
  </section>`;
  }
  function dashboard(rows) {
    const creators = new Map();
    for (const r of rows)
      for (const x of new Set(array(r.producers).filter(Boolean)))
        creators.set(x, (creators.get(x) || 0) + 1);
    const topCreators = [...creators].sort((a, b) => b[1] - a[1]).slice(0, 7);
    const counted = (labels) => {
      const m = new Map();
      for (const r of rows) for (const n of new Set(labels(r))) m.set(n, (m.get(n) || 0) + 1);
      return [...m].sort((a, b) => b[1] - a[1]);
    };
    const genreRanking = counted(genreLabels).slice(0, 6),
      moodRanking = counted(moodLabels).slice(0, 6);
    const c = counts();
    const p = state.library.playlists;
    return `${hero('OVERVIEW', 'あなたの音楽の棚', '好きな曲を、探して、整理して、もっと知る。', `<div class="inline-actions"><button class="btn primary" data-action="sync">＋ マイリストを取り込む</button><button class="btn subtle" data-action="add">＋ 動画を登録</button><button class="btn subtle" data-action="import">⇩ ファイルを取り込む</button></div>`)}
    ${statsCards()}
    <div class="trend-entry-banner"><span><strong>♫ 音楽の変遷</strong><small>マイリストの順番・投稿年から、好きな曲の傾向を比較</small></span><button class="btn subtle" data-view="trends">分析を見る →</button></div>
    ${c.videos === 0 ? `<div class="welcome-banner"><div class="welcome-icon">♫</div><div><h2>最初のライブラリを作りましょう</h2><p>ニコニコの公開マイリストのURLを貼り付けて、内容を確認するだけ。追加するまでデータは保存されません。Googleアカウントごとに非公開で管理します。</p><div class="inline-actions"><button class="btn primary" data-action="sync">マイリストURLから取り込む</button><button class="btn subtle" data-action="import">ファイルから取り込む</button></div></div></div>` : ''}
    <div class="two-cols">
      <section class="panel"><div class="panel-title voice-rank-heading"><div><span class="section-eyebrow">VOICE RANKING</span><h2>歌唱者ランキング</h2></div><div class="voice-rank-controls"><label class="control-label compact">集計単位<select id="voice-mode"><option value="canonical" ${state.voiceMode === 'canonical' ? 'selected' : ''}>キャラクター別</option><option value="raw" ${state.voiceMode === 'raw' ? 'selected' : ''}>元の歌唱者表記</option></select></label><label class="control-label compact">表示人数<select id="voice-count">${[
        [5, '上位5'],
        [10, '上位10'],
        [15, '上位15'],
        [20, '上位20'],
        [30, '上位30'],
        ['all', '全員'],
      ]
        .map(
          ([num, label]) =>
            `<option value="${num}" ${(state.voiceVisibleCount ?? 15) === num ? 'selected' : ''}>${label}</option>`,
        )
        .join(
          '',
        )}</select></label></div></div>${barList(voiceStats(rows, state.voiceMode, state.voiceVisibleCount === 'all' ? Infinity : (state.voiceVisibleCount ?? 15)), '曲', '', true)}</section>
      <section class="panel"><div class="panel-title"><div><span class="section-eyebrow">MY PLAYLISTS</span><h2>マイリスト別の登録件数</h2></div><span class="panel-note">${p.length} lists</span></div>${barList(
        p.map((x) => [
          x.name,
          state.library.entries.filter((e) => e.playlist_id === x.id && e.present !== false).length,
        ]),
        '件',
      )}<div class="panel-bottom"><button class="text-btn" data-action="playlist">＋ マイリストを作成</button></div></section>
    </div>
    ${playlistVoiceMatrix(rows, p)}
    <div class="two-cols discover-charts">
      <section class="panel"><div class="panel-title"><div><span class="section-eyebrow">TAG GENRES</span><h2>メタデータから推定したジャンル</h2></div></div>${barList(genreRanking, '曲', 'genre')}</section>
      <section class="panel"><div class="panel-title"><div><span class="section-eyebrow">TAG MOODS</span><h2>メタデータから推定した雰囲気</h2></div></div>${barList(moodRanking, '曲', 'mood')}</section>
    </div>
    <p class="facet-disclaimer">※ジャンル・雰囲気は保存済みタグと概要欄の明示的な分類表記からの推定です（ジャンル ${rows.filter((r) => genreLabels(r).length).length}/${rows.length}曲、雰囲気 ${rows.filter((r) => moodLabels(r).length).length}/${rows.length}曲に根拠あり）。音声解析ではなく未分類曲もあります。各項目を押すとライブラリを絞り込めます。</p>
    <section class="panel"><div class="panel-title"><div><span class="section-eyebrow">RECENTLY PUBLISHED</span><h2>ライブラリ内の新着投稿</h2></div><button class="text-btn" data-view="library">すべて見る →</button></div>${cards(sortRows(rows, 'published_at', 'desc').slice(0, 5))}</section>`;
  }
  function cards(rows) {
    return `<div class="video-list ${state.cardMode === 'grid' ? 'as-grid' : ''}">${rows
      .map((v) => {
        const thumb = safeThumb(v.thumb);
        const dup = v.memberships.length > 1;
        return `<article class="video-card"><a class="cover" href="https://www.nicovideo.jp/watch/${encodeURIComponent(v.id)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(v.title || v.id)}をニコニコで視聴"><span class="cover-fallback">♫</span>${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-thumbnail />` : ''}<span class="duration">${formatDuration(v.duration)}</span></a>
      <div class="video-info"><div class="video-title-row"><a class="video-title" href="https://www.nicovideo.jp/watch/${encodeURIComponent(v.id)}" target="_blank" rel="noopener noreferrer" title="${esc(v.title || v.id)}"><span class="video-title-text">${esc(v.title || v.id)}</span><span class="external-arrow" aria-hidden="true">↗</span></a>${dup ? '<span class="dup-badge">重複</span>' : ''}</div>
      <div class="video-sub"><span>${esc(v.uploader || '投稿者不明')}</span><span class="sub-divider">·</span><span>${esc(v.id)}</span><span class="sub-divider">·</span><span>${formatDate(v.published_at)}</span></div>
      <div class="video-tags">${v.memberships.map((m) => `<span class="list-chip" title="取得時のリスト内順番: ${Number.isFinite(Number(m.position)) ? m.position : '不明'}">${esc(m.name)}</span>`).join('') || '<span class="empty-chip">未分類</span>'}<span class="voice-clip" title="${esc(rawVoices(v).join(' / '))}">${esc(canonicalVoices(v).slice(0, 3).join(' / '))}</span>${genreLabels(
        v,
      )
        .slice(0, 2)
        .map((g) => `<span class="facet-chip">${esc(g)}</span>`)
        .join('')}${moodLabels(v)
        .slice(0, 1)
        .map((g) => `<span class="mood-chip">${esc(g)}</span>`)
        .join('')}</div></div>
      <div class="video-stat"><span>▶ ${formatCount(v.views)}</span><span>♡ ${formatCount(v.likes)}</span></div>
      <div class="video-buttons"><button class="heart-btn ${v.userMeta?.favorite ? 'hearted' : ''}" title="お気に入り" aria-label="${esc(v.title || v.id)}をお気に入りに${v.userMeta?.favorite ? 'から外す' : '追加する'}" data-favorite="${esc(v.id)}">${v.userMeta?.favorite ? '♥' : '♡'}</button><button class="related-btn" title="関連する曲を探す" aria-label="${esc(v.title || v.id)}に関連する曲を探す" data-related="${esc(v.id)}">≋</button><button class="more-btn" title="メモと評価" aria-label="${esc(v.title || v.id)}のメモ・評価" data-detail="${esc(v.id)}">···</button></div></article>`;
      })
      .join('')}</div>`;
  }
  function listing(rows) {
    const inPlaylist = state.view.startsWith('playlist:');
    const forced = inPlaylist ? state.view.slice(9) : '';
    const playlist = forced || state.filters.playlist;
    const duplicate = state.view === 'duplicates',
      favorite = state.view === 'favorites';
    const { rows: sorted } = selectLibraryResults(state);
    const totalPages = Math.max(1, Math.ceil(sorted.length / 35));
    state.page = Math.min(state.page, totalPages);
    const pageRows = sorted.slice((state.page - 1) * 35, state.page * 35);
    const heading = inPlaylist
      ? state.library.playlists.find((x) => x.id === forced)?.name || 'マイリスト'
      : duplicate
        ? '重複した動画'
        : favorite
          ? 'お気に入り'
          : 'すべての動画';
    const help = inPlaylist
      ? 'このマイリストに登録されている動画'
      : duplicate
        ? '2つ以上のマイリストに所属している動画'
        : favorite
          ? '自分でお気に入りにした動画'
          : 'あなたのライブラリ全体を検索・並び替え';
    const voices = voiceStats(rows, 'canonical', 200).map(([name]) => name);
    const variants = state.filters.voice ? voiceVariants(rows, state.filters.voice) : [];
    const years = [
      ...new Set(
        rows.map((v) => String(v.published_at || '').slice(0, 4)).filter((v) => /^\d{4}$/.test(v)),
      ),
    ].sort((a, b) => b.localeCompare(a));
    const selectOptions = (values, current) =>
      values
        .map(
          (value) =>
            `<option value="${esc(value)}" ${current === value ? 'selected' : ''}>${esc(value)}</option>`,
        )
        .join('');
    return `${hero('LIBRARY', heading, help, `<button class="btn primary" data-action="add">＋ 動画を登録</button>`)}
  <div class="toolbar"><label class="search-field"><span>⌕</span><input id="search" type="search" placeholder="曲名・動画ID・歌唱者・タグ・メモを検索" value="${esc(state.filters.q)}" autocomplete="off" /></label>
    ${!inPlaylist ? `<label class="control-label">マイリスト<select id="list-filter"><option value="">すべて</option>${state.library.playlists.map((p) => `<option value="${esc(p.id)}" ${playlist === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : ''}
    <label class="control-label">並び替え<select id="sort-field">${Object.entries(SORTS)
      .map(
        ([key, val]) =>
          `<option value="${key}" ${state.filters.sort === key ? 'selected' : ''}>${esc(val)}</option>`,
      )
      .join('')}</select></label>
    <button class="btn btn-sort" id="sort-dir" title="昇順/降順を切替">${state.filters.order === 'desc' ? '↓' : '↑'}</button>
    <button class="btn subtle" id="sort-reset" title="ソートだけ初期化、絞り込みは維持">↺ リセット</button>
    <button class="btn subtle" id="toggle-card-mode" title="一覧とジャケット型表示を切り替え">${state.cardMode === 'list' ? '▦ ジャケット表示' : '≡ リスト表示'}</button>
  </div>
  <details class="library-extra-filters" ${state.filterPanelsOpen ? 'open' : ''}>
    <summary>保存検索・詳細フィルター <span>条件を指定して絞り込む</span></summary>
  <div class="preset-toolbar" aria-label="保存した検索条件">
    <label class="control-label preset-picker">保存検索
      <select id="saved-search-select" ${state.savedSearchesError ? 'disabled' : ''}>
        <option value="">保存済みの検索条件を選択</option>
        ${state.savedSearches.map((p) => `<option value="${esc(p.id)}" ${state.activeSavedSearchId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
    </label>
    <button class="btn subtle" id="save-search" ${state.savedSearchesError ? 'disabled' : ''}>＋ この条件を保存</button>
    <button class="btn subtle" id="delete-search" ${!state.activeSavedSearchId || state.savedSearchesError ? 'disabled' : ''}>保存条件を削除</button>
    ${state.savedSearchesError ? `<span class="preset-warning">${esc(state.savedSearchesError)}</span>` : ''}
  </div>
  <div class="facet-toolbar" aria-label="詳細検索条件">
    <label class="control-label">歌唱キャラ<select id="voice-filter"><option value="">すべて</option>${selectOptions(voices, state.filters.voice)}</select></label>
    <label class="control-label">歌唱者の原表記<select id="variant-filter" ${state.filters.voice ? '' : 'disabled'}><option value="">すべてのバージョン</option>${selectOptions(variants, state.filters.variant)}</select></label>
    <label class="control-label">ジャンル（タグ・概要欄推定）<select id="genre-filter"><option value="">すべて</option>${selectOptions(GENRE_LABELS, state.filters.genre)}</select></label>
    <label class="control-label">雰囲気（タグ・概要欄推定）<select id="mood-filter"><option value="">すべて</option>${selectOptions(MOOD_LABELS, state.filters.mood)}</select></label>
    <label class="control-label">投稿年<select id="year-filter"><option value="">すべて</option>${selectOptions(years, state.filters.year)}</select></label>
    <label class="control-label">整理状況<select id="status-filter">
      <option value="" ${!state.filters.status ? 'selected' : ''}>すべて</option>
      ${[
        ['duplicate', '複数リストに所属（重複）'],
        ['unlisted', 'どのリストにも未所属'],
        ['no-voice', '歌唱者が未判定'],
        ['voice-review', '歌唱者に要確認候補あり'],
        ['unrated', '未評価'],
        ['missing-metadata', '動画情報が不足'],
      ]
        .map(
          ([key, label]) =>
            `<option value="${key}" ${state.filters.status === key ? 'selected' : ''}>${label}</option>`,
        )
        .join('')}
    </select></label>
    <label class="control-label creator-control">作者・投稿者<input id="creator-filter" placeholder="作者名で検索" value="${esc(state.filters.creator)}" autocomplete="off" /></label>
    <button class="btn subtle" id="facets-reset" title="検索と詳細条件を解除。ソートは維持">条件クリア</button>
  </div>
  <div class="facet-disclaimer">ジャンルと雰囲気はタグ・概要欄などからの推定分類です。未分類の曲は条件指定時に除外されます。</div>
  </details>
  ${state.filters.sort === 'registration' ? `<div class="inline-hint">登録順はインポート時の一覧表示順です。正確な登録日時とは限りません。${!playlist ? 'マイリストを選ぶと順番を比較できます。' : ''}</div>` : ''}
  <div class="result-heading"><span><b>${formatCount(sorted.length)}</b> 件の動画</span><span>ソート：${esc(SORTS[state.filters.sort])} ${state.filters.order === 'desc' ? '降順' : '昇順'}</span></div>
  <div class="result-actions">
    <span>現在の絞り込み結果すべてが対象です（表示ページに限定されません）</span>
    <button class="btn subtle" id="surprise-me" ${!sorted.length ? 'disabled' : ''}>♫ 条件から1曲選ぶ</button>
    <button class="btn subtle" id="export-filtered" ${!sorted.length ? 'disabled' : ''}>⇩ 結果をCSVに出力</button>
  </div>
  ${pageRows.length ? cards(pageRows) : `<div class="empty-panel"><span>♫</span><h2>動画が見つかりません</h2><p>絞り込み条件を変えるか、データをインポートしてください。</p></div>`}
  ${
    totalPages > 1
      ? `<nav class="pagination" aria-label="ページを移動"><button class="btn subtle" data-page="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''}>← 前へ</button><label class="page-picker">ページ
    <select id="page-jump" aria-label="移動先のページ">${Array.from({ length: totalPages }, (_, i) => `<option value="${i + 1}" ${state.page === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select><span>/ ${totalPages}</span></label><button class="btn subtle" data-page="${state.page + 1}" ${state.page === totalPages ? 'disabled' : ''}>次へ →</button></nav>`
      : ''
  }`;
  }
  function settings() {
    return `${hero('SETTINGS', 'データと設定', 'マイリストの取り込み・バックアップ・アカウント管理')}
  <section class="settings-grid"><div class="panel setting-panel"><div class="setting-icon">⇩</div><h2>データをインポート</h2><p>v0.3のJSONバックアップ、またはCSVをSupabaseへ取り込みます。同じIDは上書き更新されます。</p><button class="btn primary" data-action="import">インポート</button></div>
  <div class="panel setting-panel"><div class="setting-icon">⇧</div><h2>バックアップ</h2><p>動画・マイリスト・メモ・評価などを、自分のPCにJSON形式で保存します。</p><button class="btn subtle" id="export">JSONバックアップを保存</button></div>
  <div class="panel setting-panel"><div class="setting-icon">≡</div><h2>マイリストを作成</h2><p>アプリ内の管理用リストを追加します。ニコニコ本体には作成されません。</p><button class="btn subtle" data-action="playlist">新しいリスト</button></div>
  <div class="panel setting-panel"><div class="setting-icon">↻</div><h2>ニコニコとの差分同期</h2><p>ログイン済みニコニコの一覧を取得して、登録漏れや削除済み動画を確認できます。差分を確認してからDBへ反映します。</p><button class="btn primary" data-action="sync">差分を確認する</button></div>
  <section class="panel setting-panel metadata-settings"><div class="setting-icon">✦</div><h2>動画メタデータを補完</h2><p>タイトル・サムネイル・タグなどの不足分をニコニコから取得します。既存の手動修正やVocaDB情報は保持します。</p><button class="btn primary" data-action="metadata">不足情報を確認</button></section>
  </section><div class="danger-zone"><div><h2>ライブラリを削除</h2><p>このアカウントの動画・マイリスト・メモを削除します。Googleアカウント自体は削除しません。</p></div><button class="btn danger" id="erase">全データを削除</button></div>`;
  }
  function content() {
    const rows = makeRows();
    if (state.view === 'dashboard') return dashboard(rows);
    if (state.view === 'trends') return renderTrends({ state, rows, cards, hero });
    if (state.view === 'scatter') return renderScatter({ state, rows, hero });
    if (state.view === 'settings') return settings();
    return listing(rows);
  }
  function loginScreen() {
    return `<div class="login-bg"><div class="login-orbit orbit-one"></div><div class="login-orbit orbit-two"></div><header class="login-top"><span class="login-mark">♫</span><span>NICO SHELF</span><span class="version">BETA / ${APP_VERSION}</span></header><div class="login-card"><div class="eyebrow">PERSONAL MUSIC ARCHIVE</div><div class="login-art">♫</div><h1>好きな音楽を、<br><em>自分だけの棚に。</em></h1><p>ニコニコのマイリストを検索・整理・分析。<br>タグも、歌唱者も、あなたの思い出も。</p><button id="login" class="google-btn"><span class="google-g">G</span> Googleアカウントで続ける <span>↗</span></button><small>ライブラリはアカウントごとに非公開で管理されます。<br>ニコニコ公式のサービスではありません。</small></div><footer class="login-footer">NICO SHELF <span>YOUR MUSIC ARCHIVE</span></footer></div>`;
  }
  function missingConfig() {
    return `<div class="setup-state"><span class="big-note">♫</span><h1>NICO SHELF v${APP_VERSION}</h1><p>Supabaseの接続先が設定されていません。</p><div class="code-hint">.env.local に VITE_SUPABASE_URL と<br>VITE_SUPABASE_PUBLISHABLE_KEY を設定</div><p class="muted">設定後に npm run dev を再起動してください。<br>詳しくは README.md を参照してください。</p></div>`;
  }

  return { shell, content, loginScreen, missingConfig };
}
