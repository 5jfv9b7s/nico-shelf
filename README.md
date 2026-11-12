# NICO SHELF v0.13.0 β

ニコニコ動画のマイリストを、Googleログインに対応した自分の音楽ライブラリとして検索・分析・整理するWebアプリです。

- **公開アプリ**: https://nico-shelf.shiokara-lab.workers.dev
- **構成**: Vite / vanilla JavaScript / Supabase（Google Auth + PostgreSQL + RLS）/ Cloudflare Workers
- **ニコニコ連携**: Tampermonkeyのログイン済みニコニコタブから、直接登録・差分同期・メタデータ取得
- **注意**: ニコニコの非公式APIを利用するため、API変更時に同期・登録が動かなくなる可能性があります。

## v0.13の新機能

1. **音楽の変遷：推移グラフ** — ヒートマップに加え、複数項目の折れ線・注目項目の横棒表示を追加。凡例から特定項目を強調でき、分類率もグループ別に表示します。
2. **歌唱者判定の精度改善** — 既存歌唱者情報・タグに加え、タイトルの `feat.` / `/ 歌唱者`、概要欄の `歌唱:` / `Vocal:` / `使用音源:` なども参照します。根拠は動画詳細画面で確認できます。
3. **誤判定を抑制** — 概要欄の単なる名前の言及や、歌唱以外のクレジットは原則として歌唱者に確定せず、要確認候補に残します。「歌唱者に要確認候補あり」フィルタから整理できます。
4. **分類根拠の改善** — ジャンル・雰囲気はタグに加え、概要欄の `ジャンル:` / `雰囲気:` など明示的な表記だけを参考にします。`作曲:` や `Music:` からの作曲者情報も補助的に抽出します。

**重要な限界**: これは保存されているテキスト情報からの推定であり、曲の音声を解析した判定ではありません。概要欄内の自由な言及をすべて歌唱者として採用しないのは誤判定対策です。歌唱者は動画詳細の「歌唱者を自分で修正」で最終確定できます。

## v0.12からの更新

1. アプリの **データと設定 → JSONバックアップ** を保存してください。
2. 更新ZIPを展開し、GitHubの同じフォルダ階層に**変更ファイルの上書きと新規ファイルの追加**を行ってください。`src/app/voice-detection.js`、`src/app/creator-detection.js`、`src/ui/trend-charts.js` の追加を忘れないでください。
3. Cloudflareの自動デプロイ成功を確認し、公開サイトを強制再読み込みしてください。
4. **音楽の変遷** で折れ線／横棒を切り替え、曲の詳細画面で歌唱者の判定根拠を確認してください。

SupabaseのSQL、Google認証、Cloudflare環境変数、Tampermonkeyスクリプトは **変更不要**です。既存の登録・差分同期フローのプロトコルも変更していません。

## ローカル開発

Node.js 22以上を使用します。

```bash
npm install
cp .env.example .env.local
# .env.local に VITE_SUPABASE_URL と VITE_SUPABASE_PUBLISHABLE_KEY を設定
npm run dev
npm test
npm run build
```

Cloudflare Workersへの公開は既存の `wrangler.jsonc` を使います。**`service_role` キー・ニコニコCookie・個人のJSONバックアップをGitHubへコミットしないでください。**

## ソース構成

| 場所 | 担当 |
|---|---|
| `src/app/voice-detection.js` | 歌唱者の名寄せ・タイトル／概要欄・タグ判定・根拠と確認候補 |
| `src/app/creator-detection.js` | 概要欄の明示的な作曲クレジット |
| `src/discovery.js` | 公開用の分類・検索API・ジャンル／雰囲気ルール |
| `src/app/trends.js` | グループ分割・分類率・割合・選択セル集計 |
| `src/ui/trend-charts.js` | 折れ線SVG・横棒・分類率表示 |
| `src/ui/trends.js` | 音楽の変遷ページ（ヒートマップ等） |
| `src/ui/dialogs.js` | 詳細画面・判定根拠・ユーザー手動修正 |
| `src/app/events.js` | 画面操作のイベント委譲 |
| `src/bridge.js` / `bridge/` | ニコニコタブとの安全なローカル連携 |
| `src/supabase.js` / `supabase/` | クラウドDBと権限制御 |
| `tests/` | Node.js標準テスト・回帰検証 |

詳しい仕様は `docs/CLASSIFICATION.md`、`docs/TRENDS.md`、`docs/ARCHITECTURE.md` を参照してください。

## 既知の注意点

- マイリストの**表示順**は正確な登録日ではありません。投稿年も聴取年ではありません。
- 1曲に複数人が歌唱・複数タグが付与されるため、割合の合計は100%にならない場合があります。
- 未分類動画の分母を消さないため、グラフには**分類率（根拠を確認できた動画の割合）**を必ず併記しています。
- 追加の判定ルールは、意図しない誤判定を防ぐためテストとセットで変更してください。
- この開発環境では依存パッケージをインストールできず、Vite本番ビルドと実ブラウザ画面での最終確認は未完了です。Cloudflareのデプロイ後に確認してください。
