# T-064 スカウトNO発番・応募者紐付け機能 調査報告書

調査日: 2026-05-24

---

## Q1: ScoutDeliverySlot に scoutNumber カラムはあるか

### 実コード（`prisma/schema.prisma:1802-1843`）

```prisma
model ScoutDeliverySlot {
  id           String   @id @default(cuid())
  scoutNumber  String   @unique @map("scout_number") // SC + 8桁数字
  deliveryDate DateTime @map("delivery_date") @db.Date
  hourSlot     Int      @map("hour_slot") // 8〜19（開始時刻）

  machineId String?             @map("machine_id")
  machine   ScoutMachineMaster? @relation(fields: [machineId], references: [id])

  isMachine Boolean @default(true) @map("is_machine")
  isStaff   Boolean @default(false) @map("is_staff")

  // 配信種別3階層
  deliveryCategoryLarge  String  @map("delivery_category_large") // "機械" / "社員"
  deliveryCategoryMedium String? @map("delivery_category_medium") // "個別配信" / "一斉配信"
  deliveryCategorySmall  String? @map("delivery_category_small") // "検索条件指定" / "検索条件未指定"

  mediaSource String @default("マイナビ転職") @map("media_source")

  searchConditionName String? @map("search_condition_name")

  deliveryCount Int @default(0) @map("delivery_count")
  openCount     Int @default(0) @map("open_count")

  isAggregationTarget Boolean @default(true) @map("is_aggregation_target")

  memo String? @db.Text

  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  createdById String?  @map("created_by_id")
  updatedById String?  @map("updated_by_id")

  linkedCandidates Candidate[]

  @@unique([deliveryDate, hourSlot, machineId])
  @@index([deliveryDate])
  @@index([deliveryDate, hourSlot])
  @@index([machineId])
  @@index([mediaSource])
  @@map("scout_delivery_slots")
}
```

**判定: あり。** `scoutNumber String @unique` — SC+8桁数字、ユニーク制約付き。

---

## Q2: ScoutSequence テーブルの仕様

### 実コード（`prisma/schema.prisma:1902-1909`）

```prisma
model ScoutSequence {
  id         String @id @default(cuid())
  lastNumber Int    @map("last_number") // 最後に採番した番号（8桁数字部分）

  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("scout_sequences")
}
```

### seed データ（`scripts/seed-scout-masters.ts:45,87-90`）

```typescript
const SCOUT_SEQUENCE_INITIAL = 10062652;

// ...
await prisma.scoutSequence.create({
  data: { lastNumber: SCOUT_SEQUENCE_INITIAL },
});
```

**seed 初期値: 10062652**（FM最終想定 + 1000）。次回採番は 10062653 から。

### 採番ロジック（`src/lib/scout/scout-number.ts`）

```typescript
export async function reserveScoutNumbers(count: number): Promise<string[]> {
  if (count <= 0) return [];
  return prisma.$transaction(async (tx) => {
    const sequence = await tx.scoutSequence.findFirst();
    if (!sequence) {
      throw new Error("ScoutSequence not initialized");
    }
    const start = sequence.lastNumber + 1;
    const end = sequence.lastNumber + count;
    await tx.scoutSequence.update({
      where: { id: sequence.id },
      data: { lastNumber: end },
    });
    const result: string[] = [];
    for (let n = start; n <= end; n++) {
      result.push(formatScoutNumber(n));
    }
    return result;
  });
}

export function formatScoutNumber(n: number): string {
  return `SC${n.toString().padStart(8, "0")}`;
}
```

トランザクション内で `lastNumber` をアトミックに更新し、`SC` + 8桁ゼロパディングの連番を返す。

---

## Q3: 配信枠作成時にスカウトNOが発番されるか

### 実コード（`src/lib/scout/slot-creator.ts` 全文）

```typescript
import { createDailySlots, parseSlotDate } from "@/lib/scout/slot-helpers";

export interface SlotCreationResult {
  status: "CREATED" | "SKIPPED";
  createdCount: number;
  targetDate: string;
}

export async function createSlotsForDate(
  targetDate: string,
): Promise<SlotCreationResult> {
  const date = parseSlotDate(targetDate);
  const result = await createDailySlots(date);
  return {
    status: result.skipped ? "SKIPPED" : "CREATED",
    createdCount: result.created,
    targetDate: date.toISOString().slice(0, 10),
  };
}
```

### 実コード（`src/lib/scout/slot-helpers.ts:14-72` — `createDailySlots` 関数）

```typescript
export async function createDailySlots(targetDate: Date): Promise<{
  created: number;
  skipped: boolean;
}> {
  const existing = await prisma.scoutDeliverySlot.findFirst({
    where: { deliveryDate: targetDate },
  });
  if (existing) {
    return { created: 0, skipped: true };
  }

  const machines = await prisma.scoutMachineMaster.findMany({
    orderBy: [{ isMachine: "desc" }, { machineNumber: "asc" }, { recruiterName: "asc" }],
  });

  const totalSlots = machines.length * HOUR_SLOTS.length;
  const scoutNumbers = await reserveScoutNumbers(totalSlots);

  const data: Array<{...}> = [];

  let idx = 0;
  for (const m of machines) {
    for (const hour of HOUR_SLOTS) {
      const isStaff = !m.isMachine;
      data.push({
        scoutNumber: scoutNumbers[idx++],
        // ... 他のカラム
      });
    }
  }

  await prisma.scoutDeliverySlot.createMany({ data, skipDuplicates: true });
  return { created: data.length, skipped: false };
}
```

**判定: あり。** `createDailySlots` は `reserveScoutNumbers(totalSlots)` を呼び、8名×12時間=96枠分のスカウトNOを一括発番し、各 `ScoutDeliverySlot` レコードの `scoutNumber` カラムに格納している。

---

## Q4: Candidate のスカウト関連カラム

### 実コード（`prisma/schema.prisma:259-261, 273-277, 298`）

```prisma
  // スカウトNO（手入力。AI抽出対象外）
  scoutNumber String? @map("scout_number")

  // T-064 Phase A: スカウト配信枠との紐付け
  scoutDeliverySlotId String?            @map("scout_delivery_slot_id")
  scoutDeliverySlot   ScoutDeliverySlot? @relation(fields: [scoutDeliverySlotId], references: [id])
  scoutLinkedAt       DateTime?          @map("scout_linked_at")
  scoutLinkedById     String?            @map("scout_linked_by_id")
  mynaviScoutSentAt   DateTime?          @map("mynavi_scout_sent_at") // マイナビPDFから取れる「スカウト送信時刻」（将来自動取得用）

  @@index([scoutDeliverySlotId])
```

**5カラム存在:**

| カラム | 型 | 用途 |
|--|--|--|
| `scoutNumber` | `String?` | 手入力のスカウトNO（SC+8桁） |
| `scoutDeliverySlotId` | `String?` | 配信枠FK（ScoutDeliverySlot.id） |
| `scoutLinkedAt` | `DateTime?` | 紐付け実行日時 |
| `scoutLinkedById` | `String?` | 紐付け実行者のユーザーID |
| `mynaviScoutSentAt` | `DateTime?` | 将来用（スカウト送信時刻の自動取得） |

---

## Q5: スカウトNO紐付け用の API

### 紐付け専用 API: `POST /api/scout/candidates/link`

実コード（`src/app/api/scout/candidates/link/route.ts` 全文）:

```typescript
// POST /api/scout/candidates/link
//   body: { candidateId, scoutNumber }
//   応募者にスカウト配信枠を紐付ける
//
// DELETE /api/scout/candidates/link?candidateId=xxx
//   紐付け解除

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  // ...認証チェック...

  const candidateId = String(body?.candidateId || "").trim();
  const scoutNumber = String(body?.scoutNumber || "").trim();

  if (!isValidScoutNumberFormat(scoutNumber)) {
    return NextResponse.json(
      { error: "スカウト番号フォーマットが不正です（SC + 8桁数字）" },
      { status: 400 },
    );
  }

  const slot = await prisma.scoutDeliverySlot.findUnique({
    where: { scoutNumber },
  });
  if (!slot) {
    return NextResponse.json(
      { error: `スカウト番号 ${scoutNumber} の配信枠が見つかりません` },
      { status: 404 },
    );
  }

  const candidate = await prisma.candidate.update({
    where: { id: candidateId },
    data: {
      scoutDeliverySlotId: slot.id,
      scoutNumber,
      scoutLinkedAt: new Date(),
      scoutLinkedById: user.id,
    },
  });

  return NextResponse.json({ candidate, slot });
}

export async function DELETE(req: NextRequest) {
  // ...認証チェック...
  const candidate = await prisma.candidate.update({
    where: { id: candidateId },
    data: {
      scoutDeliverySlotId: null,
      scoutLinkedAt: null,
      scoutLinkedById: null,
    },
  });
  return NextResponse.json({ candidate });
}
```

**判定: API あり。**
- `POST /api/scout/candidates/link` — `{ candidateId, scoutNumber }` で紐付け
- `DELETE /api/scout/candidates/link?candidateId=xxx` — 紐付け解除
- scoutNumber から ScoutDeliverySlot を検索し、Candidate の `scoutDeliverySlotId`, `scoutNumber`, `scoutLinkedAt`, `scoutLinkedById` を更新

### 全 scout API エンドポイント一覧

| パス | 用途 |
|--|--|
| `/api/scout/candidates/link` | 応募者→配信枠紐付け（POST/DELETE） |
| `/api/scout/cron/create-daily-slots` | 翌日分配信枠自動作成 |
| `/api/scout/import/aggregated` | 集計済みデータ取込 |
| `/api/scout/import/daily-excel` | エクセル配信数取込（multipart） |
| `/api/scout/import/daily-excel-base64` | エクセル配信数取込（Base64） |
| `/api/scout/import/filemaker-legacy` | FM 過去データインポート |
| `/api/scout/masters` | マスタ一覧取得 |
| `/api/scout/open-count` | 開封数一括保存 |
| `/api/scout/slots` | 配信枠取得/更新 |
| `/api/scout/stats` | 集計データ取得 |

---

## Q6: UI 側の実装

### 求職者詳細画面でのスカウトNO入力 UI: あり

#### 1. ScoutLinkPanel（配信枠紐付けパネル）

ファイル: `src/components/scout/ScoutLinkPanel.tsx`

- `applicationRoute === "スカウト"` の場合のみ表示
- SC+8桁の入力フィールド + 「紐付け」ボタン + 「解除」ボタン
- 担当者ベースの候補補完（直近3日の同 recruiterName 配信枠を提案）
- `POST /api/scout/candidates/link` を呼び出して紐付け
- 紐付け済み表示: 配信日、時間、担当者、検索条件、媒体

挿入場所（`src/components/candidates/CandidateDetailPage.tsx:1889-1895`）:
```tsx
<ScoutLinkPanel
  candidateId={candidate.id}
  currentScoutNumber={candidate.scoutNumber}
  applicationRoute={candidate.applicationRoute}
  scoutLinkedAt={candidate.scoutLinkedAt}
  scoutDeliverySlotId={candidate.scoutDeliverySlotId}
/>
```

#### 2. CandidateDetailPage のスカウトNO手入力欄

ファイル: `src/components/candidates/CandidateDetailPage.tsx:366`

```tsx
<input type="text" value={scoutNumber} onChange={(e) => setScoutNumber(e.target.value)}
  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm ..." />
```

求職者編集画面の基本情報セクションに、自由入力のスカウトNO欄がある。これは ScoutLinkPanel とは別に、Candidate.scoutNumber に直接保存する手入力フィールド。

#### 3. CandidateRegistrationModal のスカウトNO入力欄

ファイル: `src/app/(app)/admin/master/CandidateRegistrationModal.tsx:476`

```tsx
<input type="text" value={scoutNumber} onChange={(e) => setScoutNumber(e.target.value)}
  className={inputClass} />
```

新規求職者登録モーダルにもスカウトNO入力欄がある。

### 配信枠管理画面でのスカウトNO表示: あり

ファイル: `src/app/(app)/scout/slots/page.tsx:287-288`

```tsx
<div className="text-[10px] text-[#9CA3AF] truncate" title={slot.scoutNumber}>
  {slot.scoutNumber}
</div>
```

配信枠管理画面（`/scout/slots`）の各枠セルに SC+8桁のスカウトNOが表示されている。

### 一斉配信入力 UI: なし

`/scout/slots` 画面では個別配信枠の deliveryCount / openCount の手入力と、社員枠の複製ボタンがあるが、「一斉配信した」と入力できる専用 UI は存在しない。社員枠の `deliveryCategoryMedium` を「一斉配信」に切り替える UI は未実装。

---

## サマリ

### 動いている機能

| 機能 | 状態 | 根拠 |
|--|--|--|
| ScoutDeliverySlot.scoutNumber カラム | ✅ 存在 | `@unique` 制約付き |
| ScoutSequence 連番管理 | ✅ 動作中 | 初期値 10062652、$transaction で排他制御 |
| 配信枠作成時のスカウトNO自動発番 | ✅ 動作中 | `createDailySlots` → `reserveScoutNumbers` |
| Candidate のスカウト関連カラム | ✅ 5カラム存在 | scoutNumber, scoutDeliverySlotId, scoutLinkedAt, scoutLinkedById, mynaviScoutSentAt |
| スカウトNO紐付け API | ✅ 実装済 | `POST /DELETE /api/scout/candidates/link` |
| ScoutLinkPanel（紐付け UI） | ✅ 実装済 | `applicationRoute === "スカウト"` 時に表示 |
| 配信枠管理画面のスカウトNO表示 | ✅ 実装済 | `/scout/slots` 各セルに表示 |
| 求職者編集画面のスカウトNO手入力 | ✅ 実装済 | CandidateDetailPage + CandidateRegistrationModal |

### 動いていない / 未実装の機能

| 機能 | 状態 | 備考 |
|--|--|--|
| 一斉配信入力 UI | ❌ 未実装 | 社員枠の deliveryCategoryMedium を「一斉配信」に切り替える UI がない |
| mynaviScoutSentAt の自動取得 | ❌ 未実装 | カラムは存在するが値を設定するロジックがない（コメントに「将来自動取得用」と明記） |
| ScoutLinkPanel の紐付け済みスロット詳細取得 | ⚠️ 部分的 | `loadLinkedSlot` 内のコメントに「単発検索エンドポイントは未実装」とあり、link API のレスポンスでのみ情報をセット |

### 要件定義との差分

1. **配信枠へのスカウトNO発番**: 要件通り動作中。96枠/日に SC+8桁が自動付与される。
2. **応募者→配信枠の紐付け**: API・UI とも実装済み。手動で SC番号を入力して紐付ける方式。
3. **一斉配信入力**: 要件にあった「社員の一斉配信」用の入力 UI が未実装。`deliveryCategoryMedium` を「一斉配信」に設定する手段がない。
4. **スカウト送信時刻の自動取得**: `mynaviScoutSentAt` カラムは用意されているが、マイナビからの送信時刻自動取得は Phase B 以降の予定（T-064 Phase A 完了報告書にも Phase B 項目として記載）。
