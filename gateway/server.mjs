/**
 * NICO SHELF optional public-mylist gateway (Node.js 22+, zero dependencies).
 *
 * This service reads only public metadata from a fixed NicoNico endpoint. It
 * never uses user cookies, handles logins, accepts arbitrary URLs or writes DB.
 * It must be deployed on an environment whose upstream access is permitted.
 * Cloudflare Workers were observed to receive HTTP 403, so deployment here
 * does NOT establish that another hosting provider will work.
 */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { parsePublicMylistPage, publicMylistUpstreamUrl } from '../worker/public-mylist.js';

const PATH = /^\/v1\/public-mylists\/([1-9]\d{0,15})$/;
const LIMIT_BYTES = 1024 * 1024;

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(JSON.stringify(data));
}

/** Stop before consuming an unbounded remote response body. */
async function readJsonLimited(response) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > LIMIT_BYTES) throw new Error('TOO_LARGE');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('EMPTY_BODY');
  let bytes = 0;
  const buffers = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > LIMIT_BYTES) throw new Error('TOO_LARGE');
      buffers.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return JSON.parse(new TextDecoder().decode(Buffer.concat(buffers)));
}

export function makeGatewayHandler({ token, fetchUpstream = fetch } = {}) {
  if (typeof token !== 'string' || token.length < 24) throw new Error('GATEWAY_TOKEN (24+ chars) is required');
  return async function handle(req, res) {
    if (req.method !== 'GET') return send(res, 405, { code: 'METHOD_NOT_ALLOWED' });
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health') return send(res, 200, { status: 'ready', upstreamVerified: false });
    // Reject unknown query keys, invalid page, arbitrary host and path inputs.
    const match = url.pathname.match(PATH);
    const page = Number(url.searchParams.get('page') || '1');
    if (!match || [...url.searchParams.keys()].some(k => k !== 'page') || !Number.isInteger(page) || page < 1 || page > 20) {
      return send(res, 400, { code: 'INVALID_REQUEST' });
    }
    // Compare exact header only; never log the supplied secret.
    if (req.headers['x-nico-shelf-gateway-key'] !== token) {
      return send(res, 401, { code: 'UNAUTHORIZED' });
    }

    const id = match[1];
    try {
      const upstream = await fetchUpstream(publicMylistUpstreamUrl(id, page), {
        headers: {
          'X-Frontend-Id': '6',
          'X-Frontend-Version': '0',
          'X-Niconico-Language': 'ja-jp',
          Accept: 'application/json',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(12000),
      });
      if (upstream.status === 403 || upstream.status === 401) {
        console.warn('[gateway] upstream access denied', { id, page, status: upstream.status });
        return send(res, 502, { code: 'UPSTREAM_ACCESS_DENIED', upstreamStatus: upstream.status });
      }
      if (upstream.status === 404) return send(res, 404, { code: 'UPSTREAM_NOT_FOUND' });
      if (upstream.status === 429) return send(res, 503, { code: 'UPSTREAM_RATE_LIMITED' });
      if (!upstream.ok) return send(res, 502, { code: 'UPSTREAM_HTTP_ERROR', upstreamStatus: upstream.status });
      if (!/(?:application\/json|\+json)/i.test(upstream.headers.get('content-type') || '')) {
        return send(res, 502, { code: 'UPSTREAM_NOT_JSON' });
      }
      const payload = await readJsonLimited(upstream);
      const normalized = parsePublicMylistPage(payload, id, page);
      return send(res, 200, normalized);
    } catch (error) {
      const code = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'UPSTREAM_TIMEOUT'
        : error?.message === 'TOO_LARGE' ? 'UPSTREAM_TOO_LARGE' : 'UPSTREAM_INVALID_RESPONSE';
      console.warn('[gateway] fetch or parse failed', { id, page, code });
      return send(res, 502, { code });
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.GATEWAY_TOKEN;
  const port = Number(process.env.PORT || '8788');
  const handle = makeGatewayHandler({ token });
  createServer((req, res) => { void handle(req, res); }).listen(port, '0.0.0.0', () => {
    console.log(`[gateway] listening on port ${port}; /health checks server only, not NicoNico access`);
  });
}
