> **v0.17.5の現在の仕様** — 公開マイリストの内容取得にはログイン済みセッションのローカルJWT検証を適用します。Workerの `SUPABASE_URL` と、旧HS256方式の場合の `SUPABASE_JWT_SECRET` を設定してください。以下のv0.16.xの認証不要という記述は当時の履歴です。現在の設定は [PUBLIC_GATEWAY.md](PUBLIC_GATEWAY.md) を参照してください。

> **2026-11-13 更新：** この文書のv0.16.x時点のCloudflare直結手順は、実環境でニコニコAPIからHTTP 403を返されるため、実際の公開同期手段としては利用できません。v0.17以降は [`PUBLIC_GATEWAY.md`](PUBLIC_GATEWAY.md) を参照してください。別Nodeホストでも取得できるとはまだ確認されていません。

# v0.16.3 追記 — Cloudflare Workersのredirect互換性

v0.16.2のWorkerでは `fetch(..., { redirect: 'error' })` を指定していましたが、Cloudflare Workersはこのモードをサポートしておらず、リクエストを送信する前にTypeErrorを返します。これはCloudflare公式のRequest仕様で明示されています: https://developers.cloudflare.com/workers/runtime-apis/request/

v0.16.3では `redirect: 'manual'` に変更し、3xx応答を明示的に拒否。上流リクエストのエラーは以下のコードに分けて返します。

| エラーコード | 段階 | 意味・確認先 |
|---|---|---|
| `NICO_NETWORK` | fetch | Cloudflare→ニコニコ通信ができない。Workersログで接続エラーを確認 |
| `NICO_TIMEOUT` | fetch | 15秒のタイムアウト |
| `NICO_REDIRECT` | http | APIが予期しない3xxを返した。自動追跡しない |
| `NICO_HTTP_ERROR` | http | ニコニコAPIの4xx/5xx（非公開とレート制限を除く） |
| `NICO_NON_JSON` | response | HTTP 200でもJSONではなく、HTMLのエラー画面など |
| `NICO_INVALID_JSON` | response | JSON形式としてパースできない |
| `NICO_INVALID_DATA` | parse | フィールド不足や動画ID欠落。安全のため同期中止 |
| `NICO_NOT_PUBLIC` | http | 非公開・削除・アクセス制限の可能性 |

本番で失敗したときはAPIレスポンスの `code` と `stage`、Cloudflare WorkersのLogsを確認してください。生の認証トークンやCookieをログに出さないでください。**取得失敗時に空の一覧をDBへ反映しない**仕様は維持しています。

---

# NICO SHELF v0.16.2 — 拡張機能不要の公開マイリスト同期

## 対応範囲

- **可能:** 公開マイリストの動画ID・タイトル・順序を、同一オリジンのCloudflare Worker経由で取得し、ライブラリとの差分をプレビューする。
- **可能:** URL/IDから公開マイリストを追加する。動画の追加・削除候補は必ず事前に確認し、承認時だけDBを変更する。
- **不可:** 非公開マイリストの取得、ニコニコ本体への直接登録・削除。これらは今もTampermonkey連携が必要。
- OAuthのマイリスト読み書きスコープ・利用権限は未確認。公開読み取りAPIをOAuth連携とは呼ばない。

## 503エラー修正の背景

v0.16.0〜0.16.1では、公開データを返す前にWorkerがSupabase `/auth/v1/user` に接続し、通信やJSONの解析に失敗すると `503 認証サービスに接続できませんでした` を返していました。公開マイリストの取得に個別のSupabase Auth情報は不要なため、この再通信を廃止しました。

- Workerの `/api/public-mylists/{数値ID}?page=1` は**公開情報だけ**を返し、認証は不要です。
- 自分のライブラリ（動画、メモ、評価、所属）を読み書きする処理は別経路で、従来どおり **Googleログイン + Supabase RLS** が必要です。RLSのポリシーは変更しません。
- Workerは取得先を `https://nvapi.nicovideo.jp/v2/mylists/{ID}` に固定しています。任意URLへのアクセスはできず、ニコニコのCookie・パスワード・Supabaseトークンも転送しません。
- 認証がないため、外部からも**公開マイリスト情報は読めます**。公開APIの運用にはレート制限を必須とし、一般公開時はCloudflare WAFでの追加制限も検討してください。

## Cloudflareでの設定（v0.16.2）

1. GitHubに `worker/index.js`、`src/public-sync.js`、`wrangler.jsonc` を含む更新ファイルを配置します。**wrangler.jsoncを更新し忘れるとAPIは503を返します。**
2. `wrangler.jsonc` の `ratelimits` 設定により `PUBLIC_MYLIST_RATE_LIMIT` バインディングが作られることを、Cloudflareのデプロイ設定・ログで確認します。今回の設定は接続元IPごとに1分120リクエストです（Cloudflare拠点ごとの近似制限）。
3. `npm run build` だけでなく **`wrangler deploy` によりWorker側コードとバインディングが公開される**必要があります。CloudflareのWorkers Builds/Git連携でWranglerのデプロイまで実行されていることを確認してください。
4. 従来の `VITE_SUPABASE_URL` と `VITE_SUPABASE_PUBLISHABLE_KEY` はアプリのGoogleログイン・DBアクセスに必要なので変更しないでください。
5. **Worker専用**の `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` はこのAPIから参照しなくなったため不要です。動作確認後に削除して構いません。`service_role` / 秘密鍵は追加しません。
6. ブラウザでNICO SHELFへGoogleログインし、公開リストを選んで照合します。

### APIのエラーについて

- `503 レート制限設定がありません`: `wrangler.jsonc` のバインディングが実際のWorkerに反映されていません。
- `429`: アプリ自身のレート制限。しばらく空けて再試行してください。
- `502`: ニコニコAPIがHTTPエラーを返したか、外部通信・応答解析が失敗しました。同期やDBの変更は中止します。
- `403`: 非公開・削除・アクセス制限の可能性があります。対象リストの公開設定を確認してください。

`GET /api/public-mylists/{ID}?page=1` は認証不要ですが、アクセス数制限とID検証がある読み取りAPIです。外部サイトからのクロスオリジンアクセス許可（CORSヘッダー）は設定していません。

## データ保護と限界

- 取得途中の失敗・ページ欠落・件数不一致・ID重複を成功扱いせず、一部だけのスナップショットもDBに反映しません。
- DBへ反映するのはユーザーが確認ボタンを押したときだけです。公開APIにDBの更新権限はありません。
- Workerのレート制限は厳格な全世界共通の上限ではなく、Cloudflareの拠点単位で概算されます。大規模な公開前にはWAF・監視・利用規約を別途検討してください。
- ニコニコ側の公開APIは公式に長期保証されたものではありません。仕様変更やアクセス制限、Worker→ニコニコの接続不可があれば502/403で失敗します。
- 画像・説明文・歌唱者などの全件メタデータ取得は別機能です。既存のTampermonkey連携を引き続き使います。
- **クラウド上の実デプロイとニコニコAPIへの外部通信は配布前に確認できていません。** ローカルのモックテストが通っても本番での取得を保証するものではありません。
