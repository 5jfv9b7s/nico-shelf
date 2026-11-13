// ==UserScript==
// @name         NICO SHELF Direct Bridge (v0.8.0)
// @namespace    nico-shelf.direct
// @version      0.8.0
// @description  ニコニコのログイン済みタブから登録・差分同期・動画情報取得します。Cookieを外部送信しません。
// @match        https://www.nicovideo.jp/*
// @match        https://nico-shelf.shiokara-lab.workers.dev/*
// @match        http://127.0.0.1:5173/*
// @match        http://localhost:5173/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_xmlhttpRequest
// @connect      ext.nicovideo.jp
// @run-at       document-end
// ==/UserScript==
(() => {
  'use strict';
  const ALLOWED = new Set([
    'https://nico-shelf.shiokara-lab.workers.dev',
    'http://127.0.0.1:5173',
    'http://localhost:5173',
  ]);
  const validNonce = (s) => typeof s === 'string' && /^[a-f0-9-]{36}$/.test(s);
  const PAGE_CHANNEL = 'nico-shelf-page-v06';
  const BRIDGE_CHANNEL = 'nico-shelf-bridge-v06';
  const APP_EVENT = 'nico-shelf-page-dom-v062';
  const SCRIPT_EVENT = 'nico-shelf-script-dom-v062';
  function sendToPage(message) {
    document.dispatchEvent(new CustomEvent(SCRIPT_EVENT, { detail: JSON.stringify(message) }));
    window.postMessage(message, location.origin);
  }
  if (ALLOWED.has(location.origin)) {
    // This marker is a diagnostic: it means this exact version executed here.
    document.documentElement.setAttribute('data-nico-shelf-direct-bridge', '0.8.0');
    // The app page cannot access NicoNico cookies. It only exchanges JSON
    // with the separately running userscript on the user's NicoNico tab.
    let activeNonce = '',
      listenerIds = [],
      pollTimer = null,
      acknowledgedReady = false;
    function clearListeners() {
      for (const id of listenerIds) {
        try {
          GM_removeValueChangeListener(id);
        } catch {}
      }
      listenerIds = [];
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    }
    function receiveReady(value) {
      if (value?.nonce !== activeNonce || !value.ready || acknowledgedReady) return;
      // Do not accept old responses, even though the nonce is unique per click.
      if (!Number.isFinite(value.timestamp) || Math.abs(Date.now() - value.timestamp) > 120000)
        return;
      acknowledgedReady = true;
      sendToPage({ channel: BRIDGE_CHANNEL, type: 'ready', nonce: activeNonce });
    }
    function receiveResult(value) {
      if (value?.nonce !== activeNonce || !validNonce(value.requestId)) return;
      if (!Number.isFinite(value.timestamp) || Math.abs(Date.now() - value.timestamp) > 120000)
        return;
      sendToPage({ channel: BRIDGE_CHANNEL, type: 'result', ...value });
    }
    function begin(nonce) {
      if (activeNonce === nonce) {
        sendToPage({ channel: BRIDGE_CHANNEL, type: 'page-bridge-ready', nonce });
        if (!acknowledgedReady) receiveReady(GM_getValue(`nico_shelf_ready_${nonce}`, null));
        return;
      }
      clearListeners();
      activeNonce = nonce;
      acknowledgedReady = false;
      const readyKey = `nico_shelf_ready_${nonce}`,
        resultKey = `nico_shelf_result_${nonce}`;
      listenerIds.push(
        GM_addValueChangeListener(readyKey, (_k, _old, value) => receiveReady(value)),
      );
      listenerIds.push(
        GM_addValueChangeListener(resultKey, (_k, _old, value) => receiveResult(value)),
      );
      // Some browser/extension configurations miss cross-tab change notifications.
      // Poll the same storage as a fallback (no data leaves this browser).
      let latestResultId = '';
      pollTimer = setInterval(() => {
        if (!acknowledgedReady) receiveReady(GM_getValue(readyKey, null));
        const result = GM_getValue(resultKey, null);
        if (result?.requestId && result.requestId !== latestResultId) {
          latestResultId = result.requestId;
          receiveResult(result);
        }
      }, 500);
      sendToPage({ channel: BRIDGE_CHANNEL, type: 'page-bridge-ready', nonce });
      receiveReady(GM_getValue(readyKey, null));
    }
    function handleAppMessage(data) {
      if (data?.channel !== PAGE_CHANNEL) return;
      const { type, nonce } = data;
      if (!validNonce(nonce)) return;
      if (type === 'init') begin(nonce);
      else if (type === 'request' && nonce === activeNonce) {
        if (
          !['inspect', 'register', 'snapshot-list', 'metadata'].includes(data.action) ||
          !validNonce(data.requestId)
        )
          return;
        GM_setValue(`nico_shelf_request_${nonce}`, {
          nonce,
          requestId: data.requestId,
          action: data.action,
          payload: data.payload,
          timestamp: Date.now(),
        });
      }
    }
    document.addEventListener(APP_EVENT, (event) => {
      let data;
      try {
        data = JSON.parse(event.detail);
      } catch {
        return;
      }
      handleAppMessage(data);
    });
    window.addEventListener('message', (event) => {
      if ((event.source && event.source !== window) || event.origin !== location.origin) return;
      handleAppMessage(event.data);
    });
    return;
  }
  if (location.origin !== 'https://www.nicovideo.jp') return;
  const query = new URL(location.href).searchParams;
  if (query.get('nico_shelf_bridge') !== '1') return;
  const nonce = query.get('nico_shelf_nonce');
  if (!validNonce(nonce)) return;
  const videoRe = /^(?:sm|nm|so)[0-9]{1,12}$/;
  const listRe = /^[0-9]{1,16}$/;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const header = {
    'X-Frontend-Id': '6',
    'X-Frontend-Version': '0',
    'X-Request-With': 'https://www.nicovideo.jp',
  };
  const ui = document.createElement('section');
  ui.style.cssText =
    'position:fixed;z-index:2147483647;right:20px;bottom:20px;width:min(390px,calc(100vw - 40px));box-sizing:border-box;background:#0d2238;color:#f7fcff;border:1px solid #85e3da;border-radius:15px;padding:18px;box-shadow:0 8px 28px #0008;font:14px/1.55 system-ui,sans-serif';
  const headerEl = document.createElement('strong');
  headerEl.textContent = '♫ NICO SHELF · 直接登録・同期・動画情報 v0.8.0';
  headerEl.style.cssText = 'font-size:17px;color:#85e3da';
  const note = document.createElement('p');
  note.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere';
  const buttons = document.createElement('div');
  buttons.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end';
  ui.append(headerEl, note, buttons);
  document.body.appendChild(ui);
  function setText(s) {
    note.textContent = s;
  }
  function button(label, cb, primary = false) {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = label;
    el.style.cssText = `background:${primary ? '#80e2d4' : '#1c3751'};border:1px solid #527e91;border-radius:7px;color:${primary ? '#05212b' : 'white'};font-weight:700;padding:8px 12px;cursor:pointer`;
    el.addEventListener('click', cb);
    buttons.append(el);
    return el;
  }
  let approved = false,
    processing = false;
  function send(type, payload) {
    if (type === 'ready')
      GM_setValue(`nico_shelf_ready_${nonce}`, { nonce, ready: true, timestamp: Date.now() });
    else GM_setValue(`nico_shelf_result_${nonce}`, { nonce, ...payload, timestamp: Date.now() });
  }
  setText(
    'このタブをNICO SHELFへ接続します。\n\n登録操作はNICO SHELFで実行し、このニコニコアカウントのマイリストに反映されます。\nログインCookie・Google認証情報はNICO SHELFへ送信しません。\n\nログイン中のアカウントが正しいことを確認してください。',
  );
  button('拒否する', () => {
    ui.remove();
  });
  button(
    '接続を許可',
    () => {
      approved = true;
      buttons.replaceChildren();
      setText(
        '接続中。このタブを開いたままNICO SHELFに戻ってください。\n動画登録の結果はこのタブにも表示されます。',
      );
      button('接続を解除', () => {
        approved = false;
        ui.remove();
      });
      send('ready', {});
    },
    true,
  );

  async function fetchList(id, vid) {
    const seen = new Set();
    let count = 0,
      found = false,
      title = '';
    for (let page = 1; page <= 25; page++) {
      const response = await fetch(
        `https://nvapi.nicovideo.jp/v1/users/me/mylists/${id}?page=${page}&pageSize=100`,
        { method: 'GET', credentials: 'include', cache: 'no-store', headers: header },
      );
      if (!response.ok)
        throw new Error(
          `マイリスト ${id}: 読み込みHTTP ${response.status}。ニコニコのログイン状態とリストの所有者を確認してください`,
        );
      const json = await response.json();
      const ml = json?.data?.mylist;
      if (!ml || !Array.isArray(ml.items))
        throw new Error(`マイリスト ${id}: 応答形式が認識できません`);
      for (const item of ml.items) {
        const value = String(
          item.watchId || item.videoId || item.video?.id || item.essential?.id || item.id || '',
        );
        if (!videoRe.test(value) || seen.has(value))
          throw new Error(`マイリスト ${id}: 不正または重複した動画ID。処理を停止しました`);
        seen.add(value);
        count++;
        if (value === vid) {
          found = true;
          title = String(item.video?.title || item.essential?.title || item.title || '').slice(
            0,
            220,
          );
        }
      }
      if (ml.hasNext === false || (ml.hasNext == null && ml.items.length < 100))
        return { count, found, title };
      if (ml.items.length === 0) throw new Error(`マイリスト ${id}: ページングが不完全です`);
      await sleep(150);
    }
    throw new Error(`マイリスト ${id}: 最終ページが確認できません`);
  }
  // One playlist per message, to avoid huge GM storage payloads and partial results.
  // This uses the same authenticated NicoNico tab and the same list API as registration.
  async function snapshotList(data) {
    const id = String(data?.id || '');
    const name = String(data?.name || id).slice(0, 100);
    if (!listRe.test(id)) throw new Error('同期対象のマイリストIDが不正です');
    const out = [];
    const seen = new Set();
    for (let page = 1; page <= 25; page++) {
      const res = await fetch(
        `https://nvapi.nicovideo.jp/v1/users/me/mylists/${id}?page=${page}&pageSize=100`,
        {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          headers: header,
        },
      );
      if (!res.ok)
        throw new Error(`「${name}」: HTTP ${res.status}（ログイン状態を確認してください）`);
      const json = await res.json();
      const ml = json?.data?.mylist;
      if (!ml || !Array.isArray(ml.items))
        throw new Error(`「${name}」: ニコニコのAPI形式を認識できません`);
      for (const item of ml.items) {
        const video_id = String(
          item.watchId || item.videoId || item.video?.id || item.essential?.id || item.id || '',
        );
        if (!videoRe.test(video_id) || seen.has(video_id))
          throw new Error(`「${name}」: 動画IDが不正か重複しています (${video_id})`);
        seen.add(video_id);
        out.push({
          video_id,
          title: String(item.video?.title || item.essential?.title || item.title || '').slice(
            0,
            220,
          ),
        });
      }
      if (out.length > 1000) throw new Error(`「${name}」: 1000件を超えています`);
      if (ml.hasNext === false || (ml.hasNext == null && ml.items.length < 100)) {
        // Do not report incomplete pages as success if the API provides a total.
        const total = ml.totalItemCount ?? ml.totalCount;
        if (Number.isSafeInteger(total) && total !== out.length)
          throw new Error(
            `「${name}」: 取得件数 ${out.length}/${total}。途中までの結果は破棄しました`,
          );
        return { id, name, complete: true, items: out };
      }
      if (ml.items.length === 0) throw new Error(`「${name}」: ページングが途中で終了しました`);
      await sleep(160);
    }
    throw new Error(`「${name}」: 最終ページが確認できません`);
  }
  async function inspect(data) {
    if (!videoRe.test(data?.videoId || '')) throw new Error('動画IDが不正です');
    const list = data?.lists;
    if (
      !Array.isArray(list) ||
      list.length === 0 ||
      list.length > 25 ||
      list.some((x) => !listRe.test(String(x.id)))
    )
      throw new Error('マイリストIDが不正です');
    if (new Set(list.map((x) => String(x.id))).size !== list.length)
      throw new Error('リストIDが重複しています');
    const results = [];
    for (const p of list) {
      const x = await fetchList(String(p.id), data.videoId);
      results.push({
        id: String(p.id),
        name: String(p.name).slice(0, 100),
        count: x.count,
        hasVideoIds: x.found ? [data.videoId] : [],
        title: x.title,
      });
    }
    return results;
  }
  function decide(lists, vid, targetId, allowDuplicate) {
    const members = lists.filter((p) => p.hasVideoIds.includes(vid));
    const autoCandidates = lists
      .filter((p) => /^ぼかうた([1-9][0-9]*)$/.test(p.name.trim()))
      .sort(
        (a, b) => Number(a.name.trim().match(/\d+$/)[0]) - Number(b.name.trim().match(/\d+$/)[0]),
      );
    const target =
      targetId === 'auto'
        ? autoCandidates.find((p) => p.count < 500 && !p.hasVideoIds.includes(vid))
        : lists.find((p) => p.id === targetId);
    if (!target)
      throw new Error(
        targetId === 'auto'
          ? 'ぼかうた1→2→3に空きがありません（最近のお気に入りは対象外）'
          : '登録先が見つかりません',
      );
    if (target.hasVideoIds.includes(vid))
      throw new Error(`「${target.name}」にはすでに登録されています`);
    if (target.count >= 500) throw new Error(`「${target.name}」は満杯です`);
    if (members.length && !allowDuplicate)
      throw new Error(`ほかのリストに登録済みです: ${members.map((x) => x.name).join('・')}`);
    return target;
  }
  async function addVideo(data) {
    const lists = await inspect(data); // Recheck the live NicoNico account immediately before writing.
    const target = decide(lists, data.videoId, String(data.targetId), data.allowDuplicate === true);
    setText(`${data.videoId} を「${target.name}」に登録しています…`);
    const res = await fetch(
      `https://nvapi.nicovideo.jp/v1/users/me/mylists/${target.id}/items?itemId=${encodeURIComponent(data.videoId)}&description=`,
      { method: 'POST', credentials: 'include', cache: 'no-store', headers: header },
    );
    if (![200, 201, 409].includes(res.status))
      throw new Error(
        `登録APIがHTTP ${res.status}を返しました。登録の成否はニコニコ側で確認してください`,
      );
    // Never claim success solely because POST returned 200/201/409.
    let verified = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      await sleep(400 + 200 * attempt);
      verified = await fetchList(target.id, data.videoId);
      if (verified.found) break;
    }
    if (!verified?.found)
      throw new Error(
        '登録が完了したことを一覧から確認できませんでした。DBは更新せず、ニコニコで確認してください',
      );
    return {
      videoId: data.videoId,
      listId: target.id,
      listName: target.name,
      title: verified.title || data.videoId,
      confirmed: true,
      already: false,
      remoteCount: verified.count,
    };
  }
  // Public video metadata via NicoNico's thumbinfo endpoint. No credentials or
  // Google session tokens are attached; requests originate in the userscript.
  function remoteText(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: 15000,
        anonymous: true,
        onload: (res) =>
          res.status === 200
            ? resolve(String(res.responseText || ''))
            : reject(new Error(`動画情報API: HTTP ${res.status}`)),
        onerror: () => reject(new Error('動画情報APIへの通信に失敗しました')),
        ontimeout: () => reject(new Error('動画情報APIがタイムアウトしました')),
      });
    });
  }
  function parseThumbInfo(xml, id) {
    if (xml.length > 350000) throw new Error('動画情報が大きすぎます');
    const dom = new DOMParser().parseFromString(xml, 'application/xml');
    if (dom.querySelector('parsererror')) throw new Error('動画情報XMLを解析できません');
    const top = dom.querySelector('nicovideo_thumb_response');
    if (!top || top.getAttribute('status') !== 'ok')
      throw new Error(`ニコニコの動画情報を取得できません (${id}：非公開・削除・API制限の可能性)`);
    const thumb = top.querySelector('thumb');
    if (!thumb) throw new Error('動画情報が見つかりません');
    const t = (name) => (thumb.querySelector(name)?.textContent || '').trim();
    if (t('video_id') !== id) throw new Error('返された動画IDが一致しません');
    const len = t('length').split(':').map(Number);
    const duration = len.every(Number.isFinite) ? len.reduce((a, v) => a * 60 + v, 0) : null;
    const n = (name) => {
      const s = t(name);
      return /^\d+$/.test(s) ? Number(s) : null;
    };
    let thumbUrl = t('thumbnail_url');
    try {
      const u = new URL(thumbUrl);
      if (u.protocol !== 'https:' || !/(^|\.)(?:nicovideo\.jp|nimg\.jp)$/.test(u.hostname))
        thumbUrl = '';
    } catch {
      thumbUrl = '';
    }
    const tags = [...thumb.querySelectorAll('tags tag')]
      .map((x) => (x.textContent || '').trim())
      .filter(Boolean)
      .slice(0, 120);
    return {
      id,
      title: t('title').slice(0, 220) || id,
      description: t('description').slice(0, 20000),
      uploader: t('user_nickname').slice(0, 220),
      uploader_id: t('user_id').slice(0, 40),
      thumb: thumbUrl,
      published_at: t('first_retrieve') || null,
      duration,
      views: n('view_counter'),
      comments: n('comment_num'),
      mylists: n('mylist_counter'),
      genre: t('genre').slice(0, 100),
      tags,
    };
  }
  async function fetchMetadata(data) {
    const id = String(data?.videoId || '');
    if (!videoRe.test(id)) throw new Error('動画情報の対象IDが不正です');
    const xml = await remoteText(
      `https://ext.nicovideo.jp/api/getthumbinfo/${encodeURIComponent(id)}`,
    );
    return parseThumbInfo(xml, id);
  }
  const processed = new Set();
  async function handleRequest(message) {
    if (!approved || processing || message?.nonce !== nonce || !validNonce(message.requestId))
      return;
    const { requestId, action, payload, timestamp } = message;
    if (
      processed.has(requestId) ||
      !Number.isFinite(timestamp) ||
      Math.abs(Date.now() - timestamp) > 120000
    )
      return;
    if (!['inspect', 'register', 'snapshot-list', 'metadata'].includes(action)) return;
    processed.add(requestId);
    processing = true;
    try {
      const result =
        action === 'inspect'
          ? await inspect(payload)
          : action === 'snapshot-list'
            ? await snapshotList(payload)
            : action === 'metadata'
              ? await fetchMetadata(payload)
              : await addVideo(payload);
      send('result', { requestId, ok: true, payload: result });
      setText(
        action === 'inspect'
          ? `確認完了。${payload.videoId}の所属と空き件数をNICO SHELFへ送信しました。`
          : action === 'snapshot-list'
            ? `一覧取得完了：${result.name} ${result.items.length}件\nNICO SHELFで全リストの取得完了と差分を確認してください。`
            : action === 'metadata'
              ? `動画情報を取得しました：${result.id} / ${result.title}\nNICO SHELF側で保存結果を確認してください。`
              : `ニコニコへの登録を確認しました：\n${result.videoId} → ${result.listName}\n\nNICO SHELF側のDB更新結果も確認してください。`,
      );
    } catch (err) {
      send('result', { requestId, ok: false, error: String(err.message || err).slice(0, 400) });
      setText(`処理を完了できませんでした：\n${err.message}`);
    } finally {
      processing = false;
    }
  }
  const requestKey = `nico_shelf_request_${nonce}`;
  GM_addValueChangeListener(requestKey, (_key, _old, message) => {
    void handleRequest(message);
  });
  setInterval(() => {
    const message = GM_getValue(requestKey, null);
    if (message) void handleRequest(message);
  }, 500);
})();
