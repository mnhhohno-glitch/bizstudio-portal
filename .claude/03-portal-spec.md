# 03. Portal 仕様メモ

## 主要モデル

### Memo（面談メモ）

```prisma
model InterviewMemo {
  id                String   @id @default(cuid())
  interviewRecordId String   @map("interview_record_id")
  title             String
  flag              String       // "初回面談" / "その他" 等
  date              DateTime     // 日付のみ保存（T00:00:00.000Z 形式、Task と同形式）
  time              String?      // "HH:MM"
  content           String   @db.Text
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")
  interview InterviewRecord @relation(...)
  @@map("interview_memos")
}
```

⚠️ **日付保存形式の重要事項**: T-032 で Task と同形式（`new Date("YYYY-MM-DD").toISOString()`）に統一済み。新規 Memo 作成時は `now.toLocaleDateString('sv-SE')` で日付のみ送信、表示時も `toLocaleDateString('sv-SE')` で抽出する（`toISOString().slice(0,10)` は禁止、JST 0:00-8:59 で前日表示バグ発生）。詳細は `12-pitfalls.md` 罠ポイント #17 参照。

⚠️ **handleUpdateMemo シグネチャ**: `(memoId, field, value)` の **3 引数**。オブジェクト渡し `{ field: value }` ではない。

## 主要API一覧（求職者詳細関連）

| エンドポイント | メソッド | 用途 |
|--|--|--|
| `/api/interviews/[id]/memos` | GET | メモ一覧取得 |
| `/api/interviews/[id]/memos` | POST | メモ新規作成 |
| `/api/interviews/[id]/memos/[memoId]` | PATCH | メモ部分更新（field/value 形式） |
| `/api/interviews/[id]/memos/[memoId]` | DELETE | メモ削除 |

## よく参照すべきファイル

- 面談入力: `InterviewForm.tsx`（1700+行、頻出修正対象、構造マップは `14-ui-component-map.md` 参照）
- 面談メモ API: `src/app/api/interviews/[id]/memos/route.ts`
- 面談メモ更新 API: `src/app/api/interviews/[id]/memos/[memoId]/route.ts`
