# 09. 既存スクリプト・ツール一覧

## bizstudio-portal の scripts/

### recalculate-sub-status.ts
全求職者の supportSubStatus を再計算。`--dry-run` / 本実行。

### complete-phase-c-sync-tasks.ts
Phase C 一括同期で生成されたタスクを完了に変更。`--dry-run` / `--execute`。

## kyuujin-pdf-tool の scripts/

### sync_unsubmitted_feedbacks_to_portal.py
既存 JobFeedback を portal に一括同期。`--dry-run` / `--execute`。

### cleanup_duplicate_jobs_5004379.py
志喜屋美心さんの重複Jobクリーンアップ。

## 動作確認に使うコマンド

### 本番DB直接クエリ（portal）
```bash
railway run npx tsx -e "import { prisma } from './src/lib/prisma'; ..."
```

## スクリプト作成の標準パターン

1. 必ず `--dry-run` モードを実装
2. idempotent にする
3. 影響範囲を絞る条件を明確に
4. 実行ログを十分に出す
