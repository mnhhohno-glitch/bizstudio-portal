# 面談履歴の保存 500 エラー再調査レポート (v2)

## 調査日
2026-04-21

## 前回修正の検証結果

### 前回の仮説（v1）: WorkHistory PATCH に `interviewRecordId`, `createdAt`, `updatedAt` が混入

**検証結果: この仮説は誤りだった。**

実DB で以下のテストを実施:
```javascript
// WorkHistory の API レスポンスオブジェクトからidのみ除外して update
const { id, ...rawData } = workHistory;
// rawData = { interviewRecordId, order, companyName, ..., createdAt, updatedAt }
await prisma.workHistory.update({ where: { id }, data: rawData });
// → 結果: SUCCESS（Prisma は受け入れた）
```

Prisma は `interviewRecordId`, `createdAt`, `updatedAt` を含むオブジェクトでの update を問題なく受け入れる。
前回の修正は **不要だったが害もない**（安全性向上として残してよい）。

また、**前回の修正はstaging に push されていなかった**（ローカルの `0abce43` が `origin/staging` の `7dcf3b1` より先にある）。

---

## 真の原因: DateTime フィールドへの不正な文字列入力

### 再現テスト結果

実DBに対して `prisma.interviewDetail.update()` で `nextInterviewDate` に各種値を渡した結果:

| 入力値 | 型 | Prisma の応答 |
|--------|----|--------------|
| `"2026-05-01T00:00:00.000Z"` | 完全 ISO-8601 文字列 | **ACCEPTED** |
| `new Date("2026-05-01")` | Date オブジェクト | **ACCEPTED** |
| `null` | null | **ACCEPTED** |
| `undefined` | undefined | **ACCEPTED**（変更なし） |
| `"2026-05-01"` | 日付のみ文字列 | **REJECTED** ❌ |
| `""` | 空文字列 | **REJECTED** ❌ |

Prisma エラーメッセージ:
```
Invalid value for argument `nextInterviewDate`: premature end of input.
Expected ISO-8601 DateTime.
```

### 発生メカニズム

**InterviewForm.tsx L1362:**
```tsx
<Fld
  value={d.nextInterviewDate ? new Date(d.nextInterviewDate).toISOString().slice(0, 10) : ""}
  onChange={(v) => setDetail("nextInterviewDate", v)}
  type="date"
/>
```

1. HTML `<input type="date">` のブラウザ仕様: `onChange` で返る値は `"2026-05-01"`（date-only）または `""`（クリア時）
2. `setDetail("nextInterviewDate", "2026-05-01")` → state に date-only 文字列が格納
3. 自動保存（autosave）が `cleanRelationFields(detail)` 経由で `{ nextInterviewDate: "2026-05-01" }` を送信
4. autosave route が `prisma.interviewDetail.upsert({ update: body.detail })` で Prisma に渡す
5. **Prisma が date-only 文字列 `"2026-05-01"` を拒否 → 500 エラー**

クリア時は:
1. ユーザーが日付を消す → `onChange` が `""` を返す
2. `setDetail("nextInterviewDate", "")` → state に空文字列
3. autosave が `{ nextInterviewDate: "" }` を送信
4. **Prisma が空文字列を拒否 → 500 エラー**

### 影響するフィールド一覧

InterviewDetail の DateTime? フィールド:
- `resignationDate` — フォームUI なし（AI解析からのみ設定）→ 影響低
- **`nextInterviewDate`** — フォームUI あり（L1362）→ **確実に影響**
- `jobSendDeadline` — フォームUI なし → 影響低

InterviewRecord の DateTime フィールド:
- `interviewDate` — `form.interviewDate || undefined` でガードされている + autosave route で `new Date()` 変換 → **影響なし**

### なぜ常時エラーではなく特定操作でエラーになるか

- フォーム初期読み込み時: API レスポンスは完全ISO文字列 (`"2026-05-01T00:00:00.000Z"`) を返すため、**stateに格納された値はPrismaが受け入れる形式**
- ユーザーが `nextInterviewDate` を**変更しない限り**、エラーは発生しない
- ユーザーが日付フィールドを**操作した瞬間**、`<input type="date">` が返す date-only 文字列がstateに入り、次回の autosave で 500 エラーが発生

---

## Railway staging ログ状況

```
railway logs --since 1w --filter "Autosave"  → 該当なし
railway logs --since 1w --filter "error"     → OCR/PDF関連エラーのみ
railway logs --since 1w --filter "500"       → 該当なし
```

最新デプロイ以降のログには autosave 500 エラーの記録がなかった。
autosave route の `console.error("Autosave error:", error)` は実装されているが、
ユーザーが最新デプロイ後に `nextInterviewDate` を操作していない可能性が高い。

---

## 修正方針

### 必須修正

1. **InterviewForm.tsx**: detail state に DateTime 値を格納する際、date-only 文字列を完全ISO文字列に変換、空文字列を `null` に変換

```typescript
// setDetail の改修案
const setDetail = (key: string, value: unknown) => {
  // DateTime フィールドの空文字列を null に、date-only を ISO-8601 に変換
  const DATETIME_FIELDS = ["resignationDate", "nextInterviewDate", "jobSendDeadline"];
  let v = value;
  if (DATETIME_FIELDS.includes(key)) {
    if (typeof v === "string") {
      if (v === "") v = null;
      else if (!v.includes("T")) v = new Date(v).toISOString(); // "2026-05-01" → "2026-05-01T00:00:00.000Z"
    }
  }
  setDetailState((prev) => ({ ...prev, [key]: v }));
  setIsDirty(true);
};
```

2. **autosave route (防御的)**: `body.detail` の DateTime フィールドをサーバー側でもサニタイズ

### 追加修正（安全策）

3. **PATCH route `/api/interviews/[id]/route.ts`**: manual save 時も同様にサニタイズ
4. **autosave route**: エラーログにリクエストbodyの要約を追加（次回デバッグ用）

---

## 確認事項

- 上記の修正方針で GO でしょうか？
- フェーズ2（自動保存化）は保存エラー修正後に着手する認識で合っていますか？
