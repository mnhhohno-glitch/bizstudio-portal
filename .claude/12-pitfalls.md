# 12. 罠ポイント集

## 17. JST タイムゾーン

**罠**: portal の `timestamp without time zone` カラムは JST 値前提で運用されているが、ブラウザから `Date.toISOString()` でフルタイムスタンプ（時分秒含む UTC）を渡すと UTC 文字列に変換され、表示時に日付がずれる。特に `toISOString().slice(0,10)` で日付抽出すると JST 0:00-8:59 作成のレコードが**前日表示される9時間ずれバグ**が発生する。

### 対処パターン（既存実装の対比）

| モデル | 保存形式 | 表示時抽出 | 状態 |
|--|--|--|--|
| Task.dueDate | `new Date("YYYY-MM-DD").toISOString()` で T00:00:00Z 統一 | `toLocaleDateString("ja-JP")` または `split("T")[0]` | 正常 |
| Memo.date | `now.toISOString()`（フルタイムスタンプ送信） → T-032 で `toLocaleDateString('sv-SE')` に統一 | `toISOString().slice(0,10)` → T-032 で `toLocaleDateString('sv-SE')` に統一 | 修正済（commit 2ecc181, 2026/5/7） |
| tasks.created_at | DB 直接書き込み時は `new Date("...+09:00")` 形式 | - | スクリプトで要注意 |

### 採用パターン（推奨）

`toLocaleDateString('sv-SE')` を **保存・表示の両方で使う**。`'sv-SE'` ロケールは ISO 8601 形式（YYYY-MM-DD）をブラウザTZで出力するため、JST ブラウザでは正しい JST 日付になる。既存 UTC 保存データもブラウザ側で自動変換され、マイグレーション不要。

```typescript
// 保存時（新規作成）
const now = new Date();
body: JSON.stringify({
  date: now.toLocaleDateString('sv-SE'),  // "YYYY-MM-DD"
  // ...
});

// 表示時
value={memo.date ? new Date(memo.date).toLocaleDateString('sv-SE') : ""}
```

### 新機能で日付フィールド追加時のチェックリスト

1. 保存時: フロントから `"YYYY-MM-DD"` 形式 or `toLocaleDateString('sv-SE')` で送る
2. 表示時: `toLocaleDateString('sv-SE')` で日付抽出（`toISOString().slice(0,10)` は禁止）
3. JST 0:00-8:59 の作成シナリオで前日表示にならないか必ず動作確認
4. 既存パターン（Task の dueDate 処理）に揃えることで再発防止

### 関連ケース

- T-032 (2026/5/7): Memo.date の9時間ずれバグ修正、commit 2ecc181
- 室岡ほのかさん（5004405）2回目面談メモで該当（JST 5/7 06:15 作成 → 5/6 表示 → 修正後 5/7 表示）
- Phase C cleanup script 実装時にも JST タイムゾーン関連で発覚

**詳細**: `03-portal-spec.md` の Memo 節参照
