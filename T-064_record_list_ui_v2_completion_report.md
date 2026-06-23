# T-064 配信枠管理レコード一覧 UI v2 完了報告書

実装日: 2026-05-25
PR: https://github.com/mnhhohno-glitch/bizstudio-portal/pull/18
master マージ済 / staging マージ済 (commit `1f77c4c`)
Railway 本番反映確認済（`/api/scout/slots/list?...&sortBy=deliveryCategoryLarge:asc,deliveryDate:desc` → 401）

---

## 完了条件チェックリスト

| # | 項目 | 結果 |
|--|--|--|
| 1 | 外国籍判定ロジック調査・実装 | ✅ `isForeignNg` 流用、name を姓名にスプリット |
| 2 | API レスポンス拡張 | ✅ ageGroups.foreign, validApplyCount, invalidApplyCount, validApplyRate, invalidApplyRate |
| 3 | 複合ソート API 対応 | ✅ `sortBy=col:order,col:order` 形式 + 旧形式後方互換 |
| 4 | レコード一覧 UI を 2段表示に改修 | ✅ 単一 `<tr>` 内で flex-col スタック方式 |
| 5 | 複合ソート UI 実装 | ✅ ▲ⁿ/▼ⁿ + 色付きチップ + ソートクリア |
| 6 | 計算プロパティでのソート対応 | ✅ openRate / applyRate1 など in-memory ソート |
| 7 | 新規テスト PASS | ✅ 15/15 |
| 8 | 既存テスト全項目 PASS | ✅ 全91件 PASS |
| 9 | master マージ済 | ✅ |
| 10 | staging マージ済（本番反映完了） | ✅ |
| 11 | Railway デプロイ完了確認済 | ✅ |
| 12 | 完了報告書作成済 | ✅ 本ファイル |

---

## 1. 外国籍判定ロジック

### 調査結果

`prisma/schema.prisma` に `Candidate.nationality` カラムは **存在しない**。
代わりに、既存のマイナビRPA判定ロジック `src/lib/mynavi-rpa/judgment.ts` の `isForeignNg(lastName, firstName)` が
姓・名の両方が「カタカナのみ」or「英字のみ」で構成されている場合に `true` を返す。

### 採用ロジック

```typescript
import { isForeignNg } from "@/lib/mynavi-rpa/judgment";

function isForeigner(name: string | null): boolean {
  if (!name) return false;
  const n = name.trim();
  if (!n) return false;
  const parts = n.split(/[\s　]+/).filter(Boolean);
  if (parts.length >= 2) {
    return isForeignNg(parts[0], parts.slice(1).join(""));
  }
  return isForeignNg(n, n);
}
```

`Candidate.name`（フルネーム）をスペース（半角/全角）で分割し、姓と名を取り出してから `isForeignNg` に渡す。
分割不能な単一トークンの場合は同じ値を姓名両方に入れて判定。

判定結果が `true` の応募者は `ageGroups.foreign` カウンタへ振り分け、年代別カウントから除外。

---

## 2. 年代カウントの境界修正

| 区分 | 旧 | 新 |
|--|--|--|
| 〜20代 | `20 <= age < 30` | `age < 30`（19歳以下も含む） |
| 30代 | `30 <= age < 40` | 同じ |
| 40代 | `40 <= age < 50` | 同じ |
| 50代〜 | `50 <= age < 60` | `age >= 50`（60代以上も含む） |
| 外国籍 | なし | name から isForeignNg で判定（年代カウントから除外） |

---

## 3. 有効/無効応募の集計

```typescript
const validApplyCount = ageGroups["20s"] + ageGroups["30s"];
const invalidApplyCount = ageGroups["40s"] + ageGroups["50s"] + ageGroups.foreign;
const validApplyRate = (validApplyCount / deliveryCount) * 100;
const invalidApplyRate = (invalidApplyCount / deliveryCount) * 100;
```

---

## 4. 複合ソート

### API

```
GET /api/scout/slots/list?...&sortBy=deliveryCategoryLarge:asc,deliveryDate:desc,applyCount:desc
```

または配列形式:
```
?...&sortBy[]=col1:asc&sortBy[]=col2:desc
```

**後方互換**: 旧形式 `?sortBy=deliveryDate&sortOrder=desc` も受け付ける。

ソート可能項目（8項目）:
- `deliveryCategoryLarge`（配信種別）
- `machineId`（配信者: machine.recruiterName で比較）
- `deliveryDate`（時刻も含めて `${date}-${HH}` で比較）
- `hourSlot`
- `openCount`, `openRate`
- `applyCount`, `applyRate1`

計算プロパティ（`openRate`, `applyRate1`, `applyRate2`）も対応するため、Prisma ソートではなく
全件取得後の **in-memory ソート** で実装。データ量が将来増えた場合は orderBy + 計算カラム化を検討。

### UI 状態管理

```typescript
const [sortSpecs, setSortSpecs] = useState<SortSpec[]>([
  { column: "deliveryDate", order: "desc" },
  { column: "hourSlot", order: "desc" },
]);
```

ヘッダクリック時の遷移:
1. **未ソート** → リスト末尾に `{column, order: "asc"}` を追加
2. **昇順** → 同じ位置で `order: "desc"` に更新
3. **降順** → リストから削除（未ソート状態へ）

`clearSort()` で全解除。

### UI 表示

- 未ソートヘッダ: グレーの ↕
- ソート中ヘッダ: 青の ▲/▼ + 上付き数字（優先順位）
- 上部に色付きチップでアクティブソートを並べる: `¹配信種別▲` `²配信日▼`
- 「ソートをクリア」ボタン

---

## 5. 2段レイアウト実装方針

各レコードは **単一 `<tr>` + セル内 flex-col スタック** 方式を採用。

理由:
- `rowSpan={2}` を多用すると hover / 罫線挙動が複雑になる
- セル内 div は CSS だけで完結し、可読性が高い
- 行高は `style={{ height: 56 }}` で固定（2段相当のスペース）

属性列（2段表示）:
| 列 | 上段 | 下段 |
|--|--|--|
| 1 | スカウトNO | 配信種別（色分け） |
| 2 | 中フラグ | 小フラグ |
| 3 | 媒体 | 配信者 |
| 4 | 配信日 | 曜日 |
| 5 | 時間帯 | 時間 |

集計列（1段、行中央寄せ）:
- 配信数 / 開封数 / 開封率 / 応募数 / 応募率(配信) / 応募率(開封)
- 〜20代 / 30代 / 40代 / 50代〜 / 外国籍
- 有効応募数（緑）/ 無効応募数（赤）/ 有効応募率（緑）/ 無効応募率（赤）
- 操作（複製ボタン、社員枠のみ）

総幅 `min-width: 1800px` で横スクロール許可。

---

## 6. テスト結果

### 新規テスト

`scripts/test-scout-slots-list-v2.ts`: **15 PASS / 0 FAIL**

カバー項目:
1. 〜20代カウントが 30未満（19,25,29歳）で 3
2. 30代カウントが 30〜39（30,39歳）で 2
3. 40代カウント（45歳）で 1
4. 50代〜カウントが 50以上（55,65歳）で 2
5. 外国籍カウント（カナ姓名・英字姓名）で 2
6. 有効応募数 = 〜20代 + 30代
7. 無効応募数 = 40代 + 50代 + 外国籍
8. 有効応募率・無効応募率の計算
9. `isForeignNg` 個別判定（カナ・英字・漢字・混在）
10. 複合ソート: 配信日昇順
11. 複合ソート: 開封数降順 + 配信日昇順（タイブレーク）

### 既存テスト（リグレッション確認）

| テスト | PASS / FAIL |
|--|--|
| test-scout-slots-list | 13 / 0 |
| test-scout-auto-link | 17 / 0 |
| test-scout-slot-creation | 13 / 0 |
| test-scout-phase-a | 17 / 0 |
| test-scout-aggregated | 17 / 0 |
| test-scout-aggregated-auto-create | 14 / 0 |

### TypeScript / Lint

```
$ npx tsc --noEmit         → エラーなし
$ npx eslint <変更ファイル>  → エラーなし
```

---

## 7. 実装ファイル一覧

| ファイル | 種別 | 内容 |
|--|--|--|
| `src/app/api/scout/slots/list/route.ts` | 修正 | 外国籍カウント / 有効無効 / 複合ソート対応 |
| `src/app/(app)/scout/slots/page.tsx` | 大幅改修 | 2段レイアウト / 複合ソート UI / 列追加 |
| `scripts/test-scout-slots-list-v2.ts` | 新規 | v2 機能の e2e テスト |

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

---

## 10. 既知の限界と将来の検討事項

### in-memory ソートのスケーラビリティ
現状は最大 1ヶ月分（96枠 × 30日 = 2,880件程度）を想定して全件取得 → JS ソートで実装。
それ以上のスケールでは Prisma `orderBy` + 計算カラムへの永続化（DB 計算列 or 集計テーブル）を検討。

### 外国籍判定の精度
`isForeignNg` は姓名の構成文字（カタカナ/英字）で判定するため、以下のケースは誤判定の可能性あり:
- 帰化日本人で氏名がカタカナ表記 → 外国籍と誤判定
- 漢字表記の外国籍（中国・韓国出身者） → 日本人と誤判定

精度向上が必要な場合は `Candidate.nationality` カラム追加 + フォーム入力対応を別タスクで起票。

### マトリクス表示タブ
変更なし。既存通り動作。
