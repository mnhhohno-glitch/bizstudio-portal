# マイページ機能調査: Pickup / 職種 / ソート

調査日: 2026-07-17
対象: portal (master) + bizstudio-mypage (read-only)
制約: コード変更なし・DB操作なし・AI呼出なし

---

## 1. Pickup フラグの格納場所

### 現状

CandidateFile に「ピックアップ」用のカラムは存在しない。

既存で流用候補となりうる仕組み:

| 候補 | 判定 | 理由 |
|------|------|------|
| `displayOverrides` (Json?) | 不適 | 13キーの表示上書き専用。意味論が違う。JSON内のフラグではmax3制約のDBレベル検証が困難 |
| `displayOrder` (Int?) | 不適 | 並び順の数値。ピン留めとは直交する概念 |
| `caMatchLabel` (String?) | 不適 | ◎○△の評価ラベル。用途が異なる |

### 推奨: 新 nullable カラム `pickedUpAt DateTime?`

```
// schema.prisma CandidateFile に追加
pickedUpAt  DateTime?   // CAがピックアップした日時。NULL=未ピックアップ
```

- **NULL = 非ピックアップ / 非NULL = ピックアップ中**（日時はいつピックアップしたかの記録用）
- Boolean でなく DateTime にする理由: ピックアップ順ソート（古い順=先に選んだもの優先）に使える
- **上限3件の制約**: APIレイヤー（PATCH エンドポイント）で `WHERE candidateId = ? AND pickedUpAt IS NOT NULL` のカウントチェック。DBレベル制約は不要（partial unique index でも3件上限は表現不能）

### API設計案

既存の display-overrides / display-order と同一の慣例に乗せる:

```
PATCH /api/external/candidate-site/pickup
body: {
  candidateNumber | candidateId,
  actor: "ca",          // CA専用
  fileId: string,
  pickup: true | false  // true=ピックアップ, false=解除
}
```

- `pickup: true` 時に既存ピックアップ数 ≥ 3 → 400 エラー
- `pickup: false` → `pickedUpAt = null`
- actor="user" → 403（本人操作不可）

### プレビュー画面での確認UI

ピックアップの確認・操作は `CaRecommendPanel.tsx` 内、各カードの既存コントロール領域に配置:

- 現在のカード内UI要素（preview時）:
  - 行309: DnDハンドル + 上下ボタン
  - 行416: 「編集」ボタン → JobEditModal
  - 行173: 編集済みバッジ
- ピックアップトグル（ピンアイコン等）をDnDハンドル右隣 or 編集ボタン横に追加
- ピックアップ済みカードにはバッジ表示（「📌」等）
- ピックアップ上限3件に達している場合はトグル無効化 + ツールチップ

### favorites GET への影響

現在の FavoriteDTO（portal favorites API レスポンス）にフィールド追加:

```typescript
pickedUpAt: string | null  // ISO datetime or null
```

mypage 側 SiteFavorite 型にも同フィールド追加 → CaRecommendPanel でピン表示判定に使用。

---

## 2. 求人の職種（Job Category）

### データソース

| ソース | フィールド | 形式 | 利用可否 |
|--------|-----------|------|----------|
| job-platform batch API → `CandidateJobDTO` | `categoryPaths` | `string[]`（例: `["営業 > 法人営業 > IT営業"]`） | **利用可** |
| kyuujinPDF 構造化データ → `PdfJobData` | なし | — | **利用不可** |
| kyuujinPDF 反応求人 → `ReactionJob` | `jobCategory` | `string \| null`（自由文） | seed専用。ソート向き不可 |

### 現在のデータフロー

```
job-platform → POST /api/public/jobs/batch
  → mypage BFF (favorites/route.ts L251-266) が100件チャンクで取得
  → SiteFavorite.job.categoryPaths として格納済み
  → 求人詳細ページ (jobs/[id]/page.tsx L224-229) で「職種」チップとして表示済み
```

**追加のAPI呼出やカラム追加なしで、職種データは既にmypageクライアントに到達している。**

### カバレッジ

- **job-platform 行** (`sourceType: "job-platform"`): `categoryPaths` あり → **職種ソート可能**
- **PDF 行** (`sourceType: "pdf"`): `PdfJobData` に職種フィールドなし → **職種ソート不可**（ソート末尾に配置）

CandidateFile にカラムを追加してポータル側で職種を保持する案もあるが、以下の理由で不要:

1. 既に BFF が job-platform から取得済み（二重保持になる）
2. PDF行の職種は元データに存在しない（カラムを作っても埋まらない）
3. 職種のマスター管理は job-platform 側（portal は source of truth ではない）

---

## 3. ソート実装の現状と職種別ソートの実現性

### 現状のソートロジック

**ユーザー向けソート選択UIは存在しない。** ソートは完全にハードコード。

```
CaRecommendPanel.tsx L670-686:
  タブ内のいずれかに displayOrder != null あり
    → displayOrder ASC (null last) → createdAt DESC      [CA手動順]
  なし
    → compareFavoritesNewest                               [既定順]

ca-status.ts L107-118 compareFavoritesNewest:
  1. introducedAt（時単位切捨て）降順
  2. caMatchLabel ランク（◎=1, ○=2, △=3, なし=999）昇順
  3. kyuujinJobId 昇順
  4. createdAt 降順
```

ホームページ上部レーン（top 6）も同一ロジック。

### 職種別ソートの変更スコープ

| 変更箇所 | ファイル | 内容 |
|----------|---------|------|
| ソート関数追加 | `mypage: src/app/site/_lib/ca-status.ts` | `compareFavoritesByCategory` 新規。categoryPaths[0] の大分類でグループ化→グループ内は既定順 |
| ソート選択UI | `mypage: src/app/site/_components/CaRecommendPanel.tsx` | ドロップダウン or タブ。選択肢: 「新着順」(既定) / 「職種別」 |
| 状態管理 | `mypage: src/app/site/_lib/store.tsx` | sortMode state 追加 |
| PDF行の扱い | ソート関数内 | `job === null` (PDF行) は category を `"zzz"` 等にして末尾配置 |

**注意**: displayOrder（CA手動順）が設定されている場合はCA手動順が常に優先される現行仕様を維持すること。職種別ソートは「CA手動順なし」の場合のデフォルトソートの代替選択肢。

### ソート関数の設計案

```typescript
export function compareFavoritesByCategory(a: SiteFavorite, b: SiteFavorite): number {
  const catA = a.job?.categoryPaths?.[0]?.split(" > ")[0] ?? "￿";
  const catB = b.job?.categoryPaths?.[0]?.split(" > ")[0] ?? "￿";
  if (catA !== catB) return catA.localeCompare(catB, "ja");
  // 同一大分類内は既定順
  return compareFavoritesNewest(a, b);
}
```

---

## 4. 実装分割案

### Phase 1: Pickup フラグ（portal のみ）

- `schema.prisma`: CandidateFile に `pickedUpAt DateTime?` 追加
- マイグレーション実行（nullable追加 = master直push可）
- `PATCH /api/external/candidate-site/pickup` 新規エンドポイント
- `GET .../favorites` レスポンスに `pickedUpAt` フィールド追加
- **デプロイ**: master 直 push（新API + nullable カラム追加）

### Phase 2: Pickup プレビューUI（mypage）

- `SiteFavorite` 型に `pickedUpAt` 追加
- `CaRecommendPanel.tsx` にピックアップトグル追加（preview時のみ）
- ピックアップ済みカードにバッジ表示（候補者側にも表示）
- pickup API 呼出（BFF 経由）

### Phase 3: 職種別ソート（mypage）

- `ca-status.ts` に `compareFavoritesByCategory` 追加
- `CaRecommendPanel.tsx` にソート選択UI追加
- `store.tsx` に sortMode 状態追加
- PDF行は末尾配置

---

## 5. 確認事項

### コード変更なし

本調査ではコードの変更・DBへの書き込み・マイグレーションは一切行っていない。

### 予期しない発見

1. **レガシーマイページの残存ソートロジック**: `LegacyMypageClient.tsx` L208-308 に別系統のソートロジック（2グループモデル: 手動順グループ+自動順グループ）が存在。新ソート追加時にレガシー側への反映要否を判断する必要がある。ただし T-133 P4 で旧 favorites ページは `/site/{token}/mypage` へリダイレクト済みのため、レガシーソートの影響は限定的。

2. **ReactionJob.jobCategory の存在**: kyuujinPDF 反応求人に `jobCategory: string | null`（自由文）が存在するが、推薦seed生成専用。SiteFavorite には含まれず、ソート用途には不適（非構造化・カバレッジ不明）。

3. **displayOrder の二重ソートリスク**: CA手動順（displayOrder）と職種別ソートは排他。現行コード（L670-686）は `anyManual` フラグで分岐しており、職種別ソートを追加する場合もこの分岐構造に乗せれば安全。ただし「タブ内の一部だけCA手動順あり」のケースでは全行がCA手動順分岐に入る現行仕様に注意。
