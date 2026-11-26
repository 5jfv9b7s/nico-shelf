## 0.22.1

- 決定木を接続線のある上から下へのツリー図に変更し、数値の「はい／以下」「いいえ／超える」、分類項目の「未観測／観測あり」を分岐線上に表示。
- 条件カード、対象と予測する葉、対象外と予測する葉を色で区別。曲数・クラス別件数・対象割合を各カードへ表示。
- 枝ごとの展開、全体展開、上から3段への戻し、縦横スクロール、開始ノードの中央表示、選択ノードの強調を追加。
- ノードの曲一覧へ移動し、スクロール位置を保持して図に戻る操作を追加。ネイティブのボタンと階層リストで操作可能に。
- 分類計算・評価・CSVの計算部分は変更なし。

## 0.22.0

- 決定木による二値分類を追加。マイリストはユーザーがIDで選択し、アプリ内のお気に入り・指定再生数以上も分類対象にできる。特定のマイリスト名を前提にしない。
- 数値・歌唱者・ジャンル・雰囲気・タグから説明変数を選び、対象を直接定義する所属数や再生数/派生率を除外。
- 二分岐のCART型木をジニ不純度/エントロピーで学習し、深さ・最小葉件数・固定αのコスト複雑度で制限・枝刈り。分岐の開閉とノードごとの曲一覧に対応。
- 共通の二値評価指標と再現可能な層化分割を追加。3/5分割交差検証では、中央値・分類項目の辞書も学習用だけで決める。少数クラスに合わせた分割数調整、欠損ラベル除外、計算量上限を実装。
- 混同行列、正解率、多数派の基準、バランス正解率、適合率、再現率、F1、分割ごとの件数、全曲での説明用木を区別して表示・CSV出力。
- 架空データでscikit-learn 1.8.0の分岐・枝刈り・葉の割合・評価指標と照合。IDによる分類、漏洩防止、分割、未定義指標、UI、Worker、中止・アカウント切替の検証を追加。
- ロジスティック回帰は次の拡張候補。今回の追加は決定木と共通の分類評価機能。

## 0.21.1

- 相関ルールの区切り設定を、設定アイコン・背景・枠・矢印・「開く／閉じる」がある折りたたみ操作へ変更。
- 区切り編集後の再描画でも開閉状態を保持。表示状態は分析用Workerに送らず、計算条件から除外。
- 再生数・投稿年・動画時間に、入力値から作られる分類範囲のプレビューと入力形式の案内を追加。
- 数値・区切りの入力欄を暗色背景・枠・角丸で統一。条件と任意の結論部設定を区分し、選択した属性を強調。
- 統計分析内の補足説明の開閉見出しも、枠・背景・矢印・フォーカス表示で操作可能と分かるように調整。

## 0.21.0

- 相関ルールにAprioriを追加。頻出1項目からprefix join・部分集合の枝刈り・トランザクションID列の積集合で最大5項目を探索し、左右の全ての非空分割から規則を生成。既存の簡易分析も維持。
- 再生数帯・投稿時期・動画時間帯・現在の所属マイリストを分析属性に追加。曲の範囲の選択と、規則に使う属性の選択を分離。区切りを変更可能に。
- 最小共起曲数・最低リフト・結論部に含む属性/項目・表示件数と確信度順を追加。
- 未完了の探索段階を捨て、完了した項目集合だけから部分結果を表示。ルール生成の上限、頻度上位80項目による省略も明示。
- 分析元CSVとWeka用ARFFを追加。全対象曲・頻出項目を結果と同じスナップショットから出力し、空のトランザクションと欠損を保持。結果CSVは複数項目・条件・該当動画IDに対応。
- 総当たり計算との比較、手計算の買い物データ、上位件数選択、区間境界、所属、計算上限、出力、画面とWorker連携の検証を追加。実Wekaによる実行比較は未実施。
- GitHub mainのv0.20.4に元からある公開ページとテストの不一致1件はそのまま記録。公開ページ・DB・ゲートウェイは今回変更しない。

## 0.20.4

- プライバシーポリシーに、外国にある事業者と保存先、第三者への提供、安全管理措置、開示・訂正・利用停止などの請求手続き、苦情の申出先、運営者の氏名・住所の回答方針を追加。
- 利用条件に、同意、免責、利用の制限・停止、条件の変更、準拠法・管轄、対象年齢を追加。
- ログイン画面のボタン直下に、利用条件とプライバシーポリシーへの同意の案内を追加。
- 公開ページの雛形で、運営者名・連絡先に `$&` などを含めると文面が壊れる不具合を修正。
- ホスティング先の国名など運営者だけが確認できる箇所を `【要入力】` として残し、`npm run check:release` が未入力のまま公開しないよう検査。

## 0.20.3

- 統計分析の数値項目の初期選択を「再生数・コメント数・ニコニコのマイリスト数」に変更。
- 既存の初期設定の検証と現行ドキュメントを更新。

## 0.20.2

- 全334テスト、import・整形チェック・ビルドが成功。通常取得・制限待機・中止時の時間表示をサンプル画面で確認。

- 補完の経過時間と残り時間の概算を追加。
- 3件完了後、直近12件の取得・保存時間から速度を計算し、未処理分・今後の休憩・現在の待機時間を加算。
- 初期は計算中と表示し、秒/分/時間の目安に丸めて更新。完了・中止・停止時にタイマーを解除して経過時間を保持。

## 0.20.1

- 15件で終了していた補完を、休憩を挟む全候補の自動継続へ変更。
- 進捗・成功/失敗/未処理件数・中止を追加し、再描画でフォーカスやスクロール位置を失わないよう調整。
- アクセス制限時の待機・同じ動画からの再試行、設定/認証失敗・連続エラーでの停止、ログアウト時の中止を追加。
- ニコニコ公開thumbinfoのAccept指定によるHTTP 406を修正。開発環境からsm29200429で旧指定406/修正200、sm29315733でも修正ゲートウェイ200を確認。
- HTTP診断ログを維持し、動画情報の上流HTTP番号は数値のみアプリへ表示。
- 全326テスト、import確認・ビルド・整形確認が成功。

## 0.20.0

- 公開URL・Tampermonkeyの取得元リスト名を、プレビュー後の同期でDBへ反映。名前だけの差分にも対応。
- 全6種類の統計分析で複数リストを選択可能にし、動画ID単位の重複除去とCSV出力へ反映。
- 既存の認証済みWorker/Renderゲートウェイに公開動画メタデータ取得を追加。通常の補完操作は拡張不要。いいね数は取得元にないため保持。
- XML構文・ID・文字数・項目を検証し、DOCTYPE/ENTITY、リダイレクト、巨大応答を拒否。失敗時のDB変更を防止。
- PCの詳細ダイアログを760pxの二列へ調整。900px未満は縦並び。
- 名前同期用SQL、Render更新手順、メタデータ取得の診断手順・プライバシーの説明を追加。
- 全304テスト、import確認、整形確認、ビルド成功。PC幅とスマホ幅390pxの表示をサンプルデータで確認。開発環境から公開動画sm9の実通信と解析が成功。Render本番・Cloudflare本番は更新後の確認が必要。

## 0.18.1

- 初期の分析項目を3項目に絞り、メニューの番号を外しました。
- kごとの群内平方和・シルエット係数・群サイズを比較できるようにしました。
- 回帰係数のt分布による95%区間と、図の読み上げ・画面上の要約を追加しました。
- 相関ルールに共起曲数順とリフト順の並べ替えを追加しました。
- IPの粗い取得制限に加え、署名検証済みユーザーID単位の独立した制限を追加しました。
- CSPのインラインスタイル許可を属性に限定し、directモードの具体的な診断手順を追記しました。
- wrangler.jsoncを含むWorker再デプロイが必要です。SQL追加はありません。

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
