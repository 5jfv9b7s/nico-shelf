import { AUTHOR_HANDLE, AUTHOR_URL } from '../src/app/site-info.js';

/** Public contact values are deliberately limited to HTTPS and a plain mailto. */
export function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
export function publicSettings(environment) {
  const operator = String(environment.VITE_OPERATOR_NAME ?? AUTHOR_HANDLE).trim();
  const contact = String(
    environment.VITE_SUPPORT_URL ?? 'https://forms.gle/xPVJd5bzC8ujRYDF8',
  ).trim();
  if (operator.length > 120) throw new Error('VITE_OPERATOR_NAME must be 120 characters or fewer');
  if (contact) {
    const url = new URL(contact);
    const https = url.protocol === 'https:' && !url.username && !url.password;
    const mail = /^mailto:[^\s@?<>]+@[^\s@?<>]+\.[^\s@?<>]+$/.test(contact);
    if ((!https && !mail) || /[\r\n]/.test(contact) || contact.length > 2048)
      throw new Error('VITE_SUPPORT_URL must be HTTPS or a plain mailto address');
  }
  const launch = environment.NICO_PUBLIC_LAUNCH === '1';
  if (
    launch &&
    (!operator ||
      !contact ||
      !environment.VITE_SUPABASE_URL ||
      !environment.VITE_SUPABASE_PUBLISHABLE_KEY)
  ) {
    throw new Error(
      'Public launch requires VITE_OPERATOR_NAME, VITE_SUPPORT_URL and both public Supabase settings',
    );
  }
  return { operator, contact, launch };
}
export function renderPublicPage(template, settings) {
  const operatorName = settings.operator || 'NICO SHELF 運営者';
  const operator =
    operatorName === AUTHOR_HANDLE
      ? `<a href="${AUTHOR_URL}" rel="noreferrer">${escapeHtml(operatorName)}（X / Twitter）</a>`
      : escapeHtml(operatorName);
  const contact = settings.contact
    ? `<a href="${escapeHtml(settings.contact)}" rel="noreferrer">お問い合わせ・登録情報の削除依頼</a><p>パスワード、ログイン用コード、認証トークンは送らないでください。</p>`
    : '<p>現在は公開準備中です。問い合わせ窓口はまだ設定されていません。</p>';
  return template
    .replaceAll('<!-- operator -->NICO SHELF 運営者', operator)
    .replace(/<!-- contact:start -->[\s\S]*?<!-- contact:end -->/g, contact);
}
