/** Public attribution supplied by the creator. */
export const AUTHOR_HANDLE = '@5jfv9b7s_1155';
export const AUTHOR_URL = 'https://x.com/5jfv9b7s_1155';
export const DEFAULT_SUPPORT_URL = 'https://forms.gle/xPVJd5bzC8ujRYDF8';

/** Match the public-page contact setting; unsafe values never become a link. */
export function getSupportUrl(value = DEFAULT_SUPPORT_URL) {
  const candidate = String(value).trim();
  try {
    const url = new URL(candidate);
    if (url.protocol === 'https:' && !url.username && !url.password) return candidate;
    if (/^mailto:[^\s@?<>]+@[^\s@?<>]+\.[^\s@?<>]+$/.test(candidate)) return candidate;
  } catch {
    /* An absent/invalid contact falls back to the help page. */
  }
  return '';
}
