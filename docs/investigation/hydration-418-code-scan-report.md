# Hydration #418 網羅的コードスキャンレポート

調査日: 2026-04-19
ブランチ: staging
調査者: Claude (自動スキャン)

## 1. SSR レンダリングパス

### RootLayout (`src/app/layout.tsx`)
- `<html lang="ja"><body>{children}</body></html>` のみ
- 動的コンテンツなし → **不一致の可能性なし**

### AppLayout (`src/app/(app)/layout.tsx`)
- Server Component: `<Sidebar>` + `<TopBar>` + `{children}`
- `Sidebar`: `usePathname()` でアクティブ状態を判定。テキストは全て静的日本語文字列。`process.env.NEXT_PUBLIC_*` はビルド時埋め込み
- `TopBar`: Server Component。`userName` + "ログアウト" のみ
- **不一致の可能性なし**

### CandidateDetailPage (`src/app/(app)/candidates/[candidateId]/page.tsx`)
- `"use client"` コンポーネント（SSR対象）
- `loading = true` (useState初期値) で早期return
- SSR出力はスピナーのみ: `<div class="animate-spin ..."></div><p>読み込み中...</p>`
- CandidateHeader, 全タブコンテンツ, Toaster, モーダル類は `!loading && candidate` 条件後 → **SSR時に存在しない**

### SSR HTML テキストコンテンツ（実測）

`next build && next start` でローカルに本番ビルドを起動し、curl で取得した SSR HTML のテキスト要素:

| テキスト | ソース | 動的か |
|---|---|---|
| ダッシュボード, 求職者, タスク, 求人, ... | Sidebar (静的) | No |
| 大野 望 | TopBar (Server Component) | セッション依存・静的 |
| 読み込み中... | page.tsx スピナー | No |

**TZ=UTC と TZ=Asia/Tokyo で SSR HTML を比較 → バイト単位で完全一致。**

## 2. grep スキャン結果サマリー

対象: `src/app/(app)/candidates/[candidateId]/page.tsx` + `src/components/candidates/*.tsx` + レイアウト関連

### 2-1. new Date() / Date.now()

全12箇所を検出。全て以下のいずれかで保護:

- `useEffect` 内（dc4c7ae 修正済み: CandidateHeader.tsx calcAge）
- イベントハンドラ内（InterviewHistoryTab, InterviewForm, DocumentsTab, AdvisorTab等）
- 条件付きレンダリング内（EditModal `editModalOpen &&`, SupportEndModal `showEndModal &&`）
- useEffect でデータ取得後のみ表示（CandidateTasksTab, DocumentsTab）

**SSR レンダリングパスで直接実行される箇所: なし**

### 2-2. toLocaleDateString / toLocaleString

全6箇所を検出。全て useEffect でのデータ取得後 or 条件付きレンダリング内。

**ロケール依存の出力が SSR HTML に含まれる箇所: なし**

### 2-3. typeof window / navigator / document

- page.tsx line 524 `typeof window !== "undefined"`: イベントハンドラ内のみ、JSX 直接レンダリングなし
- page.tsx InterviewTab `appUrl`: dc4c7ae で useState+useEffect に修正済み
- その他: 全て `navigator.clipboard`, `window.open()`, `window.addEventListener()` — イベントハンドラまたは useEffect 内

**SSR/CSR 分岐が HTML 出力に影響する箇所: なし（修正済み）**

### 2-4. localStorage / sessionStorage

InterviewForm.tsx line 345 のみ — autosave エラーハンドラ内。**SSR 影響なし**

### 2-5. Math.random / UUID 生成

該当なし。

### 2-6. Intl.DateTimeFormat / Intl.NumberFormat

該当なし。

### 2-7. suppressHydrationWarning

プロジェクトコード内での使用なし。sonner 内部の `<section>` にのみ適用。

## 3. useSearchParams() Suspense バウンダリ分析

Next.js App Router では `useSearchParams()` を使う Client Component は `<Suspense>` で囲むことが推奨される。Suspense なしの場合、ページ全体が Client-side rendering にフォールバックする可能性がある。

| ページ | useSearchParams | Suspense | 備考 |
|---|---|---|---|
| `/login` | ✅ line 7 | ✅ line 85 | OK |
| `/auth/callback` | ✅ line 7 | ✅ line 84 | OK |
| `/invite/[token]` | ✅ line 9 | ❌ | Suspense なし |
| `/candidates/[candidateId]` | ✅ line 1306 | ❌ | **問題ページ。Suspense なし** |
| `/tasks/new` | ✅ line 112 | ❌ | Suspense なし |
| `/jobs` | ✅ line 20 | ❌ | Suspense なし |
| `/documents` | ✅ line 25 | ✅ line 231 | OK |
| `/manuals` | ✅ line 47 | ✅ line 355 | OK |
| `/announcements` | ✅ line 32 | ❌ | Suspense なし |

**5/9 ページで Suspense バウンダリなし。** ただし candidate ページ以外でも Hydration エラーが報告されていない点から、これが直接の原因とは断定できない。

## 4. sonner (Toast ライブラリ) 分析

sonner 2.0.7 内部:

- `useIsDocumentHidden` フック: `useState(document.hidden)` — SSR 時に `document` 未定義の可能性
- ただし `Toaster` コンポーネント自体の `<section>` に `suppressHydrationWarning: true` が設定済み
- Toast は通知がある時のみレンダリング（SSR 時は通知なし）
- candidate ページでは `loading=true` 時に Toaster が描画されない

**sonner が原因の可能性: 低**

## 5. Railway 環境との差異分析

### 環境差異

| 項目 | ローカル | Railway |
|---|---|---|
| タイムゾーン | JST (UTC+9) | UTC |
| ロケール | ja_JP | en (POSIX) |
| Node.js | ローカル版 | Railway コンテナ |
| ビルド | Turbopack (dev) / webpack (build) | Railway ビルドパイプライン |

### 検証結果

- `TZ=UTC next build && TZ=UTC next start` でローカル本番ビルドを起動
- SSR HTML を JST ビルドと比較 → **バイト単位で完全一致**
- SSR HTML にロケール/タイムゾーン依存のテキストが含まれないため、差異が出る経路がない

### Railway 固有の可能性

1. **CDN/Edge キャッシュ**: Railway がレスポンスをキャッシュし、古い SSR HTML と新しいクライアント JS が不一致する可能性
2. **ビルドキャッシュ**: Railway のビルドキャッシュが古いバージョンのコンポーネントを含む可能性
3. **Node.js バージョン差異**: `Intl` や `Date` の出力差（ただし SSR HTML に日付テキストが含まれないため影響なし）

## 6. 結論

### 確定事実

1. SSR HTML は静的テキストのみ（Sidebar メニュー + ユーザー名 + "読み込み中..."）で、タイムゾーン・ロケール依存の内容を含まない
2. `new Date()`, `toLocaleDateString()`, `typeof window` 等の全パターンについて、SSR レンダリングパスで直接実行される箇所はない（修正済み or 保護済み）
3. dev サーバー (Puppeteer) で 0 件、本番ビルド (Puppeteer) で 0 件、UTC 本番ビルドでも 0 件 — ローカルでは再現不可
4. TZ=UTC と TZ=JST の SSR HTML はバイト単位で一致

### 未確定の原因候補（優先度順）

| # | 候補 | 確度 | 根拠 |
|---|---|---|---|
| 1 | Railway ビルド/デプロイキャッシュの不整合 | **中〜高** | SSR HTML と Client JS のバージョン不一致。dc4c7ae 修正前のキャッシュが残存している可能性 |
| 2 | useSearchParams() の Suspense バウンダリ欠如 | **低〜中** | Next.js が警告するパターンだが、他の同パターンページで問題報告なし |
| 3 | sonner 内部の document.hidden useState | **低** | Toaster は SSR 時に描画されないため影響なし |
| 4 | React 19 + Next.js 16 の未知の挙動 | **低** | 再現できないため検証不可 |

### 推奨アクション

1. **Railway で完全なクリーンデプロイ**: ビルドキャッシュを削除して再デプロイし、キャッシュ不整合を排除
2. **Railway staging で再現確認**: クリーンデプロイ後にシークレットモードでアクセスし、エラーが消えたか確認
3. **それでも再現する場合**: candidate ページの `useSearchParams()` を `<Suspense>` で囲む修正を試行
4. **dev モードでの詳細エラー**: Railway 環境変数に `NODE_ENV=development` を一時的に設定し、完全なエラーメッセージ（Server: "XXX" Client: "YYY"）を取得
