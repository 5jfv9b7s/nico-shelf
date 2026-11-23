import { createMetadataFetch } from './metadata-fetch.js';
import { abortable } from './metadata-queue.js';
import { mergeMetadata, inferredVoicesFromTags } from '../discovery.js';

/** Guard the owner/library after reads, before any database write. */
export function createMetadataEnricher({ state, client, nicoBridge }) {
  return async function enrichOne(
    id,
    { refresh = false, signal, source = state.metadataSource } = {},
  ) {
    signal?.throwIfAborted();
    const owner = state.user?.id,
      library = state.library;
    if (!owner)
      throw Object.assign(new Error('ログインしてください'), {
        code: 'AUTH_REQUIRED',
        status: 401,
      });
    const local = library.videos.find((video) => video.id === id);
    if (!local) throw new Error(`${id} はDBにありません。先に同期または登録してください。`);
    const remote =
      source === 'bridge'
        ? await abortable(nicoBridge.request('metadata', { videoId: id }, 35000), signal)
        : await createMetadataFetch(client.auth)(id, { signal });
    signal?.throwIfAborted();
    if (state.user?.id !== owner || state.library !== library)
      throw Object.assign(new Error('ライブラリが変更されたため補完を中止しました'), {
        code: 'STALE_LIBRARY',
      });
    if (!remote || remote.id !== id) throw new Error('取得動画IDが一致しません');
    const patch = mergeMetadata(
      local,
      { ...remote, voices: inferredVoicesFromTags(remote.tags) },
      { refresh },
    );
    // Do not abort a save already sent: finish this one record, then stop the queue.
    const { error } = await client.from('videos').update(patch).eq('owner_id', owner).eq('id', id);
    if (error) throw new Error(`${id}：保存失敗 ${error.message}`);
    if (state.user?.id === owner && state.library === library) Object.assign(local, patch);
    return patch;
  };
}
