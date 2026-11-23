/** Run on the actual gateway host; no credentials, arbitrary URLs or DB writes. */
import { parseVideoMetadataXml, videoMetadataUpstreamUrl } from '../gateway/video-metadata.js';
import { readTextLimited } from '../shared/video-metadata.js';
const id = process.argv[2] || 'sm9';
try {
  const response = await fetch(videoMetadataUpstreamUrl(id), {
    redirect: 'manual',
    signal: AbortSignal.timeout(12000),
  });
  console.log('Upstream HTTP', response.status);
  if (!response.ok) throw new Error('UPSTREAM_HTTP_ERROR');
  const data = parseVideoMetadataXml(await readTextLimited(response), id);
  console.log('Validated video:', data.id, '/ fields:', Object.keys(data).join(', '));
  console.log(
    'This verifies only this host and this video. /health does not verify upstream access.',
  );
} catch (error) {
  console.error(
    'Metadata probe failed:',
    error?.name === 'TimeoutError'
      ? 'UPSTREAM_TIMEOUT'
      : error?.message === 'METADATA_UNAVAILABLE'
        ? 'UPSTREAM_METADATA_UNAVAILABLE'
        : 'FETCH_OR_VALIDATION_FAILED',
  );
  process.exitCode = 1;
}
