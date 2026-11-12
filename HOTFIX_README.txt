NICO SHELF v0.14.2 — Cloudflare ビルドエラー修正

原因: src/ui/scatter.js が import する src/app/scatter.js が GitHub リポジトリにありません。

方法:
1. この ZIP を展開し、src/app/scatter.js を GitHub の同じパスにアップロードします。
   GitHub ではリポジトリの直下に src/app/scatter.js があるか確認してください。
2. main ブランチへ Commit します。
3. Cloudflare の新しいビルドの実行結果を確認します。

Supabase、Tampermonkey、環境変数の変更は不要です。
既存のデータは変更しません。
