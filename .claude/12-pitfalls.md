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

### サーバー側の罠: Railway UTC 環境での `Date.getDay()` ずれ（追加事例）

上記まではブラウザ側（クライアント）で発生する TZ ずれの話。サーバー側でも別パターンの罠がある。

**症状**: サーバー（Railway 本番）で生成した `Date` から `getDay()` で曜日判定すると、JST の土曜が金曜扱いされる等のずれが発生。Windows/Mac のローカル開発環境（JST）では動いても、本番（Railway UTC）で壊れる。

**原因**: Railway 本番は UTC で動作。`Date.getDay()` はサーバーのローカル TZ 基準で曜日を返すため、UTC 環境では UTC 曜日を返す。JST 5/2 0:00 = UTC 5/1 15:00 → UTC では金曜（day=5）と判定され、土日除外を逃れる。

**対処パターン**: 入力 Date に +9h 補正してから `getUTCDay()` を使う。`src/lib/attendance/business-days.ts` の `isBusinessDay()` がリファレンス実装:

```typescript
import holiday_jp from "@holiday-jp/holiday_jp";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function isBusinessDay(date: Date): boolean {
  const jstDate = new Date(date.getTime() + JST_OFFSET_MS);
  const day = jstDate.getUTCDay();  // JST 基準の曜日
  if (day === 0 || day === 6) return false;
  if (holiday_jp.isHoliday(jstDate)) return false;
  return true;
}
```

`@holiday-jp/holiday_jp` の `isHoliday()` も同様に補正済の `jstDate` を渡す（ライブラリは Date をローカル TZ 解釈するため、JST 補正後の Date を渡すのが安全）。

**サーバー側 TZ ずれ チェックリスト**（既存「新機能で日付フィールド追加時のチェックリスト」とは別物）:
- サーバーサイドで `Date.getDay()` / `getDate()` / `getMonth()` を **直接呼んでいる箇所は要確認**（特に営業日・祝日・曜日判定）
- `new Date(year, month-1, d)` もサーバーローカル TZ 依存（Railway では UTC 0:00 が生成される）
- 営業日・祝日・曜日判定は原則 `src/lib/attendance/business-days.ts` の `isBusinessDay()` 経由に統一する
- ローカル開発（JST）で動作確認 OK でも、本番（Railway UTC）で動かない可能性を必ず疑う
- `dayjs` の `cursor.day()` / `cursor.toDate().getDay()` も同じ罠あり、JST 補正必要

**関連ケース（サーバー側）**:
- T-033 緊急修正（commit `1a2b06a`, 2026/5/7）: Phase 4 で `isBusinessDay()` を導入したが初版が `date.getDay()` 直接呼び出しで、本番 Railway UTC 環境で 5/2 (土) が未打刻アラートに表示されるバグ発生。`+9h` 補正 + `getUTCDay()` で解決。

**詳細**: `03-portal-spec.md` の Memo 節参照
