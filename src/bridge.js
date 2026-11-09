/** Tampermonkey value-storage bridge. No cookies or auth tokens cross origins. */
export class NicoTabBridge {
  constructor(){
    this.nonce='';this.connected=false;this.tab=null;this.pending=new Map();this.handshake=null;
    window.addEventListener('message',e=>this.onMessage(e));
  }
  onMessage(e){
    if(e.source!==window || e.origin!==location.origin || e.data?.channel!=='nico-shelf-bridge-v06' || e.data?.nonce!==this.nonce)return;
    if(e.data.type==='ready'){
      this.connected=true;
      if(this.handshake){clearTimeout(this.handshake.timer);this.handshake.resolve();this.handshake=null;}
    }else if(e.data.type==='result'){
      const wait=this.pending.get(e.data.requestId);if(!wait)return;
      clearTimeout(wait.timer);this.pending.delete(e.data.requestId);
      if(e.data.ok)wait.resolve(e.data.payload);else wait.reject(new Error(e.data.error||'ニコニコ側で処理できませんでした'));
    }
  }
  connect(){
    if(this.connected)return Promise.resolve();
    this.disconnect();
    this.nonce=crypto.randomUUID();
    // Message posted to the userscript instance on the NICO SHELF site.
    window.postMessage({channel:'nico-shelf-page-v06',type:'init',nonce:this.nonce},location.origin);
    const url=new URL('https://www.nicovideo.jp/');
    url.searchParams.set('nico_shelf_bridge','1');
    url.searchParams.set('nico_shelf_nonce',this.nonce);
    // Must open synchronously in the click handler to avoid popup blockers.
    const tab=window.open(url.toString(),'_blank');
    if(!tab)throw new Error('ポップアップがブロックされました。ニコニコのタブを開けるようにしてください');
    this.tab=tab;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        this.handshake=null;
        reject(new Error('ニコニコからの接続確認が届きません。両サイトでTampermonkeyスクリプトが有効か、ニコニコ側の「接続を許可」を押したか確認してください。'));
      },90000);
      this.handshake={resolve,reject,timer};
    });
  }
  request(action,payload,timeout=12000){
    if(!this.connected)throw new Error('ニコニコに未接続です。「ニコニコと接続」を押してください');
    const requestId=crypto.randomUUID();
    const promise=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(requestId);reject(new Error('ニコニコからの応答がありません。登録結果をニコニコ側で確認してください。'));},timeout);
      this.pending.set(requestId,{resolve,reject,timer});
    });
    window.postMessage({channel:'nico-shelf-page-v06',type:'request',nonce:this.nonce,requestId,action,payload},location.origin);
    return promise;
  }
  disconnect(){
    this.connected=false;
    if(this.handshake){clearTimeout(this.handshake.timer);this.handshake.reject(new Error('接続が解除されました'));this.handshake=null;}
    for(const [id,job] of this.pending){clearTimeout(job.timer);job.reject(new Error('接続が解除されました'));this.pending.delete(id);}
    this.tab=null;this.nonce='';
  }
}
