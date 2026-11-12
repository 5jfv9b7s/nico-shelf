/** Display labels and initial ephemeral UI state; never persisted to Supabase. */
export const APP_VERSION = '0.16.2';
export const VIEWS = {
  dashboard: 'ダッシュボード',
  library: 'ライブラリ',
  trends: '音楽の変遷',
  scatter: '散布図',
  duplicates: '重複した動画',
  favorites: 'お気に入り',
  settings: 'データと設定',
};

export const SORTS = {
  views: '再生数',
  published_at: '投稿日',
  duration: '動画時間',
  comments: 'コメント数',
  mylists: 'マイリスト数',
  title: 'タイトル',
  registration: 'リスト内順番',
};

export const NAV_ICONS = {
  dashboard: '▦',
  library: '≡',
  trends: '▥',
  scatter: '⠿',
  duplicates: '◈',
  favorites: '♡',
  settings: '⚙',
};

export function createInitialState() {
  return {
    user: null,
    library: { playlists: [], videos: [], entries: [], meta: [] },
    view: 'dashboard',
    filters: {
      q: '', playlist: '', sort: 'views', order: 'desc',
      voice: '', variant: '', genre: '', mood: '', year: '', creator: '', status: '',
    },
    savedSearches: [],
    savedSearchesLoaded: false,
    savedSearchesError: '',
    activeSavedSearchId: '',
    trends: { axis: 'playlist', facet: 'voice', playlistId: '', includeOther: false, selected: null, chartStyle: 'matrix', focus: '', visibleCount: 10 },
    scatter: { mode: '2d', x: 'views', y: 'comments', z: 'mylists', voice: '', legendLimit: 30 },
    voiceMode: 'canonical',
    voiceVisibleCount: 15,
    cardMode: 'list',
    filterPanelsOpen: false,
    page: 1,
    dialog: null,
    preview: null,
    sync: null,
    syncProgress: '',
    publicSyncSelected: null,
    busy: false,
    error: '',
    toastTimer: null,
  };
}
