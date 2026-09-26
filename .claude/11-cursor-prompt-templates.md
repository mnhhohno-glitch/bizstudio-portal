# 11. Cursor プロンプトテンプレート

## 基本原則

- Cursor プロンプトは Markdown (.md) ファイルで受け取る
- 「調査→実装→コミット→push」まで確認停止せず一気に実行が標準
- 各プロンプトに対象リポジトリを明記
- デプロイ手順（git コマンド）は本文に含める

## コミットメッセージ規約

```
<type>(<scope>): <summary>
```

type: feat / fix / refactor / chore / docs / style / perf / test
scope: bookmarks / interviews / entries / mypage / auth / scripts / ai

## プロンプトの種類

### A. 調査プロンプト（実装なし）
冒頭で「**本プロンプトは調査のみ**」を明示。コード変更禁止。

### B. 実装プロンプト
調査結果を冒頭に書き、修正項目を明確化。push まで一気に実行。

### C. データ移行スクリプト
dry-run と execute の両モード必須、idempotent 必須。

## アンチパターン

- 曖昧な指示（「いい感じに」）
- 影響範囲を書かない
- デプロイ判断を丸投げ
- 動作確認手順なし

## 実装プロンプトに含める定型（2026-09-27 追記, T-205）

- 確認用ビルド: `npx prisma generate && npx next build`（ローカルの dev サーバー停止中に実行）。**`npm run build` は本番DBへの `prisma migrate deploy` を含むため使わない**（罠#53）。
- push: `node scripts/wait_railway_idle.mjs && git push origin master`（開発機に Python が無い）。
- マイグレーション: `prisma migrate dev` は使わず、`prisma migrate diff --from-schema <旧> --to-schema prisma/schema.prisma --script` → 手書き SQL（`IF NOT EXISTS` で冪等）。ローカルから `migrate deploy` は実行しない（本番反映時のビルドで適用）。
