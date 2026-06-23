# T-064 配信枠管理レコード一覧 UI v3.1 完了報告書

実装日: 2026-05-25
commit: `0d7b775` (master direct push)
staging マージ済 (commit `3ae4a1f`)
Railway 本番反映確認済（`/api/scout/slots/list` → 401）

---

## 完了条件チェックリスト

| # | 項目 | 結果 |
|--|--|--|
| 1 | 左側5列を w-[120px] に統一 | ✅ |
| 2 | 集計列7列を w-[44px] から w-[52px] に変更 | ✅ 全集計列が w-[52px] に統一 |
| 3 | スカウト運用配下の全画面でタブタイトル設定 | ✅ `scout/layout.tsx` で一括設定 |
| 4 | 他画面のタブタイトルは変更なし | ✅ |
| 5 | 既存テスト全項目 PASS | ✅ 45件 PASS（13+15+17） |
| 6 | master push 済 | ✅ |
| 7 | staging マージ済（本番反映完了） | ✅ |
| 8 | Railway デプロイ完了確認済 | ✅ |
| 9 | 完了報告書作成済 | ✅ 本ファイル |

---

## 1. 列幅変更

### Before / After

| 対象 | Before | After |
|--|--|--|
| スカウトNO / 種別\|媒体 | 幅指定なし（whitespace-nowrap） | `w-[120px]` |
| 中 / 小 | 幅指定なし | `w-[120px]` |
| 配信者 / 号機 | 幅指定なし | `w-[120px]` |
| 配信日 / 曜日 | 幅指定なし | `w-[120px]` |
| 時間帯 / 時間 | 幅指定なし | `w-[120px]` |
| 配信数〜応募率(開封) | `w-[52px]` | `w-[52px]`（変更なし） |
| 〜20代〜無効応募数 | `w-[44px]` | `w-[52px]` |
| 有効応募率〜無効応募率 | `w-[52px]` | `w-[52px]`（変更なし） |

### whitespace-nowrap の扱い

左側5列の `<td>` には `whitespace-nowrap` を残した。120px に対して:
- スカウトNO（SC10063312）: 11px × 10文字 ≈ 110px → 収まる
- 「社員 | マイナビ転職」: 約 110px → 収まる
- 「藤本 なつみ」「大野 望」: 収まる
- 「2026-05-25」: 収まる
- 「月曜日」「19:00」: 収まる

---

## 2. タブタイトル

### 実装方法

`src/app/(app)/scout/layout.tsx` を新規作成し、metadata で一括設定:

```typescript
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "スカウト運用",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
```

root layout の template `"%s - Bizstudio"` により、ブラウザタブには **「スカウト運用 - Bizstudio」** と表示される。

### 対象画面

| パス | タブタイトル |
|--|--|
| /scout | スカウト運用 - Bizstudio |
| /scout/slots | スカウト運用 - Bizstudio |
| /scout/by-sent | スカウト運用 - Bizstudio |
| /scout/by-applied | スカウト運用 - Bizstudio |
| /scout/by-media | スカウト運用 - Bizstudio |
| /scout/open-count | スカウト運用 - Bizstudio |
| /scout/import-legacy | スカウト運用 - Bizstudio |

既存パターン（`entries/layout.tsx`, `documents/layout.tsx` 等）と同じ方式。

---

## 3. 実装ファイル一覧

| ファイル | 種別 | 内容 |
|--|--|--|
| `src/app/(app)/scout/slots/page.tsx` | 修正 | 左5列 w-[120px] + 集計列 w-[52px] 統一 |
| `src/app/(app)/scout/layout.tsx` | 新規 | スカウト運用タブタイトル |

---

## 4. 変更禁止ファイル

以下は触っていない:
- `src/constants/candidate-flags.ts`
- `specs/` 配下
- `scripts/gas/` 配下
- `src/services/loadSpec.ts`
- `src/services/geminiClient.ts`
