# T-064 配信レコードの項目・フラグ構造 調査報告書

調査日: 2026-05-24

---

## Q1: ScoutDeliverySlot の全カラム

`prisma/schema.prisma` L1802–L1843 全文転記:

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

### カラム一覧表

| カラム | 型 | nullable | デフォルト | 説明 |
|--|--|--|--|--|
| id | String | No | cuid() | PK |
| scoutNumber | String | No | なし | SC + 8桁数字（unique） |
| deliveryDate | DateTime (@db.Date) | No | なし | 配信日 |
| hourSlot | Int | No | なし | 開始時刻（8〜19） |
| machineId | String | Yes | なし | FK → ScoutMachineMaster.id |
| isMachine | Boolean | No | true | 機械配信か |
| isStaff | Boolean | No | false | 社員配信か |
| deliveryCategoryLarge | String | No | なし | 大分類: "機械" or "社員" |
| deliveryCategoryMedium | String | Yes | なし | 中分類: "個別配信" or "一斉配信" |
| deliveryCategorySmall | String | Yes | なし | 小分類: "検索条件指定" or "検索条件未指定" |
| mediaSource | String | No | "マイナビ転職" | 媒体ソース |
| searchConditionName | String | Yes | なし | 検索条件名 |
| deliveryCount | Int | No | 0 | 配信数 |
| openCount | Int | No | 0 | 開封数 |
| isAggregationTarget | Boolean | No | true | 集計対象か |
| memo | String (@db.Text) | Yes | なし | メモ |
| createdAt | DateTime | No | now() | 作成日時 |
| updatedAt | DateTime | No | auto | 更新日時 |
| createdById | String | Yes | なし | 作成者 ID |
| updatedById | String | Yes | なし | 更新者 ID |
| linkedCandidates | Candidate[] | - | - | 紐付き求職者（relation） |

### ユニーク制約・インデックス

- `@@unique([deliveryDate, hourSlot, machineId])` — 同一日・同一時間帯・同一担当者で1レコードのみ
- `scoutNumber` — 単独 unique
- インデックス: `[deliveryDate]`, `[deliveryDate, hourSlot]`, `[machineId]`, `[mediaSource]`

### Candidate 側の関連カラム（schema.prisma L273–L277）

```prisma
scoutDeliverySlotId String?            @map("scout_delivery_slot_id")
scoutDeliverySlot   ScoutDeliverySlot? @relation(fields: [scoutDeliverySlotId], references: [id])
scoutLinkedAt       DateTime?          @map("scout_linked_at")
scoutLinkedById     String?            @map("scout_linked_by_id")
mynaviScoutSentAt   DateTime?          @map("mynavi_scout_sent_at")
```

---

## Q2: ScoutMediaMaster の全カラム

`prisma/schema.prisma` L1867–L1879 全文転記:

```prisma
model ScoutMediaMaster {
  id           String  @id @default(cuid())
  mediaName    String  @unique @map("media_name")
  displayOrder Int     @map("display_order")
  isActive     Boolean @default(true) @map("is_active")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([displayOrder])
  @@index([isActive])
  @@map("scout_media_masters")
}
```

| カラム | 型 | nullable | デフォルト | 説明 |
|--|--|--|--|--|
| id | String | No | cuid() | PK |
| mediaName | String | No | なし | 媒体名（unique） |
| displayOrder | Int | No | なし | 表示順 |
| isActive | Boolean | No | true | 有効か |
| createdAt | DateTime | No | now() | 作成日時 |
| updatedAt | DateTime | No | auto | 更新日時 |

**注意**: ScoutDeliverySlot.mediaSource は ScoutMediaMaster への FK **ではない**。自由文字列（デフォルト "マイナビ転職"）。マスタとはリレーションで紐づいていない。

---

## Q3: ScoutMachineMaster の全カラム

`prisma/schema.prisma` L1845–L1865 全文転記:

```prisma
model ScoutMachineMaster {
  id            String  @id @default(cuid())
  recruiterName String  @map("recruiter_name") // マイナビPDFに記載される担当者名
  machineNumber Int?    @map("machine_number") // 1〜6（社員の場合 null）
  machineLabel  String  @map("machine_label") // "1号機" / "2号機" / "人（社員）"
  isMachine     Boolean @default(true) @map("is_machine")
  isActive      Boolean @default(true) @map("is_active")

  validFrom DateTime  @default(now()) @map("valid_from")
  validTo   DateTime? @map("valid_to")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  slots ScoutDeliverySlot[]

  @@unique([recruiterName, validFrom])
  @@index([machineNumber])
  @@index([isActive])
  @@map("scout_machine_masters")
}
```

| カラム | 型 | nullable | デフォルト | 説明 |
|--|--|--|--|--|
| id | String | No | cuid() | PK |
| recruiterName | String | No | なし | 担当者名（マイナビPDF記載名） |
| machineNumber | Int | Yes | なし | 号機番号（1〜6、社員は null） |
| machineLabel | String | No | なし | 表示ラベル（"1号機" / "人（社員）"） |
| isMachine | Boolean | No | true | 機械配信か |
| isActive | Boolean | No | true | 稼働中か |
| validFrom | DateTime | No | now() | 有効開始日 |
| validTo | DateTime | Yes | なし | 有効終了日 |
| createdAt | DateTime | No | now() | 作成日時 |
| updatedAt | DateTime | No | auto | 更新日時 |
| slots | ScoutDeliverySlot[] | - | - | 配信枠（relation） |

---

## Q4: フラグの「大中小」に該当するカラム

### 該当カラム一覧

| テーブル | カラム名 | 型 | 想定値 | コメント根拠 |
|--|--|--|--|--|
| ScoutDeliverySlot | `deliveryCategoryLarge` | String (NOT NULL) | `"機械"` / `"社員"` | schema コメント |
| ScoutDeliverySlot | `deliveryCategoryMedium` | String? | `"個別配信"` / `"一斉配信"` | schema コメント + UI select |
| ScoutDeliverySlot | `deliveryCategorySmall` | String? | `"検索条件指定"` / `"検索条件未指定"` | schema コメント + UI select |
| ScoutDeliverySlot | `isMachine` | Boolean | true/false | 大分類の冗長フラグ |
| ScoutDeliverySlot | `isStaff` | Boolean | true/false | 大分類の冗長フラグ（isMachine の逆） |
| ScoutDeliverySlot | `mediaSource` | String (NOT NULL) | `"マイナビ転職"` 他 | 媒体ソース（大中小とは独立した軸） |
| ScoutDeliverySlot | `searchConditionName` | String? | 任意文字列 | 小分類が "検索条件指定" の場合の条件名 |
| ScoutDeliverySlot | `isAggregationTarget` | Boolean | true/false | 集計対象フラグ（大中小とは別管理） |

### 大中小の構造

```
大（deliveryCategoryLarge） ─── "機械"
│                              └── 中（deliveryCategoryMedium） ─── "個別配信"（デフォルト）
│                                                                  └── 小（deliveryCategorySmall） ─── "検索条件指定"（デフォルト）
│                                                                                                      "検索条件未指定"
│                                                                  └── "一斉配信"
│                                                                      └── 小（任意 or null）
│
└── "社員"
    └── 中（deliveryCategoryMedium） ─── null（初期値）
                                         "個別配信"
                                         "一斉配信"
        └── 小（deliveryCategorySmall） ─── null（初期値）
                                             "検索条件指定"
                                             "検索条件未指定"
```

### slot-helpers.ts での初期値割り当て（L51–L65）

```typescript
data.push({
  ...
  deliveryCategoryLarge: m.isMachine ? "機械" : "社員",
  deliveryCategoryMedium: m.isMachine ? "個別配信" : null,
  deliveryCategorySmall: m.isMachine ? "検索条件指定" : null,
  mediaSource: "マイナビ転職",
  isAggregationTarget: m.isMachine ? m.isActive : false,
});
```

- 機械枠: 大="機械", 中="個別配信", 小="検索条件指定"
- 社員枠: 大="社員", 中=null, 小=null（UI で手動入力後に設定）

---

## Q5: seed データの初期値

ソース: `scripts/seed-scout-masters.ts`

### ScoutMachineMaster 初期値（8件）

| recruiterName | machineNumber | machineLabel | isMachine | isActive |
|--|--|--|--|--|
| 藤本 なつみ | 1 | 1号機 | true | true |
| 岡田 かなこ | 2 | 2号機 | true | true |
| 上原 ちはる | 3 | 3号機 | true | true |
| 上原 千遥 | 4 | 4号機 | true | true |
| 岡田 愛子 | 5 | 5号機 | true | true |
| 安藤 嘉富 | 6 | 6号機 | true | **false** |
| 大野 望 | null | 人（社員） | false | true |
| 藤本 夏海 | null | 人（社員） | false | true |

### ScoutMediaMaster 初期値（6件）

| mediaName | displayOrder | isActive |
|--|--|--|
| マイナビ転職 | 1 | true |
| マイナビエージェント | 2 | true |
| indeed | 3 | false |
| 日経HR | 4 | false |
| 自社HP | 5 | false |
| dodaMaps | 6 | false |

### ScoutSequence 初期値

| lastNumber | 備考 |
|--|--|
| 10062652 | FM最終番号 SC10061652 前後 + 1000（安全マージン） |

### 補足

- `prisma/seed.ts`（メイン seed）には ScoutDeliverySlot / ScoutMachineMaster / ScoutMediaMaster の投入はない。
- スカウト関連の seed は専用スクリプト `scripts/seed-scout-masters.ts` で別途実行する構成。

---

## Q6: 配信レコード一覧画面の表示項目

ソース: `src/app/(app)/scout/slots/page.tsx`

### 画面概要

パス: `/scout/slots`（配信枠管理）

構造: 日付選択付きの **マトリクス表**（縦軸=時間帯、横軸=担当者/号機）

### テーブルヘッダ（横軸: 担当者ごと）

各 `ScoutMachineMaster` に対して:
- `machineLabel`（例: "1号機", "人（社員）"）
- `recruiterName`（例: "藤本 なつみ"）
- `isActive` が false の場合「停止中」表示

### テーブル行（縦軸: 時間帯）

HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]

### 各セルに表示される項目

閲覧モード:
- `deliveryCount`（配信数）
- `openCount`（開封数、0 の場合非表示）
- `scoutNumber`（SC番号、truncate表示）
- `isAggregationTarget` が false の場合: 背景色グレー

UI操作:
- **編集ボタン**（`isReadOnly = slot.isMachine` なので、**社員枠のみ**編集可能）
- **複製ボタン**（社員枠で deliveryCount > 0 の場合、別の時間帯に複製可能）

### 編集モード（社員枠のみ）で入力可能なフィールド

| フィールド | UI要素 | 選択肢 |
|--|--|--|
| deliveryCount | number input | 数値入力 |
| deliveryCategoryMedium | select | "個別配信" / "一斉配信" |
| deliveryCategorySmall | select | "検索条件指定" / "検索条件未指定" |
| searchConditionName | text input | 自由入力 |
| isAggregationTarget | checkbox | 集計対象 |

### PATCH API で更新可能な全フィールド（`/api/scout/slots` PATCH）

```
id, deliveryCount, openCount, deliveryCategoryLarge, deliveryCategoryMedium,
deliveryCategorySmall, mediaSource, searchConditionName, memo, isAggregationTarget
```

### UI に表示されていないが PATCH 可能なフィールド

- `deliveryCategoryLarge`（UI の select には存在しないが API では更新可能）
- `mediaSource`（UI の編集フォームにはないが、startEdit で editValues に含まれる → PATCH body に送信される）
- `memo`（PATCH 可能だが UI フォームに input がない）
- `openCount`（PATCH 可能だが UI フォームに input がない）

### 画面上の補足テキスト

> グレーの背景セル: 集計対象外（停止中号機、または社員枠で未入力）
> 機械分（1〜6号機）の配信数は OneDrive エクセル取り込みで自動更新されます。社員枠（藤本 夏海・大野 望）は手入力です。

---

## サマリ

### 配信レコードの分類軸（フラグ）として使えるカラム

1. **deliveryCategoryLarge** — 最上位分類: "機械" / "社員"
2. **deliveryCategoryMedium** — 中間分類: "個別配信" / "一斉配信" / null
3. **deliveryCategorySmall** — 最下位分類: "検索条件指定" / "検索条件未指定" / null
4. **isMachine / isStaff** — 大分類の Boolean 冗長表現
5. **mediaSource** — 媒体軸（大中小とは直交する分類軸）
6. **isAggregationTarget** — 集計対象か否か（分類とは独立した運用フラグ）

### 大中小に相当する構造

ScoutDeliverySlot は `deliveryCategoryLarge` / `Medium` / `Small` の3カラムで直接大中小を保持する。外部テーブル参照ではなく **自由文字列** で管理されている（enum や FK なし）。

- 値の制約はアプリケーション側のみ（UI の select 選択肢 + createDailySlots のハードコード値）
- DB レベルではどんな文字列でも入る

### 社員一斉配信レコード新規作成の場合に必要な値

| カラム | 設定値 |
|--|--|
| scoutNumber | reserveScoutNumbers で新規採番 |
| deliveryDate | 対象日 |
| hourSlot | 該当時間帯 |
| machineId | 社員の ScoutMachineMaster.id |
| isMachine | false |
| isStaff | true |
| deliveryCategoryLarge | "社員" |
| deliveryCategoryMedium | "一斉配信" |
| deliveryCategorySmall | null or "検索条件指定" / "検索条件未指定" |
| mediaSource | "マイナビ転職" |
| isAggregationTarget | true |

### 現状の制約事項

- `@@unique([deliveryDate, hourSlot, machineId])` のため、同一日・同一時間帯・同一担当者で2件目を作成できない
- 社員の一斉配信を同じ時間帯の既存枠とは別レコードで作成する場合、**machineId を null にする** か **ユニーク制約を緩和する** 必要がある
- 現在の UI は `isMachine = true`（機械枠）を編集不可にしている（`isReadOnly = slot.isMachine`）
