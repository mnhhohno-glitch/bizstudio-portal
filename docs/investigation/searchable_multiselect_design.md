# 希望条件 検索型+複数選択UI — 調査・設計レポート

## 調査日: 2026-04-21

---

## 1. 階層ドロップダウン関連コードの棚卸し（削除対象）

### 削除するファイル
| ファイル | 理由 |
|---|---|
| `src/components/common/HierarchicalCategorySelect.tsx` | 丸ごと削除。検索型UIに置き換え |

### 削除するスキーマフィールド（prisma/schema.prisma L1429-1434）
| フィールド | 理由 |
|---|---|
| `desiredJobTypeLarge` | JSON配列で保持するため不要。追加直後で既存データなし |
| `desiredJobTypeMedium` | 同上 |
| `desiredJobTypeSmall` | 同上 |
| `desiredIndustryLarge` | 同上 |
| `desiredIndustryMedium` | 同上 |
| `desiredIndustrySmall` | 同上 |

### 差し替えるコード

**InterviewForm.tsx:**
- L6: `import HierarchicalCategorySelect` → 削除
- L342-352: 読み込み時の `desiredJobTypeLarge/Medium/Small` パース復元 → JSON配列復元に変更
- L1226-1292: 3つの `<HierarchicalCategorySelect>` → `<SearchableMultiSelect>` に置換

**interview-analyzer-mapping.ts:**
- L114-124: `desiredJobTypeLarge/Medium/Small`, `desiredIndustryLarge/Medium/Small` への展開 → JSON配列への展開に変更

### 残すもの（再利用）
| 対象 | 理由 |
|---|---|
| `AreaCategoryMajor/Middle/Minor` テーブル | マスタデータとして引き続き使用 |
| `/api/area-categories/*` API | 新しい全件取得APIの基盤 |
| `/api/job-categories/*`, `/api/industry-categories/*` | 同上 + タスク画面が使用中 |
| `seed.ts` の業種・エリアシード | そのまま使用 |

---

## 2. 複数選択の保存方式: JSON配列（選択肢A）

### 新規追加フィールド

```prisma
model InterviewDetail {
  // 既存フィールド全て維持（削除しない）
  desiredJobType1       String?  // 互換: 配列1番目をスラッシュ区切りで同期
  desiredJobType1Memo   String?
  desiredJobType2       String?  // ノータッチ
  desiredIndustry1      String?  // 互換: 配列1番目をスラッシュ区切りで同期
  desiredIndustry1Memo  String?
  desiredArea           String?  // 互換: 配列1番目のareaを同期
  desiredPrefecture     String?  // 互換: 配列1番目のprefectureを同期
  desiredCity           String?  // 互換: 配列1番目のcityを同期
  desiredAreaMemo       String?

  // 新規: JSON配列で複数選択を保持
  desiredJobTypes    Json?  @map("desired_job_types")
  desiredIndustries  Json?  @map("desired_industries")
  desiredAreas       Json?  @map("desired_areas")
}
```

### JSON配列の構造

```typescript
// 職種・業種
type DesiredSelection = {
  large: string;
  medium: string;
  small: string;
}[];

// エリア
type DesiredAreaSelection = {
  area: string;       // エリア（関西等）
  prefecture: string; // 都道府県
  city: string;       // 市区
}[];
```

### 既存フィールドとの同期

```typescript
// 保存時: 配列1番目を既存フィールドに同期
desiredJobType1 = selected[0]
  ? [selected[0].large, selected[0].medium, selected[0].small].join(' / ')
  : null;

desiredIndustry1 = selected[0]
  ? [selected[0].large, selected[0].medium, selected[0].small].join(' / ')
  : null;

desiredArea = selected[0]?.area ?? null;
desiredPrefecture = selected[0]?.prefecture ?? null;
desiredCity = selected[0]?.city ?? null;
```

### 既存データ読み込み時の復元

```typescript
// desiredJobTypes が null で desiredJobType1 に値がある場合
if (!detail.desiredJobTypes && detail.desiredJobType1) {
  const parts = String(detail.desiredJobType1).split(' / ');
  detail.desiredJobTypes = [{
    large: parts[0] || '',
    medium: parts[1] || '',
    small: parts[2] || '',
  }];
}
// 業種・エリアも同様
```

---

## 3. 全件取得API（新規必要）

現在のAPI（major → middles → minors の3段階フェッチ）は検索UIに不向き。
全件をフラットに返すエンドポイントが必要。

### 新規API

```
GET /api/job-categories/all
→ [{large: "営業", medium: "営業・代理店...", small: "営業・企画営業..."}, ...]

GET /api/industry-categories/all
→ [{large: "IT・通信...", medium: "IT・通信...", small: "ソフトウェア..."}, ...]

GET /api/area-categories/all
→ [{area: "関西", prefecture: "大阪府", city: "大阪市"}, ...]
```

実装: Prisma の `include` で1クエリ取得 → フラット化して返却。
レスポンスサイズ: 職種378件、業種115件、エリア192件 — 全て小さいのでキャッシュ不要。

---

## 4. SearchableMultiSelect コンポーネント設計

```typescript
// src/components/common/SearchableMultiSelect.tsx

interface FlatItem {
  label1: string;  // 大カテゴリ
  label2: string;  // 中カテゴリ
  label3: string;  // 小カテゴリ
}

interface Props {
  items: FlatItem[];           // マスタ全件
  selected: FlatItem[];        // 選択済み
  onChange: (items: FlatItem[]) => void;
  maxSelect: number;           // 職種3, 業種3, エリア5
  columnLabels: [string, string, string];  // ['職種大','職種中','職種小']
  searchPlaceholder?: string;
  disabled?: boolean;
}
```

### UI構成

```
┌──────────────────────────────────────────────┐
│ 選択済み:                                        │
│ [🏷 管理・事務 / 総務 / 総務・庶務  ×]            │
│ [🏷 営業 / コールセンター / オペレーター  ×]      │
│                                                │
│ 🔍 [事務__________________________]             │
├──────────────────────────────────────────────┤
│ ☐ 管理・事務 / 総務 / 総務・庶務                  │
│ ☑ 管理・事務 / 営業事務 / 営業事務・アシスタント   │
│ ☐ 営業 / 営業事務 / 企画アシスタント              │
│ ...（スクロール、最大200px高）                     │
└──────────────────────────────────────────────┘
```

### 挙動
- 検索: `label1`, `label2`, `label3` のいずれかに部分一致するアイテムを表示
- 検索空時: 全件表示（スクロール）
- チェック: 選択追加。上限到達時はチェックボックス disabled + トースト
- タグ ×: 選択解除
- 各行のフォーマット: `大 / 中 / 小`
- 選択済みアイテムはリスト内で ☑ 表示

---

## 5. マッピング処理の調整方針

### candidate-intake 解析結果

```typescript
// interview-analyzer-mapping.ts
if (result.desiredJobType1) {
  const parts = String(result.desiredJobType1).split(' / ');
  result.desiredJobTypes = [{
    large: parts[0] || '',
    medium: parts[1] || '',
    small: parts[2] || '',
  }];
}
// 業種・エリアも同様
```

### ai-organize route（読み取り専用・変更不要）

`ai-organize/route.ts` L55 は `desiredJobType1` を参照 → 同期書き込みで互換維持。

---

## 6. 実装ステップ

| # | 内容 |
|---|---|
| 1 | スキーマ変更: 6フィールド削除 + 3フィールド追加(Json?) → db push |
| 2 | 全件取得API: `/api/job-categories/all`, `/api/industry-categories/all`, `/api/area-categories/all` |
| 3 | `HierarchicalCategorySelect.tsx` 削除 → `SearchableMultiSelect.tsx` 新規作成 |
| 4 | `InterviewForm.tsx` 改修: 階層ドロップダウン → SearchableMultiSelect + データ復元ロジック |
| 5 | `interview-analyzer-mapping.ts` 改修: JSON配列展開 |
| 6 | ビルド確認 (tsc + build) |

---

## 確認事項

1. JSON配列保存方式で進めてよいか？
2. 先ほど追加した `desiredJobTypeLarge/Medium/Small` 等6フィールドはスキーマから削除してよいか？（追加直後、既存データなし）
3. エリアの上限5、職種・業種の上限3 で合っているか？
