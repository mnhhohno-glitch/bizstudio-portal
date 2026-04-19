# 「+ 新規面談」ボタン動作フロー解析

調査日: 2026-04-20
対象ファイル: `src/components/candidates/InterviewHistoryTab.tsx`

## 呼び出しフロー

### ボタンクリック → レコード作成

1. **[L207-213]** `onClick={handleCreateInterview}` — 「+ 新規面談」ボタン
2. **[L239-244]** `onClick={handleCreateInterview}` — 「+ 新規面談を作成」ボタン（面談0件時）
3. **[L95]** `handleCreateInterview()` が発火

### handleCreateInterview 内部フロー

```
[L96]  ガード: if (creating || !currentUser || !currentEmployeeId) return;
         ↓ パスした場合
[L97]  setCreating(true)
[L99]  const now = new Date()
[L100] timeStr = "HH:MM"
[L101-113] POST /api/interviews — リクエスト送信
         body: { candidateId, interviewDate, startTime, endTime,
                 interviewTool: "電話", interviewerUserId: currentEmployeeId,
                 interviewType: "初回面談"/"フォロー面談", status: "draft" }
[L115] レスポンスチェック: !res.ok → throw Error
[L119] const record = await res.json()
[L120] toast.success("新規面談を作成しました")
[L121] setSelectedId(record.id)         ⚠️ バグ: 後述
[L122] await fetchInterviews()          → 面談一覧を再取得
[L126] setCreating(false)
```

### fetchInterviews 内部フロー

```
[L59-77] GET /api/candidates/{id}/interviews
[L64]  records をソート (interviewCount 昇順)
[L65]  setInterviews(records)
[L67]  if (!selectedId && records.length > 0) → 最新の面談を自動選択
[L75]  setLoading(false)
```

### currentEmployeeId の取得フロー

```
[L83-93] useEffect (currentUser 依存)
  [L85]  GET /api/employees
  [L87]  レスポンスを { id, userId }[] として型付け
  [L89]  data.find(e => e.userId === currentUser.id)
  [L90]  マッチ → setCurrentEmployeeId(match.id)
```

## ガード条件一覧

| 行 | 条件 | 意味 | 失敗時の挙動 |
|---|---|---|---|
| L96 | `creating` | 二重送信防止 | サイレント return |
| L96 | `!currentUser` | 未ログイン | サイレント return |
| L96 | `!currentEmployeeId` | Employee未取得 | **サイレント return** ← 主原因 |

## 発見したバグ

### バグ1（修正済み dc4240e）: /api/employees が userId を返さない

**原因**: `/api/employees/route.ts` のレスポンスマッピングに `userId` が含まれていなかった。
`data.find(e => e.userId === currentUser.id)` が常に `undefined === "xxx"` → false。
→ `currentEmployeeId` が null のまま → ガード条件でサイレント return。

**修正**: レスポンスマッピングに `userId: emp.userId` を追加（dc4240e）。

### バグ2（未修正）: API レスポンス構造の不一致

**場所**: `InterviewHistoryTab.tsx` L119-121 vs `api/interviews/route.ts` L86

**API 側** (route.ts L86):
```typescript
return NextResponse.json({ record });  // → { record: { id: "xxx", ... } }
```

**フロント側** (InterviewHistoryTab.tsx L119-121):
```typescript
const record = await res.json();    // record = { record: { id: "xxx", ... } }
setSelectedId(record.id);           // record.id = undefined ❌
```

**影響**: 面談レコードはDBに作成されるが、`setSelectedId(undefined)` となる。
その後 `fetchInterviews()` が走り面談リストは更新されるが、
selectedId が undefined のため新規作成した面談のフォームが自動で開かない。

fetchInterviews 内の自動選択ロジック (`if (!selectedId && records.length > 0)`) は
useCallback のクロージャで古い selectedId を参照するため、
既に面談が存在する場合はこのフォールバックも効かない。

**正しいコード**:
```typescript
const data = await res.json();
setSelectedId(data.record.id);   // ← { record: { id } } 構造に合わせる
```

## 同時発火する処理

| 処理 | 発火するか | 根拠 |
|---|---|---|
| AI解析 | ❌ 呼ばれない | handleCreateInterview 内にAI呼び出しなし |
| 自動保存 (autosave) | ❌ 呼ばれない | InterviewForm 内で独立管理（30秒インターバル） |
| 添付ファイル処理 | ❌ 呼ばれない | InterviewForm 内で独立管理 |
| Supabase Storage | ❌ 呼ばれない | 面談作成とは無関係 |
| beforeunload | ❌ 呼ばれない | InterviewForm 内で設定 |
| fetchInterviews | ✅ 呼ばれる | L122: レコード作成後に一覧再取得 |

## 複雑度の評価

「レコードを作成してフォームを開く」という操作に対して、
現状の実装は **適切** である。

handleCreateInterview の処理自体はシンプル:
1. POST /api/interviews でレコード作成（1回のAPI呼び出し）
2. selectedId を設定（画面切り替え）
3. fetchInterviews で一覧更新

AI解析・自動保存・添付ファイル等の重い処理は全て InterviewForm 内で独立管理されており、
ボタンクリック時には一切発火しない。

**問題はアーキテクチャの複雑さではなく、2つの単純なバグ**:
1. API レスポンスに userId が欠落（修正済み）
2. API レスポンス構造の不一致（`{ record: {...} }` vs 直接アクセス）

## 修正方針: ケースA（ピンポイント修正）

バグ2の修正のみで解決する。アーキテクチャ変更は不要。

修正箇所: `InterviewHistoryTab.tsx` L119-121

```typescript
// 修正前
const record = await res.json();
toast.success("新規面談を作成しました");
setSelectedId(record.id);

// 修正後
const data = await res.json();
toast.success("新規面談を作成しました");
setSelectedId(data.record.id);
```
