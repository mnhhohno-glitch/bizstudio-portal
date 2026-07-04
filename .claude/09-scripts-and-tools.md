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

### relink-scout-candidates-t135.ts
**用途**: T-135。既存スカウト紐付けを「配信日ベース」へ再紐付け。

**実行**:
```bash
npx tsx scripts/relink-scout-candidates-t135.ts            # dry-run（既定）
npx tsx scripts/relink-scout-candidates-t135.ts --execute
```

**仕様**:
- 対象: `scoutDeliverySlotId` あり かつ `scoutDeliveryDate` あり かつ JST暦日(scoutDeliveryDate)≠現在の紐付き枠の配信日
- 現在の枠と同一 machineId の、scoutDeliveryDate の日の枠を `pickBestSlot`（auto-link と同ロジック）で選び付け替え（scoutDeliverySlotId / scoutNumber を更新）
- 移動先枠が無ければ現状維持（「移動不可」一覧）。scoutDeliveryDate NULL は対象外。枠の新規作成はしない
- idempotent（移動済みは同日となり対象外）

**作成経緯**: T-135。旧 auto-link は応募日で枠を引いていたため配信日別集計が実質「応募日起算」になっていた。実行実績: 308紐付き中 scoutDeliveryDate あり52件、移動25件・同日27件・移動不可0件。

### restore-scout-delivery-t135.ts
**用途**: T-135。欠測したスカウト配信数（deliveryCount）を Excel実測値から復旧。

**実行**:
```bash
npx tsx scripts/restore-scout-delivery-t135.ts            # 検証+dry-run（既定）
npx tsx scripts/restore-scout-delivery-t135.ts --execute
```

**仕様**:
- 対象: 2026-07-01 の 1〜3号機（全枠0）、2026-06-30 の 1号機のみ（2・3号機は更新禁止）
- Excel実測値をスクリプト内定数として保持。**早朝(8時未満)の送信は8時枠へ畳み込む**（`stored[8]=Excel[5..7]+Excel[8]`、9-19時は1:1）。更新対象は RPA/個別配信 枠
- 書込み前に 7/2・7/3（DB一致済み）で規約を突合（実績72/72一致）
- idempotent（現値==新値はスキップ）、`ScoutImportLog` に MANUAL ログを日ごとに1件記録

**作成経緯**: T-135。Power Automate の AGGREGATED_JSON インポートが 7/1 未実行・6/30 は1号機欠落。実行実績: 48枠更新（7/1=1363 / 6/30 1号機=247→日合計1275）。

### auto-link.ts の T-135 新仕様（ライブラリ）
`findMatchingSlot` / `autoLinkCandidateToSlot` に `scoutDeliveryDate?` を追加。**配信日があれば応募日より優先**して枠を選ぶ（NULL時は応募日フォールバック）。呼出元は pdf-upload・master/candidates で scoutDeliveryDate を渡す（parse-resume は応募日から配信日を導出するプレビュー用途のため据え置き）。stats API の `dateMode=applied` も候補者単位バケットへ修正（枠先頭候補者のみ計上するバグを解消）。

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
