# NICO SHELF v0.17.1 — 初めての人向け取り込み・同期

## 一般ユーザーの操作

1. GoogleでNICO SHELFにログイン。
2. ホームの「マイリストを取り込む」を押す。
3. **公開**マイリストのURLか数字のIDを入力して「内容を確認する」または Enter。
4. 新しいマイリストなら動画一覧を確認して「このリストを追加する」を押す。
5. 同じURLをもう一度入力したら、登録済みリストの差分画面が表示される。「確認して差分を反映」を押すまではDBに変更なし。

Renderの起動直後は接続が遅い場合があります。取得中はページ番号や再接続中の状態を表示します。一時的な通信エラーでは1回だけ再試行します。403（アクセス拒否）・429（利用制限）・不正データ・非公開リストは再試行せず同期を中止します。

## 運営側の構成

- 公開マイリスト取得: Browser → Cloudflare Workers → Render Node gateway → ニコニコ公開API。
- Renderは既存の `https://nico-shelf.onrender.com/` のバックエンドを維持。
- Cloudflare Workersの既存設定 `PUBLIC_MYLIST_SOURCE=gateway`、`PUBLIC_MYLIST_GATEWAY_URL`、`PUBLIC_MYLIST_GATEWAY_TOKEN` は変更不要。
- `GATEWAY_TOKEN` はRenderの環境変数に保持し、利用者やGitHubへ露出させない。
- Supabaseの認証・RLSはライブラリのDB操作にのみ使う。
- 非公開リストの取得とニコニコ本体への直接登録は従来の任意Tampermonkey連携が必要。

## デプロイ後の確認項目

1. Cloudflare Workers のビルド・デプロイが成功する。
2. ホームから公開リスト取り込み画面を開ける。
3. 既存の公開リストURLを入れると、新規登録せず差分プレビューへ進む。
4. 初めてのURLは動画を確認してから明示的に追加できる。
5. Renderが一時停止状態から起動するとき、画面が閉じたり入力URLが消えたりしない。
6. 失敗した取得が空リスト扱いにならず、DBの動画が削除扱いにならない。
7. 過去のTampermonkey同期とJSONインポートの導線も残っている。

## 開発者向け検証

```bash
npm test
npm run check:imports
npm run build
```

`npm run build` は Vite などを `npm install` した環境で行ってください。ローカルで依存関係を取得できない場合はCloudflareのビルドログを確認します。
