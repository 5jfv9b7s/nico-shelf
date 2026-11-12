/** Check public read access FROM THE MACHINE RUNNING THIS SCRIPT. */
const id = process.argv[2] || '75327830';
if (!/^[1-9]\d{0,15}$/.test(id)) throw new Error('Please supply a numeric public mylist ID');
const url = `https://nvapi.nicovideo.jp/v2/mylists/${id}?page=1&pageSize=100`;
try {
  const response = await fetch(url, {
    headers: { 'X-Frontend-Id': '6', 'X-Frontend-Version': '0', 'X-Niconico-Language': 'ja-jp' },
    signal: AbortSignal.timeout(12000),
    redirect: 'manual',
  });
  console.log(`Upstream HTTP ${response.status} (run this on the actual intended server host)`);
  if (!response.ok) process.exitCode = 1;
  else {
    const data = await response.json();
    const list = data?.data?.mylist;
    console.log(list?.items && Array.isArray(list.items) ? `Public mylist response: ${list.items.length} first-page items` : 'Unexpected JSON structure');
    if (!Array.isArray(list?.items)) process.exitCode = 1;
  }
} catch (error) {
  console.error('Probe failed:', error?.name || 'UnknownError');
  process.exitCode = 1;
}
