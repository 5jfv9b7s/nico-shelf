/** Public metadata DTO shared by the gateway, Worker and browser. No credentials. */
export const VIDEO_ID_RE = /^(sm|nm|so)[0-9]{1,12}$/;
export const METADATA_BYTES = 350000;
const strings = { title: 220, description: 20000, uploader: 200, uploader_id: 80, genre: 200 };
export function validateVideoMetadata(data, id) {
  if (
    !VIDEO_ID_RE.test(id) ||
    !data ||
    data.id !== id ||
    typeof data.title !== 'string' ||
    !data.title.trim()
  )
    throw new Error('INVALID_METADATA');
  const result = { id };
  for (const [key, max] of Object.entries(strings)) {
    if (data[key] === undefined || data[key] === null) continue;
    if (typeof data[key] !== 'string' || [...data[key]].length > max)
      throw new Error('INVALID_METADATA');
    result[key] = data[key];
  }
  for (const key of ['views', 'comments', 'mylists', 'likes', 'duration']) {
    const value = data[key];
    if (value === undefined || value === null) continue;
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('INVALID_METADATA');
    result[key] = value;
  }
  if (data.published_at) {
    if (typeof data.published_at !== 'string' || !Number.isFinite(Date.parse(data.published_at)))
      throw new Error('INVALID_METADATA');
    result.published_at = new Date(data.published_at).toISOString();
  }
  if (data.thumb) {
    const url = new URL(data.thumb);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !/(^|\.)(nicovideo\.jp|nimg\.jp)$/.test(url.hostname) ||
      data.thumb.length > 2048
    )
      throw new Error('INVALID_METADATA');
    result.thumb = url.href;
  }
  if (
    !Array.isArray(data.tags) ||
    data.tags.length > 100 ||
    data.tags.some((x) => typeof x !== 'string' || [...x].length > 200)
  )
    throw new Error('INVALID_METADATA');
  result.tags = [...new Set(data.tags)];
  return result;
}
/** Bound bytes even when Content-Length is missing or false; always close the stream. */
export async function readTextLimited(response, limit = METADATA_BYTES) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('INVALID_METADATA');
  let size = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  try {
    if (Number(response.headers.get('content-length')) > limit) throw new Error('TOO_LARGE');
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('TOO_LARGE');
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
}
