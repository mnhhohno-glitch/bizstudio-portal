# 面談履歴の保存 500 エラー調査レポート

## 発生日
2026-04-21

## 症状
- PATCH `/api/interviews/{id}/autosave` → 500
- PATCH `/api/interviews/{id}/work-histories/{whId}` → 500

## 根本原因

### WorkHistory PATCH 500（主原因）

**GET `/api/interviews/[id]`** が `include: { workHistories: true }` で返す WorkHistory オブジェクトには、Prisma が自動管理するフィールドが含まれる:

```json
{
  "id": "...",
  "interviewRecordId": "...",
  "order": 1,
  "companyName": "...",
  "createdAt": "2026-04-20T...",
  "updatedAt": "2026-04-20T..."
}
```

**InterviewForm.tsx** の WorkHistory autosave（L455-472）では:
```typescript
const { id: whId, ...data } = wh;
fetch(`/api/interviews/${interviewId}/work-histories/${whId}`, {
  method: "PATCH",
  body: JSON.stringify(data), // ← interviewRecordId, createdAt, updatedAt が残る
});
```

`id` のみ除外して残りをそのまま送信。`data` には `interviewRecordId`、`createdAt`、`updatedAt` が含まれたまま。

**PATCH route**（`[whId]/route.ts` L22-26）では:
```typescript
const updated = await prisma.workHistory.update({
  where: { id: whId },
  data: body, // ← 未サニタイズ
});
```

`body` をそのまま Prisma に渡すため、以下のエラーが発生:
- `interviewRecordId`: リレーションフィールドを直接更新しようとしてエラー
- `createdAt`/`updatedAt`: `@updatedAt` 自動管理フィールドに文字列を渡してエラー

### Autosave PATCH 500（副次的）

`cleanRelationFields()` が `id`、`interviewRecordId`、`createdAt`、`updatedAt`、`interviewRecord` を除去するが、detail/rating オブジェクトに含まれるその他のリレーションフィールド（例: `interviewDetail` の未知フィールド）が残る可能性がある。

## 修正内容

### 1. `[whId]/route.ts` PATCH — サーバー側サニタイズ
`body` から既知のフィールドのみ取り出して Prisma に渡す（POST/PUT と同じパターン）。

### 2. `InterviewForm.tsx` WorkHistory autosave — クライアント側クリーンアップ
送信前に `interviewRecordId`、`createdAt`、`updatedAt` を除外。

## 影響範囲
- 面談レコードの職歴 autosave
- 面談レコードの手動保存（`handleSave` 内の PUT は既にサニタイズ済みで影響なし）
