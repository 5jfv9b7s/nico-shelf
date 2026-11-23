import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { validateVideoMetadata, VIDEO_ID_RE, METADATA_BYTES } from '../shared/video-metadata.js';
export function videoMetadataUpstreamUrl(id) {
  if (!VIDEO_ID_RE.test(id)) throw new Error('INVALID_VIDEO_ID');
  return new URL('https://ext.nicovideo.jp/api/getthumbinfo/' + id);
}
const cut = (value, max) => (typeof value === 'string' ? [...value].slice(0, max).join('') : '');
const text = (value) =>
  typeof value === 'string' ? value : typeof value?.['#text'] === 'string' ? value['#text'] : '';
function count(value) {
  const raw = text(value);
  if (!raw) return undefined;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error('INVALID_METADATA');
  return Number(raw);
}
export function parseVideoMetadataXml(xml, id) {
  if (
    typeof xml !== 'string' ||
    new TextEncoder().encode(xml).length > METADATA_BYTES ||
    /<!\s*(DOCTYPE|ENTITY)\b/i.test(xml) ||
    XMLValidator.validate(xml) !== true
  )
    throw new Error('INVALID_METADATA');
  const root = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
  }).parse(xml).nicovideo_thumb_response;
  if (root?.['@_status'] === 'fail') throw new Error('METADATA_UNAVAILABLE');
  const v = root?.thumb;
  if (root?.['@_status'] !== 'ok' || !v || text(v.video_id) !== id)
    throw new Error('INVALID_METADATA');
  const data = {
    id,
    title: cut(text(v.title), 220),
    description: cut(text(v.description), 20000),
    uploader: cut(text(v.user_nickname) || text(v.ch_name), 200),
    uploader_id: cut(text(v.user_id) || text(v.ch_id), 80),
    genre: cut(text(v.genre), 200),
    tags: [],
  };
  if (text(v.thumbnail_url)) data.thumb = text(v.thumbnail_url).replace(/^http:\/\//, 'https://');
  if (text(v.first_retrieve)) data.published_at = text(v.first_retrieve);
  for (const [key, field] of [
    ['views', 'view_counter'],
    ['comments', 'comment_num'],
    ['mylists', 'mylist_counter'],
  ]) {
    const n = count(v[field]);
    if (n !== undefined) data[key] = n;
  }
  const length = text(v.length);
  if (length) {
    if (!/^\d+:\d{2}(?::\d{2})?$/.test(length)) throw new Error('INVALID_METADATA');
    const parts = length.split(':').map(Number);
    if (parts.slice(1).some((n) => n >= 60)) throw new Error('INVALID_METADATA');
    data.duration = parts.reduce((sum, n) => sum * 60 + n, 0);
  }
  for (const group of Array.isArray(v.tags) ? v.tags : [v.tags]) {
    const tags = Array.isArray(group?.tag)
      ? group.tag
      : group?.tag === undefined
        ? []
        : [group.tag];
    data.tags.push(
      ...tags
        .map(text)
        .filter(Boolean)
        .map((s) => cut(s, 200)),
    );
  }
  data.tags = [...new Set(data.tags)].slice(0, 100);
  return validateVideoMetadata(data, id);
}
