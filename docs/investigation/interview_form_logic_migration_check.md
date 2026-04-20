# 新UI InterviewForm.tsx ロジック移植チェックレポート

コミット: b40c76a
対象ファイル: `src/components/candidates/InterviewForm.tsx` (1178行)
チェック日: 2026-04-20

## サマリー

- 全 30 項目中
  - ✅ OK: 22
  - ❌ NG: 3
  - ⚠️ 要確認: 5

## NG・要確認項目（優先対応）

---

### ❌ NG-1 [B-1]: 候補者データの取得 — APIレスポンス構造の不一致

**行番号**: InterviewForm.tsx L339-344
**問題**: `/api/candidates/${candidateId}` は `{ candidate: {...} }` を返す（route.ts L44: `NextResponse.json({ candidate })`）。
しかしフロント側は：

```typescript
// L342-343
.then((r) => r.ok ? r.json() : null)
.then((data) => { if (data) setCandidate(data); })
```

`data` は `{ candidate: { id, name, ... } }` だが、`setCandidate(data)` で丸ごとセットしている。
CandidateInfo 型の `data.name` は undefined → **全RO表示が "-" になる**。

**正しいコード**: `setCandidate(data.candidate)`

**影響度**: **大** — 求職者情報（氏名・電話・メール・住所・生年月日・年齢・性別・担当CA）が全て "-" 表示。スクショで "-" だった問題はこれが原因の可能性が高い。

---

### ❌ NG-2 [B-1 関連]: Employee select に employeeNumber ���ない

**行番号**: InterviewForm.tsx L50, L708
**問題**: CandidateInfo 型定義（L50）で `employee: { name: string; employeeNumber: string } | null` を期待。
しかし `/api/candidates/{id}` の Prisma include は:

```typescript
// route.ts L18
employee: { select: { id: true, name: true } }
```

`employeeNumber` が select されていない → `candidate.employee.employeeNumber` は undefined。
L708 で `BS${candidate.employee.employeeNumber}` → `"BSundefined"` 表示。

**影響度**: 中 — 担当CA欄の社員番号が不正表示。

---

### ❌ NG-3 [H-3]: 文字化け（Unicode Replacement Character U+FFFD）22箇所

**行番号**: 22行にわたり発生
**問題**: ファイル内に Unicode Replacement Character (U+FFFD = `�`) が22箇所存在。
表示上は文字が欠落する。

**全箇所一覧**:

| 行 | 現在のテキスト | 正しいテキスト |
|---|---|---|
| L69 | `添��` | `添付` |
| L85 | `エ���ア` | `エリア` |
| L505 | `に�����しました` | `に失敗しま���た` |
| L513 | `削除�����すか` | `削除しますか` |
| L533 | `新規メ���` | `新規��モ` |
| L629 | `変更あ���` | `変更あり` |
| L708 | `���当CA` | `担当CA` |
| L731 | `求���紹介` | `求人紹介` |
| L742 | `転職活動状��` | `転職活動状況` |
| L835 | `��未入力` | `（未入力` |
| L905 | `���規メモ登録` | `新規メモ登録` |
| L910 | `希望条��タブ` | `希望条件タブ` |
| L938 | `詳細メ��` | `��細メモ` |
| L943 | `東京都内���` | `東京都内）` |
| L944 | `詳細メ��` | `詳細メモ` |
| L955 | `45時間���内` | `45時間以内` |
| L961 | `取得予��` | `取得予定` |
| L963 | `日本���` | `日本語` |
| L988 | `ラ��ク` | `ランク` |
| L1095 | `次回面談予���` | `次回面談予定` |
| L1136 | `ファイルを選��` | `ファイルを選択` |
| L1145 | `添付��ァイル一覧` | `添付フ���イル一覧` |

**影響度**: **大** — UIテキストが22箇所で文字化け。タブラベル「添付」が正しく表示されない。

---

### ⚠️ 要確認-1 [C-2]: 自動保存の依存配列

**行���号**: InterviewForm.tsx L362-400
**問題**: useEffect の依存配列:

```typescript
// L400
}, [isDirty, interviewId, form, detail, rating, autosaveToken, currentUser?.id]);
```

`form`, `detail`, `rating` がオブジェクトのため、**setField / setDetail / setRating が呼ばれるたびに**新しいオブジェクト参照が生成され、useEffect が再実行 → `clearInterval` → 新しい `setInterval`。
つまり**入力のたびにタイマーが��セット**される。

**影響**: 30秒間入力し続けると自動保存が発火しない（最後の入力から30秒後に初めて発火）。これは「デバウンス」的な挙動であり、**機能としては問題ない**（むしろ望ましい）。ただし旧UIと挙動が異なる可能性あり。

**判定**: 実害なしだが、意図的かどうか将幸さんに確認。

---

### ⚠️ 要確認-2 [E-1]: handleAnalyze が「添付ファイルAI解析」のみ

**行番号**: InterviewForm.tsx L484-508
**問題**: `handleAnalyze` は添付ファイル個別のAI解析（`/api/interviews/${interviewId}/attachments/${attachmentId}/analyze`）のみ実装。
アクションタブ L1106 に `✨ AI整理` ボタンがあるが、`onClick` ハンドラが未設定:

```typescript
// L1106
<BtnMini variant="ai">✨ AI整理</BtnMini>  // ← onClick がない
```

**影響度**: 低 — ボタンは表示されるがクリックしても何も起きない。将来のAI機能用プレースホルダーか、実装漏れか要確��。

---

### ⚠️ 要確認-3 [F-1/F-2/F-3]: 職務経歴カードが1社目固定

**行番号**: InterviewForm.tsx L767-794
**問題**: 職務経歴カードは1社目のみハードコードされている。「+ 追加」ボタンや削除ボタンがない。
Prisma スキーマの InterviewDetail は1レコードしか持たない構造のため、**現状では1社分しか保存できない**。

```typescript
// L772 — ハードコードされた「1 社目」
<span style={{ fontSize: 12, fontWeight: 500, color: "var(--im-fg)", minWidth: 50 }}>1 社目</span>
```

**影響度**: 低 — スキーマ上の制約であり、新UIの問題ではない。ただしモックアップには複数カード対応の指示があった可能性があるため確認。

---

### ⚠️ 要確認-4 [I-3]: PDF表示ボタンが未実装

**行番号**: InterviewForm.tsx L641-648
**問題**: PDF表示ボタンに `onClick` ハンドラがない:

```typescript
// L641-648
<button
  type="button"
  className="cursor-pointer inline-flex items-center justify-center gap-1"
  style={...}
>
  <svg .../>
  PDF表示
</button>  // ← onClick がない
```

**影響度**: 低 — ボタンは表示されるがクリックしても何も起きない。

---

### ⚠️ 要���認-5 [I-4]: 「+ 新規面談」ボタンがヘッダーにない

**行番号**: InterviewForm.tsx 全体
**問題**: InterviewForm はヘッダーに「+ 新規面談」ボタンを持たない。この機能は親コンポーネント InterviewHistoryTab.tsx で管理されているため、**InterviewForm の責務外**。

**影響度**: なし — 設計上正しい。

---

## OK 項目

### カテゴリ C: 保存系ロジック

| # | 項目 | 判定 | 証拠 |
|---|---|---|---|
| C-1 | handleSave 関数 | ✅ OK | L418-460。PATCH `/api/interviews/${interviewId}`。rating の小計・合計を計算して送信。try/catch あり。成功時 `toast.success("保存しました")` (L453)。`setIsDirty(false)` (L451)、`onSaved?.()` コールバック (L454)。status を `"complete"` に設定 (L445)。 |
| C-2 | 自動保存 setInterval | ✅ OK (⚠️ 上記参照) | L362-400。PATCH `/api/interviews/${interviewId}/autosave`。30秒間隔 (L398: `AUTOSAVE_INTERVAL = 30_000`)。`isDirty` チェックあり (L363)。unmount 時 `clearInterval` (L399)。409 Conflict 対応あり (L392-393)。失敗時 localStorage フォールバック (L396)。 |
| C-3 | beforeunload | ✅ OK | L403-409。`isDirty` 条件で `e.preventDefault()` + `e.returnValue = ""`。unmount 時 `removeEventListener`。 |
| C-4 | バリデーション | ✅ OK | 旧UIと同様、明示的なバリデーションロジックなし。フォームフィールドは全て optional (Prisma スキーマ上も全て `?`)。保存時にバリデーションは不要。 |

### カテゴリ D: 添付ファイル

| # | 項目 | 判定 | 証拠 |
|---|---|---|---|
| D-1 | handleUpload | ✅ OK | L463-481。POST `/api/interviews/${interviewId}/attachments`。FormData で `file` を送信。サイズ制限・MIMEチェックはAPI側で実施 (route.ts: 20MB、ALLOWED_MIME_TYPES)。成功時 `setAttachments` で先頭に追加 (L474)。toast 表示 (L475)。 |
| D-2 | handleDeleteAttachment | ✅ OK | L512-523。DELETE `/api/interviews/${interviewId}/attachments/${attachmentId}`。API側で Supabase Storage 削除 + DB レコード削除。confirm ダイアログあり (L513)。成功時 state から filter で除去 (L517)。 |
| D-3 | 添付ファイル表示 | ✅ OK | L1149-1167。ファイル名、サイズ (KB)、解析ステータス Chip、AI解析ボタン、削除ボタン表示。ドラッグ＆ドロップ対応 (L1122-1123)。ファイル選択ボタン + hidden input (L1125-1128)。 |

### カテゴリ E: AI解析

| # | 項目 | 判定 | 証拠 |
|---|---|---|---|
| E-1 | handleAnalyze | ✅ OK | L484-508。POST `/api/interviews/${interviewId}/attachments/${attachmentId}/analyze`。API側 (analyze/route.ts) で `generateWithGemini` + `buildStructuredExtractPrompt` 呼び出し。モデル名・プロンプトYAMLは API 側管理であり、InterviewForm は触れていない。ローディング: `setAnalyzingId` (L485, L507)。エラーハンドリング: failed 状態更新 + toast (L498-502)。 |
| E-2 | AI解析ボタン配置 | ✅ OK | L1146: 一括解析ボタン「✨ ログを解析して各カラムへ自動入力」。L1158: 個別ファイル解析ボタン「✨ AI解析」。analyzingId で disabled 相当の表示切替 (L1159)。 |

### カ���ゴリ G: メモ CRUD

| # | ���目 | 判定 | 証拠 |
|---|---|---|---|
| G-1 | handleAddMemo | ✅ OK | L526-547。POST `/api/interviews/${interviewId}/memos`。デフォルト flag: `"初回面談"` (L535)。成功時 state 先頭に追加 (L542)。 |
| G-2 | handleDeleteMemo | ✅ OK | L560-571。DELETE `/api/interviews/${interviewId}/memos/${memoId}`。confirm ダイアログ (L561)。成功時 state から filter 除去 (L565)。 |
| G-3 | 日時設定 | ✅ OK | L882-889。date input (`type="date"`) と time input (`type="time"`) が各メモカードに配置。`handleUpdateMemo` で即座にAPI更新 (PATCH)。 |
| G-4 | タイプ選択 | ✅ OK | L875-880。select 要素。選択肢: `MEMO_FLAGS = ["初回面談", "既存面談", "面接対策", "内定面談", "その他"]` (L74)。 |

### カテゴリ H: タブ切り替え

| # | 項目 | 判定 | 証拠 |
|---|---|---|---|
| H-1 | タブ state 管理 | ✅ OK | L281: `const [rightTab, setRightTab] = useState<string>("initial")`。デフォルトは「初期条件」。 |
| H-2 | タブ切り替え | ✅ OK | L804: `onClick={() => setRightTab(tab.id)}`。5タブ全てが条件分岐で表示 (L826, L911, L985, L1079, L1114)。 |

### カテ���リ I: ナビゲーション

| # | 項目 | 判定 | 証拠 |
|---|---|---|---|
| I-1 | 「← 一覧に戻る」 | ✅ OK | L634: `onClick={() => window.history.back()}`。未保存警告なし（これは意図的 — 一覧に戻るだけ）。 |
| I-2 | 「キャンセル」 | ✅ OK | L638: `onClick={() => { if (!isDirty \|\| confirm("変更を破棄しますか？")) window.history.back(); }}`。未保存時に confirm ダイアログ。 |

### カテゴリ J: 型安全性・ビルド

| # | 項目 | 判定 | 証拠 |
|---|---|---|---|
| J-1 | TypeScript 型エラー | ✅ OK | `npx tsc --noEmit` で 0 エラー（2026-04-20 確認済み）。ただし CandidateInfo 型と実際のAPIレスポンスの不一致は `AnyRecord` や `any` で型エラーにならない。 |
| J-2 | 未使用インポート | ✅ OK | React, useState, useEffect, useCallback, useRef, toast — 全て使用されている。 |
| J-3 | コンポーネント props 型 | ✅ OK | L53-58: `InterviewFormProps = { interviewId, candidateId, currentUser, onSaved }` — 呼び出し元 InterviewHistoryTab.tsx L243-247 と完全互換。 |

### カテゴリ K: 前セッション実装機能の生存確認

| # | 項目 | 判定 | 証拠 |
|---|---|---|---|
| K-1 | エントリーボード連携 | ✅ OK (対象外) | supportStatus 更新は InterviewHistoryTab.tsx の `handleCreateInterview` (POST `/api/interviews`) および API 側の処理。InterviewForm の責務外。 |
| K-2 | 担当CA自動入力 | ✅ OK | InterviewHistoryTab.tsx L123 で `interviewerUserId: currentEmployeeId` を POST 時に送信。InterviewForm は既存レコードの編集のみのため、作成時の自動入力は InterviewHistoryTab の責務。 |
| K-3 | AI「お仕事内容」生成 | ✅ OK (対象外) | 別機能 (`/api/candidates/{id}/guides/interview`)。InterviewForm とは独立��� |
| K-4 | メモパーサ�� | ✅ OK (対象外) | 添付ファイル解析API側 (`analyze/route.ts`) で `buildStructuredExtractPrompt` が処理。InterviewForm からは `handleAnalyze` で POST するだけ。 |

---

## コード外の手動確認が必要な項目

1. **NG-1 修正後の候補者情報表示**: `setCandidate(data.candidate)` に修正した後、実機で氏名・電話等が正しく表示されるか確認
2. **保存後のF5リロードでデータ永続化**: Network タブで PATCH リクエストが飛んでいるか、DB に反映されているか
3. **自動保存の30秒インターバル**: 実機で待機して Network タブを確認（⚠️ 要確認-1 のデバウンス挙動も含む）
4. **メモ更新のリアルタイム同期**: `handleUpdateMemo` は optimistic update + 非同期 PATCH。PATCH 失敗時のロールバックなし — 要確認
5. **ドラッグ＆ドロップによるファイルアップロード**: 実機でドラッグ＆ドロップが動作するか
6. **ランク評価のスコアボタン**: タップ→スコア反映→合計更新の一連の動作確認

---

## 修正が必要な項目まとめ（優先順位順）

| 優先 | ID | 問題 | 修正内容 |
|---|---|---|---|
| 🔴 P0 | NG-1 | 候補者データ取得のレスポンス構造不一致 | L343: `setCandidate(data)` → `setCandidate(data.candidate)` |
| 🔴 P0 | NG-3 | 文字化け22箇所 | 全22行の U+FFFD を正しい日��語に置換 |
| 🟡 P1 | NG-2 | Employee の employeeNumber が API select にない | `/api/candidates/{id}/route.ts` L18 に `employeeNumber: true` を追加 |
| 🟢 P2 | 要確認-2 | AI整理ボタン onClick 未設定 | 将来実装 or 一旦削除を判断 |
| 🟢 P2 | 要確認-4 | PDF表示ボタン onClick 未設定 | 将来実装 or 一旦削除を判断 |
