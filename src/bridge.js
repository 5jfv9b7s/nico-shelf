/** NICO SHELF 0.6.1: Tampermonkey tab bridge with explicit diagnostics and retry.
 *  NicoNico cookies stay within the authenticated NicoNico tab.
 */
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
    window.addEventListener('message', this.onMessage);
  }

  onMessage(event) {
    // A content-script message may have a null source depending on injection mode.
    if ((event.source && event.source !== window) ||
        event.origin !== location.origin ||
        event.data?.channel !== 'nico-shelf-bridge-v06' ||
        event.data?.nonce !== this.nonce) return;

    if (event.data.type === 'page-bridge-ready') {
      this.pageBridgeAcknowledged = true;
    } else if (event.data.type === 'ready') {
      this.connected = true;
      this.clearInitTimer();
      if (this.handshake) {
        clearTimeout(this.handshake.timer);
        this.handshake.resolve();
        this.handshake = null;
      }
    } else if (event.data.type === 'result') {
      const waiter = this.pending.get(event.data.requestId);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      this.pending.delete(event.data.requestId);
      if (event.data.ok) waiter.resolve(event.data.payload);
      else waiter.reject(new Error(event.data.error || 'ニコニコ側で処理できませんでした'));
    }
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
    if (document.documentElement.getAttribute('data-nico-shelf-direct-bridge') !== '0.6.1') {
      throw new Error('NICO SHELF側で連携スクリプトv0.6.1が検出できません。Tampermonkeyでこの公開サイトへのアクセスを許可し、アプリのタブを再読み込みしてください');
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
        window.postMessage({channel:'nico-shelf-page-v06', type:'init', nonce}, location.origin);
      }
    };
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.handshake = null;
        this.clearInitTimer();
        const detail = this.pageBridgeAcknowledged
          ? 'NICO SHELF側のスクリプトは動作していますが、ニコニコ側から接続応答が届いていません。ニコニコ側のパネルで許可を押したか、同じTampermonkeyスクリプトが両サイトで動いているか確認してください。'
          : 'NICO SHELF側スクリプトとの通信に失敗しています。両サイトのTampermonkeyの有効状態、Chromeの「ユーザースクリプトを許可」、拡張機能のサイトアクセス権限を確認してください。';
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
    if (!this.connected) throw new Error('ニコニコに未接続です。「ニコニコと接続」を押してください');
    const requestId = crypto.randomUUID();
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('ニコニコからの応答がありません。登録結果をニコニコ側で確認してください。'));
      }, timeout);
      this.pending.set(requestId, {resolve, reject, timer});
    });
    window.postMessage({channel:'nico-shelf-page-v06', type:'request', nonce:this.nonce, requestId, action, payload}, location.origin);
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
