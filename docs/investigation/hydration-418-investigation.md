# React Error #418 調査レポート

調査日: 2026-04-20
ブランチ: staging
前回修正: dc4c7ae

## 1. dev サーバーでのエラー詳細

### dev サーバー起動確認

- `npm run dev` 起動済み（Next.js 16.1.6 Turbopack, http://localhost:3000）
- サーバーサイドログにhydration関連の警告・エラーなし

### 完全なエラーメッセージ

**ユーザー確認待ち。**

dev モードで `http://localhost:3000/candidates/[候補者ID]?tab=interview` にアクセスし、Chrome DevTools Console で以下を確認:

1. `Warning: Text content did not match. Server: "XXX" Client: "YYY"` のメッセージ
2. コンポーネントスタックトレース（at ComponentName ...）
3. 実際のServer値とClient値

staging（本番ビルド）では最小化されており:
```
Uncaught Error: Minified React error #418;
visit https://react.dev/errors/418?args[]=text&args[]=
```
しか得られない。dev モードでの再現が必要。

## 2. 機械的スキャン結果

対象ファイル:
- `src/app/(app)/candidates/[candidateId]/page.tsx`
- `src/components/candidates/*.tsx` (全18ファイル)
- `src/app/layout.tsx`, `src/app/(app)/layout.tsx`
- `src/components/layout/TopBar.tsx`, `src/components/layout/Sidebar.tsx`

### 2-1. new Date() / Date.now()

| ファイル | 行 | コード | SSR影響 |
|---|---|---|---|
| CandidateHeader.tsx | 56 | `const today = new Date()` (calcAge内) | **修正済み** — useEffect化済み (dc4c7ae) |
| page.tsx | 164 | `const today = new Date()` (EditModal内calcAge) | **安全** — EditModalは条件付きレンダリング (`editModalOpen &&`)、初期値false |
| page.tsx | 1010 | `new Date(new Date().toDateString())` (isOverdue) | **安全** — CandidateTasksTabのtasksはuseEffectで取得、SSR時は空配列 |
| InterviewHistoryTab.tsx | 99 | `const now = new Date()` | **安全** — handleCreateInterview内（イベントハンドラ） |
| InterviewForm.tsx | 66 | `Date.now()` (formatTimeAgo内) | **安全** — lastSavedAt初期値null、データ取得後のみ表示 |
| InterviewForm.tsx | 403 | `new Date()` | **安全** — setLastSavedAt内（autosave後の状態更新） |
| InterviewForm.tsx | 449 | `new Date().toISOString()` | **安全** — AI解析完了時の状態更新 |
| SupportEndModal.tsx | 18 | `useState(new Date().toISOString().slice(0,10))` | **安全** — 条件付きレンダリング (`showEndModal &&`) |
| HistoryTab.tsx | 86 | `const now = new Date()` (todayString内) | **安全** — EntryDateModal内、条件付きレンダリング |
| DocumentsTab.tsx | 263 | `new Date().toISOString()` | **安全** — download handler内（イベントハンドラ） |
| AdvisorFloatingPanel.tsx | 複数 | `Date.now()`, `new Date()` | **安全** — 全てイベントハンドラ/状態更新内 |
| AdvisorTab.tsx | 複数 | `Date.now()`, `new Date()` | **安全** — 全てイベントハンドラ/状態更新内 |

### 2-2. typeof window / typeof document

| ファイル | 行 | コード | SSR影響 |
|---|---|---|---|
| page.tsx | 337→339 | `window.location.origin` (InterviewTab) | **修正済み** — useState+useEffect化済み (dc4c7ae) |
| page.tsx | 524 | `typeof window !== "undefined" ? window.location.origin : ""` (JimuSection) | **安全** — line 548のイベントハンドラでのみ使用、JSXに直接レンダリングなし |

### 2-3. toLocaleDateString / toLocaleString

| ファイル | 行 | コード | SSR影響 |
|---|---|---|---|
| page.tsx | 1005 | `new Date(d).toLocaleDateString("ja-JP")` (CandidateTasksTab.fmtDate) | **安全** — tasks取得はuseEffect後、SSR時は空配列 |
| page.tsx | 1637 | `new Date(mypageExpiresAt).toLocaleDateString("ja-JP")` | **安全** — mypageModalOpen条件付き（初期false） |
| DocumentsTab.tsx | 620,714 | `toLocaleDateString("ja-JP")` | **安全** — データはuseEffect取得後 |
| InterviewForm.tsx | 709,955 | `toLocaleDateString("ja-JP")` | **安全** — データはuseEffect取得後 |

### 2-4. navigator / window 参照

全てイベントハンドラまたはuseEffect内:
- `navigator.clipboard.writeText()` — CandidateHeader, InterviewUrlModal, HistoryTab, AdvisorTab, DocumentsTab等
- `window.open()` — DocumentsTab, page.tsx
- `window.addEventListener()` — HistoryTab, InterviewForm (useEffect内)
- `window.location.origin` — page.tsx line 1508 (イベントハンドラ内)

**JSXレンダリングパスで直接使用されているものはなし。**

### 2-5. localStorage / sessionStorage

| ファイル | 行 | コード | SSR影響 |
|---|---|---|---|
| InterviewForm.tsx | 345 | `localStorage.setItem(...)` | **安全** — autosave errorハンドラ内 |

### 2-6. Math.random / UUID生成

該当箇所なし。

### 2-7. suppressHydrationWarning

プロジェクト内での使用なし。（sonner内部で `<section>` に適用済み）

## 3. 前回修正済みの箇所 (dc4c7ae)

| ファイル | 箇所 | 修正内容 | 状態 |
|---|---|---|---|
| CandidateHeader.tsx | calcAge呼び出し | `const age = calcAge(...)` → `useState(null)` + `useEffect` | 確認済み OK |
| page.tsx InterviewTab | appUrl | `typeof window` 三項演算子 → `useState("")` + `useEffect` | 確認済み OK |

## 4. SSR時のレンダリングパス分析

### メインページ (CandidateDetailPage)

SSR時の状態:
- `loading = true` (useState初期値)
- `candidate = null`
- 全ての他のstateも初期値

SSR出力:
```html
<div class="flex items-center justify-center py-20">
  <div class="text-center">
    <div class="animate-spin h-8 w-8 border-4 border-[#2563EB] border-t-transparent rounded-full mx-auto"></div>
    <p class="mt-3 text-[14px] text-gray-500">読み込み中...</p>
  </div>
</div>
```

ハイドレーション時: 同一のスピナーが描画される → **不一致なし**

CandidateHeader, InterviewHistoryTab, 全タブコンテンツ, Toaster, モーダル類は全て `!loading && candidate` 条件後に描画 → SSR時には存在しない。

### Layout (app/layout.tsx, (app)/layout.tsx)

- `RootLayout`: `<html lang="ja"><body>` のみ → **不一致なし**
- `AppLayout`: Server Componentで `<Sidebar>` + `<TopBar>` + `{children}`
  - Sidebar: `usePathname()` 使用 → pathname一致
  - TopBar: Server Component → ハイドレーション対象外
  - **不一致の可能性なし**

## 5. 環境情報

| 項目 | 値 |
|---|---|
| Next.js | 16.1.6 (Turbopack) |
| React | 19.2.3 |
| sonner | 2.0.7 |
| reactStrictMode | 未設定（next.config.tsに記載なし） |
| experimental | なし |
| output | 未設定（デフォルト） |

## 6. 現時点の推測される原因候補

### 候補1: sonner Toaster の内部動作 (確度: 低〜中)

sonner 2.0.7 の `useIsDocumentHidden` フック:
```javascript
// node_modules/sonner/dist/index.mjs:110
const [isDocumentHidden, setIsDocumentHidden] = React.useState(document.hidden);
```

SSR時に `document` が未定義のためエラーまたは不一致の可能性。ただし:
- Toaster 自体がSSR時にレンダリングされない（loading=true で早期return）
- Toaster の `<section>` には `suppressHydrationWarning: true` がある
- この hooks は Toast コンポーネント内で使用（Toaster ではない）

→ **ページのToasterはSSR時に描画されないため影響なしの可能性が高い**

### 候補2: useSearchParams() に Suspense バウンダリがない (確度: 低)

Next.js 公式ドキュメントでは `useSearchParams()` に `Suspense` が推奨。ただし:
- 他の多くのページ (login, tasks/new, manuals, documents等) でも同パターン
- SSR時の初期レンダリングはスピナーのみでsearchParamsが影響するUI要素なし
- 動的ルートのため searchParams はSSR時に利用可能

→ **他ページも同パターンのため、本件の直接原因ではない可能性が高い**

### 候補3: ブラウザ拡張機能によるDOM注入 (確度: 中)

Grammarly, LastPass, React DevTools 等の拡張機能がHTMLにDOM要素を注入し、React 19 の厳格なハイドレーションチェックに引っかかる可能性。

→ **シークレットモード + 拡張無効で再現テストが必要**

### 候補4: Phase 5a以前からの既存問題 (確度: 中)

`typeof window` パターンや `new Date()` の使用は Phase 5a 以前から存在。しかし:
- Phase 5a で CandidateHeader を新規作成（calcAge 問題を導入）
- Phase 5a で InterviewTab の appUrl をJSXに直接使用
- これらは dc4c7ae で修正済み

→ **修正済みの箇所以外に Phase 5a で導入された問題はスキャンで発見されず**

### 候補5: React 19 + Next.js 16 の未知の挙動 (確度: 低)

React 19.2.3 は 比較的新しく、Next.js 16.1.6 との組み合わせで未知のハイドレーション問題がある可能性。

## 7. 次のアクション

**将幸さんに以下のいずれかを選択いただく:**

### A: dev サーバーで完全なエラーメッセージを取得（推奨）

1. dev サーバー起動済み (`npm run dev`)
2. Chrome で `http://localhost:3000/candidates/[候補者ID]?tab=interview` にアクセス
3. DevTools > Console で完全なエラーメッセージを確認
4. `Warning: Text content did not match. Server: "XXX" Client: "YYY"` と表示されるはず
5. コンポーネントスタックトレースからピンポイントで原因特定

### B: シークレットモードで再現テスト

1. Chrome シークレットモード（拡張無効）で staging 環境にアクセス
2. 同じ候補者詳細ページを開く
3. エラーが再現するか確認 → 再現しなければ拡張機能が原因

### C: 全候補箇所を一括修正

スキャン結果でSSR影響「安全」と判断した箇所は全て、loading/条件付きレンダリングにより保護されているが、念のため全候補を修正:
- page.tsx JimuSection の `typeof window` を useState+useEffect 化
- 重複 Toaster を1つに統合

ただし、原因特定なしの修正のためAを先に実施することを推奨。

### D: sonner バージョンアップ

sonner 2.0.7 → 最新版にアップデートして再現確認。
sonner には SSR 関連の修正が入っている可能性がある。
