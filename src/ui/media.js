/** Only render remote thumbnails from NicoNico's own image hosts. */
export function safeThumb(v) {
  try {
    const u = new URL(v || '');
    return u.protocol === 'https:' &&
      (u.hostname === 'nicovideo.jp' ||
        u.hostname.endsWith('.nicovideo.jp') ||
        u.hostname === 'nimg.jp' ||
        u.hostname.endsWith('.nimg.jp'))
      ? u.href
      : '';
  } catch {
    return '';
  }
}
