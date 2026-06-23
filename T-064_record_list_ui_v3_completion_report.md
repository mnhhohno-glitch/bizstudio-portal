# T-064 配信枠管理レコード一覧 UI v3 完了報告書

実装日: 2026-05-25
commit: `0b2043e` (master direct push)
staging マージ済 (commit `41cb6fd`)
Railway 本番反映確認済（`/api/scout/slots/list?...&sortBy=deliveryCategoryLarge:asc,deliveryDate:desc` → 401）

---

## 完了条件チェックリスト

| # | 項目 | 結果 |
|--|--|--|
| 1 | 媒体をスカウトNO列下段に統合（"RPA \| マイナビ転職"） | ✅ |
| 2 | スカウトNOクリックでコピー + toast表示 | ✅ `navigator.clipboard.writeText` + `toast.success` |
| 3 | 配信者名クリックでコピー + toast表示 | ✅ 同上 |
| 4 | 配信者列下段に号機表示（"RPA3号機" / "-"） | ✅ `machineNumber` を API レスポンスに追加 |
| 5 | 曜日を完全表記に変更（月 → 月曜日） | ✅ API `dayOfWeekJa` を 3文字表記に変更 |
| 6 | 集計列幅の統一 | ✅ `w-[52px]`（率系）/ `w-[44px]`（数値系） |
| 7 | 独立した媒体列を廃止 | ✅ 列1下段に統合 |
| 8 | TypeScript / Lint エラーなし | ✅ |
| 9 | 既存テスト全項目 PASS | ✅ 全106件 PASS |
| 10 | master push 済 | ✅ |
| 11 | staging マージ済（本番反映完了） | ✅ |
| 12 | Railway デプロイ完了確認済 | ✅ |
| 13 | 完了報告書作成済 | ✅ 本ファイル |

---

## 1. 列構成の変更

### 変更前（v2: 5属性列）

| 列 | 上段 | 下段 |
|--|--|--|
| 1 | スカウトNO | 配信種別（色分け） |
| 2 | 中フラグ | 小フラグ |
| 3 | 媒体 | 配信者 |
| 4 | 配信日 | 曜日（1文字） |
| 5 | 時間帯 | 時間 |

### 変更後（v3: 5属性列、統合版）

| 列 | 上段 | 下段 |
|--|--|--|
| 1 | スカウトNO（クリックでコピー） | 種別 \| 媒体（例: "RPA \| マイナビ転職"） |
| 2 | 中フラグ（ソート可） | 小フラグ |
| 3 | 配信者（クリックでコピー、ソート可） | 号機（例: "RPA3号機" / "—"） |
| 4 | 配信日（ソート可） | 曜日（完全表記: "月曜日"） |
| 5 | 時間帯 | 時間（ソート可） |

集計列（配信数〜操作）は変更なし。列幅のみ統一。

---

## 2. クリックでコピー

```typescript
const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text).then(() => {
    toast.success(`コピーしました: ${text}`);
  });
};
```

対象:
- スカウトNO: `onClick={() => copyToClipboard(r.scoutNumber)}`
- 配信者名: `onClick={() => r.machine?.recruiterName && copyToClipboard(r.machine.recruiterName)}`

ホバー時に `cursor-pointer` + `hover:text-[#2563EB]` で視覚的にコピー可能であることを示す。
`title="クリックでコピー"` ツールチップ付き。

---

## 3. 号機表示

API レスポンスの `machine` オブジェクトに `machineNumber: number | null` を追加。

UI 表示:
- RPA枠（`machine.isMachine === true`）: `RPA${machineNumber}号機`（例: "RPA3号機"）
- 社員枠（`machine.isMachine === false`）: "—"

---

## 4. 曜日完全表記

API側 `dayOfWeekJa` の DOW 配列を変更:
```typescript
// v2
const DOW = ["日", "月", "火", "水", "木", "金", "土"];
// v3
const DOW = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];
```

---

## 5. 集計列幅の統一

| 列種別 | 幅 | 対象 |
|--|--|--|
| 率系 | `w-[52px]` | 配信数, 開封数, 開封率, 応募数, 応募率(配信), 応募率(開封), 有効応募率, 無効応募率 |
| 数値系 | `w-[44px]` | 〜20代, 30代, 40代, 50代〜, 外国籍, 有効応募数, 無効応募数 |

---

## 6. テスト結果

### 全テストスイート

| テスト | PASS / FAIL |
|--|--|
| test-scout-slots-list-v2 | 15 / 0 |
| test-scout-slots-list | 13 / 0 |
| test-scout-slot-creation | 13 / 0 |
| test-scout-auto-link | 17 / 0 |
| test-scout-phase-a | 17 / 0 |
| test-scout-aggregated | 17 / 0 |
| test-scout-aggregated-auto-create | 14 / 0 |
| **合計** | **106 / 0** |

### TypeScript / Lint

```
$ npx tsc --noEmit → エラーなし
```

---

## 7. 実装ファイル一覧

| ファイル | 種別 | 内容 |
|--|--|--|
| `src/app/api/scout/slots/list/route.ts` | 修正 | dayOfWeek完全表記 + machineNumber追加 |
| `src/app/(app)/scout/slots/page.tsx` | 修正 | 列統合 + コピー機能 + 号機表示 + 列幅統一 |

---

## 8. デプロイ確認

```
GET https://bizstudio-portal-staging-production.up.railway.app/api/scout/slots/list?startDate=2026-05-25&endDate=2026-05-25&sortBy=deliveryCategoryLarge:asc,deliveryDate:desc
→ 401 (認証必須、新パラメータも含めて route 登録済)
```

---

## 9. 変更禁止ファイル

以下は触っていない:
- `src/constants/candidate-flags.ts`
- `specs/` 配下
- `scripts/gas/` 配下
- `src/services/loadSpec.ts`
- `src/services/geminiClient.ts`
