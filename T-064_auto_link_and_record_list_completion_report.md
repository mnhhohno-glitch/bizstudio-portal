# T-064 PDF取り込み自動紐付け + 配信枠管理レコード一覧タブ 完了報告書

実装日: 2026-05-25
PR: https://github.com/mnhhohno-glitch/bizstudio-portal/pull/17
master マージ済 / staging マージ済 (commit `e3d83e5`)
Railway 本番反映確認済（`/api/scout/slots/list` → 401 で route 登録確認）

---

## 完了条件チェックリスト

| # | 項目 | 結果 |
|--|--|--|
| 1 | `src/lib/scout/auto-link.ts` 新規作成 | ✅ |
| 2 | pdf-upload route 改修 | ✅ |
| 3 | MynaviRpaProcessingLog に紐付け結果カラム追加 | ✅ scoutLinkResult / scoutLinkedSlotId |
| 4 | ScoutLinkPanel 調整（自動紐付け済み表示対応） | ✅ |
| 5 | 新規 API `/api/scout/slots/list` 実装 | ✅ |
| 6 | レコード一覧タブ UI 実装 | ✅ デフォルトで開いた状態 |
| 7 | 年代カウントロジック実装（応募日基準） | ✅ |
| 8 | 応募率①② の定義確認・実装 | ✅ 既存 src/app/(app)/scout/page.tsx の applyRate と整合（①= apply/delivery） |
| 9 | テスト PASS（新規 + 既存） | ✅ 新規 30件 + 既存 61件 = 全91件 PASS |
| 10 | master マージ済 | ✅ |
| 11 | staging マージ済（本番反映完了） | ✅ |
| 12 | Railway デプロイ完了確認済 | ✅ |
| 13 | 完了報告書作成済 | ✅ 本ファイル |

---

## 1. 自動紐付けロジック (`src/lib/scout/auto-link.ts`)

### findMatchingSlot

```typescript
findMatchingSlot({ recruiterName, applicationDate }) → MatchedSlot | null
```

1. `ScoutMachineMaster` で `recruiterName` をマッチ（半角・全角スペース揺れ吸収）
2. JST 日付に変換した `applicationDate` + `machineId` で `ScoutDeliverySlot` を検索
3. 候補が複数の場合:
   - `deliveryCount > 0` のみを優先候補集合とする（無ければ全候補）
   - JST 現在時刻と `hourSlot` の差分が最小のものを選択
4. 当日0件 → 前日同条件で再検索
5. それでも0件 → `null`

### autoLinkCandidateToSlot

```typescript
autoLinkCandidateToSlot({ candidateId, recruiterName, applicationDate })
  → { linked, slotId?, scoutNumber?, reason }
```

戻り値の `reason`:

| reason | 意味 |
|--|--|
| `matched` | 紐付け成功 |
| `no_recruiter_name` | recruiterName が空 |
| `no_machine_master` | ScoutMachineMaster にヒットせず |
| `no_candidate_today` | 当日にスロット無し（今は前日も探すため実質出現しない） |
| `no_candidate_yesterday` | 前日にもスロット無し |
| `error` | 内部例外 |

成功時 Candidate に次を書き戻す:
- `scoutDeliverySlotId`: slot.id
- `scoutNumber`: slot.scoutNumber
- `scoutLinkedAt`: new Date()
- `scoutLinkedById`: null（自動紐付け）

---

## 2. pdf-upload route への組み込み

ファイル: `src/app/api/rpa/mynavi/pdf-upload/route.ts`

`Candidate.create` 完了後・`MynaviRpaProcessingLog.create` の前に `autoLinkCandidateToSlot` を呼び、結果を log に書き込む:

```typescript
const linkRes = await autoLinkCandidateToSlot({
  candidateId: candidate.id,
  recruiterName: recruiterName?.trim() ?? null,
  applicationDate: candidate.createdAt,
});
// ...
await prisma.mynaviRpaProcessingLog.create({
  data: {
    // ...
    scoutLinkResult,    // matched | no_machine_master | ...
    scoutLinkedSlotId,  // 紐付けに使った slot id（成功時のみ）
  },
});
```

レスポンスにも `scoutLinkResult` / `scoutLinkedSlotId` を含める（デバッグ用）。

---

## 3. スキーマ + マイグレーション

### スキーマ変更

```prisma
model MynaviRpaProcessingLog {
  // ... 既存フィールド ...
  scoutLinkResult    String? @map("scout_link_result")
  scoutLinkedSlotId  String? @map("scout_linked_slot_id")
  // ...
}
```

### マイグレーション

`prisma/migrations/20260525120000_t064_add_scout_link_result_to_processing_log/migration.sql`

```sql
ALTER TABLE "mynavi_rpa_processing_logs"
  ADD COLUMN IF NOT EXISTS "scout_link_result" TEXT,
  ADD COLUMN IF NOT EXISTS "scout_linked_slot_id" TEXT;
```

Railway 本番に適用済:
```
Applying migration `20260525120000_t064_add_scout_link_result_to_processing_log`
All migrations have been successfully applied.
```

---

## 4. ScoutLinkPanel 改修

ファイル: `src/components/scout/ScoutLinkPanel.tsx`

### 紐付け済み（`scoutDeliverySlotId !== null`）

- 緑バッジで「紐付け済 (日付)」を表示
- 配信枠詳細を `bg-[#EEF2FF]` ボックスで表示（配信日 / 時間 / 担当 / 検索条件 / 媒体）
- スロット詳細は `/api/scout/slots?date=...` を直近60日分順次叩いて取得
- 「再紐付け」ボタンでフォーム展開、「解除」ボタンで紐付け解除

### 未紐付け（`scoutDeliverySlotId === null` かつ `applicationRoute === "スカウト"`）

- 黄色背景の警告: 「自動紐付けに失敗しています。下のフォームから手動で紐付けてください。」
- スカウトNO入力フォーム + 担当者ベースの候補補完（直近3日の配信あり枠）

---

## 5. レコード一覧 API (`/api/scout/slots/list`)

### リクエスト

```
GET /api/scout/slots/list?
  startDate=2026-05-18&endDate=2026-05-26
  &deliveryCategoryLarge=社員      (任意)
  &deliveryCategoryMedium=一斉配信  (任意)
  &machineId=...                   (任意)
  &mediaSource=マイナビ転職          (任意)
  &sortBy=deliveryDate             (任意, default=deliveryDate)
  &sortOrder=desc                  (任意, default=desc)
```

`sortBy` の許容値: `deliveryDate | hourSlot | deliveryCount | openCount | applyCount | scoutNumber`

### レスポンス例

```json
{
  "slots": [
    {
      "id": "...",
      "scoutNumber": "SC10076685",
      "deliveryCategoryLarge": "社員",
      "deliveryCategoryMedium": "一斉配信",
      "deliveryCategorySmall": "検索条件指定",
      "mediaSource": "マイナビ転職",
      "machineId": "...",
      "machine": { "id": "...", "recruiterName": "大野 望", "machineLabel": "社員1", "isMachine": false, "isActive": true },
      "deliveryDate": "2026-05-25",
      "dayOfWeek": "月",
      "hourSlot": 14,
      "timeBlock": "午後",
      "deliveryCount": 100,
      "openCount": 40,
      "openRate": 40,
      "applyCount": 4,
      "applyRate1": 4,
      "applyRate2": 10,
      "searchConditionName": "営業職_東京_30代男性",
      "isAggregationTarget": true,
      "isMachine": false,
      "ageGroups": { "20s": 1, "30s": 2, "40s": 1, "50s": 0 }
    }
  ],
  "total": 1
}
```

### 集計ロジック

- 開封率 = openCount / deliveryCount × 100
- 応募率① = applyCount / deliveryCount × 100（配信に対する応募率、既存 `applyRate` と同定義）
- 応募率② = applyCount / openCount × 100（開封者に対する応募率、追加）
- 時間帯: 8〜11=午前 / 12〜13=昼 / 14〜16=午後 / 17〜19=夕方

### 年代カウント（応募日基準）

```typescript
for (const c of slot.linkedCandidates) {
  if (!c.birthday) continue;
  const age = ageAtDate(c.birthday, c.createdAt);
  if (age >= 20 && age < 30) ageGroups["20s"]++;
  else if (age >= 30 && age < 40) ageGroups["30s"]++;
  else if (age >= 40 && age < 50) ageGroups["40s"]++;
  else if (age >= 50 && age < 60) ageGroups["50s"]++;
}
```

`ageAtDate` は Candidate.birthday と Candidate.createdAt（応募日）から満年齢を算出。60代以上は集計対象外。

---

## 6. レコード一覧タブ UI

ファイル: `src/app/(app)/scout/slots/page.tsx`

### タブ構成

ページ上部に2タブ:
1. **レコード一覧**（デフォルト = 開いた状態）
2. **マトリクス表示**（従来の表）

### レコード一覧タブの構成

- フィルタ行: 期間（startDate〜endDate）/ 配信種別 / 中フラグ / 配信者 / 媒体
- 初期表示期間: 過去7日〜翌日（=「過去7日 + 当日 + 翌日 = 9日」要件に沿う）
- 22列テーブル: スカウトNO / 配信種別 / 中 / 小 / 媒体 / 配信者 / 配信日 / 曜日 / 時間 / 時間帯 / 配信数 / 開封 / 開封率 / 応募 / 応募率① / 応募率② / 検索条件名 / 20代 / 30代 / 40代 / 50代 / 操作（複製）
- 並び替え: ヘッダクリック（▲/▼）で `scoutNumber, deliveryDate, hourSlot, deliveryCount, openCount, applyCount` を切替
- 行アクション: 社員枠のみ「複製」ボタン（マトリクスタブと共通の複製モーダルを再利用）

### マトリクスタブ

従来の `(machineId, deliveryCategoryMedium)` 単位カラム表示はそのまま残す。

---

## 7. テスト結果

### 新規テスト

| テスト | PASS / FAIL |
|--|--|
| test-scout-auto-link.ts | 17 / 0 |
| test-scout-slots-list.ts | 13 / 0 |

`scripts/test-scout-auto-link.ts` でカバーするケース:
1. 当日に1件のスロット → 紐付け成功（Candidate.scoutDeliverySlotId / scoutNumber / scoutLinkedAt 全て更新）
2. 当日に個別配信+一斉配信あり → `deliveryCount>0` 優先で選択
3. 当日にスロット無し → 前日にフォールバック
4. `recruiterName` が `ScoutMachineMaster` にヒットしない → `no_machine_master`
5. `recruiterName` が null → `no_recruiter_name`
6. 当日も前日もスロット無し → `no_candidate_yesterday`

`scripts/test-scout-slots-list.ts` でカバーするケース:
- 年代カウント（20代×1, 30代×2, 40代×1, 50代×0）
- 開封率 / 応募率① / 応募率② の計算
- 曜日 / 時間帯ロジック

### 既存テスト（リグレッション確認）

| テスト | PASS / FAIL |
|--|--|
| test-scout-slot-creation | 13 / 0 |
| test-scout-phase-a | 17 / 0 |
| test-scout-aggregated | 17 / 0 |
| test-scout-aggregated-auto-create | 14 / 0 |

### TypeScript / Lint

```
$ npx tsc --noEmit
(エラーなし)
$ npx eslint <変更ファイル>
(エラーなし)
```

---

## 8. 実装ファイル一覧

| ファイル | 種別 | 内容 |
|--|--|--|
| `src/lib/scout/auto-link.ts` | 新規 | findMatchingSlot / autoLinkCandidateToSlot |
| `prisma/schema.prisma` | 修正 | MynaviRpaProcessingLog に scoutLinkResult / scoutLinkedSlotId 追加 |
| `prisma/migrations/20260525120000_t064_add_scout_link_result_to_processing_log/migration.sql` | 新規 | カラム追加マイグレーション |
| `src/app/api/rpa/mynavi/pdf-upload/route.ts` | 修正 | autoLinkCandidateToSlot 呼び出し + ログ記録 |
| `src/components/scout/ScoutLinkPanel.tsx` | 大幅改修 | 自動紐付け済み表示 + 警告表示 + 再紐付けボタン |
| `src/app/api/scout/slots/list/route.ts` | 新規 | 一覧 API（フィルタ・並び替え・年代別集計） |
| `src/app/(app)/scout/slots/page.tsx` | 大幅改修 | 2タブ（レコード一覧デフォルト + マトリクス） |
| `scripts/test-scout-auto-link.ts` | 新規 | 自動紐付け E2E テスト |
| `scripts/test-scout-slots-list.ts` | 新規 | 集計ロジックテスト |

---

## 9. デプロイ確認

### Railway staging

```
GET https://bizstudio-portal-staging-production.up.railway.app/api/scout/slots/list?startDate=2026-05-25&endDate=2026-05-25
→ 401 (認証必須、route 登録済)
```

---

## 10. 既存応募者の扱い

過去に取り込まれた応募者で `scoutDeliverySlotId === null` のものは、本実装後も自動的には紐付けされない。

これらは以下のいずれかで対応:
- ScoutLinkPanel から CA が手動で紐付け（既存 UI 維持）
- 将来バッチ処理を実装する場合は別タスクとして起票

警告表示により、未紐付けの応募者が画面上で目立つようになった。

---

## 11. 変更禁止ファイル

以下は触っていない:
- `src/constants/candidate-flags.ts`
- `specs/` 配下
- `scripts/gas/` 配下
- `src/services/loadSpec.ts`
- `src/services/geminiClient.ts`

Gemini プロンプトには変更を入れていない（要件確認時の決定通り、応募日は `Candidate.createdAt` で代替）。
