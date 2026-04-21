# 希望条件の階層選択式設計 — 調査レポート

## 調査日: 2026-04-21

---

## 1. 現状の InterviewDetail フィールド分析

### 希望条件セクション（schema.prisma L1387-1396）

| フィールド | 型 | 用途 | UI | candidate-intake |
|---|---|---|---|---|
| `desiredJobType1` | String? | 希望職種（スラッシュ区切り） | テキスト入力 | "希望職種フラグ" |
| `desiredJobType1Memo` | String? | 職種メモ | textarea | "希望職種メモ" |
| `desiredJobType2` | String? | 第2希望職種 | **UIなし** | マッピングなし |
| `desiredIndustry1` | String? | 希望業種（スラッシュ区切り） | テキスト入力 | "希望業種フラグ" |
| `desiredIndustry1Memo` | String? | 業種メモ | textarea | "希望業種メモ" |
| `desiredArea` | String? | 希望エリア | テキスト入力 | "希望エリアフラグ" |
| `desiredPrefecture` | String? | 都道府県 | **UIなし** | "希望都道府県" |
| `desiredCity` | String? | 市区 | **UIなし** | "希望市区" |
| `desiredAreaMemo` | String? | エリアメモ | textarea | "希望エリアメモ" |

### InterviewForm.tsx 希望条件UIの現状（L1192-1227）

- サブタブ3つ: 職種(st-job) / 業種(st-industry) / エリア(st-area)
- 全てフリーテキスト `<Fld>` コンポーネント
- placeholder: `"（例：管理・事務 ／ 一般事務・庶務）"` ← スラッシュ区切り想定

### candidate-intake から返る値の形式

```
desiredJobType1: "営業 / 営業・代理店営業・ルートセールス・MR / ルートセールス・渉外・外商"
desiredIndustry1: "IT・通信・インターネット / IT・通信・インターネット / ソフトウェア・情報処理"
desiredArea: "関西"
desiredPrefecture: "大阪府"
desiredCity: "大阪市"
```

→ 職種・業種は「大 / 中 / 小」のスラッシュ区切り。エリアは3フィールド分離済み。

---

## 2. 重大発見: 既存の階層マスタインフラ

### 既に存在するモデル

| モデル | テーブル数 | シードデータ | API | UIコンポーネント |
|---|---|---|---|---|
| `JobCategoryMajor/Middle/Minor` | 3テーブル | ✅ `job-categories.json` 投入済み | ✅ `/api/job-categories` | ✅ `JobCategorySelector` |
| `IndustryCategoryMajor/Middle/Minor` | 3テーブル | ❌ 未投入 | ✅ `/api/industry-categories` | ❌ なし |
| エリア系 | なし | ❌ | ❌ | ❌ |

### job-categories.json と job-type-master-data.ts は同一データ

```
job-categories.json (既存):
  営業 → 営業・代理店営業・ルートセールス・MR → 営業・企画営業（法人向け）

job-type-master-data.ts (新規):
  { large: "営業", medium: "営業・代理店営業・ルートセールス・MR", small: "営業・企画営業（法人向け）" }
```

**完全に同一の職種マスタデータ。** 378件の階層構造が一致。

### 既存 JobCategorySelector コンポーネント（タスク画面で使用）

- `src/components/tasks/JobCategorySelector.tsx`
- 大→中→小の3段ドロップダウン
- API: majors一覧 → middleId取得 → minors取得（3段階フェッチ）
- 値は `name` ベース（IDではなくname文字列で保持）
- 複数軸追加可能（最大10）

### 既存 API 構造

```
GET /api/job-categories           → [{id, name, sortOrder}]
GET /api/job-categories/:id/middles     → [{id, name, sortOrder}]
GET /api/job-categories/middles/:id/minors → [{id, name, sortOrder}]

GET /api/industry-categories      → [{id, name, sortOrder}]
GET /api/industry-categories/:id/middles → [{id, name, sortOrder}]
GET /api/industry-categories/middles/:id/minors → [{id, name, sortOrder}]
```

---

## 3. 設計方針: 2案の比較

### 案A: 既存インフラ再利用（推奨）

| 項目 | 対応 |
|---|---|
| 職種マスタ | `JobCategoryMajor/Middle/Minor` をそのまま使う（データ投入済み） |
| 業種マスタ | `IndustryCategoryMajor/Middle/Minor` に `industry-master-data.ts` を投入 |
| エリアマスタ | 新規 `AreaCategoryMajor/Middle/Minor` を作成（既存パターンに準拠） |
| UIコンポーネント | 既存 `JobCategorySelector` を汎用化して `HierarchicalCategorySelect` に |
| 新規テーブル | エリア用3テーブルのみ |
| API | エリア用のみ新規作成（職種・業種は既存API流用） |

**メリット:**
- テーブル重複なし（フラットテーブルを追加すると職種データが2箇所に存在）
- 既存の API・セレクタコンポーネントを流用可能
- タスク画面と面談画面で同一マスタを参照→一貫性

**デメリット:**
- 3段階APIフェッチ（ただし既にタスク画面で問題なく動作中）

### 案B: フラットテーブル新規作成（プロンプト案）

| 項目 | 対応 |
|---|---|
| 職種マスタ | 新規 `JobTypeMaster`（large/medium/small 1テーブル） |
| 業種マスタ | 新規 `IndustryMaster`（同上） |
| エリアマスタ | 新規 `AreaMaster`（area/prefecture/city 1テーブル） |
| UIコンポーネント | 新規 `HierarchicalSelect`（全件1回フェッチ→クライアント絞込） |
| 新規テーブル | 3テーブル |
| API | 3エンドポイント新規 |

**メリット:**
- 1回のAPIコールで全データ取得
- クライアント側フィルタリングでレスポンス速い

**デメリット:**
- 職種データがDB上2箇所に存在（`JobCategoryMajor/Middle/Minor` + `JobTypeMaster`）
- 既存インフラと用途が重複

### 推奨: 案A（既存インフラ再利用）

理由: 同一データの重複管理を避けるため。

---

## 4. InterviewDetail のフィールド追加案

```prisma
model InterviewDetail {
  // 既存フィールド維持（削除しない）
  desiredJobType1       String?  // "営業 / 営業・代理店... / 営業・企画営業..." 互換
  desiredJobType1Memo   String?
  desiredJobType2       String?  // 既存（UIなし、ai-organize で参照）
  desiredIndustry1      String?  // "IT・通信 / IT・通信... / ソフトウェア..." 互換
  desiredIndustry1Memo  String?
  desiredArea           String?  // エリア（関西、首都圏等）← ★ ドロップダウン化
  desiredPrefecture     String?  // 都道府県 ← ★ ドロップダウン化
  desiredCity           String?  // 市区 ← ★ ドロップダウン化
  desiredAreaMemo       String?

  // 新規追加: 階層選択の復元用
  desiredJobTypeLarge   String?  @map("desired_job_type_large")
  desiredJobTypeMedium  String?  @map("desired_job_type_medium")
  desiredJobTypeSmall   String?  @map("desired_job_type_small")
  desiredIndustryLarge  String?  @map("desired_industry_large")
  desiredIndustryMedium String?  @map("desired_industry_medium")
  desiredIndustrySmall  String?  @map("desired_industry_small")
  // エリアは既存の desiredArea/Prefecture/City がそのまま階層に対応 → 追加不要
}
```

### フィールド追加の理由

- `desiredJobType1` = `"営業 / 営業・代理店... / 営業・企画営業..."` は互換性のため維持
- `desiredJobTypeLarge/Medium/Small` = 階層選択UIの復元に使用（パース不要で確実）
- エリアは既存の3フィールドがそのまま area/prefecture/city にマッピング → 追加不要

### 保存時の同期

```typescript
// 職種選択時
setDetail(prev => ({
  ...prev,
  desiredJobTypeLarge: large,
  desiredJobTypeMedium: medium,
  desiredJobTypeSmall: small,
  desiredJobType1: [large, medium, small].filter(Boolean).join(' / '),
}));

// 業種選択時
setDetail(prev => ({
  ...prev,
  desiredIndustryLarge: large,
  desiredIndustryMedium: medium,
  desiredIndustrySmall: small,
  desiredIndustry1: [large, medium, small].filter(Boolean).join(' / '),
}));

// エリア選択時（既存フィールドをそのまま使用）
setDetail(prev => ({
  ...prev,
  desiredArea: area,
  desiredPrefecture: prefecture,
  desiredCity: city,
}));
```

### 既存データの読み込み復元

```typescript
// desiredJobTypeLarge が null → desiredJobType1 からパースして初期設定
if (!detail.desiredJobTypeLarge && detail.desiredJobType1) {
  const parts = detail.desiredJobType1.split(' / ');
  // parts[0]="営業", parts[1]="営業・代理店...", parts[2]="営業・企画営業..."
  setDetail(prev => ({
    ...prev,
    desiredJobTypeLarge: parts[0] || null,
    desiredJobTypeMedium: parts[1] || null,
    desiredJobTypeSmall: parts[2] || null,
  }));
}
```

---

## 5. エリアマスタ新規テーブル設計

既存パターン（JobCategory, IndustryCategory）に準拠:

```prisma
model AreaCategoryMajor {
  id        String               @id @default(cuid())
  name      String               @unique  // "関西", "首都圏" 等
  sortOrder Int                  @default(0) @map("sort_order")
  middles   AreaCategoryMiddle[]
  createdAt DateTime             @default(now()) @map("created_at")
  updatedAt DateTime             @updatedAt @map("updated_at")

  @@map("area_category_majors")
}

model AreaCategoryMiddle {
  id        String              @id @default(cuid())
  name      String              // "大阪府", "東京都" 等
  majorId   String              @map("major_id")
  major     AreaCategoryMajor   @relation(fields: [majorId], references: [id], onDelete: Cascade)
  sortOrder Int                 @default(0) @map("sort_order")
  minors    AreaCategoryMinor[]
  createdAt DateTime            @default(now()) @map("created_at")
  updatedAt DateTime            @updatedAt @map("updated_at")

  @@map("area_category_middles")
}

model AreaCategoryMinor {
  id        String             @id @default(cuid())
  name      String             // "大阪市", "渋谷区" 等
  middleId  String             @map("middle_id")
  middle    AreaCategoryMiddle @relation(fields: [middleId], references: [id], onDelete: Cascade)
  sortOrder Int                @default(0) @map("sort_order")
  createdAt DateTime           @default(now()) @map("created_at")
  updatedAt DateTime           @updatedAt @map("updated_at")

  @@map("area_category_minors")
}
```

---

## 6. シード戦略

### seed.ts への追加

既存の seed.ts に以下を追加:

1. **業種マスタ投入**（`IndustryCategoryMajor/Middle/Minor` — 現在空）
   - `industry-master-data.ts` を大→中→小に分解して upsert
   - 115件

2. **エリアマスタ投入**（`AreaCategoryMajor/Middle/Minor` — 新規）
   - `area-master-data.ts` を area→prefecture→city に分解して upsert
   - 192件

3. **職種マスタは投入不要**（既に `job-categories.json` からシード済み）

### 配置済みの3ファイルの扱い

| ファイル | 使用 |
|---|---|
| `job-type-master-data.ts` | **使用しない**（既存 `job-categories.json` と同一データ） |
| `industry-master-data.ts` | ✅ IndustryCategory 投入に使用 |
| `area-master-data.ts` | ✅ AreaCategory 投入に使用 |

---

## 7. API 設計

### 新規作成

```
GET /api/area-categories                        → [{id, name, sortOrder}]
GET /api/area-categories/:majorId/middles        → [{id, name, sortOrder}]
GET /api/area-categories/middles/:middleId/minors → [{id, name, sortOrder}]
```

### 既存流用（変更不要）

```
GET /api/job-categories           ← 職種大一覧
GET /api/job-categories/:id/middles     ← 職種中一覧
GET /api/job-categories/middles/:id/minors ← 職種小一覧

GET /api/industry-categories      ← 業種大一覧
GET /api/industry-categories/:id/middles ← 業種中一覧
GET /api/industry-categories/middles/:id/minors ← 業種小一覧
```

---

## 8. UI コンポーネント設計

### 共通コンポーネント: HierarchicalCategorySelect

既存 `JobCategorySelector` を参考に、汎用化した1行3ドロップダウンコンポーネント:

```typescript
// src/components/common/HierarchicalCategorySelect.tsx
interface Props {
  apiBase: string;           // "/api/job-categories" | "/api/industry-categories" | "/api/area-categories"
  level1Label: string;       // "職種大" | "業種大" | "エリア"
  level2Label: string;       // "職種中" | "業種中" | "都道府県"
  level3Label: string;       // "職種小" | "業種小" | "市区"
  level1Value: string | null;
  level2Value: string | null;
  level3Value: string | null;
  onChange: (l1: string | null, l2: string | null, l3: string | null) => void;
  disabled?: boolean;
}
```

**挙動:**
- level1 変更 → level2, level3 リセット
- level2 変更 → level3 リセット
- 各ドロップダウンは前段の選択に基づきAPIフェッチ
- 空選択（「選択してください」）可能

### InterviewForm 改修箇所

職種/業種/エリア各サブタブで:
```
┌─────────────────────────────────┐
│ [大カテゴリ ▼] [中カテゴリ ▼] [小カテゴリ ▼]  │ ← HierarchicalCategorySelect
├─────────────────────────────────┤
│ [メモ自由入力…                    ]              │ ← 既存 textarea 維持
└─────────────────────────────────┘
```

---

## 9. interview-analyzer-mapping.ts の改修

`mapFilemakerToDetail` で、既存フィールドへのマッピングに加えて新規フィールドも展開:

```typescript
// 既存: "希望職種フラグ" → desiredJobType1 (スラッシュ区切り文字列)
// 追加: 同じ値をパースして desiredJobTypeLarge/Medium/Small にも展開
if (result.desiredJobType1) {
  const parts = String(result.desiredJobType1).split(' / ');
  result.desiredJobTypeLarge = parts[0] || null;
  result.desiredJobTypeMedium = parts[1] || null;
  result.desiredJobTypeSmall = parts[2] || null;
}
// 業種も同様
```

エリアは既存フィールドがそのまま対応するため変更不要。

---

## 10. autosave / PATCH route の改修

### autosave route (`/api/interviews/[id]/autosave/route.ts`)

`allowedRecordFields` のdetail許可フィールドに新規6フィールドを追加:
- `desiredJobTypeLarge`, `desiredJobTypeMedium`, `desiredJobTypeSmall`
- `desiredIndustryLarge`, `desiredIndustryMedium`, `desiredIndustrySmall`

**注:** autosave route は `body.detail` をそのまま `interviewDetail.upsert` に渡しているため、
Prisma スキーマに新フィールドが存在すれば特別な処理は不要。

---

## 11. 実装ステップ（GOが出た場合）

1. Prisma スキーマ変更（AreaCategory 3テーブル追加 + InterviewDetail 6フィールド追加）
2. マイグレーション実行
3. seed.ts に業種・エリアマスタ投入追加
4. エリアAPI作成（3エンドポイント）
5. `HierarchicalCategorySelect` 共通コンポーネント作成
6. InterviewForm.tsx 改修（フリーテキスト→階層ドロップダウン）
7. interview-analyzer-mapping.ts 改修（パース展開）
8. ビルド確認 + staging push

---

## 確認事項

1. **案Aで進めてよいか？** （既存 JobCategory/IndustryCategory を再利用、エリアのみ新規テーブル）
   - 案Bのフラットテーブルだと職種データがDB上2箇所に存在するため非推奨
2. `desiredJobType2` はどうするか？（現在UIなし、ai-organize でのみ参照）
3. `job-type-master-data.ts` は使用しない想定だが、削除 or 残置どちらが良いか？
