# 09. 既存スクリプト・ツール一覧

## bizstudio-portal の scripts/

### recalculate-sub-status.ts
全求職者の supportSubStatus を再計算。`--dry-run` / 本実行。

### complete-phase-c-sync-tasks.ts
Phase C 一括同期で生成されたタスクを完了に変更。`--dry-run` / `--execute`。

### migrate-document-sending-plan-T051.ts
**用途**: 面談入力フォーム「送付予定」フィールドの旧値を新値にマイグレーション

**実行**:
```bash
railway run npx tsx scripts/migrate-document-sending-plan-T051.ts --dry-run
railway run npx tsx scripts/migrate-document-sending-plan-T051.ts --execute
```

**仕様**:
- 「週明け月曜日」「今週中」「求人送付予定」→「送付予定」
- 「未定」「送付済」→ NULL
- idempotent（複数回実行しても安全、対象0件で正常終了）

**作成経緯**: T-051 で送付予定フィールドの選択肢を業務実態に合わせて整理。dry-run でAI解析由来の「求人送付予定」31件を発見し、マッピングに追加して50件全てを「送付予定」に統一。

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
