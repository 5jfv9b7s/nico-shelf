/** NICO SHELF 0.7.0: Cross-world DOM event + postMessage bridge with diagnostics.
 *  NicoNico cookies stay within the authenticated NicoNico tab.
 */
// DOM CustomEvents cross Chrome extension's isolated world and page world.
// Only JSON text passes across the boundary, avoiding cross-world object wrappers.
const APP_EVENT = 'nico-shelf-page-dom-v062';
const SCRIPT_EVENT = 'nico-shelf-script-dom-v062';

export class NicoTabBridge {
  constructor() {
    this.nonce = '';
    this.connected = false;
    this.tab = null;
    this.pending = new Map();
    this.handshake = null;
    this.initTimer = null;
    this.pageBridgeAcknowledged = false;
    this.onMessage = this.onMessage.bind(this);
    this.onDomMessage = this.onDomMessage.bind(this);
    window.addEventListener('message', this.onMessage);
    document.addEventListener(SCRIPT_EVENT, this.onDomMessage);
  }

  onMessage(event) {
    // The extension sandbox may use a different origin, so postMessage is a
    // secondary path. We do not weaken the origin validation here.
    if ((event.source && event.source !== window) || event.origin !== location.origin) return;
    this.onPayload(event.data);
  }

  onDomMessage(event) {
    // CustomEvent.detail is a JSON string so isolated-world boundaries do not
    // need to exchange realm-specific JS objects.
    let data;
    try { data = JSON.parse(event.detail); } catch { return; }
    this.onPayload(data);
  }

  onPayload(data) {
    if (data?.channel !== 'nico-shelf-bridge-v06' || data.nonce !== this.nonce) return;
    if (data.type === 'page-bridge-ready') {
      this.pageBridgeAcknowledged = true;
    } else if (data.type === 'ready') {
      this.connected = true;
      this.clearInitTimer();
      if (this.handshake) {
        clearTimeout(this.handshake.timer);
        this.handshake.resolve();
        this.handshake = null;
      }
    } else if (data.type === 'result') {
      const waiter = this.pending.get(data.requestId);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      this.pending.delete(data.requestId);
      if (data.ok) waiter.resolve(data.payload);
      else waiter.reject(new Error(data.error || 'ニコニコ側で処理できませんでした'));
    }
  }

  sendToScript(message) {
    document.dispatchEvent(new CustomEvent(APP_EVENT, {detail:JSON.stringify(message)}));
    window.postMessage(message, location.origin);
  }

  clearInitTimer() {
    if (this.initTimer) clearInterval(this.initTimer);
    this.initTimer = null;
  }

  connect() {
    if (this.connected) return Promise.resolve();
    this.disconnect();

    // Makes missing/disabled site userscripts visible immediately instead of
    // showing a seemingly perpetual "unconnected" state.
    if (document.documentElement.getAttribute('data-nico-shelf-direct-bridge') !== '0.7.0') {
      throw new Error('NICO SHELF側で連携スクリプトv0.7.0が検出できません。Tampermonkeyでこの公開サイトへのアクセスを許可し、アプリのタブを再読み込みしてください');
    }

    this.nonce = crypto.randomUUID();
    const url = new URL('https://www.nicovideo.jp/');
    url.searchParams.set('nico_shelf_bridge', '1');
    url.searchParams.set('nico_shelf_nonce', this.nonce);
    // Open synchronously from the original click event to avoid popup blocking.
    const tab = window.open(url.toString(), '_blank');
    if (!tab) {
      this.disconnect();
      throw new Error('ポップアップがブロックされました。ニコニコのタブを開けるようにしてください');
    }
    this.tab = tab;

    const nonce = this.nonce;
    const sendInit = () => {
      if (this.nonce === nonce && !this.connected) {
        this.sendToScript({channel:'nico-shelf-page-v06', type:'init', nonce});
      }
    };
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.handshake = null;
        this.clearInitTimer();
        const detail = this.pageBridgeAcknowledged
          ? 'NICO SHELF側の連携は動作していますが、ニコニコ側からの許可通知が届きません。同じv0.6.2スクリプトが両サイトで動いているか確認してください。'
          : 'アプリ側スクリプトから応答がありません。Tampermonkeyにv0.6.2を上書き保存し、NICO SHELFのタブを再読み込みしてください。';
        reject(new Error(detail));
      }, 30000);
      this.handshake = {resolve, reject, timer};
    });
    // Repeating init heals missed postMessage events and races during script startup.
    sendInit();
    this.initTimer = setInterval(sendInit, 850);
    return promise;
  }

  request(action, payload, timeout = 12000) {
    if (this.tab?.closed) {
      this.disconnect();
      throw new Error('ニコニコの接続用タブが閉じられました。再接続してください');
    }
    if (!this.connected) throw new Error('ニコニコに未接続です。「ニコニコと接続」を押してください');
    const requestId = crypto.randomUUID();
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(action==='snapshot-list'?'ニコニコのマイリスト一覧取得がタイムアウトしました。差分は反映していません。':'ニコニコからの応答がありません。登録結果をニコニコ側で確認してください。'));
      }, timeout);
      this.pending.set(requestId, {resolve, reject, timer});
    });
    this.sendToScript({channel:'nico-shelf-page-v06', type:'request', nonce:this.nonce, requestId, action, payload});
    return promise;
  }

  disconnect() {
    this.connected = false;
    this.pageBridgeAcknowledged = false;
    this.clearInitTimer();
    if (this.handshake) {
      clearTimeout(this.handshake.timer);
      this.handshake.reject(new Error('接続が解除されました'));
      this.handshake = null;
    }
    for (const [id, job] of this.pending) {
      clearTimeout(job.timer);
      job.reject(new Error('接続が解除されました'));
      this.pending.delete(id);
    }
    this.tab = null;
    this.nonce = '';
  }
}
