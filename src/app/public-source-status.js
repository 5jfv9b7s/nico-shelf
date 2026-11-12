/**
 * Public-list source status is advisory. A failed status probe must not
 * prevent users from trying the actual, read-only public-list endpoint.
 *
 * The /status endpoint reports CONFIGURATION, not proof that Render and
 * NicoNico are reachable. Actual imports still validate EVERY page before
 * offering any database write.
 */
export async function checkPublicSourceStatus(fetchStatus = fetch) {
  try {
    const response = await fetchStatus('/api/public-mylists/status', {
      cache: 'no-store',
    });
    if (!response.ok) return { status: 'unverified', reason: 'STATUS_HTTP_ERROR' };

    const body = await response.json();
    if (body?.available === true) return { status: 'configured', reason: null };
    if (body?.available === false) {
      const permitted = new Set(['SOURCE_NOT_GATEWAY', 'GATEWAY_URL_INVALID', 'GATEWAY_TOKEN_INVALID']);
      return { status: 'not-configured', reason: permitted.has(body.reason) ? body.reason : 'GATEWAY_NOT_CONFIGURED' };
    }
    return { status: 'unverified', reason: 'STATUS_UNEXPECTED_DATA' };
  } catch {
    return { status: 'unverified', reason: 'STATUS_NETWORK_ERROR' };
  }
}
