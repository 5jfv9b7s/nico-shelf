# v0.20.0 メタデータ補完

通常の取得経路は、ブラウザ → 同一オリジンのCloudflare Worker → 既存のRenderゲートウェイ → ニコニコの公開thumbinfoです。Tampermonkeyやニコニコへのログインは不要です。アプリへのGoogleログインは必要です。

## 利用方法

「データと設定」の補完画面から、公開情報取得を選んで実行します。一度に最大15動画を順次取得し、リクエスト間を400ms空けます。詳細画面からは1動画を補完できます。新規差分同期後の補完は最大5件です。既存の手動修正・VocaDB情報・メモ・評価を保持し、欠損だけを埋めます。取得失敗で動画を削除・非公開と判断することはありません。

タイトル、説明、投稿者、サムネイル、投稿日、動画時間、タグ、再生・コメント・マイリスト数を取得します。公開thumbinfoにない「いいね数」は変更しません。音声解析や再生履歴の収集は行いません。

## 運営者の更新

追加SQL `202611230001_mylist_names.sql` を全体実行し、RenderとCloudflareを同じソースへ更新します。Renderのルートはリポジトリのルート、Build Commandは `npm ci --omit=dev --no-audit --no-fund`、Start Commandは `npm run gateway:start`。fast-xml-parserは通常依存です。ゲートウェイ共有鍵・JWT設定・IP/アカウント制限は既存のものを使います。新しい環境変数はありません。

実際のRender環境からの通信は、その環境で `npm run gateway:probe:metadata -- sm9` を実行して検証できます。`/health` が200でも取得成功は意味しません。最後にログイン済みアプリの動画詳細から補完を試して、Worker経由とDB保存も確認します。

## 固定エンドポイントと制限

- Worker: `GET /api/video-metadata/{sm|nm|so + 1〜12桁}`。任意URL・追加クエリは拒否。リスト取得と同じ認証前IP枠・認証後アカウント枠を共有します。
- Render: `GET /v1/video-metadata/{id}`。共有鍵が必須。取得先は `https://ext.nicovideo.jp/api/getthumbinfo/{id}` に固定し、リダイレクトを追いません。ユーザーのCookieとSupabaseトークンは渡しません。
- 上流12秒、Worker→Render28秒、ブラウザ35秒。XML/JSONはヘッダーがなくても350,000バイトで打ち切ります。DOCTYPE・ENTITY宣言を拒否し、XML構文、動画ID、カウンター、日時、サムネイルホスト、文字数・配列上限を検証します。
- DTOの許可した項目だけを返します。上流の生本文・内部エラー・秘密情報はブラウザへ返しません。ブラウザは補完途中にアカウントやライブラリが変わったら保存を停止します。

## 取得できない場合

削除・非公開・年齢制限等により、この公開取得元が情報を返さない動画があります。非公式の取得元なので、提供内容・利用可否は今後変わる可能性があります。

`UPSTREAM_METADATA_UNAVAILABLE` は公開メタデータなし、`UPSTREAM_ACCESS_DENIED` は取得環境からの接続拒否、`UPSTREAM_RATE_LIMITED` は上流制限です。`GATEWAY_ERROR` はRender更新や接続設定を確認してください。失敗時は既存のDB情報を保持します。取得方法を従来のTampermonkey連携へ切り替えることもできますが、非公開・削除動画の取得を保証するものではありません。

2026-11-23に開発環境からsm9を1件取得し、HTTP 200とXML解析成功を確認しました。Render本番とCloudflare本番の実通信は、このパッケージの検証には含みません。
