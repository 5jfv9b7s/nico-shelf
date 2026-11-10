# アーキテクチャとソースコードの読み方

NICO SHELF は **Vite + 素の JavaScript + Supabase** を使っています。

## ディレクトリ構造

```text
nico-shelf/
├── index.html                     # ViteのエントリHTML
├── src/
│   ├── main.js                    # 起動処理・データ更新・ユーザー操作の調整
│   ├── style.css                  # 画面デザイン
│   ├── app/
│   │   ├── state.js               # UIの初期状態とラベル・バージョン
│   │   ├── library.js             # 所属情報・動画一覧・件数の計算
│   │   └── events.js              # HTMLのイベントをコントローラーに振り分ける
│   ├── ui/
│   │   ├── views.js               # ダッシュボード・一覧・設定画面
│   │   ├── dialogs.js             # 登録・同期・編集ダイアログ
│   │   └── media.js               # サムネイルURLの許可判定
│   ├── supabase.js                # DBからの読み込み・インポート
│   ├── bridge.js                  # ログイン済みニコニコとの通信
│   ├── sync.js                    # スナップショット比較と整合性検証
│   ├── registration.js            # 登録先選択と重複判定
│   ├── discovery.js               # 歌唱者名寄せ・ジャンル・タグ分析
│   └── lib.js                     # 文字列処理・CSV・並び替えなど
├── bridge/
│   └── nico-shelf-direct.user.js # Tampermonkey側（ニコニコで動作）
├── tests/                          # node:test による自動テスト
└── supabase/migrations/           # DBの定義とRPC
```

## 一連の動作

```text
ブラウザ上のクリック
  ↓ src/app/events.js
src/main.js の操作関数
  ├─ src/supabase.js・Supabase DB（本人のデータを保存）
  └─ src/bridge.js → Tampermonkey → ニコニコ（読み取り・登録）
  ↓ 更新成功後に表示を更新
src/ui/views.js / dialogs.js
  ↓
ブラウザにHTMLを描画
```

表示関数は Supabase へ書き込まず、DBのデータ構造は表示関数へ直接変更させないようにします。

## 重要な設計判断

- **動画情報とユーザーのメモは分離**：動画メタデータの再取得で、個人の評価を上書きしない。
- **登録は二段階**：ニコニコ本体への成功確認後、Supabaseへ反映する。通信切断時は再登録せず差分同期を使う。
- **同期はプレビューしてから反映**：動画ID単位で差分を比較し、削除済みの登録履歴を維持する。
- **歌唱者の名寄せは表示側で実施**：元の表記（SV・Spicyなど）は消さない。
- **UIの処理はクライアント側**：検索・ランキングの演算はクライアントで実行する。動画数が大幅に増えた場合は改善が必要。
- **UI状態の共有**：`createInitialState()` が返したstateをビューとイベント処理へ注入し、同一オブジェクトを参照する。
- **ログインセッション**：GoogleログインはSupabase Authが担当。ニコニコのCookieはクラウドDBに保存しない。

## 変更すべきファイルの目安

| やりたいこと | 最初に見るファイル |
|---|---|
| 歌唱者の表記統一を修正 | `src/discovery.js` |
| 登録先の優先順位を変える | `src/registration.js` |
| ニコニコからの動画情報取得を変える | `bridge/nico-shelf-direct.user.js` |
| ダッシュボードの表示を直す | `src/ui/views.js` |
| 登録・同期画面の入力項目を変更 | `src/ui/dialogs.js` |
| ボタン押下時の処理を追加 | `src/app/events.js` と `src/main.js` |
| Supabaseのクエリを変更 | `src/supabase.js` と関連処理 |
| ライブラリの件数を変更 | `src/app/library.js` |

## 今後の整理余地

`src/main.js` の操作関数と、`src/ui/views.js` の大きなHTMLテンプレートはまだ長い部分があります。今回の分割は **機能を壊さないことを最優先** した第1段階です。今後、登録・同期・補完の操作を個別コントローラーへ切り出す際は、必ずテストを追加してください。
