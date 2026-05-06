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
