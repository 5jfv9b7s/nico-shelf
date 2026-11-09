# NICO SHELF v0.5 — ニコニコとの差分同期プレビュー対応

**個人用NICO SHELF v0.3（Node.js + SQLite）の次世代版。** Cloudflare Pages + Supabase Auth / PostgreSQL。ユーザーごとのマイリスト・メモ・評価を管理し、ブラウザからインポート／バックアップできます。

> 現在は **Googleログイン + クラウドDB + インポート + 検索/ソート + 重複・所属確認 + 分析 + 個人メモ + ニコニコのスナップショット差分同期**。ニコニコ本体への直接登録・自動同期は未移植。v0.3のTampermonkeyスクリプトを公開サイトに接続しないでください。


## v0.5: ニコニコとの差分同期（手動・安全優先）

**v0.5は、ニコニコのログイン済みタブからマイリストの現在の一覧を取得し、クラウドDBとの差分を確認してから反映する機能です。** 「登録」ボタンからのニコニコ本体への直接書き込みや完全自動同期はまだ実装していません。

- ニコニコから取得するのは **動画ID・動画タイトル（取得できる場合）・リスト内表示順**。ニコニコCookie／Google OAuthトークンは外部へ送信も保存もしません。
- ブラウザのTampermonkeyスクリプトは、ユーザーが押した時だけ **ニコニコAPIをGETで読み取り、JSONをローカルに保存**します。アプリへ自動送信しません。
- NICO SHELF側でJSONを選択すると、リストごとに **追加／削除候補／順番変更** と具体的な動画IDをプレビューできます。
- **「差分を反映」ボタンを押した時だけ**、SupabaseのRPCで1トランザクションで反映します。
- ニコニコに存在しなくなった登録は`entries.present=false`で履歴を残すだけ。**動画データやメモ・評価は削除しません**。
- リスト一覧の途中取得に失敗した場合、スナップショットを生成しません。リスト数とIDを確認してから反映してください。
- 現時点のニコニコ内部APIは非公式・未検証です。仕様変更・認証制限で取得できない場合があります。ログイン済みのPCブラウザで実行してください。

### 既存v0.4からの更新

1. GitHubの既存のソースを本ZIPの `src/` と `bridge/`、`package.json`、`README.md`、`wrangler.jsonc`、`supabase/migrations/`、`tests/` で更新します。既存のCloudflare Workersのデプロイ設定は `npm run build` → `npx wrangler deploy` のまま。
2. [Supabase SQL Editor](https://supabase.com/dashboard/project/xlgchlblzssypmeslmsk/sql/new) で **`supabase/migrations/202611090002_sync_snapshot.sql` だけ**を実行します。既存テーブルを作り直したりデータを初期化したりしません。
3. ChromeのTampermonkeyに `bridge/nico-shelf-snapshot.user.js` を **新規スクリプトとして**登録して保存します。ローカルv0.3のスクリプトとは別物です。
4. Cloudflareの自動デプロイ完了後、NICO SHELFの「↻ ニコニコとの差分同期」から「ニコニコで一覧を取得する」を押します。ニコニコ側に表示されるパネルで「一覧を取得する」を押すと、`nico-shelf-snapshot-YYYY-MM-DD.json` がダウンロードされます。
5. NICO SHELFに戻り、そのJSONを選んで、例えば **ぼかうた3: ニコニコ125件 / DB126件** の差分動画IDを確認します。差分が妥当なら「事前にバックアップ」→「確認して差分を反映」。

**ファイルのアップロード先はユーザー自身のブラウザからSupabaseです。** 個人のJSONはGitHubやCloudflareのソースに含めないでください。取得JSONを他人に共有しないでください。

### 同期対象と安全性

- 数字のニコニコマイリストIDだけを同期対象としてリンクに含めます。`local-...` で作成した内部管理リストは対象外。
- アカウントのマイリスト4件から指定して取得したものだけを反映し、**未取得のリストを勝手に空にしません**。
- 取得時点の一覧順が`position`に入ります。歴史的な登録日時そのものではありません。
- スナップショットの期限は反映時24時間。古いファイルは再取得してください。
- データは既存Supabase AuthとRLSによりログイン中の本人だけが変更できます。**`service_role`/`sb_secret`キーは使用しません。**
- ニコニコ側のAPI応答が異なる、ページ送りが完了しない、動画IDが判別できない場合は、差分反映しません。

### 次の段階

v0.6以降では、ログイン済みニコニコタブとクラウド間の短期認可・利用者ごとの接続検証を実装し、Webアプリからの直接登録・自動差分同期を検討します。v0.3ローカル用Tampermonkey連携をそのままクラウドに転送するのは危険なので行いません。

---

## まず全体像

- GitHub: `https://github.com/5jfv9b7s/nico-shelf`
- Supabase: `https://supabase.com/dashboard/project/xlgchlblzssypmeslmsk`
- 画面: Vite + 素のJavaScript（React/Next.js不要）
- DB: Supabase PostgreSQL。**4テーブル全部に owner_id + RLS。** ログイン中のユーザー以外は読めません。
- Auth: Supabase Auth の Google OAuth。Googleアカウントとニコニコアカウントは別管理。
- 画像・動画ファイルそのものは保存しません。
- `.env.local`、認証秘密鍵、個人の初期1096曲、DB、バックアップファイルはGitHubにコミット**しない**でください。

## 1. Supabase: SQLを一度だけ実行

1. [Supabase SQL Editor](https://supabase.com/dashboard/project/xlgchlblzssypmeslmsk/sql/new) を開きます。
2. `supabase/migrations/202611090001_nico_shelf.sql` の全文を貼り **Run**。
3. `playlists`, `videos`, `entries`, `user_meta` が作られ、いずれもRLSが有効であることを確認。
4. **すでに前回のv0.4スターターのSQLを実行した場合は、同じSQLをもう一度実行する必要はありません。** 同じテーブル構造を使用しています。

SQLの権限: 公開 `anon` は表を読めず、`authenticated` はRLSにより `owner_id = auth.uid()` のレコードだけアクセスできます。アプリ側で他人の `owner_id` を指定しても読めません。秘密鍵なしで運用します。

## 2. Supabase: Google認証

1. [Google Cloud Console](https://console.cloud.google.com/) でGoogle Auth Platformを準備。
2. OAuthクライアントを **ウェブ アプリケーション**として作成。
3. **承認済みの JavaScript 生成元**: ローカルなら `http://127.0.0.1:5173`、公開後なら `https://あなたのサイト.pages.dev`。
4. **承認済みリダイレクトURI**: Google側には **`https://xlgchlblzssypmeslmsk.supabase.co/auth/v1/callback`** を登録する（SupabaseのGoogleプロバイダー画面に表示される値を優先）。CloudflareのURLをここに入れるのではありません。
5. [Supabase Authentication → Sign In / Providers](https://supabase.com/dashboard/project/xlgchlblzssypmeslmsk/auth/providers) のGoogleを有効にし、Googleの **Client ID / Client Secret** をSupabase内に登録する。**Secretをリポジトリへ書かない**。
6. [Supabase Authentication → URL Configuration](https://supabase.com/dashboard/project/xlgchlblzssypmeslmsk/auth/url-configuration) の **Redirect URLs** に次を追加:
   - `http://127.0.0.1:5173/`
   - `https://あなたのサイト.pages.dev/`
   - Site URLは公開後のURLを指定（公開前はローカルURLでもよい）。
7. Google OAuth同意画面が Testing の間は、Google Cloud Console のテストユーザーに自分のGoogleアカウントを追加する。

新規ユーザーを許可して一般公開する場合、SupabaseのSign-up設定を有効にする。**自分だけで試す間はGoogle側のTesting/テストユーザーで対象を限定**するのが安全。

## 3. ローカルで起動

Node.js 22.13以降（Node.js 24推奨）を使用。

```powershell
npm install
Copy-Item .env.example .env.local
notepad .env.local
npm run dev
```

`.env.local` の値:

```env
VITE_SUPABASE_URL=https://xlgchlblzssypmeslmsk.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxx
```

`VITE_` の値は**ブラウザ配布される公開用設定**です。Supabaseの `sb_secret_...` や `service_role` キーを入れないこと。URLは秘密ではありません。公開キーもRLSが有効であることが前提です。

ブラウザから `http://127.0.0.1:5173/` にアクセスし、Googleでログインしてください。

## 4. ライブラリを取り込む

ログイン後「データを取り込む」を押してファイルを指定。

- **JSON**: v0.3の「JSONバックアップ」、またはローカルv0.3の `data/initial.json`（変更済みのメモを引き継ぐならJSONバックアップがおすすめ）。動画・リスト・所属情報・ユーザー個人メモを読み取ります。
- **CSV**: `samples/import-example.csv` 参照。最低限 `playlist_id,playlist_name,video_id` 列が必要。任意で `position,title,uploader,voices,views,tags`。引用符と複数行セルに対応。動画詳細がない場合はタイトルがIDになります。
- **インポートの処理**: ファイルはブラウザ内で解析し、サインイン済みのユーザー権限でSupabaseに送ります。秘密キーは不要。同じ主キーは上書き、無関係な既存データは削除しません。
- **部分成功に注意**: 途中で回線が切れると、一部のバッチだけ保存されることがあります。同じファイルをもう一度インポートして復旧できます。ユーザーごとの既存データを使っている場合、上書きされる列にも注意してください。
- バックアップファイルをGitHubに置かないでください。一般公開するサイトにも個人用JSONを同梱しないでください。

## 5. Cloudflare Workers / Pagesに公開

1. GitHubに **このフォルダの中身だけ**をプッシュ（`package.json` がリポジトリ直下に来るようにする）。
2. Cloudflare Dashboard → Workers & Pages → Pages → **GitHubリポジトリに接続**。
3. Framework preset: `Vite`（または None）、Build command: `npm run build`、Output directory: `dist`。
4. Build環境変数（Production / Previewに必要ならそれぞれ追加）:
   - `VITE_SUPABASE_URL`: `https://xlgchlblzssypmeslmsk.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: Supabaseの公開用キー
5. デプロイ後の実際の `https://....pages.dev` をGoogle CloudのJS生成元とSupabaseのRedirect URLsへ追加。Site URLも更新。
6. アプリにアクセスしてGoogleログイン → インポート → 検索/重複/並び替えを確認。

> Googleに登録するOAuth callbackはSupabase側のURL。アプリに戻るredirect URLはCloudflare側。この二つを混同しないこと。

## 6. 主な機能・注意

- 検索: 曲名、動画ID、投稿者、歌唱者、タグ、メモ
- ソート: 再生数、コメント数、投稿日、再生時間、タイトル、**リスト内順番**、リセット
- 追加したリストごとに動画の所属を表示、2リスト以上で重複バッジ
- お気に入り、個人メモ、評価、ユーザーごとの歌唱者ランキング
- ログイン中の本人だけが動画を **DBに仮登録**可能。ニコニコ本体には追加しません。
- リスト内順番はデータ取得時の並び。正確な登録日時は保証できません。
- Supabaseは1クエリ最大1,000行が既定なので、アプリは **400行ずつ全件取得**します。大きなライブラリでは読み込みに時間がかかります。今後はサーバー側の検索/集計に移行する予定。
- 初期データ、本人のニコニコCookie、既存v0.3の接続トークンはクラウド版に転送しません。
- 本人のライブラリは「データと設定」から削除できます。ログイン用のSupabase Authユーザー自体の削除機能はまだありません（一般公開前の課題）。

## 7. v0.6に持ち越す項目（重要）

- ニコニコログイン済みページとの安全な連携プロトコルの新設（ユーザー識別、端末ごとの短期認可、悪意のあるジョブ実行を防ぐ）
- ニコニコ側APIの利用規約・負荷・変更可能性の検証
- 完全自動の差分同期と動画メタデータ補完
- 正確なリストの登録順・手動並び替えの仕様の確認
- ローカルだけでなく一般利用を想定した、アカウント削除・プライバシーポリシー・問い合わせ窓口

## コマンド

```sh
npm test        # データ変換・並び替え・重複判定等のテスト
npm run build   # Cloudflare配布用 dist/ を作成
npm run preview # 配布物の表示確認
```

公式ドキュメント:
- https://supabase.com/docs/guides/auth/social-login/auth-google
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/auth/redirect-urls
- https://developers.cloudflare.com/pages/configuration/build-configuration/
