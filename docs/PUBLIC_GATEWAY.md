# v0.17.5の認証設定

公開マイリストの内容を返すAPIは、ログイン済みのSupabaseセッションを受け付けます。ブラウザは現在のセッションを同一オリジンの取得APIへ渡し、Workerが署名・発行元・対象・有効期限・ユーザー権限を検証します。設定状態だけを返す `/api/public-mylists/status` は公開しています。

| Cloudflareのランタイム設定 | 値 | 保存形式 |
| --- | --- | --- |
| `SUPABASE_URL` | フロントエンドの `VITE_SUPABASE_URL` と同じプロジェクトURL | 変数 |
| `SUPABASE_JWT_SECRET` | 旧HS256方式を使用するプロジェクトのJWT secret | シークレット |

ES256／RS256の公開鍵は、設定したプロジェクトの `/auth/v1/.well-known/jwks.json` から取得し、Workerのメモリで最大10分キャッシュします。ページごとの `/auth/v1/user` 問い合わせは行いません。HS256は共有シークレットを使ってローカルで検証します。キー取得は `redirect: manual` を使い、3xxを認証失敗として処理します。

ローカルJWT検証はトークンの有効期限とキャッシュ済み署名鍵に従います。Auth側での即時失効確認を必要とする運用では、このキャッシュとトークン寿命を考慮してください。DB側の操作には引き続きSupabaseのRLSが適用されます。[SupabaseのJWT署名鍵](https://supabase.com/docs/guides/auth/signing-keys)

| 診断コード | 対応 |
| --- | --- |
| `AUTH_REQUIRED` / `AUTH_INVALID` | アプリへ再ログインして取得する |
| `AUTH_NOT_CONFIGURED` | Workerの `SUPABASE_URL` を確認する |
| `AUTH_LEGACY_KEY_REQUIRED` | 旧HS256プロジェクトの `SUPABASE_JWT_SECRET` をWorkerのシークレットに設定する |
| `AUTH_KEYS_UNAVAILABLE` | 設定したプロジェクトの公開鍵取得が回復してから再試行する |

`PUBLIC_MYLIST_SOURCE=direct` はCloudflare直結のHTTP診断用です。通常の構成は `gateway` です。directでも同じセッション署名検証とIPレート制限を適用します。両方の経路でSupabaseトークンをニコニコへ転送しません。

新規取り込み・同期の両方で、通信失敗やページ欠落は取得中止になります。最終ページが確認でき、公称件数より少ない応答だけが追加・復元モードになります。この場合は既存の所属・順番を保持し、削除判定を保留します。

CSPのスクリプト実行元は同一オリジンに限定しています。動的なグラフの幅・色に使うインラインスタイルを許可し、Supabase接続先はビルド時にプロジェクトの実際のホストへ合わせます。[Cloudflareのヘッダー設定](https://developers.cloudflare.com/workers/static-assets/headers/)

---

# NICO SHELF v0.17 — 公開マイリスト取得サービスの検証と運用

## 現状と目的

ユーザーのブラウザからのリクエストは CORS で拒否され、Cloudflare Workers の公開マイリストAPIへのリクエストは実環境で HTTP 403 でした。同じ公開リスト (75327830) について Windows PowerShell からは HTTP 200 でした。この差は**実行環境ごとにアクセス条件が違う**ことを示すもので、ニコニコがNode.jsや別クラウドを許可している証拠ではありません。

このリリースは公開APIを使う**別Node.js環境を検証できる最小実装**と、ユーザー向けの**URL → 確認 → 追加**画面を備えています。ゲートウェイのクラウド上での成功は未確認。一般公開前に利用条件とアクセス状況を確認してください。アクセス制限の回避を目的にIP変更やCookie転送などを行わないでください。

## 運営者だけが行う手順

### 1. 本番で使う予定のホストから公開情報取得を検査

Node.js 22以上のサーバー上で、リポジトリを配置してから以下を実行します。手元のPCで200でも**クラウド環境で200になるとは限りません**。

```bash
npm run gateway:probe -- 75327830
```

`Upstream HTTP 200` に加え、`Public mylist response: ... items` が表示されて初めて、そのホストからこのリストを取得できたと判断します。403なら、**ゲートウェイを有効にせず**、別の公式な利用方法を検討してください。

### 2. 読み取り専用Node.jsゲートウェイを起動

デプロイ先に環境変数 `GATEWAY_TOKEN`（十分長いランダム文字列、24文字以上）を設定します。例： `openssl rand -hex 32` の結果を**秘密として管理**してください。トークンをGitHub、Viteの `VITE_*` 変数、ブラウザ、公開ドキュメントに含めないでください。

```bash
npm run gateway:start
```

Nodeは `PORT` 環境変数のポート（指定なしでは8788）を待ち受けます。ホスティングサービス側で**HTTPS化**してください。`GET /health` はサーバーの起動確認のみで、ニコニコへのアクセス成功は保証しません。

認証済みの `GET /v1/public-mylists/{数値ID}?page=1..20` しか公開情報を読みません。`X-Nico-Shelf-Gateway-Key` が一致しない場合は401。ゲートウェイにはCORSの許可を付けないため、ブラウザから直接呼ばせません。

アクセスを制限した本番構成（運営側WAF/レート制限、通信監視、稼働率監視）も別途必要です。Cloudflare WorkerにはIPベースのレート制限を維持していますが、Nodeホストをインターネット上にそのまま無制限公開することは推奨しません。

### 3. Cloudflare Workerにゲートウェイを接続

デプロイ先が実際に公開APIを取得できると確認してから、Cloudflare Workerの**ランタイム変数（公開ビルド変数ではない）**を設定します。

| 変数 | 値 |
|---|---|
| `PUBLIC_MYLIST_SOURCE` | `gateway` |
| `PUBLIC_MYLIST_GATEWAY_URL` | `https://<gateway-host>/` (HTTPS、末尾 `/`、パスなし) |
| `PUBLIC_MYLIST_GATEWAY_TOKEN` | Nodeの`GATEWAY_TOKEN`と同じ秘密文字列 |

WorkerはURLパラメータから取得先を受け取らず、このHTTPS固定ホストにのみ送信します。Nodeゲートウェイはさらにニコニコの公開リスト専用URLしか参照しません。`SUPABASE_SERVICE_ROLE_KEY`、ニコニコCookie、ニコニコパスワードは不要です。

> 注意: `PUBLIC_MYLIST_SOURCE=direct` は旧Cloudflare直結を再現する**診断用**であり、実際の検証で403になるため本番には推奨しません。未設定なら「公開マイリストのURL取り込みは現在準備中」となります。

### 4. 結合試験

1. `GET https://<nico-shelf-domain>/api/public-mylists/status` が `{ "available": true }` を返すか確認。これは設定状態だけであり、接続成功を意味しません。
2. 内容取得URLをアドレスバーで直接開いた場合、v0.17.5では `AUTH_REQUIRED`（401）が正常です。セッショントークンをURLに付けないでください。
3. NICO SHELFにGoogleログインし、同期画面のURL入力に `https://www.nicovideo.jp/mylist/75327830` を貼り付ける。アプリが認証ヘッダーを付けて取得し、200と妥当な `items` を返して初めて実通信成功が分かります。
4. 曲名・件数が表示されたことを確認する。キャンセル時にはDBに何も追加しない。
5. 確認後に「このリストを追加する」を押す。既存リストへの同期は差分確認後だけ反映される。
6. 途中で404・403・レスポンス不一致・ページ欠落が起きた場合、空リスト扱いせず中断されることを確認する。

## 制限・安全性

- **公開リストの読み取りのみ**。非公開リストやニコニコ本体への動画登録には、公式に認められた認証・操作権限が必要です。
- サーバーにユーザーのニコニコログイン情報は一切保存しません。Google/Supabaseの個人データにもゲートウェイからアクセスしません。
- 最大20ページ、1ページ100件、上流レスポンス最大1MiB、12秒タイムアウト。ページの欠落は取得エラー。v0.17.3では、最終ページの `hasNext:false` を確認し、動画が1件以上ある場合、公称件数より少ない応答も取得分をプレビューします。保存時は既存の所属・順番を保持し、新規・復元動画を末尾へ加えます。
- 新規リストの保存はSupabaseの既存「リスト作成→取得一覧の適用」の2呼び出しです。通信失敗時に空のリストが残る可能性はありますが、既存データの削除は行いません。将来の原子化は別途SQLマイグレーションで対応します。
- 外部のクラウドゲートウェイで成功する保証はありません。ユーザーに公開する前に、運営側で継続的な実通信・利用規約の確認が必要です。

## v0.17.2: 公開マイリストの入力欄が無効になる場合

従来のUIは `/api/public-mylists/status` の通信・設定チェックが失敗すると、実際の読み取りを試す前にURL入力や同期ボタンを無効化していました。v0.17.2では **事前チェックは参考情報** に変更しています。

- `status` が `available:true`: Cloudflareの接続設定が構文上は揃っています。**Render→ニコニコへの通信成功までは保証しません**。
- `available:false`, `reason:SOURCE_NOT_GATEWAY`: `PUBLIC_MYLIST_SOURCE` を `gateway` に設定してください。
- `reason:GATEWAY_URL_INVALID`: `PUBLIC_MYLIST_GATEWAY_URL` に `https://nico-shelf.onrender.com/` のような **HTTPSのルートURL**（パス・クエリなし）を指定してください。
- `reason:GATEWAY_TOKEN_INVALID`: `PUBLIC_MYLIST_GATEWAY_TOKEN` に24文字以上の秘密値を設定し、Renderの `GATEWAY_TOKEN` と一致させてください。**秘密値をスクリーンショットやログに出さないでください**。
- ステータス取得が一時的に失敗する、または古いHTMLが返る場合: この失敗だけでユーザー操作を禁止しません。URLを入力して実際に読み取りを試し、そこで返った診断コードを確認してください。

診断用URL（GETのみ。内容取得はv0.17.5以降、ログインしたアプリから確認）:

```text
https://nico-shelf.shiokara-lab.workers.dev/api/public-mylists/status
https://nico-shelf.shiokara-lab.workers.dev/api/public-mylists/75327830?page=1
```

**データ保護:** 全ページを取得・検証するまで差分更新を提案せず、ユーザーの明示確認なしでSupabaseを更新しません。
