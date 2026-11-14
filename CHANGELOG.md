## 0.18.0

- 統計分析画面に相関・単回帰・重回帰・主成分・相関ルール・クラスタリングを追加しました。
- 対象マイリスト／歌唱者の選択、項目と変換の指定、結果CSV、曲詳細への導線を追加しました。
- Web Workerで計算し、中止・古い応答の破棄・ユーザー切り替え時の結果消去に対応しました。
- 階層型は平均連結法、k-meansはk-means++の複数初期化を使用します。階層型の300曲制限と標本外件数を表示します。
- 数値参照テストと操作・エスケープ・Workerの回帰テストを追加しました。
- SQL変更なし。v0.17.5の公開取得認証設定を引き継ぎます。

## 0.17.5

- CSP、サムネイルエラーのイベント委譲、GoogleログインのPKCE化を追加しました。
- 公開マイリスト取得APIにSupabase JWTのローカル署名検証を追加しました。
- ゲートウェイのトークンを固定長ハッシュの定数時間比較へ変更しました。
- ロックファイルを追加し、CIに `npm ci` と整形チェックを組み込みました。ソース全体を整形しました。
- 主要ラベルを12px以上にし、件数差がある場合の削除判定保留の案内を補足しました。

## 0.17.4

- 変遷ヒートマップの左端列を横スクロール時に固定しました。
- グリッドカードの数値と操作ボタンの重なり、曲名の外部リンク矢印の折り返しを修正しました。
- 「↑ 上へ」ボタンと、画面・一覧ページ切り替え時の自動スクロールを追加しました。
- バージョン表示を0.17.4へ更新しました。

## 0.17.3

- 公開APIが最終ページまで返しても公称件数に届かない場合、取得した動画のプレビューと追加・復元を可能にしました。
- 件数差と、今回の応答に含まれなかった登録済み動画を表示します。
- 件数差があるリストでは既存の所属・順番を保持するRPCを追加しました。全件取得できたリストは従来どおり同期します。
- `202611130001_public_mylist_partial.sql` をフロントエンド更新前に適用してください。

## 0.17.2 — Fix false-negative public gateway readiness blocking

- Status endpoint is advisory only: missing/stale/unreachable `/api/public-mylists/status` never disables URL entry, Enter key, or existing-list sync.
- Show distinct messages for configuration missing vs unable to check status; add recheck control.
- Expose safe reason codes (`SOURCE_NOT_GATEWAY`, `GATEWAY_URL_INVALID`, `GATEWAY_TOKEN_INVALID`) without returning URLs or tokens.
- Keep the actual fetch fail-closed, full-page completeness checks, explicit confirmation, and no DB change on fetch error.

## 0.17.1 — Simpler first-run import and resilient public sync

- Use one URL field for both first-time import and re-sync of an existing list.
- Enter key starts a public import preview; the user still explicitly confirms writes.
- Preserve URL field text, expanded disclosures, and scroll position during status refreshes and long requests.
- Update progress in-place instead of replacing the whole DOM after every page.
- Retry one transient gateway / browser connection error; never retry access-denied, rate-limited, malformed or incomplete responses. No DB write on failed fetch.
- Extend the Worker-to-Render gateway timeout from 15 to 28 seconds to accommodate slow first requests.
- Keep legacy Tampermonkey, Supabase RLS and gateway authentication unchanged.
- 210 local automated tests; deployment smoke testing still required.

## 0.17.0 — URL-first onboarding and optional public mylist gateway

- Public-mylist URL entry is prominently displayed, with full read-only preview before any DB write.
- Added optional zero-dependency Node.js gateway (`gateway/server.mjs`), strictly scoped to public NicoNico list IDs, protected by a server-to-server shared key.
- Worker uses configured HTTPS gateway only (`PUBLIC_MYLIST_SOURCE=gateway`); otherwise returns `PUBLIC_SYNC_NOT_READY` instead of misleading private/deleted errors. Legacy `direct` mode remains available for isolated diagnostics.
- Added status check, error isolation, source-level validation, request bounds, HTTPS-only host pinning, and safe no-write failure behavior.
- New-list confirmation writes the list and validated video snapshot. These are two database calls; if snapshot application fails, an empty list may remain, which is reported rather than silently removed.
- Existing NicoNico-tab extension link remains optional and unchanged.
- Deployment is NOT verified; host-level probe is mandatory before enabling user-facing imports.

## v0.16.3 (2026-11-12) — Cloudflare Workers公開同期の実行時互換性を修正

- **根本原因:** Workers の `fetch()` は `redirect: 'error'` に非対応で、リクエスト送信前に `TypeError` を発生させる。v0.16.2はこれを汎用502にしていた。
- `worker/index.js`: `redirect: 'manual'` + HTTP 3xx の明示的な拒否に変更。fetch先を文字列URLに統一。
- 失敗段階を `NICO_NETWORK`、`NICO_TIMEOUT`、`NICO_REDIRECT`、`NICO_HTTP_ERROR`、`NICO_NON_JSON`、`NICO_INVALID_JSON`、`NICO_INVALID_DATA` 等で区別。Workerログには公開ID、ページ番号、エラー種別だけを記録。
- `X-Niconico-Language` を追加。外部へのCookie/Token転送禁止、レート制限、全ページ検証、失敗時にDBを変更しない仕様を維持。
- フロントはエラー表示に診断コードを追記。次に失敗したときも原因の段階を判断しやすくした。
- 独立した通信・JSON・リダイレクト・パースのテストを追加。実際のCloudflare→ニコニコ通信は公開後要検証。

## v0.16.2 (2026-11-12) — 公開マイリストAPIの503修正

- `worker/index.js`: 読み取り専用の公開APIでSupabase Authに再問い合わせしない構成に変更。Authサービスへの接続失敗やJSON応答による503を回避。
- `src/public-sync.js`: この公開APIにSupabaseのアクセストークンを送らない構成に変更。
- `wrangler.jsonc`: Cloudflareレート制限バインディング（120リクエスト/分・接続元IP）を設定。バインディング未設定時はFail Closedで503。
- 非公開・不正ID・ページ欠落・重複・応答不備・上流通信失敗時はDBを変更しない安全策を維持。
- 旧版のWorker専用Supabase環境変数は不要。ブラウザのVITE_*設定とSupabase RLSは従来どおり。
- 公開APIは認証不要で公開情報のみ返す。レート制限はPoP単位で近似値であり、厳格な世界共通上限ではない。
- Cloudflare→ニコニコAPIの実通信と本番UIは未検証。更新用ZIPでは `wrangler.jsonc` も更新必須。

## v0.16.1 (2026-11-12) — UI・アクセシビリティ改善

- スマホ（600px以下）では左サイドバーを下部6タブに変更。デスクトップのサイドバーは維持。
- 文字サイズとコントラスト、曲の操作ボタン（40〜42px）、キーボードフォーカスを改善。
- 保存検索・詳細フィルタを折りたたみ、一覧がすぐ見えるように。
- ページを直接指定できるドロップダウンを追加。
- 動画の重複所属をライブラリ内から抽出できる絞り込みを追加。
- 変遷の初期表示をヒートマップ中心にし、折れ線・横棒へ切替可能。折れ線はパネル幅に追従。
- 2D散布図の対数目盛を100・1,000・10,000などに統一。0件の除外理由は非表示。
- `#app` 全体のaria-liveを撤去し、トーストだけに読み上げ設定を適用。
- モバイル下部ナビとダイアログの重なり順を調整。モーション削減設定に対応。
- 操作イベントの互換性を維持し、新規UIテスト8件を追加。

**未対応／別途評価が必要**
- 3D散布図のデータ密集時の自動ズーム・奥行き目盛、より厳密なコントラスト計測。
- CSP、GoogleログインPKCEなどの認証・セキュリティ改修は本UI更新に含めない。
- 本番ブラウザでの視覚テストは未完了。

## v0.16.0 (2026-11-12)

- 公開マイリストの拡張機能不要な取得を実装（Cloudflare Workerの認証付き読み取りAPI）。
- 差分同期画面で公開リストの選択とURL/IDからの追加に対応。
- 非公開・ページ不整合・取得失敗では書き込みを中止して従来連携にフォールバック可能。
- GitHub Actions CIを追加。公開APIアダプタと認証ゲートのテストを追加。
- OAuthの利用・マイリスト書き込み権限は未確認であり直接登録を移行していない。

## 0.15.0 — 3軸散布図

- 2D・3D切り替えとZ軸の11指標選択を追加。
- 3D Canvas描画、ドラッグ回転、タッチ操作、ズーム、ホバー表示、詳細画面へのクリックを追加。
- 歌唱者別カラーを既存グラフと共通利用。削除・非公開・取得失敗・数値未取得の動画を除外。
- 3Dの投影・判定・描画を別モジュールに分離し、専用テストを追加。
- 新規ファイル漏れ対策として相対import検査コマンドを追加。
- Supabase、ニコニコ連携、Tampermonkeyのプロトコルは変更なし。

## 0.14.4 — 散布図の軸を拡張

- ニコニコ動画全体のマイリスト登録数（`videos.mylists`）をX軸・Y軸の選択肢に追加。
- 再生数に対するマイリスト率・コメント率・いいね率（1,000再生あたり）を追加。
- NICO SHELF内の所属マイリスト数と、ユーザーが付けた5段階評価を追加。
- ニコニコ全体のマイリスト数と自分のマイリスト所属数を明確に区別。
- 値が未取得の場合は0とせず描画対象から除外。再生数0の動画の反応率は計算しない。
- 軸選択肢を「動画の基本情報」「反応率」「自分のライブラリ」に分類。離散値は整数目盛で描画。
- 非公開／削除／公開状態未確認の動画は以前と同様、散布図の点・件数・相関係数から除外。
- 軸計算・UI選択状態・重複所属・欠損値処理の自動テストを追加。
- Supabase SQL、Tampermonkey、ニコニコ直接登録・差分同期処理は変更なし。

## 0.14.3 — 歌唱候補と散布図の公開状態フィルター

- 知声／Chis-Aを同一歌唱者として認識するよう判定辞書を補完。東北ずん子とLilyの既存配色・判定辞書間の不一致も解消。

- 辞書未登録の歌唱名を、明示クレジットから「要確認候補」として抽出。元データ・ランキングを自動変更しない。
- 削除・非公開・取得失敗の動画を散布図の表示、歌唱者凡例、相関計算から除外。状態不明は削除確定と扱わない。
- 成功したメタデータ再取得後は取得失敗を解消できるようにする。
- 散布図除外の純関数と自動テストを追加。既存v0.14.2機能を維持。

## 0.14.2 — グラフ表示キャラクター拡張

- ランキング／マイリスト別比較：5, 10, 15, 20, 30, 全員表示。
- 音楽の変遷：5, 10, 20, 30, 全項目表示。凡例・強調項目を追加。
- 散布図：凡例を30件表示（初期値）、全員表示、凡例から絞り込み。
- 追加キャラクター色・歌唱者表記の名寄せ辞書。
- 色未設定の歌唱者は安定した自動色を表示。公式色とは区別。
- DBの読み書き、ニコニコ直接登録、差分同期への変更なし。

## 0.14.1 — 歌唱キャラクター配色の訂正

- 音街ウナのオレンジ指定を、公式ビジュアルの紫／青紫系に修正。
- 宮舞モカのピンク指定を、公式設定画の青緑のアクセントを参考にした色へ修正。
- 色の根拠・近似値である点を文書化し、固定カラーの回帰テストを追加。
- グラフの実装・DB・ニコニコ連携は変更しない。

## 0.14.0 — 歌唱キャラクターの配色統一・散布図

- キャラクターごとの色を1か所で管理し、歌唱者ランキングと変遷グラフへ適用。
- キャラクター名で色を固定し、Spicy／SVなどの別表記を同色化。
- 散布図専用画面を追加。再生数・コメント・いいね・動画時間・投稿年を自由に選択。
- 歌唱者別の絞り込み、動画詳細へのクリック、未取得メタデータの除外、Spearman順位相関。
- モバイル向けスクロールとアクセシブルなマーカーを実装。
- 回帰テストを新設（従来の登録・同期機能は変更なし）。

# Changelog

## 0.13.0 — Visual trends and evidence-based classification

- 折れ線・横棒を切り替えられる比較チャートを追加。項目強調と分類率の表示に対応。
- タイトル、概要欄の歌唱クレジット、タグから既存の歌唱者情報を補完する**表示時の推定**を実装。
- ただの名前の言及を「要確認候補」に分離し、詳細画面と検索フィルタで確認可能。
- 明示的なジャンル・雰囲気・作曲者クレジットの補助利用を追加。
- 既存SQL・Tampermonkey・データ形式は変更せず、旧機能の回帰テストを維持。

---

# Changelog

## 0.12.0 — 2026-11-11

- マイリスト別・一覧表示順・動画投稿年別の3種類で聴取ライブラリの傾向を比較
- 歌唱キャラ／ジャンル／雰囲気／作者・投稿者の構成比ヒートマップ、判定情報のある割合を表示
- セルから該当動画へアクセス、最初と最後のグループのパーセントポイント差を表示
- 登録日時と作品投稿日・リスト表示順の違いを画面と仕様書で明記
- 純粋な集計モジュールと表示モジュールを分離、既存同期・直接登録は変更なし
- SupabaseのSQLとTampermonkeyの更新は不要
- 既存80件に専用テストを追加（92件＋画面統合テスト）


## 0.11.0 — 2026-11-11

- 関連動画にバランス・ジャンル／雰囲気重視・別作者／投稿者を探すモードを追加
- 関連動画を「未評価のみ」で絞り込み可能に
- プラットフォーム共通の低情報量タグを一致根拠から除外
- 分析モジュール・UI・操作イベントを分離したまま、8件のテストを追加（合計80件）
- Supabase、Cloudflare環境変数、Tampermonkeyスクリプトの変更なし
- 制限：音声解析なし。作者や投稿者の名寄せの正確性は保証しない

## 0.10.1

- 棒グラフを表示する CSS の修正
